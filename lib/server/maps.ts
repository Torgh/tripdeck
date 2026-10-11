import type { LatLng, RoutableMode } from "../types";
import { readConfig } from "./config";
import { HttpError } from "./errors";
import * as google from "./google";
import * as osm from "./osm";

export type { PlaceResult, RouteOut } from "./google";
export { OSM_CATEGORIES } from "./osm";

export type MapsProvider = "google" | "osm";

export function mapsProvider(): MapsProvider {
  return readConfig().googleMapsServerKey ? "google" : "osm";
}

/**
 * Uses Google when a key is configured and falls back to OpenStreetMap when Google is
 * unavailable (API not enabled, quota, network) – so a half-configured key never blocks planning.
 */
async function withFallback<T>(viaGoogle: () => Promise<T>, viaOsm: () => Promise<T>): Promise<T> {
  if (mapsProvider() === "osm") return viaOsm();
  try {
    return await viaGoogle();
  } catch (err) {
    if (err instanceof HttpError && (err.status === 503 || err.status === 502)) {
      console.warn(`Google Maps unavailable (${err.message}); using OpenStreetMap.`);
      return viaOsm();
    }
    throw err;
  }
}

export function searchPlaces(query: string, opts: { bias?: LatLng; radiusM?: number; maxResults?: number } = {}) {
  return withFallback(
    () => google.searchText(query, opts),
    () => osm.osmSearch(query, opts),
  );
}

/** Google place types for the same categories the OSM provider understands. */
const GOOGLE_TYPES: Record<string, string[]> = {
  sights: ["tourist_attraction", "historical_landmark", "museum"],
  nature: ["park", "national_park", "hiking_area", "beach"],
  beaches: ["beach"],
  viewpoints: ["observation_deck", "tourist_attraction"],
  museums: ["museum", "art_gallery"],
  food: ["restaurant", "cafe"],
  diving: ["tourist_attraction"],
};

export function nearbyPlaces(opts: { center: LatLng; radiusM: number; categories?: string[]; maxResults?: number }) {
  const cats = opts.categories?.length ? opts.categories : ["sights", "nature"];
  return withFallback(
    () =>
      google.searchNearby({
        center: opts.center,
        radiusM: opts.radiusM,
        maxResults: opts.maxResults,
        includedTypes: [...new Set(cats.flatMap((c) => GOOGLE_TYPES[c] ?? []))],
      }),
    () => osm.osmNearby({ ...opts, categories: cats }),
  );
}

export function placeDetails(placeId: string) {
  if (placeId.startsWith("osm:")) throw new HttpError(404, "Details are only available for Google places.");
  return google.placeDetails(placeId);
}

export function computeRoute(origin: LatLng, destination: LatLng, mode: RoutableMode) {
  return withFallback(
    () => google.computeRoute(origin, destination, mode),
    () => osm.osmRoute(origin, destination, mode),
  );
}

export function routeMatrix(points: LatLng[], mode: RoutableMode) {
  return withFallback(
    () => google.routeMatrix(points, mode),
    () => osm.osmMatrix(points, mode),
  );
}

export function elevation(point: LatLng) {
  return withFallback(
    () => google.elevation(point),
    () => osm.osmElevation(point),
  );
}
