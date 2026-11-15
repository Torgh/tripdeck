import { describe, expect, it } from "vitest";
import { tripSummary } from "./summary";
import { tripWith } from "./testUtils";
import { computeTripTimeline } from "./timeline";
import type { Item } from "./types";

const at = (id: string, type: Item["type"], lat: number, lng: number, extra: Partial<Item> = {}): Item => ({
  id,
  type,
  title: id,
  location: { lat, lng, address: `Somewhere, ${extra.notes ?? "Thailand"}` },
  ...extra,
});

describe("tripSummary", () => {
  it("counts days, nights, places, dives, journeys, distance and countries", () => {
    const flight = at("flight", "transport", 52.16, 20.97, {
      transport: { kind: "flight", toLocation: { lat: 13.69, lng: 100.75 } },
      notes: "Poland",
    });
    const hotel = at("hotel", "stay", 13.72, 100.52, { stay: { nights: 2 } });
    const temple = at("temple", "place", 13.75, 100.49, { location: { lat: 13.75, lng: 100.49, address: "Bangkok, Thailand", elevationM: 12 } });
    const dive = at("dive", "dive", 10.1, 99.83, { dive: { dives: 3, gas: "air" } });
    const trip = tripWith([[flight, hotel], [temple], [dive]]);
    const s = tripSummary(trip, computeTripTimeline(trip));
    expect(s).toMatchObject({ days: 3, nights: 2, stays: 1, places: 1, dives: 3, diveDays: 1, flights: 1, countries: ["Thailand"] });
    // Warsaw → Bangkok is ~8,200 km as the crow flies.
    expect(s.km.flown).toBeGreaterThan(8000);
    expect(s.km.flown).toBeLessThan(8500);
    // No routes fetched: road legs are estimated from the straight line.
    expect(s.roadEstimated).toBe(true);
    expect(s.km.road).toBeGreaterThan(0);
    expect(s.highest).toEqual({ m: 12, title: "temple" });
  });

  it("prefers the countries of the entry check", () => {
    const trip = tripWith([[at("a", "place", 1, 1)]]);
    trip.entry = {
      passports: ["PL"],
      routeKey: "",
      checkedAt: "",
      countries: [
        { code: "QA", name: "Qatar", transit: true, summary: "", requirements: [], sources: [] },
        { code: "TH", name: "Thailand", summary: "", requirements: [], sources: [] },
      ],
    };
    expect(tripSummary(trip, computeTripTimeline(trip)).countries).toEqual(["Thailand"]);
  });
});
