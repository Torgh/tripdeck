import { describe, expect, it } from "vitest";
import { rentalsOf, rentalSummary } from "./rentals";
import { tripWith } from "./testUtils";
import type { Item } from "./types";

const scooter = (id: string, days: number, returnTime?: string): Item => ({
  id,
  type: "rental",
  title: id,
  startTime: "18:00",
  rental: { vehicle: "scooter", days, returnTime },
});
const place = (id: string): Item => ({ id, type: "place", title: id });

const phases = (days: ReturnType<typeof rentalsOf>) =>
  days.map((rentals) => rentals.map((r) => `${r.rental.id} ${r.phase}`).join(", "));

describe("rentalsOf", () => {
  it("marks pick-up, the days in between and the return day", () => {
    const trip = tripWith([[place("a")], [scooter("adv", 3)], [], [], [place("b")], []]);
    expect(phases(rentalsOf(trip))).toEqual(["", "adv pickup", "adv during", "adv during", "adv return", ""]);
    expect(rentalsOf(trip)[1][0]).toMatchObject({ days: 3, returnLabel: "Fri 5 Jun" });
  });

  it("keeps overlapping rentals apart and stops at the end of the trip", () => {
    const trip = tripWith([[scooter("car", 5)], [scooter("bike", 1)], []]);
    expect(phases(rentalsOf(trip))).toEqual(["car pickup", "car during, bike pickup", "car during, bike return"]);
  });

  it("ignores rentals in Ideas", () => {
    const trip = tripWith([[place("a")]]);
    trip.items.idea = scooter("idea", 2);
    trip.ideas = ["idea"];
    expect(phases(rentalsOf(trip))).toEqual([""]);
  });
});

describe("rentalSummary", () => {
  it("names the return day and time", () => {
    const trip = tripWith([[scooter("adv", 9, "18:00")]]);
    expect(rentalSummary(trip, trip.items.adv, 0)).toBe("9 days · back Wed 10 Jun 18:00");
    expect(rentalSummary(trip, trip.items.adv, -1)).toBe("9 days");
    expect(rentalSummary(trip, scooter("x", 1), 0)).toBe("1 day · back Tue 2 Jun");
  });
});
