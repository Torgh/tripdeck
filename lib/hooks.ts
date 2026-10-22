"use client";

import { useEffect, useState } from "react";
import { ApiError, postJSON } from "./api";
import { routeKey } from "./geo";
import type { Rates } from "./money";
import { isoDate } from "./time";
import { getLeg, type DayTimeline } from "./timeline";
import { legRouteTime } from "./transit";
import { useRatesFrom, useTripBudgetFrom, type FetchRates } from "./useRates";
import { useStore } from "./store";
import {
  isRoutable,
  leavesFrom,
  legKey,
  routeTimeKey,
  type Item,
  type LatLng,
  type Location,
  type RouteTime,
  type Trip,
} from "./types";
import type { RouteOut } from "./server/google";

let hydration: Promise<void> | undefined;

/** Loads persisted trips from localStorage once per page load, after the first client render. */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    hydration ??= Promise.resolve(useStore.persist.rehydrate());
    hydration.then(() => setHydrated(true));
  }, []);
  return hydrated;
}

const inFlight = new Set<string>();
/** Routes Google said do not exist; checked again after a reload. */
const noRoute = new Set<string>();
/**
 * Set when the server has no Google key (503) or the browser is offline: stop asking and let the
 * board fall back to straight-line estimates. Not persisted, so routing resumes after a reload.
 */
let googleUnavailable = false;
const isUnavailable = (err: unknown) => err instanceof ApiError && (err.status === 503 || err.status === 0);

/**
 * Every consecutive pair on the board that needs a route, including the hop from the morning's stay,
 * with when public transport should be planned for (the time in the plan, not right now).
 */
function legsToRoute(trip: Trip, timelines: DayTimeline[]): { from: Item; to: Item; time?: RouteTime }[] {
  const today = isoDate(new Date());
  return timelines.flatMap((tl) =>
    tl.entries.flatMap((e) => {
      const from = e.fromId ? trip.items[e.fromId] : undefined;
      const to = trip.items[e.itemId];
      if (!from || !to) return [];
      const transit = getLeg(trip, from.id, to.id).mode === "TRANSIT";
      return [{ from, to, time: transit ? legRouteTime(trip.startDate, tl.dayIndex, e, today) : undefined }];
    }),
  );
}

/** Fetches Google routes for legs that have no up-to-date result yet. `timelines` is computeTripTimeline(trip). */
export function useRouteLegs(trip: Trip | undefined, timelines: DayTimeline[]) {
  const setLeg = useStore((s) => s.setLeg);
  useEffect(() => {
    if (!trip || googleUnavailable) return;
    for (const { from, to, time } of legsToRoute(trip, timelines)) {
      const origin = leavesFrom(from);
      if (!origin || !to.location) continue;
      const leg = getLeg(trip, from.id, to.id);
      if (!isRoutable(leg.mode)) continue;
      const key = routeKey(leg.mode, origin, to.location);
      const at = time && routeTimeKey(time);
      const attempt = at ? `${key}@${at}` : key;
      const upToDate = leg.result?.key === key && leg.result.at === at;
      if (upToDate || noRoute.has(attempt) || inFlight.has(attempt)) continue;
      inFlight.add(attempt);
      const k = legKey(from.id, to.id);
      postJSON<{ route: RouteOut }>("/api/route", { origin, destination: to.location, mode: leg.mode, time })
        .then(({ route }) => setLeg(trip.id, k, { mode: leg.mode, auto: leg.auto, result: { key, at, ...route }, error: undefined }))
        .catch((err: Error) => {
          if (isUnavailable(err)) googleUnavailable = true;
          // Remember only a genuine "no route between these points"; transient errors are retried.
          else if (err instanceof ApiError && err.status === 404) {
            noRoute.add(attempt);
            setLeg(trip.id, k, { mode: leg.mode, auto: leg.auto, result: undefined, error: { key, message: err.message } });
          }
        })
        .finally(() => inFlight.delete(attempt));
    }
  }, [trip, timelines, setLeg]);
}

