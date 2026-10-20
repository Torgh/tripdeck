import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { useEffect, useRef, useState } from "react";
import { fitPoints, pinClass, type MapLayers, type Marker } from "@/lib/mapLayers";
import type { LatLng } from "@/lib/types";
import { chooseBasemap, offlineStyle, type Basemap } from "./basemap";

// MapLibre can't find its worker from inside a bundle; ship it as an asset of the app.
maplibregl.setWorkerUrl(workerUrl);

const toLngLat = (p: LatLng): [number, number] => [p.lng, p.lat];

interface Props {
  layers: MapLayers;
  /** Changes when the map should frame its stops again (another day, or the pane was resized). */
  fitKey: string;
  highlightId?: string;
  onPinTap: (marker: Marker) => void;
}

export function MapView({ layers, fitKey, highlightId, onPinTap }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const layersRef = useRef(layers);
  const tapRef = useRef(onPinTap);
  /** The card whose pin was just tapped: the map is already looking at it. */
  const tappedRef = useRef<string>(undefined);
  useEffect(() => {
    layersRef.current = layers;
    tapRef.current = onPinTap;
  });

  /** Set while Google's tiles are showing: their copyright for the area in view. */
  const [googleCopyright, setGoogleCopyright] = useState<string>();

  useEffect(() => {
    // Start on the plain background so pins show at once; the real map replaces it when it's ready.
    const map = new maplibregl.Map({
      container: container.current!,
      style: offlineStyle(),
      bounds: boundsOf(layersRef.current),
      fitBoundsOptions: { padding: 40, maxZoom: 14 },
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
    });
    map.touchZoomRotate.disableRotation();
    // The route lines live in the style, so add them again whenever a style (re)loads.
    let waiting = false;
    map.on("style.load", () => {
      waiting = false;
      addLegLayers(map);
      setLegs(map, layersRef.current);
    });
    // A tile server that can't be reached, or never answers: keep the plain background.
    const giveUp = () => {
      if (!waiting) return;
      waiting = false;
      map.setStyle(offlineStyle(), { diff: false });
    };
    map.on("error", giveUp);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    let basemap: Basemap | undefined;

    const updateCopyright = () => {
      if (!basemap?.google) return;
      const b = map.getBounds();
      basemap.google
        .copyright({ north: b.getNorth(), south: b.getSouth(), east: b.getEast(), west: b.getWest() }, map.getZoom())
        .then((c) => !cancelled && setGoogleCopyright(c || "Google"))
        .catch(() => undefined);
    };
    map.on("moveend", updateCopyright);

    void chooseBasemap().then((chosen) => {
      if (cancelled || typeof chosen.style !== "string" && !chosen.google) return; // offline: stay as is
      basemap = chosen;
      waiting = true;
      map.setStyle(chosen.style, { diff: false });
      timer = setTimeout(giveUp, 8000);
      if (chosen.google) {
        setGoogleCopyright("Google");
        updateCopyright();
      }
    });

    mapRef.current = map;
    return () => {
      cancelled = true;
      clearTimeout(timer);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (map?.isStyleLoaded()) setLegs(map, layers);
  }, [layers]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = layers.markers.map((m) => {
      // MapLibre positions the outer element with a transform, so the rotated pin goes inside it.
      const el = document.createElement("button");
      el.className = "pin-hit";
      el.setAttribute("aria-label", m.title);
      const pin = el.appendChild(document.createElement("div"));
      pin.className = pinClass(m, highlightId);
      pin.style.background = m.color;
      pin.appendChild(document.createElement("span")).textContent = m.label;
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        tappedRef.current = m.item.id;
        map.easeTo({ center: toLngLat(m.position), duration: 400 });
        tapRef.current(m);
      });
      return new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat(toLngLat(m.position)).addTo(map);
    });
  }, [layers, highlightId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.resize();
    const bounds = boundsOf(layersRef.current);
    if (bounds) map.fitBounds(bounds, { padding: 40, maxZoom: 14, duration: 0 });
  }, [fitKey]);

  // A card tapped in the list: bring its pin into view.
  useEffect(() => {
    if (highlightId && highlightId === tappedRef.current) return;
    tappedRef.current = undefined;
    const target = layersRef.current.markers.find((m) => m.item.id === highlightId && !m.stop);
    if (target) mapRef.current?.easeTo({ center: toLngLat(target.position), duration: 400 });
  }, [highlightId]);

  return (
    <div className="map-wrap">
      <div ref={container} className="map" />
      {googleCopyright && (
        <div className="google-attribution">
          <img src="https://maps.gstatic.com/mapfiles/api-3/images/google_white5.png" alt="Google" height={14} />
          <span>{googleCopyright}</span>
        </div>
      )}
    </div>
  );
}

function boundsOf(layers: MapLayers): maplibregl.LngLatBounds | undefined {
  const [first, ...rest] = fitPoints(layers.markers).map(toLngLat);
  if (!first) return undefined;
  const bounds = new maplibregl.LngLatBounds(first, first);
  rest.forEach((p) => bounds.extend(p));
  // A single stop would zoom in to street level; give it some surroundings.
  if (!rest.length) return bounds.extend([first[0] - 0.01, first[1] - 0.01]).extend([first[0] + 0.01, first[1] + 0.01]);
  return bounds;
}

function addLegLayers(map: maplibregl.Map) {
  if (map.getSource("legs")) return;
  map.addSource("legs", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  const paint: maplibregl.LineLayerSpecification["paint"] = {
    "line-color": ["get", "color"],
    "line-width": 4,
    "line-opacity": 0.85,
  };
  map.addLayer({ id: "legs-solid", type: "line", source: "legs", filter: ["!", ["get", "dashed"]], paint });
  map.addLayer({
    id: "legs-dashed",
    type: "line",
    source: "legs",
    filter: ["get", "dashed"],
    paint: { ...paint, "line-dasharray": [1.5, 1.5] },
  });
}

function setLegs(map: maplibregl.Map, layers: MapLayers) {
  (map.getSource("legs") as maplibregl.GeoJSONSource | undefined)?.setData({
    type: "FeatureCollection",
    features: layers.lines.map((l) => ({
      type: "Feature",
      properties: { color: l.color, dashed: l.dashed },
      geometry: { type: "LineString", coordinates: l.path.map(toLngLat) },
    })),
  });
}
