import { describe, expect, it } from "vitest";
import { tripWith } from "./testUtils";
import { computeDayTimeline, findBase, isOpenDuring } from "./timeline";
import { legKey, type Item } from "./types";

describe("isOpenDuring", () => {
  const nineToFive = [1, 2, 3, 4, 5].map((day) => ({
    open: { day, hour: 9, minute: 0 },
    close: { day, hour: 17, minute: 0 },
  }));
  it("handles regular hours", () => {
    expect(isOpenDuring(nineToFive, 1, 600, 660)).toBe(true);
    expect(isOpenDuring(nineToFive, 1, 960, 1080)).toBe(false);
    expect(isOpenDuring(nineToFive, 0, 600, 660)).toBe(false);
  });
  it("handles past-midnight closing and 24/7", () => {
    const bar = [{ open: { day: 5, hour: 20, minute: 0 }, close: { day: 6, hour: 2, minute: 0 } }];
    expect(isOpenDuring(bar, 5, 22 * 60, 23 * 60 + 30)).toBe(true);
    expect(isOpenDuring([{ open: { day: 0, hour: 0, minute: 0 } }], 3, 0, 100)).toBe(true);
    expect(isOpenDuring(undefined, 3, 0, 100)).toBeUndefined();
  });
});

describe("computeDayTimeline", () => {
  it("flows items, waits for fixed times and flags lateness", () => {
    const a: Item = { id: "a", type: "place", title: "A", durationMin: 60 };
    const b: Item = { id: "b", type: "activity", title: "B", startTime: "11:00", durationMin: 60 };
    const c: Item = { id: "c", type: "activity", title: "C", startTime: "11:30", durationMin: 30 };
    const trip = tripWith([[a, b, c]]);
    trip.legs[legKey("a", "b")] = { mode: "FERRY", manualMin: 30 };
    trip.legs[legKey("b", "c")] = { mode: "BOAT", manualMin: 20 };
    const tl = computeDayTimeline(trip, 0);
    expect(tl.entries.map((e) => [e.start, e.end])).toEqual([
      [540, 600],
      [660, 720],
      [690, 720],
    ]);
    expect(tl.entries[1].issues).toHaveLength(0); // arrives 10:30, waits for 11:00
    expect(tl.entries[2].issues[0].message).toMatch(/50 min after/);
    expect(tl.travelMin).toBe(50);
  });

  it("lets the first appointment set the departure time", () => {
    const dive: Item = { id: "d", type: "dive", title: "Dive", startTime: "07:30", durationMin: 240 };
    const tl = computeDayTimeline(tripWith([[dive]]), 0); // day starts 09:00 by default
    expect(tl.entries[0].start).toBe(450);
    expect(tl.entries[0].issues).toHaveLength(0);
  });

  it("starts the day from the stay you slept in", () => {
    const hotel: Item = { id: "h", type: "stay", title: "Hotel", stay: { nights: 2 }, location: { lat: 0, lng: 0 } };
    const x: Item = { id: "x", type: "place", title: "X", location: { lat: 0, lng: 0.1 } };
    const trip = tripWith([[hotel], [x], [], []]);
    expect(findBase(trip, 1)?.id).toBe("h");
    expect(findBase(trip, 2)?.id).toBe("h");
    expect(findBase(trip, 3)).toBeUndefined();
    const tl = computeDayTimeline(trip, 1);
    expect(tl.entries[0].fromId).toBe("h");
    expect(tl.entries[0].legEstimated).toBe(true);
  });

  it("warns when a place is closed that weekday", () => {
    const museum: Item = {
      id: "m",
      type: "place",
      title: "Museum",
      place: { openingPeriods: [{ open: { day: 2, hour: 9, minute: 0 }, close: { day: 2, hour: 17, minute: 0 } }] },
    };
    const tl = computeDayTimeline(tripWith([[museum]]), 0); // 2026-06-01 is a Monday
    expect(tl.entries[0].issues[0].message).toMatch(/Closed/);
  });
});
