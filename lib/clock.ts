import { dayDate, formatDuration, formatHm, formatShift, isoDate, utcOffsetMin, zonedTimeToUtc } from "./time";
import { durationOf, type DayTimeline, type Issue } from "./timeline";
import type { Item, Trip } from "./types";

/** From this far from home the first days feel off, so the arrival card says so. */
const JET_LAG_MIN = 5 * 60;

/** A journey between time zones: how far the clocks move and how long it really takes. */
export interface Clock {
  /** Minutes the clock moves on arrival: +240 when it goes forward 4 h. */
  shiftMin: number;
  /** Real time on board – the card's length is local clock time, from departure to arrival. */
  travelMin: number;
  /** Arrival clock compared with home (the trip's first departure), when known. */
  fromHomeMin?: number;
  /** The same for the departure clock. */
  departFromHomeMin?: number;
}

/**
 * The departure and arrival time zones of a flight, ferry or train card that has both places,
 * looked at the moment it leaves (`dayIndex`, `startMin` in local clock). Undefined while either
 * time zone is unknown – it is looked up with Google and stored with the place.
 */
export function clockOf(trip: Trip, item: Item, dayIndex: number, startMin: number, home?: string): Clock | undefined {
  const from = item.location?.timeZone;
  const to = item.transport?.toLocation?.timeZone;
  if (item.type !== "transport" || !from || !to) return undefined;
  const dayOffset = Math.floor(startMin / 1440);
  const date = isoDate(dayDate(trip.startDate, dayIndex + dayOffset));
  const leaves = zonedTimeToUtc(date, formatHm(startMin - dayOffset * 1440), from);
  const shiftMin = utcOffsetMin(to, leaves) - utcOffsetMin(from, leaves);
  const homeOffset = home ? utcOffsetMin(home, leaves) : undefined;
  return {
    shiftMin,
    travelMin: durationOf(item) - shiftMin,
    fromHomeMin: homeOffset === undefined ? undefined : utcOffsetMin(to, leaves) - homeOffset,
    departFromHomeMin: homeOffset === undefined ? undefined : utcOffsetMin(from, leaves) - homeOffset,
  };
}

/** Home's time zone: where the trip's first flight, ferry or train with a known zone leaves from. */
export function homeTimeZone(trip: Trip): string | undefined {
  for (const day of trip.days) {
    for (const id of day.itemIds) {
      const zone = trip.items[id]?.type === "transport" ? trip.items[id].location?.timeZone : undefined;
      if (zone) return zone;
    }
  }
  return undefined;
}

/**
 * Notes for journeys that change the clocks: how much and how long the journey really is, a check
 * that the arrival time adds up, and – when you land far from home – what the first days feel like.
 */
export function computeClockNotes(trip: Trip, timelines: DayTimeline[]): Map<string, Issue[]> {
  const out = new Map<string, Issue[]>();
  const home = homeTimeZone(trip);
  timelines.forEach((tl, d) => {
    for (const e of tl.entries) {
      const item = trip.items[e.itemId];
      const clock = item && clockOf(trip, item, d, e.start, home);
      if (!clock) continue;
      const issues: Issue[] = [];
      const kind = item.transport?.kind === "flight" ? "flight" : "journey";
      if (clock.travelMin <= 0) {
        issues.push({
          level: "warn",
          message: `With the ${formatShift(clock.shiftMin)} time difference this ${kind} would arrive before it leaves – check the local arrival time.`,
        });
      } else if (clock.shiftMin !== 0) {
        issues.push({
          level: "info",
          message: `🕐 Clocks ${clock.shiftMin > 0 ? "go forward" : "go back"} ${formatShift(clock.shiftMin).slice(1)} on arrival – the ${kind} itself takes ${formatDuration(clock.travelMin)}.`,
        });
      }
      const far = (m?: number) => m !== undefined && Math.abs(m) >= JET_LAG_MIN;
      if (far(clock.fromHomeMin) && !far(clock.departFromHomeMin)) {
        const ahead = clock.fromHomeMin! > 0;
        issues.push({
          level: "info",
          message: ahead
            ? `Local time here is ${formatShift(clock.fromHomeMin!).slice(1)} ahead of home: for a day or two, mornings will feel like the middle of the night.`
            : `Local time here is ${formatShift(clock.fromHomeMin!).slice(1)} behind home: for a day or two, you'll be tired early in the evening and awake before dawn.`,
        });
      }
      if (issues.length) out.set(item.id, issues);
    }
  });
  return out;
}

/** Joins per-card issue lists (timing, dive safety, clocks) into one map. */
export function mergeIssues(...maps: Map<string, Issue[]>[]): Map<string, Issue[]> {
  const out = new Map<string, Issue[]>();
  for (const map of maps) for (const [id, list] of map) out.set(id, [...(out.get(id) ?? []), ...list]);
  return out;
}
