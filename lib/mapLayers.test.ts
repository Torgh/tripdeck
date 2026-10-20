import { describe, expect, it } from "vitest";
import { buildLayers } from "./mapLayers";
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

  it("leaves out the morning's hotel pin when a card is picked up right there", () => {
    expect(buildLayers(trip(), "d2").markers.some((m) => m.label === "🏨")).toBe(false);

    const t = trip();
    t.items.t = { ...tour, location: { lat: 21.2, lng: -86.8 } };
    expect(buildLayers(t, "d2").markers.some((m) => m.label === "🏨")).toBe(true);
  });
});
