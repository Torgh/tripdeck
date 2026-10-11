import type { LatLng, OpeningPeriod, RoutableMode } from "../types";
import { readConfig } from "./config";
import { HttpError } from "./errors";

const PLACES_URL = "https://places.googleapis.com/v1";
const ROUTES_URL = "https://routes.googleapis.com";

const PLACE_FIELDS = [
  "id",
  "displayName",
  "formattedAddress",
  "location",
  "rating",
  "userRatingCount",
  "types",
  "primaryType",
  "regularOpeningHours",
  "googleMapsUri",
  "websiteUri",
  "editorialSummary",
];

export interface PlaceResult {
  placeId: string;
  name: string;
  address?: string;
  lat: number;
  lng: number;
  rating?: number;
  userRatingCount?: number;
  primaryType?: string;
  types?: string[];
  openingPeriods?: OpeningPeriod[];
  /** Human-readable weekly hours, e.g. "Monday: 9:00 AM – 5:00 PM". */
  weekdayHours?: string[];
  googleMapsUri?: string;
  websiteUri?: string;
  editorialSummary?: string;
}

function apiKey(): string {
  const key = readConfig().googleMapsServerKey;
  if (!key) throw new HttpError(503, "No Google Maps server key configured.");
  return key;
}

async function googleFetch<T>(url: string, init: RequestInit & { fieldMask?: string }): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey() };
  if (init.fieldMask) headers["X-Goog-FieldMask"] = init.fieldMask;
  const res = await fetch(url, { ...init, headers, cache: "no-store" });
  if (!res.ok) {
    let message = `Google API error ${res.status}`;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body.error?.message) message = body.error.message;
    } catch {
      // keep the generic message
    }
    // 401/403 mean the key or API is not set up: report as "unavailable" so clients retry later.
    const status = res.status === 400 ? 400 : res.status === 401 || res.status === 403 ? 503 : 502;
    throw new HttpError(status, message);
  }
  return (await res.json()) as T;
}

interface RawPlace {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  rating?: number;
  userRatingCount?: number;
  types?: string[];
  primaryType?: string;
  regularOpeningHours?: { periods?: OpeningPeriod[]; weekdayDescriptions?: string[] };
  googleMapsUri?: string;
  websiteUri?: string;
  editorialSummary?: { text: string };
}

function toPlace(p: RawPlace): PlaceResult {
  return {
    placeId: p.id,
    name: p.displayName?.text ?? "Unnamed place",
    address: p.formattedAddress,
    lat: p.location?.latitude ?? 0,
    lng: p.location?.longitude ?? 0,
    rating: p.rating,
    userRatingCount: p.userRatingCount,
    primaryType: p.primaryType,
    types: p.types,
    openingPeriods: p.regularOpeningHours?.periods,
    weekdayHours: p.regularOpeningHours?.weekdayDescriptions,
    googleMapsUri: p.googleMapsUri,
    websiteUri: p.websiteUri,
    editorialSummary: p.editorialSummary?.text,
  };
}

export async function searchText(
  query: string,
  opts: { bias?: LatLng; radiusM?: number; maxResults?: number } = {},
): Promise<PlaceResult[]> {
  const body: Record<string, unknown> = { textQuery: query, pageSize: opts.maxResults ?? 10 };
  if (opts.bias) {
    body.locationBias = {
      circle: {
        center: { latitude: opts.bias.lat, longitude: opts.bias.lng },
        radius: Math.min(opts.radiusM ?? 30_000, 50_000),
      },
    };
  }
  const data = await googleFetch<{ places?: RawPlace[] }>(`${PLACES_URL}/places:searchText`, {
    method: "POST",
    body: JSON.stringify(body),
    fieldMask: PLACE_FIELDS.map((f) => `places.${f}`).join(","),
  });
  return (data.places ?? []).map(toPlace);
}

