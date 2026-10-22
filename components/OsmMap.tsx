"use client";

import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import type { LatLng } from "@/lib/types";
import { fitPoints, pinClass, syncPins, type MapLayers, type Marker } from "@/lib/mapLayers";

/** Free vector tiles, no key needed. */
const STYLE = "https://tiles.openfreemap.org/styles/liberty";

const toLngLat = (p: LatLng): [number, number] => [p.lng, p.lat];

/** A pin on the map and the marker it shows now (read when it is clicked). */
interface Pin {
  marker: maplibregl.Marker;
  data: Marker;
}

// MapLibre derives its worker URL from import.meta.url, which bundlers rewrite; serve it ourselves.
if (typeof window !== "undefined") maplibregl.setWorkerUrl("/vendor/maplibre-worker");

export function OsmMap({
  layers,
  fitKey,
  staticView = false,
  highlight,
  highlightId,
  onMarkerClick,
}: {
  layers: MapLayers;
  fitKey: string;
  /** A still picture for printing: no controls, no gestures, no animation. */
  staticView?: boolean;
  highlight?: LatLng;
  highlightId?: string;
  onMarkerClick: (itemId: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const pinsRef = useRef(new Map<string, Pin>());
  const [loaded, setLoaded] = useState(false);
  const clickRef = useRef(onMarkerClick);
  useEffect(() => {
    clickRef.current = onMarkerClick;
  }, [onMarkerClick]);

  useEffect(() => {
    const first = layers.markers[0]?.position;
    const map = new maplibregl.Map({
      container: container.current!,
      style: STYLE,
      center: first ? toLngLat(first) : [10, 30],
      zoom: first ? 9 : 1.5,
      attributionControl: { compact: !staticView },
      interactive: !staticView,
      // Without it the WebGL canvas comes out blank when printed.
      canvasContextAttributes: { preserveDrawingBuffer: staticView },
    });
    if (!staticView) map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
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
    const pins = pinsRef.current;
    return () => {
      map.remove();
      mapRef.current = null;
      pins.clear();
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
    const draw = ({ marker, data: m }: Pin) => {
      const el = marker.getElement();
      el.title = m.title;
      const pin = el.firstElementChild as HTMLElement;
      pin.className = pinClass(m, highlightId);
      pin.style.background = m.color;
      pin.firstElementChild!.textContent = m.label;
      marker.setLngLat(toLngLat(m.position));
    };
    syncPins(pinsRef.current, layers.markers, {
      create: (m) => {
        // MapLibre positions the outer element with a transform, so the rotated pin goes inside it.
        const el = document.createElement("div");
        el.style.cursor = "pointer";
        el.appendChild(document.createElement("div")).appendChild(document.createElement("span"));
        const pin: Pin = { marker: new maplibregl.Marker({ element: el, anchor: "bottom" }), data: m };
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          clickRef.current(pin.data.item.id);
        });
        draw(pin);
        pin.marker.addTo(map);
        return pin;
      },
      update: (pin, m) => {
        pin.data = m;
        draw(pin);
      },
      remove: (pin) => pin.marker.remove(),
    });
  }, [layers, highlightId]);

  // Fit to the visible stops when the selection changes
  useEffect(() => {
    const map = mapRef.current;
    const pts = fitPoints(layers.markers);
    if (!map || !pts.length) return;
    if (pts.length === 1) {
      map.easeTo({ center: toLngLat(pts[0]), zoom: 13, duration: staticView ? 0 : undefined });
      return;
    }
    const bounds = new maplibregl.LngLatBounds(toLngLat(pts[0]), toLngLat(pts[0]));
    pts.forEach((p) => bounds.extend(toLngLat(p)));
    map.fitBounds(bounds, { padding: 48, maxZoom: 14, duration: staticView ? 0 : 500 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  useEffect(() => {
    if (highlight) mapRef.current?.easeTo({ center: toLngLat(highlight) });
  }, [highlight]);

  return <div ref={container} style={{ width: "100%", height: "100%" }} />;
}
