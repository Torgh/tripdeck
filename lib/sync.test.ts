import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Trip } from "./types";

// The store persists to localStorage; give Node a simple one before the store is created.
vi.hoisted(() => {
  const data = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    key: (i: number) => [...data.keys()][i] ?? null,
    get length() {
      return data.size;
    },
  } as Storage;
});

const { useStore, parseTripFile } = await import("./store");
const { syncNow, useSyncState } = await import("./sync");

const trip = (id: string, updatedAt: string, name = id): Trip =>
  ({ id, name, updatedAt, startDate: "2026-11-01", destination: "", interests: "", defaultMode: "DRIVE", days: [{ id: `${id}-d1`, itemIds: [], startTime: "09:00" }], ideas: [], items: {}, legs: {} }) as Trip;

/** A fake /api/trips server holding `remote`, recording what the browser sends. */
function server(remote: Record<string, Trip>, storage = "local", email?: string) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push(`${method} ${url}`);
      const id = url.split("/api/trips/")[1];
      if (url === "/api/trips") {
        const trips = Object.values(remote).map((t) => ({ id: t.id, name: t.name, updatedAt: t.updatedAt }));
        return Response.json({ storage, email, trips });
      }
      if (method === "GET") return Response.json({ trip: remote[id] });
      if (method === "PUT") return (remote[id] = JSON.parse(String(init!.body))), Response.json({ ok: true });
      if (method === "DELETE") return delete remote[id], Response.json({ ok: true });
      throw new Error(`unexpected ${method} ${url}`);
    }),
  );
  return { remote, calls };
}

const local = () => useStore.getState();

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("tripdeck.syncTarget", "local:");
  useStore.setState({ trips: {}, synced: {}, deleted: [] });
  useSyncState.getState().set({ status: "idle" });
});

describe("syncNow", () => {
  it("downloads trips that are newer on the server", async () => {
    useStore.setState({ trips: { a: trip("a", "2026-10-01") }, synced: { a: "2026-10-01" } });
    server({ a: trip("a", "2026-10-02", "edited by Claude") });
    await syncNow();
    expect(local().trips.a.name).toBe("edited by Claude");
    expect(local().synced.a).toBe("2026-10-02");
  });

  it("uploads trips that are newer here", async () => {
    useStore.setState({ trips: { a: trip("a", "2026-10-03", "edited here") }, synced: { a: "2026-10-01" } });
    const s = server({ a: trip("a", "2026-10-01") });
    await syncNow();
    expect(s.remote.a.name).toBe("edited here");
    expect(local().synced.a).toBe("2026-10-03");
  });

  it("uploads new trips and downloads trips it has never seen", async () => {
    useStore.setState({ trips: { mine: trip("mine", "2026-10-01") } });
    const s = server({ theirs: trip("theirs", "2026-10-01") });
    await syncNow();
    expect(Object.keys(s.remote).sort()).toEqual(["mine", "theirs"]);
    expect(Object.keys(local().trips).sort()).toEqual(["mine", "theirs"]);
  });

  it("drops a trip that was deleted elsewhere", async () => {
    useStore.setState({ trips: { a: trip("a", "2026-10-01") }, synced: { a: "2026-10-01" } });
    server({});
    await syncNow();
    expect(local().trips.a).toBeUndefined();
  });

  it("deletes on the server what was deleted here, and doesn't download it again", async () => {
    useStore.setState({ trips: { a: trip("a", "2026-10-01") }, synced: { a: "2026-10-01" } });
    local().deleteTrip("a");
    expect(local().deleted).toEqual(["a"]);
    const s = server({ a: trip("a", "2026-10-01") });
    await syncNow();
    expect(s.remote).toEqual({});
    expect(local().trips.a).toBeUndefined();
    expect(local().deleted).toEqual([]);
  });

  it("after switching storage, uploads trips instead of treating them as deleted", async () => {
    // Synced with "This PC" before; the server now reports OneDrive, which is still empty.
    useStore.setState({ trips: { a: trip("a", "2026-10-01") }, synced: { a: "2026-10-01" } });
    const s = server({}, "onedrive");
    await syncNow();
    expect(Object.keys(s.remote)).toEqual(["a"]);
    expect(local().trips.a).toBeDefined();
    expect(useSyncState.getState().state).toMatchObject({ status: "ok", storage: "onedrive" });
  });

  it("does nothing when both sides already agree", async () => {
    useStore.setState({ trips: { a: trip("a", "2026-10-01") }, synced: { a: "2026-10-01" } });
    const s = server({ a: trip("a", "2026-10-01") });
    await syncNow();
    expect(s.calls).toEqual(["GET /api/trips"]);
  });

  it("runs one sync at a time", async () => {
    const s = server({});
    await Promise.all([syncNow(), syncNow(), syncNow()]);
    expect(s.calls).toEqual(["GET /api/trips"]);
  });

  it("keeps changes in the browser and reports when offline", async () => {
    useStore.setState({ trips: { a: trip("a", "2026-10-01") } });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await syncNow();
    expect(useSyncState.getState().state).toMatchObject({ status: "error", message: expect.stringMatching(/Offline/) });
    expect(local().trips.a).toBeDefined();
  });

  it("shows the server's error message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Google Drive is unreachable" }, { status: 503 })));
    await syncNow();
    expect(useSyncState.getState().state).toEqual({ status: "error", message: "Google Drive is unreachable" });
  });
});

