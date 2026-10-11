import type { LatLng, RoutableMode } from "../types";
import { HttpError } from "./errors";
import type { PlaceResult, RouteOut } from "./google";

/**
 * Free OpenStreetMap-based services, used when no Google Maps key is configured:
 * Photon (search), Overpass (nearby places), FOSSGIS OSRM (routing) and Open-Meteo (elevation).
 * They are community-run: fine for personal planning, not for heavy traffic.
 */
const HEADERS = { "User-Agent": "TripDeck/0.1 (personal trip planner; https://github.com/)" };

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: { ...HEADERS, ...init?.headers }, cache: "no-store" });
  } catch {
    throw new HttpError(503, "OpenStreetMap services are unreachable – are you online?");
  }
  if (res.status === 429) throw new HttpError(503, "OpenStreetMap service is busy – try again in a minute.");
  if (!res.ok) throw new HttpError(502, `OpenStreetMap service error ${res.status}`);
  return (await res.json()) as T;
}

// ---------- Search (Photon) ----------

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    osm_type?: string;
    osm_id?: number;
    osm_key?: string;
    osm_value?: string;
    name?: string;
    street?: string;
    housenumber?: string;
    city?: string;
    district?: string;
    state?: string;
    country?: string;
  };
}

const OSM_TYPE: Record<string, string> = { N: "node", W: "way", R: "relation" };

function photonToPlace(f: PhotonFeature): PlaceResult {
  const p = f.properties;
  const [lng, lat] = f.geometry.coordinates;
  const street = [p.street, p.housenumber].filter(Boolean).join(" ");
  const address = [street, p.district ?? p.city, p.country].filter(Boolean).join(", ");
  return {
    placeId: `osm:${OSM_TYPE[p.osm_type ?? ""] ?? "node"}/${p.osm_id ?? 0}`,
    name: p.name ?? (street || p.city || "Unnamed place"),
    address: address || undefined,
    lat,
    lng,
    primaryType: p.osm_value,
    types: [p.osm_key, p.osm_value].filter(Boolean) as string[],
    googleMapsUri: `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`,
  };
}

export async function osmSearch(query: string, opts: { bias?: LatLng; maxResults?: number } = {}): Promise<PlaceResult[]> {
  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(opts.maxResults ?? 8));
  url.searchParams.set("lang", "en");
  if (opts.bias) {
    url.searchParams.set("lat", String(opts.bias.lat));
    url.searchParams.set("lon", String(opts.bias.lng));
  }
  const data = await getJson<{ features?: PhotonFeature[] }>(url.toString());
  return (data.features ?? []).map(photonToPlace);
}

// ---------- Nearby (Overpass) ----------

/** Overpass tag filters per category the MCP tools / UI can ask for. */
export const OSM_CATEGORIES: Record<string, string[]> = {
  sights: ['["tourism"~"^(attraction|viewpoint|museum|gallery|artwork|zoo|aquarium|theme_park)$"]', '["historic"]'],
  nature: ['["natural"~"^(beach|peak|cave_entrance|cliff|bay|spring|waterfall)$"]', '["leisure"~"^(park|nature_reserve)$"]', '["waterway"="waterfall"]'],
  beaches: ['["natural"="beach"]'],
  viewpoints: ['["tourism"="viewpoint"]'],
  museums: ['["tourism"~"^(museum|gallery)$"]'],
  food: ['["amenity"~"^(restaurant|cafe|bar|pub|ice_cream)$"]'],
  diving: ['["sport"="scuba_diving"]', '["shop"="scuba_diving"]', '["amenity"="dive_centre"]'],
};

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

function overpassToPlace(e: OverpassElement): PlaceResult | undefined {
  const t = e.tags ?? {};
  const lat = e.lat ?? e.center?.lat;
  const lng = e.lon ?? e.center?.lon;
  const name = t["name:en"] ?? t.name;
  if (lat == null || lng == null || !name) return undefined;
  const kind = t.tourism ?? t.historic ?? t.natural ?? t.leisure ?? t.amenity ?? t.sport ?? t.shop;
  const address = [t["addr:street"], t["addr:housenumber"], t["addr:city"]].filter(Boolean).join(" ");
  return {
    placeId: `osm:${e.type}/${e.id}`,
    name,
    address: address || undefined,
    lat,
    lng,
    primaryType: kind,
    types: kind ? [kind] : [],
    weekdayHours: t.opening_hours ? [t.opening_hours] : undefined,
    websiteUri: t.website ?? t["contact:website"],
    googleMapsUri: `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`,
    editorialSummary: t.description ?? (t.wikipedia ? `Wikipedia: ${t.wikipedia}` : undefined),
  };
}

/** Rough notability: Wikipedia/Wikidata links and rich tagging rank higher. */
function notability(e: OverpassElement): number {
  const t = e.tags ?? {};
  return (t.wikipedia ? 3 : 0) + (t.wikidata ? 2 : 0) + (t.website ? 1 : 0) + (t.opening_hours ? 0.5 : 0) + (t.image ? 0.5 : 0);
}

interface WikiGeo {
  pageid: number;
  title: string;
  lat: number;
  lon: number;
  dist: number;
}

/**
 * Fallback when every Overpass server is busy: Wikipedia's geosearch lists notable places
 * (anything with an article) around a point. Only useful for sights, not for food or diving.
 */
