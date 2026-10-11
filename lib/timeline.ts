import { estimateMinutes, routeKey } from "./geo";
import { dayDate, formatHm, parseHm } from "./time";
import {
  DEFAULT_DURATION_MIN,
  isRoutable,
  legKey,
  type Item,
  type Leg,
  type OpeningPeriod,
  type Trip,
} from "./types";

export interface Issue {
  level: "warn" | "info";
  message: string;
}

export interface TimelineEntry {
  itemId: string;
  /** Id of the item (or base stay) this entry is reached from. */
  fromId?: string;
  legMin?: number;
  /** True when legMin is a straight-line estimate because no route is known yet. */
  legEstimated: boolean;
  /** Minutes after midnight of the day. */
  start: number;
  end: number;
  fixed: boolean;
  issues: Issue[];
}

export interface DayTimeline {
  dayId: string;
  dayIndex: number;
  date: Date;
  /** The stay you wake up in on this day, if any. */
  base?: Item;
  entries: TimelineEntry[];
  travelMin: number;
  endMin: number;
}

/** Lateness tolerated before a fixed-time item is flagged. */
const LATE_TOLERANCE_MIN = 5;

export function durationOf(item: Item): number {
  return item.durationMin ?? DEFAULT_DURATION_MIN[item.type];
}

export function getLeg(trip: Trip, fromId: string, toId: string): Leg {
  return trip.legs[legKey(fromId, toId)] ?? { mode: trip.defaultMode };
}

/**
 * Travel time between two items. Uses the routed result when it matches the current mode and
 * endpoints, the manual duration for ferry/boat/flight legs, and a straight-line estimate otherwise.
 */
export function legMinutes(trip: Trip, from: Item, to: Item): { minutes?: number; estimated: boolean } {
  const leg = getLeg(trip, from.id, to.id);
  if (!isRoutable(leg.mode)) {
    if (leg.manualMin != null) return { minutes: leg.manualMin, estimated: false };
  } else if (from.location && to.location && leg.result?.key === routeKey(leg.mode, from.location, to.location)) {
    return { minutes: leg.result.durationSec / 60, estimated: false };
  }
  if (from.location && to.location) {
    return { minutes: estimateMinutes(from.location, to.location, leg.mode), estimated: true };
  }
  return { estimated: true };
}

/**
 * The stay you wake up in on day `dayIndex`: a stay checked in on day i with n nights is the
 * base for days i+1 .. i+n. The latest matching check-in wins.
 */
export function findBase(trip: Trip, dayIndex: number): Item | undefined {
  for (let i = dayIndex - 1; i >= 0; i--) {
    for (const id of [...trip.days[i].itemIds].reverse()) {
      const item = trip.items[id];
      if (item?.type === "stay" && dayIndex <= i + Math.max(1, item.stay?.nights ?? 1)) return item;
    }
  }
  return undefined;
}

const WEEK = 7 * 1440;

/**
 * Whether [startMin, endMin] on `weekday` (0 = Sunday) falls inside an opening period.
 * Returns undefined when opening hours are unknown.
 */
export function isOpenDuring(
  periods: OpeningPeriod[] | undefined,
  weekday: number,
  startMin: number,
  endMin: number,
): boolean | undefined {
  if (!periods?.length) return undefined;
  const s = weekday * 1440 + startMin;
  const e = weekday * 1440 + endMin;
  for (const p of periods) {
    const o = p.open.day * 1440 + p.open.hour * 60 + p.open.minute;
    if (!p.close) return true; // Google encodes "open 24/7" as a single period without close
    let c = p.close.day * 1440 + p.close.hour * 60 + p.close.minute;
    if (c <= o) c += WEEK;
    for (const shift of [-WEEK, 0, WEEK]) {
      if (s >= o + shift && e <= c + shift) return true;
    }
  }
  return false;
}

/** Whether the place opens at all on `weekday`. */
export function opensOn(periods: OpeningPeriod[] | undefined, weekday: number): boolean | undefined {
  if (!periods?.length) return undefined;
  return periods.some((p) => !p.close || p.open.day === weekday);
}

export function computeDayTimeline(trip: Trip, dayIndex: number): DayTimeline {
  const day = trip.days[dayIndex];
  const date = dayDate(trip.startDate, dayIndex);
  const weekday = date.getUTCDay();
  const base = findBase(trip, dayIndex);
  let cursor = parseHm(day.startTime) ?? 9 * 60;
  let travelMin = 0;
  let prev: Item | undefined = base;
  const entries: TimelineEntry[] = [];

  for (const id of day.itemIds) {
    const item = trip.items[id];
    if (!item) continue;
    const issues: Issue[] = [];
    let legMin: number | undefined;
    let legEstimated = false;
    let fromId: string | undefined;

    if (prev && prev.id !== item.id) {
      const leg = legMinutes(trip, prev, item);
      legMin = leg.minutes;
      legEstimated = leg.estimated;
      fromId = prev.id;
      if (legMin != null) {
        cursor += legMin;
        travelMin += legMin;
      }
    }

    const fixedStart = parseHm(item.startTime);
    let start = cursor;
    if (fixedStart != null && entries.length === 0) {
      // The first appointment of the day sets when you leave, whatever the usual start time.
      start = fixedStart;
    } else if (fixedStart != null) {
      if (cursor > fixedStart + LATE_TOLERANCE_MIN) {
        issues.push({
          level: "warn",
          message: `Arrives ~${formatHm(cursor)}, ${Math.round(cursor - fixedStart)} min after the fixed start ${item.startTime}.`,
        });
      }
      start = fixedStart;
    }
    const end = start + durationOf(item);

    const periods = item.place?.openingPeriods;
    if (opensOn(periods, weekday) === false) {
      issues.push({ level: "warn", message: "Closed on this weekday according to Google." });
    } else if (fixedStart == null && isOpenDuring(periods, weekday, start, end) === false) {
      issues.push({ level: "warn", message: `May be closed ${formatHm(start)}–${formatHm(end)}.` });
    }

    entries.push({ itemId: id, fromId, legMin, legEstimated, start, end, fixed: fixedStart != null, issues });
    cursor = end;
    prev = item;
  }

  return { dayId: day.id, dayIndex, date, base, entries, travelMin, endMin: cursor };
}

export function computeTripTimeline(trip: Trip): DayTimeline[] {
  return trip.days.map((_, i) => computeDayTimeline(trip, i));
}
