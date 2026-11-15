import { describe, expect, it } from "vitest";
import { climateLine, monthlyClimate, regionLabel, regionsOf, tripMonths } from "./climate";
import { climateUrl } from "./server/climate";
import { tripWith } from "./testUtils";
import { tripTodos } from "./todo";
import type { Item } from "./types";

const place = (id: string, lat: number, lng: number, type: Item["type"] = "place"): Item => ({ id, type, title: id, location: { lat, lng } });

describe("regionsOf", () => {
  it("groups places within ~150 km, in trip order, leaving out flights", () => {
    const trip = tripWith([
      [place("flight", 35.5, 139.8, "transport"), place("Kyoto", 35.01, 135.77), place("Nara", 34.68, 135.8)],
      [place("Tokyo", 35.68, 139.76)],
    ]);
    trip.items.osaka = { ...place("Osaka", 34.69, 135.5), id: "osaka" };
    trip.ideas.push("osaka");
    const regions = regionsOf(trip);
    expect(regions.map((r) => r.items.map((i) => i.id))).toEqual([["Kyoto", "Nara", "osaka"], ["Tokyo"]]);
    expect(regionLabel(regions[0])).toBe("Kyoto, Nara +1");
    // Rounded to a quarter of a degree, so nearby trips share the cached answer.
    expect(regions[1].center).toEqual({ lat: 35.75, lng: 139.75 });
  });
});

describe("monthlyClimate", () => {
  it("averages highs and lows and counts rainy days per year", () => {
    const climate = monthlyClimate({
      time: ["2024-01-01", "2024-01-02", "2025-01-01", "2025-07-01"],
      temperature_2m_max: [10, 12, 11, 30],
      temperature_2m_min: [0, 2, null, 20],
      precipitation_sum: [5, 0.5, 2, 0],
    });
    expect(climate).toHaveLength(12);
    expect(climate[0]).toEqual({ month: 1, highC: 11, lowC: 1, rainDays: 1, rainMm: 4 });
    expect(climate[6]).toMatchObject({ month: 7, highC: 30, rainDays: 0 });
    expect(climateLine(climate[0])).toBe("11°/1° · 1 rainy days (4 mm)");
  });

  it("asks Open-Meteo for ten full years at the region's coordinates", () => {
    const url = new URL(climateUrl({ lat: 35.75, lng: 139.75 }, 2025));
    expect(url.searchParams.get("start_date")).toBe("2016-01-01");
    expect(url.searchParams.get("end_date")).toBe("2025-12-31");
    expect(url.searchParams.get("latitude")).toBe("35.75");
  });
});

describe("early plans", () => {
  it("knows the trip's months only once it has dates", () => {
    const trip = tripWith([[], [], []]);
    expect(tripMonths({ ...trip, startDate: "2027-01-30" })).toEqual([1, 2]);
    expect(tripMonths({ ...trip, startDate: undefined })).toEqual([]);
  });

  it("doesn't ask for a bed on undated days", () => {
    const trip = tripWith([[], []]);
    expect(tripTodos(trip).filter((t) => t.kind === "night")).toHaveLength(1);
    expect(tripTodos({ ...trip, startDate: undefined }).filter((t) => t.kind === "night")).toEqual([]);
  });
});
