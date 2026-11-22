import { haversineM } from "./geo";
import { newDay, newId } from "./tripOps";
import type { Item, OutlineStop, Trip } from "./types";

/** Ideas within this distance of an outline stop count as being there. */
export const OUTLINE_NEAR_KM = 80;

/** How many days the outline adds up to. */
export function outlineDays(outline: OutlineStop[] | undefined): number {
  return (outline ?? []).reduce((sum, s) => sum + Math.max(0, s.days), 0);
}

/** "Hanoi 3 → Ha Long Bay 2 → Hoi An 4". */
export function outlineLine(outline: OutlineStop[] | undefined): string {
  return (outline ?? []).map((s) => `${s.name} ${s.days}`).join(" → ");
}

/** A new stop of the outline. */
export function outlineStop(name: string, days: number, location?: OutlineStop["location"]): OutlineStop {
  return { id: newId(), name: name.trim(), days: Math.max(1, Math.round(days)), ...(location && { location }) };
}

/**
 * Which stop each day of the outline belongs to: day i (0-based) → the stop's index, or undefined
 * past the outline's end.
 */
export function outlineDayStops(outline: OutlineStop[] | undefined): number[] {
  return (outline ?? []).flatMap((s, i) => Array.from({ length: Math.max(0, s.days) }, () => i));
}

/**
 * Lays the outline over the days: the trip gets at least as many days as the outline (never fewer –
 * a day with cards is not removed), and each day is labelled with the stop it belongs to. Days past
 * the outline keep their label only if it was not one the outline set: a name of this outline or of
 * `previous` (the outline before a change).
 */
export function applyOutline(trip: Trip, previous: OutlineStop[] = []): Trip {
  const outline = trip.outline ?? [];
  const stops = outlineDayStops(outline);
  const names = new Set([...outline, ...previous].map((s) => s.name));
  const days = [...trip.days];
  while (days.length < stops.length) days.push(newDay());
  return {
    ...trip,
    days: days.map((d, i) => {
      const stop = stops[i];
      if (stop !== undefined) return { ...d, label: outline[stop].name };
      if (d.label && names.has(d.label)) {
        const { label: _label, ...rest } = d;
        return rest;
      }
      return d;
    }),
  };
}

/** Saves a new outline; with `days`, lays it over the days too (`applyOutline`). */
export function setOutline(trip: Trip, outline: OutlineStop[], { days = false } = {}): Trip {
  const next: Trip = { ...trip, outline: outline.length ? outline : undefined };
  return days ? applyOutline(next, trip.outline) : next;
}

/** The ideas near each stop that has a location, nearest first; a card goes to its nearest stop only. */
export function ideasByStop(trip: Trip): Map<string, Item[]> {
  const out = new Map<string, { item: Item; m: number }[]>();
  const stops = (trip.outline ?? []).filter((s) => s.location);
  for (const id of trip.ideas) {
    const item = trip.items[id];
    if (!item?.location) continue;
    let best: { id: string; m: number } | undefined;
    for (const s of stops) {
      const m = haversineM(s.location!, item.location);
      if (m <= OUTLINE_NEAR_KM * 1000 && (!best || m < best.m)) best = { id: s.id, m };
    }
    if (best) out.set(best.id, [...(out.get(best.id) ?? []), { item, m: best.m }]);
  }
  return new Map([...out].map(([id, list]) => [id, list.sort((a, b) => a.m - b.m).map((x) => x.item)]));
}

/**
 * How the outline compares with the days the trip has: "match", "short" (the trip has more days than
 * the outline fills) or "long" (the outline needs more days than the trip has).
 */
export function outlineFit(trip: Trip): { kind: "none" | "match" | "short" | "long"; outline: number; days: number } {
  const outline = outlineDays(trip.outline);
  const days = trip.days.length;
  if (!outline) return { kind: "none", outline, days };
  return { kind: outline === days ? "match" : outline < days ? "short" : "long", outline, days };
}