async function wikipediaNearby(center: LatLng, radiusM: number, max: number): Promise<PlaceResult[]> {
  const url = new URL("https://en.wikipedia.org/w/api.php");
  url.search = new URLSearchParams({
    action: "query",
    list: "geosearch",
    gscoord: `${center.lat}|${center.lng}`,
    gsradius: String(Math.min(Math.round(radiusM), 10_000)),
    gslimit: String(Math.min(max * 2, 50)),
    format: "json",
    origin: "*",
  }).toString();
  const data = await getJson<{ query?: { geosearch?: WikiGeo[] } }>(url.toString());
  return (data.query?.geosearch ?? []).slice(0, max).map((g) => ({
    placeId: `wiki:${g.pageid}`,
    name: g.title,
    lat: g.lat,
    lng: g.lon,
    primaryType: "landmark",
    types: ["landmark"],
    websiteUri: `https://en.wikipedia.org/?curid=${g.pageid}`,
    googleMapsUri: `https://www.google.com/maps/search/?api=1&query=${g.lat},${g.lon}`,
    editorialSummary: "Has a Wikipedia article.",
  }));
}

export async function osmNearby(opts: {
  center: LatLng;
  radiusM: number;
  categories?: string[];
  maxResults?: number;
}): Promise<PlaceResult[]> {
  const cats = (opts.categories?.length ? opts.categories : ["sights", "nature"]).filter((c) => OSM_CATEGORIES[c]);
  const r = Math.min(opts.radiusM, 30_000);
  const filters = cats.flatMap((c) => OSM_CATEGORIES[c]);
  const around = `(around:${Math.round(r)},${opts.center.lat},${opts.center.lng})`;
  const query = `[out:json][timeout:25];(${filters.map((f) => `nwr${around}${f}["name"];`).join("")});out center tags 200;`;
  let data: { elements?: OverpassElement[] };
  try {
    data = await overpass(query);
  } catch (err) {
    const sightsOnly = cats.every((c) => ["sights", "museums", "viewpoints", "nature", "beaches"].includes(c));
    if (sightsOnly) return wikipediaNearby(opts.center, r, opts.maxResults ?? 20);
    throw err;
  }
  const seen = new Set<string>();
  return (data.elements ?? [])
    .sort((a, b) => notability(b) - notability(a))
    .map(overpassToPlace)
    .filter((p): p is PlaceResult => !!p && !seen.has(p.name) && !!seen.add(p.name))
    .slice(0, opts.maxResults ?? 20);
}

/** Public Overpass instances are often busy; try the next one on failure. */
const OVERPASS_MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

async function overpass(query: string): Promise<{ elements?: OverpassElement[] }> {
  let lastError: unknown;
  for (const url of OVERPASS_MIRRORS) {
    try {
      const data = await getJson<{ elements?: OverpassElement[]; remark?: string }>(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(30_000),
      });
      // Overloaded servers answer 200 with a "runtime error" remark and no elements.
      if (data.remark && !data.elements?.length) throw new HttpError(503, data.remark);
      return data;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof HttpError ? new HttpError(503, "Nearby search (Overpass) is busy – try again shortly.") : lastError;
}

// ---------- Routing (OSRM, FOSSGIS servers) ----------

const OSRM_PROFILE: Partial<Record<RoutableMode, string>> = {
  DRIVE: "routed-car",
  TWO_WHEELER: "routed-car",
  BICYCLE: "routed-bike",
  WALK: "routed-foot",
};

function osrmBase(mode: RoutableMode): string {
  const profile = OSRM_PROFILE[mode];
  if (!profile) throw new HttpError(404, "Public-transport routing needs a Google Maps key; using an estimate.");
  return `https://routing.openstreetmap.de/${profile}`;
}

const coord = (p: LatLng) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`;

export async function osmRoute(origin: LatLng, destination: LatLng, mode: RoutableMode): Promise<RouteOut> {
  const data = await getJson<{ code: string; routes?: { duration: number; distance: number; geometry: string }[] }>(
    `${osrmBase(mode)}/route/v1/driving/${coord(origin)};${coord(destination)}?overview=full&geometries=polyline`,
  );
  const route = data.routes?.[0];
  if (data.code !== "Ok" || !route) throw new HttpError(404, `No ${mode.toLowerCase()} route found between these places.`);
  return { durationSec: route.duration, distanceM: route.distance, polyline: route.geometry };
}

export async function osmMatrix(points: LatLng[], mode: RoutableMode): Promise<(number | null)[][]> {
  const data = await getJson<{ code: string; durations?: (number | null)[][] }>(
    `${osrmBase(mode)}/table/v1/driving/${points.map(coord).join(";")}?annotations=duration`,
  );
  if (data.code !== "Ok" || !data.durations) throw new HttpError(502, "Routing matrix unavailable.");
  return data.durations.map((row) => row.map((s) => (s == null ? null : s / 60)));
}

// ---------- Elevation (Open-Meteo) ----------

export async function osmElevation(point: LatLng): Promise<number> {
  const data = await getJson<{ elevation?: number[] }>(
    `https://api.open-meteo.com/v1/elevation?latitude=${point.lat}&longitude=${point.lng}`,
  );
  if (!data.elevation?.length) throw new HttpError(502, "Elevation unavailable.");
  return data.elevation[0];
}
