"use client";

import { useEffect, useState } from "react";
import { ApiError, postJSON } from "./api";
import { routeKey } from "./geo";
import { findBase, getLeg } from "./timeline";
import { useStore } from "./store";
import { isRoutable, leavesFrom, legKey, type Item, type Trip } from "./types";
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

/** Every consecutive pair on the board that needs a route, including the hop from the morning's stay. */
function legPairs(trip: Trip): [Item, Item][] {
  const pairs: [Item, Item][] = [];
  trip.days.forEach((day, i) => {
    let prev = findBase(trip, i);
    for (const id of day.itemIds) {
      const item = trip.items[id];
      if (!item) continue;
      if (prev && prev.id !== item.id) pairs.push([prev, item]);
      prev = item;
    }
  });
  return pairs;
}

/** Fetches Google routes for legs that have no up-to-date result yet. */
export function useRouteLegs(trip: Trip | undefined) {
  const setLeg = useStore((s) => s.setLeg);
  useEffect(() => {
    if (!trip || googleUnavailable) return;
    for (const [from, to] of legPairs(trip)) {
      const origin = leavesFrom(from);
      if (!origin || !to.location) continue;
      const leg = getLeg(trip, from.id, to.id);
      if (!isRoutable(leg.mode)) continue;
      const key = routeKey(leg.mode, origin, to.location);
      if (leg.result?.key === key || noRoute.has(key) || inFlight.has(key)) continue;
      inFlight.add(key);
      const k = legKey(from.id, to.id);
      postJSON<{ route: RouteOut }>("/api/route", { origin, destination: to.location, mode: leg.mode })
        .then(({ route }) => setLeg(trip.id, k, { mode: leg.mode, result: { key, ...route }, error: undefined }))
        .catch((err: Error) => {
          if (isUnavailable(err)) googleUnavailable = true;
          // Remember only a genuine "no route between these points"; transient errors are retried.
          else if (err instanceof ApiError && err.status === 404) {
            noRoute.add(key);
            setLeg(trip.id, k, { mode: leg.mode, error: { key, message: err.message } });
          }
        })
        .finally(() => inFlight.delete(key));
    }
  }, [trip, setLeg]);
}

const elevationTried = new Set<string>();

/** Looks up elevation for located items (used by the dive altitude checks). */
export function useElevations(trip: Trip | undefined) {
  const updateItem = useStore((s) => s.updateItem);
  useEffect(() => {
    if (!trip || googleUnavailable) return;
    const hasDives = Object.values(trip.items).some((i) => i.type === "dive");
    if (!hasDives) return;
    for (const item of Object.values(trip.items)) {
      const loc = item.location;
      if (!loc || loc.elevationM !== undefined) continue;
      const k = `${item.id}|${loc.lat},${loc.lng}`;
      if (elevationTried.has(k)) continue;
      elevationTried.add(k);
      postJSON<{ elevationM: number }>("/api/elevation", { lat: loc.lat, lng: loc.lng })
        .then(({ elevationM }) => updateItem(trip.id, item.id, { location: { ...loc, elevationM } }))
        .catch((err) => {
          // Only remember a failure for this place when the lookup itself failed.
          if (isUnavailable(err)) googleUnavailable = true;
          else updateItem(trip.id, item.id, { location: { ...loc, elevationM: null } });
        });
    }
  }, [trip, updateItem]);
}
