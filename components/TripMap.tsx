"use client";

import { AdvancedMarker, APIProvider, Map, Polyline, useMap } from "@vis.gl/react-google-maps";
import { useEffect, useMemo } from "react";
import { decodePolyline, routeKey } from "@/lib/geo";
import { findBase, getLeg } from "@/lib/timeline";
import { isRoutable, type Item, type LatLng, type Trip } from "@/lib/types";
import { useConfig } from "@/lib/config";
import { dayColor } from "./Board";
import { OsmMap } from "./OsmMap";

export interface Marker {
  item: Item;
  label: string;
  color: string;
}

export interface Line {
  key: string;
  path: LatLng[];
  color: string;
  dashed: boolean;
}

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
        mapId={config.googleMapId || "DEMO_MAP_ID"}
        defaultCenter={markers[0]?.item.location ?? { lat: 20, lng: 0 }}
        defaultZoom={markers.length ? 10 : 2}
        gestureHandling={staticView ? "none" : "greedy"}
        keyboardShortcuts={!staticView}
        colorScheme={staticView ? "LIGHT" : "FOLLOW_SYSTEM"}
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
            key={m.item.id}
            position={m.item.location!}
            title={`${m.label}. ${m.item.title}`}
            zIndex={highlightId === m.item.id ? 1000 : undefined}
            onClick={() => onMarkerClick?.(m.item.id)}
          >
            <div className={`pin${highlightId === m.item.id ? " active" : ""}`} style={{ background: m.color }}>
              <span>{m.label}</span>
            </div>
          </AdvancedMarker>
        ))}
        <FitBounds points={markers.map((m) => m.item.location!)} fitKey={fitKey} />
        <PanTo point={highlight} />
      </Map>
    </APIProvider>
  );
}

export type MapLayers = ReturnType<typeof buildLayers>;

function buildLayers(trip: Trip, selectedDayId: string | null, onlyItemIds?: Set<string>) {
  const visible = (id: string) => !onlyItemIds || onlyItemIds.has(id);
  const markers: Marker[] = [];
  const lines: Line[] = [];
  const shown = new Set<string>();

  trip.days.forEach((day, d) => {
    if (selectedDayId && selectedDayId !== day.id) return;
    const color = dayColor(d);
    let prev: Item | undefined = findBase(trip, d);
    let n = 0;
    for (const id of day.itemIds) {
      const item = trip.items[id];
      if (!item?.location) continue;
      n++;
      if (!visible(id)) {
        prev = item;
        continue;
      }
      if (!shown.has(id)) {
        markers.push({ item, label: item.type === "stay" ? "🏨" : String(n), color });
        shown.add(id);
      }
      if (prev?.location && prev.id !== item.id && visible(prev.id)) {
        const leg = getLeg(trip, prev.id, item.id);
        const fresh =
          isRoutable(leg.mode) && leg.result?.key === routeKey(leg.mode, prev.location, item.location) && leg.result.polyline;
        lines.push({
          key: `${d}-${prev.id}-${item.id}`,
          path: fresh ? decodePolyline(fresh) : [prev.location, item.location],
          color,
          dashed: !fresh,
        });
      }
      prev = item;
    }
  });

  if (!selectedDayId) {
    for (const id of trip.ideas) {
      const item = trip.items[id];
      if (item?.location && !shown.has(id)) {
        markers.push({ item, label: "💡", color: "#64748b" });
      }
    }
  } else {
    // Show the morning's stay as context for a single day.
    const index = trip.days.findIndex((d) => d.id === selectedDayId);
    const base = index >= 0 ? findBase(trip, index) : undefined;
    if (base?.location && !shown.has(base.id)) markers.push({ item: base, label: "🏨", color: dayColor(index) });
  }

  return { markers, lines };
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
