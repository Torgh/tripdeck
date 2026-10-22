import { describe, expect, it } from "vitest";
import { routeKey } from "./geo";
import { buildLayers, fitPoints, syncPins, type Marker } from "./mapLayers";
import type { Item, Trip } from "./types";

const hotel: Item = { id: "h", type: "stay", title: "Hotel", location: { lat: 21.162, lng: -86.823 }, stay: { nights: 2 } };
const tour: Item = {
  id: "t",
  type: "activity",
  title: "Chichén Itzá tour",
  location: { lat: 21.162, lng: -86.823 },
  tour: {
    stops: [
      { name: "Chichén Itzá", location: { lat: 20.684, lng: -88.568 } },
      { name: "Lunch somewhere" },
      { name: "Valladolid", location: { lat: 20.69, lng: -88.201 } },
    ],
  },
};

function trip(): Trip {
  return {
    id: "x",
    name: "Mexico",
    destination: "Mexico",
    startDate: "2027-02-18",
    interests: "",
    defaultMode: "DRIVE",
    days: [
      { id: "d1", itemIds: ["h"], startTime: "09:00" },
      { id: "d2", itemIds: ["t"], startTime: "09:00" },
    ],
    ideas: [],
    items: { h: hotel, t: tour },
    legs: {},
    updatedAt: "2026-10-18T00:00:00.000Z",
  };
}

describe("buildLayers", () => {
  it("draws a tour's stops as numbered small pins joined to its pick-up point", () => {
    const { markers, lines } = buildLayers(trip(), "d2");
    expect(markers.map((m) => [m.label, !!m.stop])).toEqual([
      ["1", false],
      ["1.1", true],
      ["1.3", true], // the stop without a location has no pin, but keeps its number
    ]);
    expect(lines.find((l) => l.key === "t-tour")?.path).toEqual([
      tour.location,
      tour.tour!.stops[0].location,
      tour.tour!.stops[2].location,
    ]);
  });

  it("pins where a flight lands and routes the next card from there", () => {
    const t = trip();
    const landing = { lat: 20.5, lng: -86.9 };
    t.items.f = {
      id: "f",
      type: "transport",
      title: "Flight",
      location: { lat: 19.43, lng: -99.07 },
      transport: { kind: "flight", to: "Cozumel", toLocation: landing },
    };
    t.days[1].itemIds = ["f", "t"];
    const { markers, lines } = buildLayers(t, "d2");
    expect(markers.find((m) => m.key === "f#to")).toMatchObject({ label: "1→", position: landing, stop: true });
    expect(lines.find((l) => l.key === "f-to")?.path).toEqual([t.items.f.location, landing]);
    expect(lines.find((l) => l.key === "1-f-t")?.path[0]).toEqual(landing);
  });

  it("draws public-transport rides in their line colours over the day's route", () => {
    const t = trip();
    const museum: Item = { id: "m", type: "place", title: "Museum", location: { lat: 21.2, lng: -86.8 } };
    t.items.m = museum;
    t.days[1].itemIds = ["m"];
    t.legs["h>m"] = {
      mode: "TRANSIT",
      result: {
        key: routeKey("TRANSIT", hotel.location!, museum.location!),
        durationSec: 1800,
        distanceM: 5000,
        polyline: "_p~iF~ps|U_ulLnnqC",
        transit: [
          { vehicle: "BUS", line: "R1", color: "#00ff00", from: "A", to: "B", polyline: "_p~iF~ps|U_ulLnnqC" },
          { vehicle: "BUS", line: "R2", from: "B", to: "C" },
        ],
      },
    };
    const { lines } = buildLayers(t, "d2");
    expect(lines.map((l) => [l.key, l.color, l.dashed])).toEqual([
      ["1-h-m", "#c2410c", false],
      ["1-h-m-0", "#00ff00", false], // the ride without a polyline has nothing to draw
    ]);
  });

  it("zooms to the trip, not to the far end of the flights", () => {
    const t = trip();
    t.items.f = {
      id: "f",
      type: "transport",
      title: "Flight home",
      location: { lat: 21.04, lng: -86.87 },
      transport: { kind: "flight", toLocation: { lat: 52.17, lng: 20.97 } },
    };
    t.days[1].itemIds = ["t", "f"];
    const { markers } = buildLayers(t, "d2");
    expect(markers.some((m) => m.position.lat === 52.17)).toBe(true); // Warsaw is still pinned…
    expect(fitPoints(markers).some((p) => p.lat === 52.17)).toBe(false); // …but not zoomed to
    // A day of nothing but flights shows them all.
    expect(fitPoints(markers.filter((m) => m.item.id === "f"))).toHaveLength(2);
  });

  it("leaves out the morning's hotel pin when a card is picked up right there", () => {
    expect(buildLayers(trip(), "d2").markers.some((m) => m.label === "🏨")).toBe(false);

    const t = trip();
    t.items.t = { ...tour, location: { lat: 21.2, lng: -86.8 } };
    expect(buildLayers(t, "d2").markers.some((m) => m.label === "🏨")).toBe(true);
  });
});

describe("syncPins", () => {
  const marker = (key: string, label = key): Marker =>
    ({ key, label, item: hotel, position: hotel.location!, color: "#000", title: label }) as Marker;

  it("updates pins that stay, adds new ones and removes the rest", () => {
    const log: string[] = [];
    const ops = {
      create: (m: Marker) => (log.push(`create ${m.key}`), { label: m.label }),
      update: (p: { label: string }, m: Marker) => (log.push(`update ${m.key}`), (p.label = m.label)),
      remove: (p: { label: string }) => void log.push(`remove ${p.label}`),
    };
    const pins = new Map<string, { label: string }>();
    syncPins(pins, [marker("a"), marker("b")], ops);
    const a = pins.get("a");

    log.length = 0;
    syncPins(pins, [marker("a", "A2"), marker("c")], ops);
    expect(log).toEqual(["remove b", "update a", "create c"]);
    expect(pins.get("a")).toBe(a);
    expect(a?.label).toBe("A2");
    expect([...pins.keys()]).toEqual(["a", "c"]);
  });
});
