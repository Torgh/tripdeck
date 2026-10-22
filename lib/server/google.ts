import { hmInZone, isoDate, zonedTimeToUtc } from "../time";
import type { LatLng, OpeningPeriod, RoutableMode, RouteTime, TransitStep } from "../types";
import { DAY_MS, DiskCache } from "./cache";
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
  transit?: TransitStep[];
  walkMin?: number;
  sampledOn?: string;
}

interface RawStep {
  travelMode?: string;
  staticDuration?: string;
  polyline?: { encodedPolyline?: string };
  transitDetails?: {
    headsign?: string;
    stopCount?: number;
    stopDetails?: {
      departureStop?: { name?: string };
      arrivalStop?: { name?: string };
      departureTime?: string;
      arrivalTime?: string;
    };
    localizedValues?: {
      departureTime?: { time?: { text?: string }; timeZone?: string };
      arrivalTime?: { time?: { text?: string }; timeZone?: string };
    };
    transitLine?: {
      name?: string;
      nameShort?: string;
      color?: string;
      textColor?: string;
      vehicle?: { type?: string };
    };
  };
}

const ROUTE_FIELDS = "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline";
const TRANSIT_FIELDS =
  "routes.legs.steps.travelMode,routes.legs.steps.staticDuration,routes.legs.steps.polyline.encodedPolyline,routes.legs.steps.transitDetails";

/** The rides of a public-transport route and the minutes walked around them. */
export function transitSteps(steps: RawStep[]): { transit: TransitStep[]; walkMin: number } {
  const transit: TransitStep[] = [];
  let walkSec = 0;
  for (const s of steps) {
    const t = s.transitDetails;
    if (!t) {
      if (s.travelMode === "WALK") walkSec += parseDuration(s.staticDuration);
      continue;
    }
    const line = t.transitLine;
    // Google's own text follows the language ("2:00 PM"); the board shows 24-hour times.
    const clock = (at: string | undefined, local?: { time?: { text?: string }; timeZone?: string }) =>
      at && local?.timeZone ? hmInZone(new Date(at), local.timeZone) : local?.time?.text;
    transit.push({
      vehicle: line?.vehicle?.type ?? "TRANSIT",
      line: line?.nameShort || line?.name || "Public transport",
      color: line?.color,
      textColor: line?.textColor,
      from: t.stopDetails?.departureStop?.name ?? "?",
      to: t.stopDetails?.arrivalStop?.name ?? "?",
      stops: t.stopCount,
      departs: clock(t.stopDetails?.departureTime, t.localizedValues?.departureTime),
      arrives: clock(t.stopDetails?.arrivalTime, t.localizedValues?.arrivalTime),
      headsign: t.headsign,
      polyline: s.polyline?.encodedPolyline,
    });
  }
  return { transit, walkMin: Math.round(walkSec / 60) };
}

/** Each Google lookup is billed, so answers are kept (lib/server/cache.ts) for as long as they hold. */
const zoneCache = new DiskCache<string>("timezones", 180 * DAY_MS);
const elevationCache = new DiskCache<number>("elevations", 365 * DAY_MS);
/** Routes ignore traffic, so they change only with the roads; timetables change more often. */
const routeCache = new DiskCache<RouteOut>("routes", 30 * DAY_MS);
const transitCache = new DiskCache<RouteOut>("transit", 7 * DAY_MS);
const matrixCache = new DiskCache<(number | null)[][]>("matrices", 30 * DAY_MS);

const at = (p: LatLng, digits = 5) => `${p.lat.toFixed(digits)},${p.lng.toFixed(digits)}`;

/** IANA time zones by rounded location – they rarely change within ~10 km. */
export function timeZoneAt(point: LatLng): Promise<string> {
  return zoneCache.getOrFetch(at(point, 1), async () => {
    const url = new URL("https://maps.googleapis.com/maps/api/timezone/json");
    url.searchParams.set("location", `${point.lat},${point.lng}`);
    url.searchParams.set("timestamp", String(Math.floor(Date.now() / 1000)));
    url.searchParams.set("key", apiKey());
    const res = await fetch(url, { cache: "no-store" });
    const data = (await res.json()) as { status: string; timeZoneId?: string; errorMessage?: string };
    if (data.status !== "OK" || !data.timeZoneId) {
      const status = data.status === "REQUEST_DENIED" ? 503 : 502;
      throw new HttpError(status, data.errorMessage ?? `Time Zone API: ${data.status}`);
    }
    return data.timeZoneId;
  });
}

type RawRoute = {
  duration?: string;
  distanceMeters?: number;
  polyline?: { encodedPolyline?: string };
  legs?: { steps?: RawStep[] }[];
};

