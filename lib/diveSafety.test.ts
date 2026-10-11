import { describe, expect, it } from "vitest";
import { demoTrip } from "./demo";
import { computeDiveWarnings } from "./diveSafety";
import { tripWith } from "./testUtils";
import { computeTripTimeline } from "./timeline";
import type { Item, Trip } from "./types";

const dive = (id: string, start: string, dives = 1): Item => ({
  id,
  type: "dive",
  title: id,
  startTime: start,
  durationMin: 120,
  dive: { dives, gas: "air" },
});
const flight = (id: string, start: string): Item => ({
  id,
  type: "transport",
  title: id,
  startTime: start,
  transport: { kind: "flight" },
});
const warnings = (trip: Trip) => computeDiveWarnings(trip, computeTripTimeline(trip));

describe("computeDiveWarnings", () => {
  it("uses 12 h after a single dive", () => {
    expect(warnings(tripWith([[dive("d", "08:00")], [flight("f", "07:00")]])).get("f")).toBeUndefined(); // 21 h
    const late = warnings(tripWith([[dive("d", "08:00"), flight("f", "20:00")]])); // 10 h
    expect(late.get("f")?.[0].message).toMatch(/at least 12 h/);
  });

  it("uses 18 h after repetitive diving and flags both cards", () => {
    expect(warnings(tripWith([[dive("d", "08:00", 2)], [flight("f", "06:00")]])).size).toBe(0); // 20 h
    const w = warnings(tripWith([[dive("d", "12:00", 2)], [flight("f", "06:00")]])); // 16 h
    expect(w.get("f")?.[0].message).toMatch(/18 h/);
    expect(w.get("d")?.[0].level).toBe("warn");
  });

  it("flags altitude after diving and long dive streaks", () => {
    const pass: Item = {
      id: "p",
      type: "place",
      title: "Pass",
      startTime: "15:00",
      location: { lat: 0, lng: 0, elevationM: 900 },
    };
    const w = warnings(
      tripWith([[dive("d1", "08:00"), pass], [dive("d2", "08:00")], [dive("d3", "08:00")], [dive("d4", "08:00")]]),
    );
    expect(w.get("p")?.[0].message).toMatch(/900 m/);
    expect(w.get("d4")?.[0].message).toMatch(/rest day/);
  });

  it("finds the planted no-fly problem in the demo trip", () => {
    const trip = demoTrip();
    const flightHome = Object.values(trip.items).find((i) => i.title === "Flight home")!;
    expect(warnings(trip).get(flightHome.id)?.[0].message).toMatch(/18 h/);
  });
});
