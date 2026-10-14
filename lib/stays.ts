import { parseHm } from "./time";
import { findBase } from "./timeline";
import type { Item, Trip } from "./types";

/** Where the night after a day is spent. */
export type Night =
  | { kind: "stay"; stay: Item; night: number; nights: number; colorKey: string }
  | { kind: "transport"; item: Item }
  | { kind: "none" }
  /** The night after the last day: the trip is over. */
  | { kind: "end" };

/** Stays at the same place (e.g. two bookings at one hotel) share a colour. */
export const stayColorKey = (stay: Item) => stay.title.trim().toLowerCase();

/** One entry per day: where you sleep after that day. */
export function nightsOf(trip: Trip): Night[] {
  const checkInDay = new Map<string, number>();
  trip.days.forEach((d, i) => d.itemIds.forEach((id) => checkInDay.set(id, i)));

  return trip.days.map((day, i): Night => {
    // The stay you wake up in tomorrow is the one you sleep in tonight.
    const stay = findBase(trip, i + 1);
    if (stay) {
      const nights = Math.max(1, stay.stay?.nights ?? 1);
      const night = i - (checkInDay.get(stay.id) ?? i) + 1;
      return { kind: "stay", stay, night, nights, colorKey: stayColorKey(stay) };
    }
    if (i === trip.days.length - 1) return { kind: "end" };
    const last = trip.items[day.itemIds[day.itemIds.length - 1]];
    const nextFirst = trip.items[trip.days[i + 1].itemIds[0]];
    // Ends the day travelling, or starts the next one before dawn on a flight / boat.
    if (last?.type === "transport") return { kind: "transport", item: last };
    if (nextFirst?.type === "transport" && (parseHm(nextFirst.startTime) ?? Infinity) < 6 * 60) {
      return { kind: "transport", item: nextFirst };
    }
    return { kind: "none" };
  });
}

/** Colour slot per stay, in order of first check-in. */
export function stayColorIndex(nights: Night[]): Map<string, number> {
  const slots = new Map<string, number>();
  for (const n of nights) if (n.kind === "stay" && !slots.has(n.colorKey)) slots.set(n.colorKey, slots.size);
  return slots;
}
