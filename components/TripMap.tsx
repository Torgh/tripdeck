"use client";

import dynamic from "next/dynamic";
import { useMemo } from "react";
import { useConfig } from "@/lib/config";
import { buildLayers } from "@/lib/mapLayers";
import type { Trip } from "@/lib/types";
import { useTheme } from "@/lib/useTheme";

const loading = () => <div className="map-placeholder">Loading map…</div>;
// Each map library is large and only one is ever used, so it is downloaded when the map is shown.
const GoogleMap = dynamic(() => import("./GoogleMap").then((m) => m.GoogleMap), { ssr: false, loading });
const OsmMap = dynamic(() => import("./OsmMap").then((m) => m.OsmMap), { ssr: false, loading });

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
  const fitKey = `${selectedDayId}|${layers.markers.length}`;
  const highlight = highlightId ? trip.items[highlightId]?.location : undefined;

  if (!config) return loading();

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
    <GoogleMap
      apiKey={config.googleMapsBrowserKey}
      mapId={config.googleMapId}
      dark={theme === "dark"}
      layers={layers}
      fitKey={fitKey}
      staticView={staticView}
      highlight={highlight}
      highlightId={highlightId}
      onMarkerClick={onMarkerClick}
    />
  );
}
