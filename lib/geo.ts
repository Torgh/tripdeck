import type { Item, LatLng, TravelMode } from "./types";

export function haversineM(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Rough average speeds (km/h) used when no routing is available. */
const FALLBACK_SPEED_KMH: Record<TravelMode, number> = {
  DRIVE: 40,
  TWO_WHEELER: 35,
  TRANSIT: 20,
  BICYCLE: 14,
  WALK: 4.5,
  FERRY: 25,
  BOAT: 30,
  FLIGHT: 500,
};

/** Straight-line distance x 1.3 detour factor at an average speed for the mode. */
export function estimateMinutes(a: LatLng, b: LatLng, mode: TravelMode): number {
  const km = (haversineM(a, b) * 1.3) / 1000;
  return (km / FALLBACK_SPEED_KMH[mode]) * 60;
}

export function routeKey(mode: TravelMode, a: LatLng, b: LatLng): string {
  const r = (n: number) => n.toFixed(5);
  return `${mode}|${r(a.lat)},${r(a.lng)}|${r(b.lat)},${r(b.lng)}`;
}

/** Decodes a Google encoded polyline (precision 5). */
export function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    for (const axis of [0, 1]) {
      let result = 0;
      let shift = 0;
      let byte: number;
      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) lat += delta;
      else lng += delta;
    }
    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}

/**
 * Extracts coordinates from a pasted Google Maps link or a plain "lat, lng" string.
 * Handles `@lat,lng,zoom`, `!3dlat!4dlng`, `?q=lat,lng` and `query=lat,lng` forms.
 */
export function parseCoordinates(input: string): LatLng | undefined {
  const text = decodeURIComponent(input.trim());
  const patterns = [
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
    /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
    /[?&](?:q|query|ll|destination)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
    /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/,
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (m) {
      const lat = Number(m[1]);
      const lng = Number(m[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
    }
  }
  return undefined;
}

/** Flights more than this far from every other stop (e.g. the flight from home) are left out of the trip's area. */
export const FOCUS_MAX_KM = 1000;

/**
 * The cards that make up a trip's area on a map: every located card except flights that are far from
 * all the places you stay or visit. Falls back to every card when the trip is only flights.
 */
export function focusItems(items: Item[]): Item[] {
  const located = items.filter((it) => it.location);
  const isFlight = (it: Item) => it.type === "transport" && it.transport?.kind === "flight";
  const ground = located.filter((it) => !isFlight(it)).map((it) => it.location!);
  if (!ground.length) return located;
  return located.filter((it) => !isFlight(it) || ground.some((g) => haversineM(g, it.location!) <= FOCUS_MAX_KM * 1000));
}

/** Height / width of the Web Mercator box around `points` (tall trips > 1, wide trips < 1). */
export function mercatorAspect(points: LatLng[]): number {
  if (points.length < 2) return 0.65;
  const y = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const height = y(Math.max(...lats)) - y(Math.min(...lats));
  const width = ((Math.max(...lngs) - Math.min(...lngs)) * Math.PI) / 180;
  return width > 0 ? height / width : 1.5;
}

export function centroid(points: LatLng[]): LatLng | undefined {
  if (!points.length) return undefined;
  const sum = points.reduce((acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }), { lat: 0, lng: 0 });
  return { lat: sum.lat / points.length, lng: sum.lng / points.length };
}
