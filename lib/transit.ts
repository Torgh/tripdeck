import { dayDate, formatHm, isoDate } from "./time";
import type { TimelineEntry } from "./timeline";
import type { RouteTime, TransitStep } from "./types";

/** Public-transport times are asked for in steps of this many minutes, so small shifts in the plan don't refetch. */
const STEP_MIN = 5;

/**
 * When to plan a public-transport leg: the local date and time you leave (or must arrive, for the
 * day's first appointment). Undefined for trips in the past – Google only plans ahead – so those get
 * today's timetable instead.
 */
export function legRouteTime(
  startDate: string,
  dayIndex: number,
  entry: Pick<TimelineEntry, "legAt">,
  today: string,
): RouteTime | undefined {
  if (!entry.legAt) return undefined;
  const min = Math.floor(entry.legAt.min / STEP_MIN) * STEP_MIN;
  const dayOffset = Math.floor(min / 1440);
  const date = isoDate(dayDate(startDate, dayIndex + dayOffset));
  if (date < today) return undefined;
  return { date, time: formatHm(min - dayOffset * 1440), arriveBy: entry.legAt.arriveBy || undefined };
}

const VEHICLE_ICON: Record<string, string> = {
  SUBWAY: "🚇",
  METRO_RAIL: "🚇",
  HEAVY_RAIL: "🚆",
  RAIL: "🚆",
  COMMUTER_TRAIN: "🚆",
  HIGH_SPEED_TRAIN: "🚄",
  LONG_DISTANCE_TRAIN: "🚆",
  MONORAIL: "🚝",
  TRAM: "🚊",
  LIGHT_RAIL: "🚊",
  BUS: "🚌",
  INTERCITY_BUS: "🚌",
  TROLLEYBUS: "🚎",
  SHARE_TAXI: "🚐",
  FERRY: "⛴️",
  CABLE_CAR: "🚡",
  GONDOLA_LIFT: "🚡",
  FUNICULAR: "🚞",
};

export function vehicleIcon(vehicle: string): string {
  return VEHICLE_ICON[vehicle] ?? "🚉";
}

/** "13:53 🚆 ARL: Suvarnabhumi → Phaya Thai (7 stops)" */
export function transitStepLine(s: TransitStep): string {
  return `${s.departs ? `${s.departs} ` : ""}${vehicleIcon(s.vehicle)} ${s.line}: ${s.from} → ${s.to}${s.stops ? ` (${s.stops} stop${s.stops > 1 ? "s" : ""})` : ""}`;
}
