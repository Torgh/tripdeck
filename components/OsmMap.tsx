"use client";

import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import type { LatLng } from "@/lib/types";
import type { MapLayers } from "./TripMap";

/** Free vector tiles, no key needed. */
const STYLE = "https://tiles.openfreemap.org/styles/liberty";

const toLngLat = (p: LatLng): [number, number] => [p.lng, p.lat];

// MapLibre derives its worker URL from import.meta.url, which bundlers rewrite; serve it ourselves.
if (typeof window !== "undefined") maplibregl.setWorkerUrl("/vendor/maplibre-worker");

export function OsmMap({
  layers,
  fitKey,
  highlight,
  highlightId,
  onMarkerClick,
}: {
  layers: MapLayers;
  fitKey: string;
  highlight?: LatLng;
  highlightId?: string;
  onMarkerClick: (itemId: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const [loaded, setLoaded] = useState(false);
  const clickRef = useRef(onMarkerClick);
  clickRef.current = onMarkerClick;

  useEffect(() => {
    const first = layers.markers[0]?.item.location;
    const map = new maplibregl.Map({
      container: container.current!,
      style: STYLE,
      center: first ? toLngLat(first) : [10, 30],
      zoom: first ? 9 : 1.5,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.on("load", () => {
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
      setLoaded(true);
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // The map is created once; later prop changes update sources and markers below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Route lines
  useEffect(() => {
    const source = loaded ? (mapRef.current?.getSource("legs") as maplibregl.GeoJSONSource | undefined) : undefined;
    source?.setData({
      type: "FeatureCollection",
      features: layers.lines.map((l) => ({
        type: "Feature",
        properties: { color: l.color, dashed: l.dashed },
        geometry: { type: "LineString", coordinates: l.path.map(toLngLat) },
      })),
    });
  }, [layers, loaded]);

  // Markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = layers.markers.map((m) => {
      // MapLibre positions the outer element with a transform, so the rotated pin goes inside it.
      const el = document.createElement("div");
      el.title = `${m.label}. ${m.item.title}`;
      el.style.cursor = "pointer";
      const pin = el.appendChild(document.createElement("div"));
      pin.className = `pin${highlightId === m.item.id ? " active" : ""}`;
      pin.style.background = m.color;
      pin.appendChild(document.createElement("span")).textContent = m.label;
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        clickRef.current(m.item.id);
      });
      return new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat(toLngLat(m.item.location!)).addTo(map);
    });
  }, [layers, highlightId]);

  // Fit to the visible stops when the selection changes
  useEffect(() => {
    const map = mapRef.current;
    const pts = layers.markers.map((m) => m.item.location!);
    if (!map || !pts.length) return;
    if (pts.length === 1) {
      map.easeTo({ center: toLngLat(pts[0]), zoom: 13 });
      return;
    }
    const bounds = new maplibregl.LngLatBounds(toLngLat(pts[0]), toLngLat(pts[0]));
    pts.forEach((p) => bounds.extend(toLngLat(p)));
    map.fitBounds(bounds, { padding: 48, maxZoom: 14, duration: 500 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  useEffect(() => {
    if (highlight) mapRef.current?.easeTo({ center: toLngLat(highlight) });
  }, [highlight]);

  return <div ref={container} style={{ width: "100%", height: "100%" }} />;
}
