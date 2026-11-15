import { haversineM } from "./geo";
import { findBase, type DayTimeline } from "./timeline";
import type { Item, LatLng, Trip } from "./types";

/** Ideas this close to where the day is spent are worth suggesting for it. */
export const NEAR_KM = 30;
/** A day whose plan ends by then still has the afternoon free. */
const FREE_AFTER_MIN = 14 * 60;
const MAX_IDEAS = 5;

/** Cards that are not something to do: they don't make a day busy and are not suggested. */
const LOGISTICS = new Set<Item["type"]>(["stay", "transport", "rental"]);

export interface IdeaNearby {
  item: Item;
  km: number;
}

export interface FreeDay {
  dayIndex: number;
  dayId: string;
  /** Ideas near where the day is spent, nearest first. */
  ideas: IdeaNearby[];
}

/** Whether day `tl` still has time: nothing to do on it yet, or the plan ends by early afternoon. */
export function isFreeDay(trip: Trip, tl: DayTimeline): boolean {
  const doing = tl.entries.filter((e) => {
    const item = trip.items[e.itemId];
    return item && !LOGISTICS.has(item.type);
  });
  return doing.length === 0 || tl.endMin <= FREE_AFTER_MIN;
}

/**
 * Where day `dayIndex` is spent: the stay you wake up in, the stay you sleep in that night, and the
 * places on the day itself. Empty for a day with nothing located.
 */
function dayPoints(trip: Trip, dayIndex: number): LatLng[] {
  const day = trip.days[dayIndex];
  const cards = day.itemIds.map((id) => trip.items[id]).filter((i): i is Item => !!i);
  const stays = [findBase(trip, dayIndex), findBase(trip, dayIndex + 1)];
  // A flight or ferry leaves you where it arrives, not at the airport you left from.
  const located = cards.flatMap((i) => [i.location, i.transport?.toLocation]);
  return [...stays.map((s) => s?.location), ...located].filter((l): l is LatLng => !!l && Number.isFinite(l.lat));
}

/**
 * For each day with time to spare, the ideas (cards in Ideas, other than stays, transport and rentals)
 * within `NEAR_KM` of where the day is spent – e.g. the Cancún ideas for an empty day in Cancún.
 */
export function ideasForFreeDays(trip: Trip, timelines: DayTimeline[]): FreeDay[] {
  const ideas = trip.ideas
    .map((id) => trip.items[id])
    .filter((i): i is Item => !!i?.location && !LOGISTICS.has(i.type));
  if (!ideas.length) return [];
  return timelines.flatMap((tl) => {
    if (!isFreeDay(trip, tl)) return [];
    const points = dayPoints(trip, tl.dayIndex);
    if (!points.length) return [];
    const near = ideas
      .map((item) => ({ item, km: Math.min(...points.map((p) => haversineM(p, item.location!))) / 1000 }))
      .filter((n) => n.km <= NEAR_KM)
      .sort((a, b) => a.km - b.km)
      .slice(0, MAX_IDEAS);
    return near.length ? [{ dayIndex: tl.dayIndex, dayId: tl.dayId, ideas: near }] : [];
  });
}
