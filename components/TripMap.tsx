"use client";

import { AdvancedMarker, APIProvider, Map, Polyline, useMap } from "@vis.gl/react-google-maps";
import { useEffect, useMemo } from "react";
import { decodePolyline, routeKey } from "@/lib/geo";
import { findBase, getLeg } from "@/lib/timeline";
import { isRoutable, type Item, type LatLng, type Trip } from "@/lib/types";
import { useConfig } from "@/lib/config";
import { useTheme } from "@/lib/useTheme";
import { dayColor } from "./Board";
import { OsmMap, pinClass } from "./OsmMap";

export interface Marker {
  key: string;
  item: Item;
  position: LatLng;
  label: string;
  color: string;
  title: string;
  /** A place an organised tour visits, drawn smaller than the card's own pin. */
  stop?: boolean;
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
        <FitBounds points={markers.map((m) => m.position)} fitKey={fitKey} />
        <PanTo point={highlight} />
      </Map>
    </APIProvider>
  );
}

export type MapLayers = ReturnType<typeof buildLayers>;

function cardMarker(item: Item, position: LatLng, label: string, color: string): Marker {
  return { key: item.id, item, position, label, color, title: `${label}. ${item.title}` };
}

/** Small pins for the places an organised tour visits, and a dashed line from its pick-up point through them. */
function tourLayers(item: Item, pickUp: LatLng, label: string, color: string): { markers: Marker[]; lines: Line[] } {
  const stops = (item.tour?.stops ?? []).flatMap((s, k) => (s.location ? [{ ...s, k, location: s.location }] : []));
  if (!stops.length) return { markers: [], lines: [] };
  return {
    markers: stops.map((s) => ({
      key: `${item.id}#${s.k}`,
      item,
      position: s.location,
      label: `${label}.${s.k + 1}`,
      color,
      title: `${label}.${s.k + 1}. ${s.name} (${item.title})`,
      stop: true,
    })),
    lines: [{ key: `${item.id}-tour`, path: [pickUp, ...stops.map((s) => s.location)], color, dashed: true }],
  };
}

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
        const label = item.type === "stay" ? "🏨" : String(n);
        const tour = tourLayers(item, item.location, label, color);
        markers.push(cardMarker(item, item.location, label, color), ...tour.markers);
        lines.push(...tour.lines);
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
        markers.push(cardMarker(item, item.location, "💡", "#64748b"));
      }
    }
  } else {
    // Show the morning's stay as context for a single day.
    const index = trip.days.findIndex((d) => d.id === selectedDayId);
    const base = index >= 0 ? findBase(trip, index) : undefined;
    if (base?.location && !shown.has(base.id)) {
      markers.push(cardMarker(base, base.location, "🏨", dayColor(index)));
    }
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
