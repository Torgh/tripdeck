import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The store persists to localStorage; give Node a simple one before the store is created.
const writes = vi.hoisted(() => {
  const data = new Map<string, string>();
  const writes: string[] = [];
  globalThis.localStorage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void (writes.push(k), data.set(k, String(v))),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    key: (i: number) => [...data.keys()][i] ?? null,
    get length() {
      return data.size;
    },
  } as Storage;
  return writes;
});

const { createTrip, useStore } = await import("./store");

const saved = () => JSON.parse(localStorage.getItem("tripdeck")!).state.trips;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  writes.length = 0;
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe("saving in the browser", () => {
  it("writes a burst of edits once, half a second after the first", () => {
    const trip = createTrip({ name: "Malta", destination: "Malta", startDate: "2026-11-01", days: 2 });
    useStore.getState().saveTrip(trip);
    for (const name of ["M", "Ma", "Mal", "Malt", "Malta & Gozo"]) useStore.getState().updateTrip(trip.id, { name });
    expect(writes).toEqual([]);

    vi.advanceTimersByTime(500);
    expect(writes).toEqual(["tripdeck"]);
    expect(saved()[trip.id].name).toBe("Malta & Gozo");
  });

  it("reads back edits that are not written yet", async () => {
    const trip = createTrip({ name: "Gozo", destination: "Malta", startDate: "2026-11-01", days: 1 });
    useStore.getState().saveTrip(trip);
    expect(localStorage.getItem("tripdeck")).toBeNull();

    const stored = await useStore.persist.getOptions().storage!.getItem("tripdeck");
    expect(stored?.state).toMatchObject({ trips: { [trip.id]: { name: "Gozo" } } });
  });
});
