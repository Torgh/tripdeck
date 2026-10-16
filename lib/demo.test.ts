import { describe, expect, it } from "vitest";
import { demoTrip } from "./demo";
import { rentalsOf } from "./rentals";
import { nightsOf } from "./stays";
import { computeTripTimeline } from "./timeline";

describe("demo trip", () => {
  const trip = demoTrip();
  const timelines = computeTripTimeline(trip);
  const issuesOf = (title: string) => {
    const item = Object.values(trip.items).find((i) => i.title === title)!;
    return timelines.flatMap((d) => d.entries).find((e) => e.itemId === item.id)!.issues.map((i) => i.message);
  };

  it("starts on a Saturday so the cathedral day is a Sunday", () => {
    expect(timelines[0].date.getUTCDay()).toBe(6);
    expect(issuesOf("St John's Co-Cathedral")).toEqual([expect.stringMatching(/Closed on this weekday/)]);
  });

  it("is late for the noon gun", () => {
    expect(issuesOf("Saluting Battery noon gun")).toEqual([expect.stringMatching(/after the fixed start 12:00/)]);
  });

  it("has a bed for every night", () => {
    const nights = nightsOf(trip);
    expect(nights.slice(0, -1).every((n) => n.kind === "stay")).toBe(true);
    expect(nights.at(-1)?.kind).toBe("end");
  });

  it("keeps the rental car until the airport hotel day and has a scooter on Gozo", () => {
    const phases = rentalsOf(trip).map((day) => day.map((r) => `${r.rental.title} ${r.phase}`).join(", "));
    expect(phases).toEqual([
      "Rental car pickup",
      "Rental car during",
      "Rental car during",
      "Rental car during, Scooter for Gozo pickup",
      "Rental car during, Scooter for Gozo return",
      "Rental car return",
      "",
    ]);
    const scooter = Object.values(trip.items).find((i) => i.title === "Scooter for Gozo")!;
    expect(scooter.rental?.returnPlace).toBe("Gozo farmhouse");
  });
});
