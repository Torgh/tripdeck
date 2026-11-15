import { centroid, haversineM } from "./geo";
import type { Item, LatLng, Trip } from "./types";

/** Places within this distance of a region's first place belong to it. */
const REGION_KM = 150;
/** At most this many regions are looked up. */
export const MAX_REGIONS = 6;
/** A day with at least this much rain counts as a rainy day. */
const RAIN_DAY_MM = 1;

/** A part of the trip, for its climate: e.g. Kyoto, or the islands. */
export interface Region {
  /** Where the climate is looked up: the middle of its places, rounded so nearby trips share the answer. */
  center: LatLng;
  /** Its places, in trip order. */
  items: Item[];
}

/** Averages for one month (1 = January) over the years looked up. */
export interface MonthClimate {
  month: number;
  /** °C, daily highs and lows. */
  highC: number;
  lowC: number;
  /** Days with at least 1 mm of rain. */
  rainDays: number;
  /** Total rain in the month, mm. */
  rainMm: number;
}

/** Daily values as Open-Meteo returns them. */
export interface DailyWeather {
  time: string[];
  temperature_2m_max: (number | null)[];
  temperature_2m_min: (number | null)[];
  precipitation_sum: (number | null)[];
}

/** Cards that say where the trip is: not flights, ferries and trains, which are mostly airports and ports. */
function placesOf(trip: Trip): Item[] {
  const ids = [...trip.days.flatMap((d) => d.itemIds), ...trip.ideas];
  return ids
    .map((id) => trip.items[id])
    .filter((i): i is Item => !!i?.location && Number.isFinite(i.location.lat) && i.type !== "transport");
}

const round = (n: number) => Math.round(n * 4) / 4;

/**
 * The trip's places grouped into regions of about 150 km, in the order the trip gets there. Regions
 * beyond `MAX_REGIONS` (the ones with the fewest places) are left out.
 */
export function regionsOf(trip: Trip): Region[] {
  const regions: { seed: LatLng; items: Item[] }[] = [];
  for (const item of placesOf(trip)) {
    const region = regions.find((r) => haversineM(r.seed, item.location!) <= REGION_KM * 1000);
    if (region) region.items.push(item);
    else regions.push({ seed: item.location!, items: [item] });
  }
  const kept = new Set([...regions].sort((a, b) => b.items.length - a.items.length).slice(0, MAX_REGIONS));
  return regions
    .filter((r) => kept.has(r))
    .map((r) => {
      const c = centroid(r.items.map((i) => i.location!))!;
      return { center: { lat: round(c.lat), lng: round(c.lng) }, items: r.items };
    });
}

/** A region's name for people: its first places. */
export function regionLabel(region: Region): string {
  const names = region.items.slice(0, 2).map((i) => i.title);
  const more = region.items.length - names.length;
  return more > 0 ? `${names.join(", ")} +${more}` : names.join(", ");
}

/** Month-by-month averages from daily weather over several years. */
export function monthlyClimate(daily: DailyWeather): MonthClimate[] {
  const acc = Array.from({ length: 12 }, () => ({ high: [] as number[], low: [] as number[], rain: 0, rainDays: 0, years: new Set<string>() }));
  daily.time.forEach((date, i) => {
    const m = acc[Number(date.slice(5, 7)) - 1];
    if (!m) return;
    const high = daily.temperature_2m_max[i];
    const low = daily.temperature_2m_min[i];
    const rain = daily.precipitation_sum[i];
    if (high != null) m.high.push(high);
    if (low != null) m.low.push(low);
    if (rain != null) {
      m.rain += rain;
      if (rain >= RAIN_DAY_MM) m.rainDays++;
      m.years.add(date.slice(0, 4));
    }
  });
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
  return acc.map((m, i) => {
    const years = Math.max(1, m.years.size);
    return {
      month: i + 1,
      highC: Math.round(mean(m.high)),
      lowC: Math.round(mean(m.low)),
      rainDays: Math.round(m.rainDays / years),
      rainMm: Math.round(m.rain / years),
    };
  });
}

/** The months (1–12) a dated trip covers; none while its dates are open. */
export function tripMonths(trip: Pick<Trip, "startDate" | "days">): number[] {
  if (!trip.startDate) return [];
  const [y, m, d] = trip.startDate.split("-").map(Number);
  const out = new Set<number>();
  for (let i = 0; i < Math.max(1, trip.days.length); i++) out.add(new Date(Date.UTC(y, m - 1, d + i)).getUTCMonth() + 1);
  return [...out];
}

/** "31°/22° · 4 rainy days (120 mm)" for get_trip-like text. */
export function climateLine(c: MonthClimate): string {
  return `${c.highC}°/${c.lowC}° · ${c.rainDays} rainy days (${c.rainMm} mm)`;
}