export async function searchNearby(opts: {
  center: LatLng;
  radiusM: number;
  includedTypes?: string[];
  maxResults?: number;
}): Promise<PlaceResult[]> {
  const data = await googleFetch<{ places?: RawPlace[] }>(`${PLACES_URL}/places:searchNearby`, {
    method: "POST",
    body: JSON.stringify({
      includedTypes: opts.includedTypes?.length ? opts.includedTypes : undefined,
      maxResultCount: Math.min(opts.maxResults ?? 20, 20),
      rankPreference: "POPULARITY",
      locationRestriction: {
        circle: {
          center: { latitude: opts.center.lat, longitude: opts.center.lng },
          radius: Math.min(opts.radiusM, 50_000),
        },
      },
    }),
    fieldMask: PLACE_FIELDS.map((f) => `places.${f}`).join(","),
  });
  return (data.places ?? []).map(toPlace);
}

export async function placeDetails(placeId: string): Promise<PlaceResult> {
  const raw = await googleFetch<RawPlace>(`${PLACES_URL}/places/${encodeURIComponent(placeId)}`, {
    method: "GET",
    fieldMask: PLACE_FIELDS.join(","),
  });
  return toPlace(raw);
}

function waypoint(p: LatLng) {
  return { location: { latLng: { latitude: p.lat, longitude: p.lng } } };
}

/** Traffic-aware routing preferences are only valid for motorised modes. */
function routingPreference(mode: RoutableMode) {
  return mode === "DRIVE" || mode === "TWO_WHEELER" ? { routingPreference: "TRAFFIC_UNAWARE" } : {};
}

function parseDuration(d: string | undefined): number {
  return d ? Number.parseFloat(d.replace(/s$/, "")) : 0;
}

export interface RouteOut {
  durationSec: number;
  distanceM: number;
  polyline?: string;
}

export async function computeRoute(origin: LatLng, destination: LatLng, mode: RoutableMode): Promise<RouteOut> {
  const data = await googleFetch<{
    routes?: { duration?: string; distanceMeters?: number; polyline?: { encodedPolyline?: string } }[];
  }>(`${ROUTES_URL}/directions/v2:computeRoutes`, {
    method: "POST",
    body: JSON.stringify({
      origin: waypoint(origin),
      destination: waypoint(destination),
      travelMode: mode,
      ...routingPreference(mode),
    }),
    fieldMask: "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline",
  });
  const route = data.routes?.[0];
  if (!route) throw new HttpError(404, `No ${mode.toLowerCase()} route found between these places.`);
  return {
    durationSec: parseDuration(route.duration),
    distanceM: route.distanceMeters ?? 0,
    polyline: route.polyline?.encodedPolyline,
  };
}

/**
 * Travel-time matrix in minutes. Unreachable pairs are `null` so callers can fall back to an
 * estimate. The diagonal is 0.
 */
export async function routeMatrix(points: LatLng[], mode: RoutableMode): Promise<(number | null)[][]> {
  const n = points.length;
  const matrix: (number | null)[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 0 : null)),
  );
  if (n < 2) return matrix;
  const elements = await googleFetch<
    { originIndex?: number; destinationIndex?: number; duration?: string; condition?: string }[]
  >(`${ROUTES_URL}/distanceMatrix/v2:computeRouteMatrix`, {
    method: "POST",
    body: JSON.stringify({
      origins: points.map((p) => ({ waypoint: waypoint(p) })),
      destinations: points.map((p) => ({ waypoint: waypoint(p) })),
      travelMode: mode,
      ...routingPreference(mode),
    }),
    fieldMask: "originIndex,destinationIndex,duration,condition",
  });
  for (const el of elements) {
    // proto3 JSON omits zero values, so a missing index means 0
    const i = el.originIndex ?? 0;
    const j = el.destinationIndex ?? 0;
    if (i !== j && el.condition === "ROUTE_EXISTS") matrix[i][j] = parseDuration(el.duration) / 60;
  }
  return matrix;
}

export async function elevation(point: LatLng): Promise<number> {
  const url = new URL("https://maps.googleapis.com/maps/api/elevation/json");
  url.searchParams.set("locations", `${point.lat},${point.lng}`);
  url.searchParams.set("key", apiKey());
  const res = await fetch(url, { cache: "no-store" });
  const data = (await res.json()) as { status: string; results?: { elevation: number }[]; error_message?: string };
  if (data.status !== "OK" || !data.results?.length) {
    throw new HttpError(502, data.error_message ?? `Elevation API: ${data.status}`);
  }
  return data.results[0].elevation;
}