/** The first date after `today` that falls on the same weekday as `date` (all "YYYY-MM-DD"). */
export function sameWeekdaySoon(date: string, today: string): string {
  const d = new Date(`${today}T00:00:00Z`);
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  do d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() !== weekday);
  return d.toISOString().slice(0, 10);
}

export function computeRoute(origin: LatLng, destination: LatLng, mode: RoutableMode, time?: RouteTime): Promise<RouteOut> {
  const ask = () => fetchRoute(origin, destination, mode, time);
  const key = `${mode}|${at(origin)}|${at(destination)}`;
  if (mode !== "TRANSIT") return routeCache.getOrFetch(key, ask);
  // Public transport "right now" depends on when it is asked; only planned times are kept.
  if (!time) return ask();
  return transitCache.getOrFetch(`${key}|${time.date} ${time.time}${time.arriveBy ? " arrive" : ""}`, ask);
}

async function fetchRoute(origin: LatLng, destination: LatLng, mode: RoutableMode, time?: RouteTime): Promise<RouteOut> {
  const transit = mode === "TRANSIT";
  const zone = transit && time ? await timeZoneAt(time.arriveBy ? destination : origin) : undefined;
  const fetchOn = async (date?: string) => {
    const when =
      time && zone && date
        ? { [time.arriveBy ? "arrivalTime" : "departureTime"]: zonedTimeToUtc(date, time.time, zone).toISOString() }
        : {};
    const data = await googleFetch<{ routes?: RawRoute[] }>(`${ROUTES_URL}/directions/v2:computeRoutes`, {
      method: "POST",
      body: JSON.stringify({
        origin: waypoint(origin),
        destination: waypoint(destination),
        travelMode: mode,
        ...routingPreference(mode),
        ...when,
        // Station names in English rather than the local script.
        ...(transit ? { languageCode: "en" } : {}),
      }),
      fieldMask: transit ? `${ROUTE_FIELDS},${TRANSIT_FIELDS}` : ROUTE_FIELDS,
    });
    return data.routes?.[0];
  };

  let route = await fetchOn(time?.date);
  let sampledOn: string | undefined;
  if (!route && zone && time) {
    // Google only plans as far ahead as timetables are published (a few weeks to months). For a
    // later trip, use the same weekday and time next week: it shows the lines and whether they run then.
    sampledOn = sameWeekdaySoon(time.date, isoDate(new Date()));
    if (sampledOn < time.date) route = await fetchOn(sampledOn);
  }
  if (!route) {
    throw new HttpError(
      404,
      transit && time
        ? `No public transport ${time.arriveBy ? "arriving by" : "leaving around"} ${time.time} on ${time.date}${sampledOn && sampledOn < time.date ? ` (checked on the same weekday, ${sampledOn})` : ""} – it may not run then.`
        : `No ${mode.toLowerCase()} route found between these places.`,
    );
  }
  return {
    durationSec: parseDuration(route.duration),
    distanceM: route.distanceMeters ?? 0,
    polyline: route.polyline?.encodedPolyline,
    ...(transit ? transitSteps(route.legs?.flatMap((l) => l.steps ?? []) ?? []) : {}),
    ...(sampledOn ? { sampledOn } : {}),
  };
}

/**
 * Travel-time matrix in minutes. Unreachable pairs are `null` so callers can fall back to an
 * estimate. The diagonal is 0.
 */
export function routeMatrix(points: LatLng[], mode: RoutableMode): Promise<(number | null)[][]> {
  const ask = () => fetchMatrix(points, mode);
  return mode === "TRANSIT" ? ask() : matrixCache.getOrFetch(`${mode}|${points.map((p) => at(p)).join("|")}`, ask);
}

async function fetchMatrix(points: LatLng[], mode: RoutableMode): Promise<(number | null)[][]> {
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

/** Elevations in metres, in the order of `points`. The ones not cached yet are asked in one request. */
export async function elevations(points: LatLng[]): Promise<number[]> {
  const keys = points.map((p) => at(p, 4));
  const out = keys.map((k) => elevationCache.get(k));
  const missing = [...new Set(keys.filter((_, i) => out[i] === undefined))];
  if (missing.length) {
    const url = new URL("https://maps.googleapis.com/maps/api/elevation/json");
    url.searchParams.set("locations", missing.join("|"));
    url.searchParams.set("key", apiKey());
    const res = await fetch(url, { cache: "no-store" });
    const data = (await res.json()) as { status: string; results?: { elevation: number }[]; error_message?: string };
    if (data.status !== "OK" || data.results?.length !== missing.length) {
      throw new HttpError(502, data.error_message ?? `Elevation API: ${data.status}`);
    }
    const found = new Map(missing.map((k, i) => [k, data.results![i].elevation]));
    found.forEach((m, k) => elevationCache.set(k, m));
    keys.forEach((k, i) => (out[i] ??= found.get(k)));
  }
  return out as number[];
}
