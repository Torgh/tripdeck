import { daysBetween } from "./time";
import type { Item, TravelMode, Trip } from "./types";

/** "YYYY-MM-DD" of `now` in the device's own time zone (where the traveller is). */
export function localIsoDate(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** Index of today's day in the trip, or undefined before / after the trip. */
export function todayIndex(trip: Trip, now: Date): number | undefined {
  const i = daysBetween(trip.startDate, localIsoDate(now));
  return i >= 0 && i < trip.days.length ? i : undefined;
}

/** The day to open a trip on: today during the trip, else the first day (before) or the last (after). */
export function defaultDayIndex(trip: Trip, now: Date): number {
  const i = daysBetween(trip.startDate, localIsoDate(now));
  return Math.max(0, Math.min(i, trip.days.length - 1));
}

/** "In 12 days", "Day 3 of 9" or "Ended", for the trip list. */
export function tripStatus(trip: Trip, now: Date): string {
  const i = daysBetween(trip.startDate, localIsoDate(now));
  if (i < 0) return i === -1 ? "Starts tomorrow" : `Starts in ${-i} days`;
  if (i < trip.days.length) return `Day ${i + 1} of ${trip.days.length}`;
  return "Ended";
}

/** The trip list's countdown tile: days to go, the day of the trip it is, or ended. */
export interface TripCountdown {
  phase: "upcoming" | "ongoing" | "ended";
  /** The big figure: days to go, or "3/9" during the trip. */
  value: string;
  label: string;
}

export function tripCountdown(trip: Trip, now: Date): TripCountdown {
  const i = daysBetween(trip.startDate, localIsoDate(now));
  if (i < 0) return { phase: "upcoming", value: String(-i), label: i === -1 ? "day" : "days" };
  if (i < trip.days.length) return { phase: "ongoing", value: `${i + 1}/${trip.days.length}`, label: "today" };
  return { phase: "ended", value: "✓", label: "ended" };
}

/** The trip list's order: under way and upcoming first, soonest first; ended trips last, the latest first. */
export function sortTrips(trips: Trip[], now: Date): Trip[] {
  const today = localIsoDate(now);
  const ended = (t: Trip) => daysBetween(t.startDate, today) >= t.days.length;
  return [...trips].sort((a, b) => {
    const ea = ended(a);
    const eb = ended(b);
    if (ea !== eb) return ea ? 1 : -1;
    return ea ? b.startDate.localeCompare(a.startDate) : a.startDate.localeCompare(b.startDate);
  });
}

/** The trip the list singles out: the one under way, else the next to start. */
export function nextTripId(trips: Trip[], now: Date): string | undefined {
  let best: { id: string; i: number } | undefined;
  for (const trip of trips) {
    const i = daysBetween(trip.startDate, localIsoDate(now));
    if (i >= trip.days.length) continue;
    // Under way beats upcoming; among upcoming, the soonest.
    const rank = i >= 0 ? -Infinity : -i;
    if (!best || rank < best.i) best = { id: trip.id, i: rank };
  }
  return best?.id;
}

const MAPS_TRAVEL_MODE: Partial<Record<TravelMode, string>> = {
  DRIVE: "driving",
  WALK: "walking",
  BICYCLE: "bicycling",
  TRANSIT: "transit",
  TWO_WHEELER: "two-wheeler",
};

/**
 * Google Maps directions from wherever the phone is to the card, which the Maps app opens.
 * Undefined when the card has neither coordinates nor an address.
 */
export function navigationUrl(item: Pick<Item, "location">, mode?: TravelMode): string | undefined {
  const loc = item.location;
  if (!loc) return undefined;
  const params = new URLSearchParams({ api: "1" });
  if (Number.isFinite(loc.lat) && Number.isFinite(loc.lng)) params.set("destination", `${loc.lat},${loc.lng}`);
  else if (loc.address) params.set("destination", loc.address);
  else return undefined;
  if (loc.placeId) params.set("destination_place_id", loc.placeId);
  const travelMode = mode && MAPS_TRAVEL_MODE[mode];
  if (travelMode) params.set("travelmode", travelMode);
  return `https://www.google.com/maps/dir/?${params}`;
}
