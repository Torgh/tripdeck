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
