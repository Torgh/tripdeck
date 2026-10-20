import { describe, expect, it } from "vitest";
import { defaultModeTo, rentalsOf, rentalSummary } from "./rentals";
import { tripWith } from "./testUtils";
import { getLeg } from "./timeline";
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

describe("defaultModeTo", () => {
  // A scooter trip: land, collect the scooter in the evening, ride two days, give it back, fly on.
  const scooterTrip = () => {
    const trip = tripWith([
      [place("airport"), place("hotel"), scooter("adv", 2), place("dinner")],
      [place("waterfall")],
      [place("canyon")],
      [place("ferry")],
    ]);
    trip.defaultMode = "TWO_WHEELER";
    return trip;
  };

  it("rides the rented scooter only from its pick-up until the day it goes back", () => {
    const trip = scooterTrip();
    expect(["hotel", "adv", "dinner", "waterfall", "canyon", "ferry"].map((id) => defaultModeTo(trip, id))).toEqual([
      "DRIVE", // from the airport, before the pick-up
      "DRIVE", // to the pick-up itself
      "TWO_WHEELER",
      "TWO_WHEELER",
      "TWO_WHEELER", // the return day
      "DRIVE", // after it went back
    ]);
  });

  it("keeps the trip's mode when it isn't a rented vehicle", () => {
    const trip = scooterTrip();
    trip.defaultMode = "TRANSIT";
    expect(defaultModeTo(trip, "ferry")).toBe("TRANSIT");
    // No scooter rental at all: your own scooter, every day.
    const own = tripWith([[place("a"), place("b")]]);
    own.defaultMode = "TWO_WHEELER";
    expect(defaultModeTo(own, "b")).toBe("TWO_WHEELER");
  });

  it("uses the vehicle you do have on a day without the default one", () => {
    const trip = tripWith([[place("a"), { ...scooter("car", 1), rental: { vehicle: "car", days: 1 } }, place("b")]]);
    trip.items.x = scooter("x", 1);
    trip.ideas.push("x"); // a scooter idea doesn't count as rented
    trip.defaultMode = "DRIVE";
    expect(defaultModeTo(trip, "b")).toBe("DRIVE");
    trip.days.push({ id: "d2", itemIds: [], startTime: "09:00" });
    trip.days[1].itemIds.push("s");
    trip.items.s = scooter("s", 1);
    trip.days[1].itemIds.push("c");
    trip.items.c = place("c");
    trip.defaultMode = "TWO_WHEELER";
    expect(defaultModeTo(trip, "b")).toBe("DRIVE"); // the car, the scooter comes tomorrow
    expect(defaultModeTo(trip, "c")).toBe("TWO_WHEELER");
  });
});

describe("legs and the rental-aware default", () => {
  it("re-follows the default for legs that only stored it, but keeps a mode picked by hand", () => {
    const trip = tripWith([[place("a"), place("b"), place("c")]]);
    trip.defaultMode = "TWO_WHEELER";
    trip.days.push({ id: "d2", itemIds: ["s"], startTime: "09:00" });
    trip.items.s = scooter("s", 1); // the scooter only comes on day 2
    // Saved by an older version while routing: just the default at the time.
    trip.legs["a>b"] = { mode: "TWO_WHEELER" };
    // Picked on the board.
    trip.legs["b>c"] = { mode: "TWO_WHEELER", auto: false };
    expect(getLeg(trip, "a", "b")).toMatchObject({ mode: "DRIVE", auto: true });
    expect(getLeg(trip, "b", "c").mode).toBe("TWO_WHEELER");
  });
});