/**
 * Adds looked-up facts (elevation, time zone) to a card's place – or a transport card's arrival place –
 * on the card as it is now, so two lookups finishing together don't undo each other, and only while
 * the place is still where it was looked up.
 */
function patchPlace(tripId: string, itemId: string, arrival: boolean, at: LatLng, patch: Partial<Location>) {
  const { trips, updateItem } = useStore.getState();
  const item = trips[tripId]?.items[itemId];
  const loc = arrival ? item?.transport?.toLocation : item?.location;
  if (!item || !loc || loc.lat !== at.lat || loc.lng !== at.lng) return;
  if (arrival) updateItem(tripId, itemId, { transport: { ...item.transport!, toLocation: { ...loc, ...patch } } });
  else updateItem(tripId, itemId, { location: { ...loc, ...patch } });
}

const elevationTried = new Set<string>();

/** Places per elevation request (the server's limit). */
const ELEVATION_BATCH = 100;

/** Looks up elevation for located items (used by the dive altitude checks), many places per request. */
export function useElevations(trip: Trip | undefined) {
  useEffect(() => {
    if (!trip || googleUnavailable) return;
    const hasDives = Object.values(trip.items).some((i) => i.type === "dive");
    if (!hasDives) return;
    const todo: { itemId: string; loc: Location }[] = [];
    for (const item of Object.values(trip.items)) {
      const loc = item.location;
      if (!loc || loc.elevationM !== undefined) continue;
      const k = `${item.id}|${loc.lat},${loc.lng}`;
      if (elevationTried.has(k)) continue;
      elevationTried.add(k);
      todo.push({ itemId: item.id, loc });
    }
    for (let i = 0; i < todo.length; i += ELEVATION_BATCH) {
      const batch = todo.slice(i, i + ELEVATION_BATCH);
      const points = batch.map(({ loc }) => ({ lat: loc.lat, lng: loc.lng }));
      postJSON<{ elevations: number[] }>("/api/elevation", { points })
        .then(({ elevations }) =>
          batch.forEach(({ itemId, loc }, j) => patchPlace(trip.id, itemId, false, loc, { elevationM: elevations[j] })),
        )
        .catch((err) => {
          // Only remember a failure for these places when the lookup itself failed.
          if (isUnavailable(err)) googleUnavailable = true;
          else batch.forEach(({ itemId, loc }) => patchPlace(trip.id, itemId, false, loc, { elevationM: null }));
        });
    }
  }, [trip]);
}

const zoneTried = new Set<string>();

/** Looks up the time zones where flights, ferries and trains leave and arrive (for the clock changes). */
export function useTimeZones(trip: Trip | undefined) {
  useEffect(() => {
    if (!trip || googleUnavailable) return;
    for (const item of Object.values(trip.items)) {
      if (item.type !== "transport") continue;
      for (const [arrival, loc] of [
        [false, item.location],
        [true, item.transport?.toLocation],
      ] as const) {
        if (!loc || loc.timeZone !== undefined) continue;
        const k = `${item.id}|${arrival}|${loc.lat},${loc.lng}`;
        if (zoneTried.has(k)) continue;
        zoneTried.add(k);
        postJSON<{ timeZone: string }>("/api/timezone", { lat: loc.lat, lng: loc.lng })
          .then(({ timeZone }) => patchPlace(trip.id, item.id, arrival, loc, { timeZone }))
          .catch((err) => {
            if (isUnavailable(err)) googleUnavailable = true;
            else patchPlace(trip.id, item.id, arrival, loc, { timeZone: null });
          });
      }
    }
  }, [trip]);
}

const fetchRates: FetchRates = (base) => postJSON<Rates>("/api/rates", { base });

/** Exchange rates from `base`, through this app's server (which keeps them for the MCP server too). */
export const useRates = (base: string, needed: boolean) => useRatesFrom(base, needed, fetchRates);

/** What the trip costs, in its budget currency, with today's rates (or the last ones fetched). */
export const useTripBudget = (trip: Trip | undefined) => useTripBudgetFrom(trip, fetchRates);
