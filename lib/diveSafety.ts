import { formatDuration } from "./time";
import type { DayTimeline, Issue } from "./timeline";
import type { Item, Trip } from "./types";

/**
 * Conservative pre-flight surface intervals following DAN's published guidance:
 * at least 12 h after a single no-decompression dive, at least 18 h after multiple dives
 * per day or multiple days of diving. Not a substitute for your dive computer or training.
 */
export const NO_FLY_SINGLE_H = 12;
export const NO_FLY_REPETITIVE_H = 18;
/** Elevation above which going up after diving is treated like flying. */
export const ALTITUDE_THRESHOLD_M = 300;
/** A streak of this many dive days in a row triggers a rest-day hint. */
export const REST_DAY_STREAK = 4;

interface DiveWindow {
  itemId: string;
  dayIndex: number;
  /** Absolute minutes since trip start. */
  end: number;
  noFlyH: number;
}

function isFlight(item: Item): boolean {
  return item.type === "transport" && item.transport?.kind === "flight";
}

export function computeDiveWarnings(trip: Trip, timelines: DayTimeline[]): Map<string, Issue[]> {
  const out = new Map<string, Issue[]>();
  const add = (id: string, issue: Issue) => {
    const list = out.get(id) ?? [];
    if (!list.some((i) => i.message === issue.message)) list.push(issue);
    out.set(id, list);
  };

  const divesPerDay = timelines.map((tl) =>
    tl.entries.reduce((n, e) => {
      const item = trip.items[e.itemId];
      return item?.type === "dive" ? n + Math.max(1, item.dive?.dives ?? 1) : n;
    }, 0),
  );

  const windows: DiveWindow[] = [];
  let streak = 0;
  timelines.forEach((tl, d) => {
    streak = divesPerDay[d] > 0 ? streak + 1 : 0;
    let streakFlagged = false;
    for (const e of tl.entries) {
      const item = trip.items[e.itemId];
      if (item?.type !== "dive") continue;
      const repetitive = divesPerDay[d] >= 2 || (d > 0 && divesPerDay[d - 1] > 0);
      windows.push({
        itemId: item.id,
        dayIndex: d,
        end: d * 1440 + e.end,
        noFlyH: repetitive ? NO_FLY_REPETITIVE_H : NO_FLY_SINGLE_H,
      });
      if ((item.location?.elevationM ?? 0) >= ALTITUDE_THRESHOLD_M) {
        add(item.id, {
          level: "info",
          message: `Altitude dive (${Math.round(item.location!.elevationM!)} m): set your computer for altitude.`,
        });
      }
      if (streak >= REST_DAY_STREAK && !streakFlagged) {
        add(item.id, { level: "info", message: `Dive day ${streak} in a row – consider a rest day.` });
        streakFlagged = true;
      }
    }
  });

  if (!windows.length) return out;

  /** The most recent dive that ended before `at` and whose no-fly window still covers it. */
  const blockingDive = (at: number) => {
    let found: DiveWindow | undefined;
    for (const w of windows) {
      if (w.end <= at && at - w.end < w.noFlyH * 60 && (!found || w.end > found.end)) found = w;
    }
    return found;
  };

  timelines.forEach((tl, d) => {
    for (const e of tl.entries) {
      const item = trip.items[e.itemId];
      if (!item) continue;
      const startAbs = d * 1440 + e.start;
      const flightLeg = e.fromId != null && trip.legs[`${e.fromId}>${e.itemId}`]?.mode === "FLIGHT";

      if (isFlight(item) || flightLeg) {
        const departAbs = flightLeg ? startAbs - (e.legMin ?? 0) : startAbs;
        const w = blockingDive(departAbs);
        if (w) {
          const gap = formatDuration(departAbs - w.end);
          add(item.id, {
            level: "warn",
            message: `Flight only ${gap} after diving – wait at least ${w.noFlyH} h.`,
          });
          add(w.itemId, { level: "warn", message: `A flight departs ${gap} after this dive (min ${w.noFlyH} h).` });
        }
      } else if (item.type !== "dive" && (item.location?.elevationM ?? 0) >= ALTITUDE_THRESHOLD_M) {
        const w = blockingDive(startAbs);
        if (w) {
          add(item.id, {
            level: "warn",
            message: `At ${Math.round(item.location!.elevationM!)} m altitude ${formatDuration(startAbs - w.end)} after diving – treat like flying (≥${w.noFlyH} h).`,
          });
        }
      }
    }
  });

  return out;
}
