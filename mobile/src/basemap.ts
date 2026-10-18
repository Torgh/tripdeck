import type { StyleSpecification } from "maplibre-gl";

/**
 * Which map is drawn under the pins: Google's tiles when the build has a Google Maps key (the
 * desktop app's browser key, with Map Tiles API enabled), otherwise OpenFreeMap, and a plain
 * background when neither can be reached – pins and routes come from the trip file either way.
 */

export const GOOGLE_KEY = import.meta.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() || undefined;

const TILES = "https://tile.googleapis.com";
const SESSION_KEY = "tripdeck.googleTiles";

export const isDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;

/** Free vector tiles, no key needed – the same maps as the desktop app without a Google key. */
export const openFreeMapStyle = () => `https://tiles.openfreemap.org/styles/${isDark() ? "dark" : "liberty"}`;

export const offlineStyle = (): StyleSpecification => ({
  version: 8,
  sources: {},
  layers: [{ id: "background", type: "background", paint: { "background-color": isDark() ? "#0b1220" : "#e8eef3" } }],
});

/** Google's own dark look for the tiles, close to the desktop map in dark mode. */
const DARK_STYLES = [
  { stylers: [{ saturation: -40 }] },
  { elementType: "geometry", stylers: [{ color: "#1f2937" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#cbd5e1" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#111827" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#374151" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#4b5563" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0b1220" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#14532d" }] },
];

interface Session {
  session: string;
  /** Unix seconds. */
  expiry: string;
  dark: boolean;
}

/** A Map Tiles API session lasts about two weeks; reuse it instead of opening one per map. */
async function googleSession(key: string): Promise<string> {
  const dark = isDark();
  try {
    const saved = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null") as Session | null;
    if (saved && saved.dark === dark && Number(saved.expiry) * 1000 > Date.now() + 3_600_000) return saved.session;
  } catch {
    // no saved session
  }
  const [language, region = "US"] = navigator.language.split("-");
  const res = await fetch(`${TILES}/v1/createSession?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mapType: "roadmap", language, region, ...(dark ? { styles: DARK_STYLES } : {}) }),
  });
  if (!res.ok) throw new Error(`Google Map Tiles: ${res.status}`);
  const { session, expiry } = (await res.json()) as Session;
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ session, expiry, dark }));
  } catch {
    // opens a new session next time
  }
  return session;
}

export interface Basemap {
  style: StyleSpecification | string;
  /** Google's tiles must show Google's logo and the copyright for the area in view. */
  google?: { copyright: (bounds: { north: number; south: number; east: number; west: number }, zoom: number) => Promise<string> };
}

export async function chooseBasemap(): Promise<Basemap> {
  if (!navigator.onLine) return { style: offlineStyle() };
  if (GOOGLE_KEY) {
    try {
      const key = encodeURIComponent(GOOGLE_KEY);
      const session = await googleSession(GOOGLE_KEY);
      const base = offlineStyle();
      return {
        style: {
          ...base,
          sources: {
            google: {
              type: "raster",
              tiles: [`${TILES}/v1/2dtiles/{z}/{x}/{y}?session=${session}&key=${key}`],
              tileSize: 256,
              maxzoom: 22,
            },
          },
          // The plain background stays underneath, so missing tiles (offline later) still show the plan.
          layers: [...base.layers, { id: "google", type: "raster", source: "google" }],
        },
        google: {
          copyright: async (b, zoom) => {
            const q = new URLSearchParams({ session, key: GOOGLE_KEY!, zoom: String(Math.round(zoom)) });
            for (const [k, v] of Object.entries(b)) q.set(k, v.toFixed(5));
            const res = await fetch(`${TILES}/tile/v1/viewport?${q}`);
            return res.ok ? ((await res.json()) as { copyright?: string }).copyright ?? "" : "";
          },
        },
      };
    } catch {
      // key without Map Tiles API, quota, network hiccup: fall back to the free map
    }
  }
  return { style: openFreeMapStyle() };
}
