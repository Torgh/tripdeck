import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { Trip } from "../types";

const home = vi.hoisted(() => {
  // DATA_DIR is read when ./config is first imported.
  const dir = `${process.env.TMPDIR ?? process.env.TEMP ?? "/tmp"}/tripdeck-lock-test-${process.pid}`;
  process.env.TRIPDECK_HOME = dir;
  return dir;
});

const { saveIfUnchanged, withTripLock } = await import("./tripLock");

afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A store as slow as Google Drive: every read and write takes a while. */
function slowStore(first: Trip) {
  let stored = first;
  return {
    kind: "google" as const,
    location: "test",
    list: async () => [],
    get: async () => (await sleep(30), structuredClone(stored)),
    put: async (t: Trip) => (await sleep(30), void (stored = structuredClone(t))),
    delete: async () => undefined,
    stored: () => stored,
  };
}

const trip = (updatedAt: string, name: string): Trip => ({
  id: "t1",
  name,
  destination: "x",
  startDate: "2027-01-10",
  interests: "",
  defaultMode: "DRIVE",
  days: [],
  ideas: [],
  items: {},
  legs: {},
  updatedAt,
});

describe("saving a trip from two places at once", () => {
  it("lets exactly one save through and hands the other the newer trip", async () => {
    const store = slowStore(trip("v0", "start"));
    // The browser (via the web app) and Claude (via MCP) both edited version v0.
    const [browser, claude] = await Promise.all([
      saveIfUnchanged(store, trip("v1-browser", "browser"), "v0"),
      saveIfUnchanged(store, trip("v1-claude", "claude"), "v0"),
    ]);
    expect([browser.saved, claude.saved].sort()).toEqual([false, true]);
    const loser = browser.saved ? claude : browser;
    // The one refused sees the winner's save, so it can merge instead of overwriting it.
    expect(!loser.saved && loser.current.updatedAt).toBe(store.stored().updatedAt);
  });

  it("writes without a base version (a brand-new trip)", async () => {
    const store = slowStore(trip("v0", "start"));
    expect(await saveIfUnchanged(store, trip("v9", "new"), undefined)).toEqual({ saved: true });
    expect(store.stored().name).toBe("new");
  });

  it("takes over a lock left behind by a crashed process", async () => {
    const lock = path.join(home, "locks", "t2.lock");
    fs.mkdirSync(path.dirname(lock), { recursive: true });
    fs.writeFileSync(lock, "12345");
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(lock, old, old);
    await expect(withTripLock("t2", async () => "done")).resolves.toBe("done");
    expect(fs.existsSync(lock)).toBe(false);
  });
});
