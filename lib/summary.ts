import { countryOf } from "./entry";
import { haversineM } from "./geo";
import { freshRoute, getLeg, type DayTimeline } from "./timeline";
import { leavesFrom, type Item, type TransportKind, type Trip } from "./types";

/** Roads wind: a straight line times this is a fair guess of the distance driven. */
const ROAD_FACTOR = 1.3;

export interface TripSummary {
  days: number;
  /** Nights booked in stays. */
  nights: number;
  stays: number;
  /** Places, meals and activities on the days. */
  places: number;
  dives: number;
  diveDays: number;
  flights: number;
  ferries: number;
  trains: number;
  /** Kilometres by way of travel; `roadEstimated` when some road legs have no route yet. */
  km: { flown: number; sea: number; rail: number; road: number };
  roadEstimated: boolean;
  /** Countries the cards are in (from the entry check, else from addresses), in trip order. */
  countries: string[];
  highest?: { m: number; title: string };
}

const TRANSPORT_WAY: Partial<Record<TransportKind, keyof TripSummary["km"]>> = {
  flight: "flown",
  ferry: "sea",
  boat: "sea",
  train: "rail",
  bus: "road",
  car_rental: "road",
};

/** The trip in numbers: days, nights, places, dives, how far it went and where. */
export function tripSummary(trip: Trip, timelines: DayTimeline[]): TripSummary {
  const out: TripSummary = {
    days: trip.days.length,
    nights: 0,
    stays: 0,
    places: 0,
    dives: 0,
    diveDays: 0,
    flights: 0,
    ferries: 0,
    trains: 0,
    km: { flown: 0, sea: 0, rail: 0, road: 0 },
    roadEstimated: false,
    countries: [],
  };
  const countries = new Set<string>();
  const cards = trip.days.flatMap((d) => d.itemIds.map((id) => trip.items[id]).filter((i): i is Item => !!i));

  for (const day of trip.days) {
    if (day.itemIds.some((id) => trip.items[id]?.type === "dive")) out.diveDays++;
  }
  for (const item of cards) {
    if (item.type === "stay") {
      out.stays++;
      out.nights += Math.max(1, item.stay?.nights ?? 1);
    }
    if (item.type === "place" || item.type === "food" || item.type === "activity") out.places++;
    if (item.type === "dive") out.dives += item.dive?.dives ?? 1;
    if (item.type === "transport" && item.transport) {
      const kind = item.transport.kind;
      if (kind === "flight") out.flights++;
      if (kind === "ferry" || kind === "boat") out.ferries++;
      if (kind === "train") out.trains++;
      const way = TRANSPORT_WAY[kind];
      if (way && item.location && item.transport.toLocation) {
        out.km[way] += haversineM(item.location, item.transport.toLocation) / 1000;
      }
    }
    const elevation = item.location?.elevationM;
    if (elevation != null && (!out.highest || elevation > out.highest.m)) out.highest = { m: Math.round(elevation), title: item.title };
    if (item.type !== "transport") {
      const country = countryOf(item.location?.address);
      if (country) countries.add(country);
    }
  }

  // Travel between the cards: the route when there is one, else a guess from the straight line.
  for (const tl of timelines) {
    for (const e of tl.entries) {
      const from = e.fromId ? trip.items[e.fromId] : undefined;
      const to = trip.items[e.itemId];
      const origin = from && leavesFrom(from);
      if (!from || !to?.location || !origin) continue;
      const mode = getLeg(trip, from.id, to.id).mode;
      const straightKm = haversineM(origin, to.location) / 1000;
      if (mode === "FLIGHT") out.km.flown += straightKm;
      else if (mode === "FERRY" || mode === "BOAT") out.km.sea += straightKm;
      else {
        const route = freshRoute(trip, from, to);
        if (route) out.km.road += route.distanceM / 1000;
        else if (straightKm > 0.05) {
          out.km.road += straightKm * ROAD_FACTOR;
          out.roadEstimated = true;
        }
      }
    }
  }
  for (const way of Object.keys(out.km) as (keyof TripSummary["km"])[]) out.km[way] = Math.round(out.km[way]);

  const checked = trip.entry?.countries.filter((c) => !c.transit).map((c) => c.name);
  out.countries = checked?.length ? checked : [...countries];
  return out;
}
