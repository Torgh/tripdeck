import { translator, type Lang } from "./i18n";
import { dayDate, daysBetween, formatDayLabel } from "./time";
import type { Item, TravelMode, Trip } from "./types";

/** "YYYY-MM-DD" of `now` in the device's own time zone (where the traveller is). */
export function localIsoDate(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** The date of day `index` (from 0), or undefined while the trip's dates are open. */
export function tripDayDate(trip: Pick<Trip, "startDate">, index: number): Date | undefined {
  return trip.startDate ? dayDate(trip.startDate, index) : undefined;
}

/** "Sat 23 Jan" for day `index`, or undefined while the trip's dates are open. */
export function tripDayLabel(trip: Pick<Trip, "startDate">, index: number, lang: Lang = "en"): string | undefined {
  const date = tripDayDate(trip, index);
  return date && formatDayLabel(date, lang);
}

/** "Day 3 · Sat 23 Jan", or just "Day 3" while the dates are open – and where the day is, when it says. */
export function tripDayTitle(trip: Pick<Trip, "startDate"> & { days?: Trip["days"] }, index: number, lang: Lang = "en"): string {
  const day = translator(lang)("common.day", { day: index + 1 });
  return [day, tripDayLabel(trip, index, lang), trip.days?.[index]?.label].filter(Boolean).join(" · ");
}

/**
 * "Sat 23 Jan – Sun 31 Jan" for a dated trip; for an early plan its rough timing, or "Dates open".
 * The number of days is left to the caller.
 */
export function tripDates(trip: Pick<Trip, "startDate" | "timing" | "days">, lang: Lang = "en"): string {
  if (!trip.startDate) return trip.timing?.trim() || translator(lang)("status.datesOpen");
  const first = formatDayLabel(dayDate(trip.startDate, 0), lang);
  const last = formatDayLabel(dayDate(trip.startDate, Math.max(0, trip.days.length - 1)), lang);
  return `${first} – ${last}`;
}

/** Days from the trip's start to `now`: negative before it; undefined while the dates are open. */
function dayOfTrip(trip: Trip, now: Date): number | undefined {
  return trip.startDate ? daysBetween(trip.startDate, localIsoDate(now)) : undefined;
}

/** Index of today's day in the trip, or undefined before / after the trip (and while the dates are open). */
export function todayIndex(trip: Trip, now: Date): number | undefined {
  const i = dayOfTrip(trip, now);
  return i !== undefined && i >= 0 && i < trip.days.length ? i : undefined;
}

/** The day to open a trip on: today during the trip, else the first day (before or undated) or the last (after). */
export function defaultDayIndex(trip: Trip, now: Date): number {
  const i = dayOfTrip(trip, now) ?? 0;
  return Math.max(0, Math.min(i, trip.days.length - 1));
}

/** "In 12 days", "Day 3 of 9", "Ended" or "Dates open", for the trip list. */
export function tripStatus(trip: Trip, now: Date, lang: Lang = "en"): string {
  const t = translator(lang);
  const i = dayOfTrip(trip, now);
  if (i === undefined) return t("status.datesOpen");
  if (i < 0) return i === -1 ? t("status.tomorrow") : t("status.startsIn", { n: -i });
  if (i < trip.days.length) return t("status.dayOf", { day: i + 1, days: trip.days.length });
  return t("status.ended");
}

/** The trip list's countdown tile: days to go, the day of the trip it is, or ended. */
export interface TripCountdown {
  /** "open": an early plan without dates yet. */
  phase: "upcoming" | "ongoing" | "ended" | "open";
  /** The big figure: days to go, or "3/9" during the trip. */
  value: string;
  label: string;
}

export function tripCountdown(trip: Trip, now: Date, lang: Lang = "en"): TripCountdown {
  const t = translator(lang);
  const i = dayOfTrip(trip, now);
  if (i === undefined) return { phase: "open", value: "?", label: t("status.openShort") };
  if (i < 0) return { phase: "upcoming", value: String(-i), label: t("status.days", { n: -i }) };
  if (i < trip.days.length) return { phase: "ongoing", value: `${i + 1}/${trip.days.length}`, label: t("status.today") };
  return { phase: "ended", value: "✓", label: t("status.endedShort") };
}

/**
 * The trip list's order: under way and upcoming first, soonest first; then early plans with open
 * dates, the latest edited first; ended trips last, the latest first.
 */
export function sortTrips(trips: Trip[], now: Date): Trip[] {
  const today = localIsoDate(now);
  const group = (t: Trip) => (!t.startDate ? 1 : daysBetween(t.startDate, today) >= t.days.length ? 2 : 0);
  return [...trips].sort((a, b) => {
    const ga = group(a);
    const gb = group(b);
    if (ga !== gb) return ga - gb;
    if (ga === 1) return b.updatedAt.localeCompare(a.updatedAt);
    const sa = a.startDate ?? "";
    const sb = b.startDate ?? "";
    return ga === 2 ? sb.localeCompare(sa) : sa.localeCompare(sb);
  });
}

/** The trip the list singles out: the one under way, else the next to start. */
export function nextTripId(trips: Trip[], now: Date): string | undefined {
  let best: { id: string; i: number } | undefined;
  for (const trip of trips) {
    const i = dayOfTrip(trip, now);
    if (i === undefined || i >= trip.days.length) continue;
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