describe("store", () => {
  it("bumps updatedAt on every edit so the next sync uploads it", () => {
    useStore.setState({ trips: { a: trip("a", "2000-01-01T00:00:00.000Z") } });
    local().updateTrip("a", { name: "renamed" });
    expect(local().trips.a.name).toBe("renamed");
    expect(local().trips.a.updatedAt > "2000").toBe(true);
  });

  it("only queues a server delete for trips the server knows", () => {
    useStore.setState({ trips: { a: trip("a", "1"), b: trip("b", "1") }, synced: { a: "1" } });
    local().deleteTrip("a");
    local().deleteTrip("b");
    expect(local().deleted).toEqual(["a"]);
  });

  it("removing a day moves its cards to Ideas, but never removes the last day", () => {
    const t = trip("a", "1");
    t.days.push({ id: "d2", itemIds: ["x"], startTime: "09:00" });
    t.items.x = { id: "x", type: "place", title: "x" };
    useStore.setState({ trips: { a: t } });
    local().removeDay("a", "d2");
    expect(local().trips.a.ideas).toEqual(["x"]);
    local().removeDay("a", "a-d1");
    expect(local().trips.a.days).toHaveLength(1);
  });

  it("persists trips, sync state and pending deletes", () => {
    useStore.setState({ trips: { a: trip("a", "1") }, synced: { a: "1" }, deleted: ["z"] });
    expect(JSON.parse(localStorage.getItem("tripdeck")!).state).toEqual({
      trips: { a: trip("a", "1") },
      synced: { a: "1" },
      deleted: ["z"],
    });
  });
});

describe("parseTripFile", () => {
  it("imports an exported trip under a new id", () => {
    const exported = trip("old-id", "2026-01-01", "Malta");
    const imported = parseTripFile(JSON.parse(JSON.stringify(exported)));
    expect(imported.id).not.toBe("old-id");
    expect(imported).toMatchObject({ name: "Malta", days: exported.days });
    expect(imported.updatedAt > "2026-01-01").toBe(true);
  });

  it("keeps the file's id and date with keepId, so a re-import replaces the trip", () => {
    const exported = trip("old-id", "2026-01-01", "Malta");
    expect(parseTripFile(JSON.parse(JSON.stringify(exported)), { keepId: true })).toMatchObject({
      id: "old-id",
      updatedAt: "2026-01-01",
    });
    const { id: _id, ...noId } = exported;
    expect(parseTripFile(noId, { keepId: true }).id).toEqual(expect.any(String));
  });

  it("fills fields that older exports lack", () => {
    const { ideas: _i, legs: _l, interests: _n, defaultMode: _m, ...old } = trip("x", "1");
    expect(parseTripFile(old)).toMatchObject({ ideas: [], legs: {}, interests: "", defaultMode: "DRIVE" });
  });

  it.each([null, "text", { days: [] }, { days: [], items: {} }, { items: {}, startDate: "2026-01-01" }])(
    "rejects %j",
    (json) => {
      expect(() => parseTripFile(json)).toThrow(/not a TripDeck trip/);
    },
  );
});
