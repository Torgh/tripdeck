import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const home = vi.hoisted(() => {
  // DATA_DIR is read when ./config is first imported.
  const dir = `${process.env.TMPDIR ?? process.env.TEMP ?? "/tmp"}/tripdeck-cache-test-${process.pid}`;
  process.env.TRIPDECK_HOME = dir;
  return dir;
});

const { DAY_MS, DiskCache } = await import("./cache");

const files = (name: string) => fs.readdirSync(path.join(home, "cache", name));

afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(home, { recursive: true, force: true });
});

describe("DiskCache", () => {
  it("keeps answers on disk, where another process finds them", async () => {
    const fetch = vi.fn(async () => 42);
    expect(await new DiskCache<number>("t1", DAY_MS).getOrFetch("Malta", fetch)).toBe(42);
    expect(await new DiskCache<number>("t1", DAY_MS).getOrFetch("Malta", fetch)).toBe(42);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(files("t1")).toHaveLength(1);
  });

  it("asks once when several requests want the same answer at the same time", async () => {
    const cache = new DiskCache<string>("t2", DAY_MS);
    const fetch = vi.fn(async () => "Europe/Malta");
    const answers = await Promise.all([1, 2, 3].map(() => cache.getOrFetch("35.9,14.5", fetch)));
    expect(answers).toEqual(["Europe/Malta", "Europe/Malta", "Europe/Malta"]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("never keeps an error", async () => {
    const cache = new DiskCache<number>("t3", DAY_MS);
    await expect(cache.getOrFetch("k", async () => Promise.reject(new Error("quota")))).rejects.toThrow("quota");
    expect(await cache.getOrFetch("k", async () => 7)).toBe(7);
  });

  it("forgets answers older than their time to live and deletes them on the next write", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-01T00:00:00Z"));
    new DiskCache<number>("t4", DAY_MS).set("old", 1);
    // The cleanup goes by the file's time, which the fake clock doesn't set.
    const file = path.join(home, "cache", "t4", files("t4")[0]);
    fs.utimesSync(file, new Date("2026-10-01T00:00:00Z"), new Date("2026-10-01T00:00:00Z"));

    vi.setSystemTime(new Date("2026-10-02T00:00:01Z"));
    const later = new DiskCache<number>("t4", DAY_MS);
    expect(later.get("old")).toBeUndefined();
    later.set("new", 2);
    expect(files("t4")).toHaveLength(1);
    expect(later.get("new")).toBe(2);
  });

  it("still answers when the folder can't be written", async () => {
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(path.join(home, "cache"), "a file where the folder should be");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await new DiskCache<number>("t5", DAY_MS).getOrFetch("k", async () => 3)).toBe(3);
    expect(warn).toHaveBeenCalled();
  });
});
