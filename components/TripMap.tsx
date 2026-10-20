"use client";

import { AdvancedMarker, APIProvider, Map, Polyline, useMap } from "@vis.gl/react-google-maps";
import { useEffect, useMemo } from "react";
import { useConfig } from "@/lib/config";
import { buildLayers, fitPoints, pinClass } from "@/lib/mapLayers";
import type { LatLng, Trip } from "@/lib/types";
import { useTheme } from "@/lib/useTheme";
import { OsmMap } from "./OsmMap";

export function TripMap({
  trip,
  selectedDayId,
  highlightId,
  onMarkerClick,
  onlyItemIds,
  staticView = false,
}: {
  trip: Trip;
  selectedDayId: string | null;
  highlightId?: string;
  onMarkerClick?: (itemId: string) => void;
  /** Show (and frame) only these cards and the legs between them. */
  onlyItemIds?: Set<string>;
  /** A still picture for printing: no controls, no gestures, no animation. */
  staticView?: boolean;
}) {
  const config = useConfig();
  const theme = useTheme();
  const layers = useMemo(() => buildLayers(trip, selectedDayId, onlyItemIds), [trip, selectedDayId, onlyItemIds]);
  const { markers, lines } = layers;
  const fitKey = `${selectedDayId}|${markers.length}`;
  const highlight = highlightId ? trip.items[highlightId]?.location : undefined;

  if (!config) return <div className="map-placeholder">Loading map…</div>;

  // Without a Google browser key, an OpenStreetMap-based map needs no setup at all.
  if (!config.googleMapsBrowserKey) {
    return (
      <OsmMap
        layers={layers}
        fitKey={fitKey}
        staticView={staticView}
        highlight={highlight}
        highlightId={highlightId}
        onMarkerClick={onMarkerClick ?? (() => {})}
      />
    );
  }

  return (
    <APIProvider apiKey={config.googleMapsBrowserKey}>
      <Map
        // Google applies the colour scheme only when the map is created.
        key={staticView ? "static" : theme}
        mapId={config.googleMapId || "DEMO_MAP_ID"}
        defaultCenter={markers[0]?.position ?? { lat: 20, lng: 0 }}
        defaultZoom={markers.length ? 10 : 2}
        gestureHandling={staticView ? "none" : "greedy"}
        keyboardShortcuts={!staticView}
        colorScheme={staticView || theme === "light" ? "LIGHT" : "DARK"}
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
