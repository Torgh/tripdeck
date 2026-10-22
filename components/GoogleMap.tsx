"use client";

import { AdvancedMarker, APIProvider, Map, Polyline, useMap } from "@vis.gl/react-google-maps";
import { useEffect } from "react";
import { fitPoints, pinClass, type MapLayers } from "@/lib/mapLayers";
import type { LatLng } from "@/lib/types";

/** The trip map on Google Maps (with a Google browser key); loaded only when it is used. */
export function GoogleMap({
  apiKey,
  mapId,
  dark,
  layers: { markers, lines },
  fitKey,
  staticView,
  highlight,
  highlightId,
  onMarkerClick,
}: {
  apiKey: string;
  mapId?: string;
  dark: boolean;
  layers: MapLayers;
  fitKey: string;
  staticView: boolean;
  highlight?: LatLng;
  highlightId?: string;
  onMarkerClick?: (itemId: string) => void;
}) {
  return (
    <APIProvider apiKey={apiKey}>
      <Map
        // Google applies the colour scheme only when the map is created.
        key={staticView ? "static" : dark ? "dark" : "light"}
        mapId={mapId || "DEMO_MAP_ID"}
        defaultCenter={markers[0]?.position ?? { lat: 20, lng: 0 }}
        defaultZoom={markers.length ? 10 : 2}
        gestureHandling={staticView ? "none" : "greedy"}
        keyboardShortcuts={!staticView}
        colorScheme={staticView || !dark ? "LIGHT" : "DARK"}
        disableDefaultUI={staticView}
        mapTypeControl={false}
        streetViewControl={false}
        style={{ width: "100%", height: "100%" }}
      >
        {lines.map((l) => (
          <Polyline
            key={l.key}
            path={l.path}
            strokeColor={l.color}
            strokeOpacity={l.dashed ? 0 : 0.85}
            strokeWeight={4}
            icons={
              l.dashed
                ? [
                    {
                      icon: { path: "M 0,-1 0,1", strokeOpacity: 0.9, strokeColor: l.color, scale: 3 },
                      offset: "0",
                      repeat: "14px",
                    },
                  ]
                : undefined
            }
          />
        ))}
        {markers.map((m) => (
          <AdvancedMarker
            key={m.key}
            position={m.position}
            title={m.title}
            zIndex={highlightId === m.item.id ? 1000 : undefined}
            onClick={() => onMarkerClick?.(m.item.id)}
          >
            <div className={pinClass(m, highlightId)} style={{ background: m.color }}>
              <span>{m.label}</span>
            </div>
          </AdvancedMarker>
        ))}
        <FitBounds points={fitPoints(markers)} fitKey={fitKey} />
        <PanTo point={highlight} />
      </Map>
    </APIProvider>
  );
}

function FitBounds({ points, fitKey }: { points: LatLng[]; fitKey: string }) {
  const map = useMap();
  useEffect(() => {
    if (!map || !points.length) return;
    if (points.length === 1) {
      map.setCenter(points[0]);
      map.setZoom(13);
      return;
    }
    const bounds = new google.maps.LatLngBounds();
    points.forEach((p) => bounds.extend(p));
    map.fitBounds(bounds, 48);
    // Refit only when the visible set changes, not on every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, fitKey]);
  return null;
}

function PanTo({ point }: { point?: LatLng }) {
  const map = useMap();
  useEffect(() => {
    if (map && point) map.panTo(point);
  }, [map, point]);
  return null;
}
