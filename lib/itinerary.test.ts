import { describe, expect, it } from "vitest";
import { defaultDayIndex, localIsoDate, navigationUrl, todayIndex, tripStatus } from "./itinerary";
import { tripWith } from "./testUtils";

// Starts Mon 1 Jun 2026, three days.
const trip = tripWith([[], [], []]);
/** Local noon on 2026-06-<day>, so the result does not depend on the machine's time zone. */
const june = (day: number) => new Date(2026, 5, day, 12);

describe("localIsoDate", () => {
  it("uses the device's calendar day, not UTC", () => {
    expect(localIsoDate(new Date(2026, 0, 9, 23, 59))).toBe("2026-01-09");
    expect(localIsoDate(new Date(2026, 11, 31, 0, 1))).toBe("2026-12-31");
  });
});

describe("todayIndex / defaultDayIndex", () => {
  it.each([
    [31, undefined, 0],
    [1, 0, 0],
    [3, 2, 2],
    [4, undefined, 2],
  ])("on day %i of June: today %s, opens on %i", (day, today, open) => {
    const now = day === 31 ? new Date(2026, 4, 31, 12) : june(day);
    expect(todayIndex(trip, now)).toBe(today);
    expect(defaultDayIndex(trip, now)).toBe(open);
  });
});

describe("tripStatus", () => {
  it.each([
    [new Date(2026, 4, 20, 12), "Starts in 12 days"],
    [new Date(2026, 4, 31, 12), "Starts tomorrow"],
    [june(2), "Day 2 of 3"],
    [june(10), "Ended"],
  ])("%s → %s", (now, status) => {
    expect(tripStatus(trip, now)).toBe(status);
  });
});

describe("navigationUrl", () => {
  it("routes to the coordinates and the Google place, in the leg's mode", () => {
    const url = new URL(navigationUrl({ location: { lat: 19.36, lng: 98.44, placeId: "ChIJ" } }, "TWO_WHEELER")!);
    expect(url.origin + url.pathname).toBe("https://www.google.com/maps/dir/");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      api: "1",
      destination: "19.36,98.44",
      destination_place_id: "ChIJ",
      travelmode: "two-wheeler",
    });
  });

  it("falls back to the address and leaves the mode to Maps for ferries and flights", () => {
    const url = new URL(navigationUrl({ location: { lat: NaN, lng: NaN, address: "Pai, Thailand" } }, "FERRY")!);
    expect(url.searchParams.get("destination")).toBe("Pai, Thailand");
    expect(url.searchParams.has("travelmode")).toBe(false);
  });

  it("needs somewhere to go", () => {
    expect(navigationUrl({})).toBeUndefined();
    expect(navigationUrl({ location: { lat: NaN, lng: NaN } })).toBeUndefined();
  });
});
