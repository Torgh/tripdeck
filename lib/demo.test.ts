import { describe, expect, it } from "vitest";
import { demoTrip } from "./demo";
import { entryState, keepFoundLinks } from "./entry";
import { rentalsOf } from "./rentals";
import { nightsOf } from "./stays";
import { dayDate, isoDate } from "./time";
import { computeTripTimeline, freshRoute } from "./timeline";
import { todoLabel, tripTodos } from "./todo";

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

describe("demo trip travel", () => {
  const trip = demoTrip();
  const timelines = computeTripTimeline(trip);
  const entryOf = (title: string) => {
    const item = Object.values(trip.items).find((i) => i.title === title)!;
    return { item, entry: timelines.flatMap((d) => d.entries).find((e) => e.itemId === item.id)! };
  };

  it("flies in from Kraków and drives on from where it lands", () => {
    const { item } = entryOf("Flight to Malta");
    expect(item.transport?.toLocation?.address).toBe("Malta International Airport");
    // Collecting the car right after landing (11:35), not hours of driving from Kraków.
    expect(entryOf("Rental car").entry.start).toBeLessThan(12 * 60);
  });

  it("arrives at the hotel before check-in and says so", () => {
    expect(entryOf("Hotel in St Julian's").entry.issues.map((i) => i.message)).toEqual([
      expect.stringMatching(/check-in from 15:00/),
    ]);
  });

  it("takes a real bus line into Valletta", () => {
    const hotel = entryOf("Hotel in St Julian's").item;
    const { item: valletta, entry } = entryOf("Valletta old town");
    expect(entry.legEstimated).toBe(false);
    expect(freshRoute(trip, hotel, valletta)?.transit?.[0]).toMatchObject({ line: "TD13", from: "Spinola", to: "Valletta" });
  });
});

describe("demo trip to-do list", () => {
  it("has the health card to get, a dive day waiting for confirmation and one still to book", () => {
    const trip = demoTrip();
    expect(tripTodos(trip).map(todoLabel)).toEqual([
      `Malta: European Health Insurance Card (EKUZ) – by ${isoDate(dayDate(trip.startDate, -3))}`,
      "Cirkewwa – Rozi & P29 wrecks (day 3): waiting for confirmation",
      "Wied iż-Żurrieq shore dives (day 6): to book",
    ]);
  });
});

describe("demo entry rules and tour", () => {
  it("has an up-to-date entry check for its Polish passports, with official links", () => {
    const trip = demoTrip();
    expect(trip.passports).toEqual(["PL"]);
    expect(entryState(trip)).toEqual({ kind: "fresh" });
    const [malta] = trip.entry!.countries;
    expect(malta.requirements.map((r) => r.level)).toEqual(["ok", "action", "warn", "info", "info"]);
    // Every link is on one of the sources, as save_entry_check keeps them.
    expect(keepFoundLinks([malta], malta.sources.map((s) => s.url))).toEqual([malta]);
  });

  it("has an organised boat tour that picks up at the harbour", () => {
    const comino = Object.values(demoTrip().items).find((i) => i.title === "Comino Blue Lagoon boat trip")!;
    expect(comino.location?.address).toBe("Mġarr harbour, Gozo");
    expect(comino.tour?.stops.map((s) => s.name)).toEqual(["Santa Maria caves", "Crystal Lagoon", "Blue Lagoon"]);
  });
});
