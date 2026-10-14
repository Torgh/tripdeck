"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useConfig } from "@/lib/config";
import { computeDiveWarnings } from "@/lib/diveSafety";
import { useElevations, useHydrated, useRouteLegs } from "@/lib/hooks";
import { useTrip } from "@/lib/store";
import { dayDate, formatDayLabel } from "@/lib/time";
import { computeTripTimeline } from "@/lib/timeline";
import type { ContainerId } from "@/lib/types";
import { Board } from "./Board";
import { ExportMenu } from "./ExportMenu";
import { ImportDialog } from "./ImportDialog";
import { ItemEditor, type EditorTarget } from "./ItemEditor";
import { OptimizeDialog } from "./OptimizeDialog";
import { Splitter, useMapWidth } from "./Splitter";
import { SuggestDialog } from "./SuggestDialog";
import { SyncBadge } from "./SyncAgent";
import { TripMap } from "./TripMap";
import { TripSettings } from "./TripSettings";

type Dialog =
  | { kind: "editor"; target: EditorTarget }
  | { kind: "suggest"; container: ContainerId; anchorItemId?: string }
  | { kind: "optimize"; dayId: string }
  | { kind: "import" }
  | { kind: "settings" };

export function TripView({ tripId }: { tripId: string | null }) {
  const hydrated = useHydrated();
  const trip = useTrip(tripId);
  const [selectedDayId, setSelectedDayId] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string>();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [tab, setTab] = useState<"board" | "map">("board");
  const mapWidth = useMapWidth();
  const ai = useConfig()?.ai ?? false;

  useRouteLegs(trip);
  useElevations(trip);

  const timelines = useMemo(() => (trip ? computeTripTimeline(trip) : []), [trip]);
  const warnings = useMemo(() => (trip ? computeDiveWarnings(trip, timelines) : new Map()), [trip, timelines]);

  if (!hydrated) return <main className="home muted">Loading…</main>;
  if (!trip) {
    return (
      <main className="home">
        <p>Trip not found in this browser.</p>
        <Link href="/">← All trips</Link>
      </main>
    );
  }

  const exportTrip = () => {
    const blob = new Blob([JSON.stringify(trip, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${trip.name.replace(/[^\w-]+/g, "-").toLowerCase() || "trip"}.tripdeck.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const warningCount = [...warnings.values()].flat().filter((i) => i.level === "warn").length;
  const close = () => setDialog(null);

  return (
    <div className="trip">
      <header className="topbar">
        <Link href="/" className="btn ghost" aria-label="All trips">
          ←
        </Link>
        <div>
          <h1>{trip.name}</h1>
          <div className="small muted">
            {trip.destination} · {formatDayLabel(dayDate(trip.startDate, 0))} –{" "}
            {formatDayLabel(dayDate(trip.startDate, trip.days.length - 1))}
            {warningCount > 0 && <span style={{ color: "var(--warn)" }}> · ⚠️ {warningCount} dive-safety warning(s)</span>}
          </div>
        </div>
        <div className="mobile-tabs">
          <button className={`btn small${tab === "board" ? " primary" : ""}`} onClick={() => setTab("board")}>
            Plan
          </button>
          <button className={`btn small${tab === "map" ? " primary" : ""}`} onClick={() => setTab("map")}>
            Map
          </button>
        </div>
        <div className="actions">
          <SyncBadge />
          <button className="btn" onClick={() => setDialog({ kind: "import" })}>
            📥 <span className="label">Import booking</span>
          </button>
          <ExportMenu tripId={trip.id} onJson={exportTrip} />
          <button className="btn" onClick={() => setDialog({ kind: "settings" })}>
            ✏️ <span className="label">Trip</span>
          </button>
          <Link className="btn" href="/settings" title="App settings: Google, maps, Claude">
            ⚙
          </Link>
        </div>
      </header>

      <div className="workspace" data-tab={tab} style={mapWidth.style}>
        <Board
          trip={trip}
          timelines={timelines}
          warnings={warnings}
          ai={ai}
          highlightId={highlightId}
          selectedDayId={selectedDayId}
          onSelectDay={setSelectedDayId}
          onHighlight={setHighlightId}
          onEdit={(itemId, t) => setDialog({ kind: "editor", target: { kind: "edit", itemId, tab: t } })}
          onAdd={(container, type) => setDialog({ kind: "editor", target: { kind: "new", container, type } })}
          onSuggest={(container, anchorItemId) => setDialog({ kind: "suggest", container, anchorItemId })}
          onOptimize={(dayId) => setDialog({ kind: "optimize", dayId })}
        />
        <Splitter pct={mapWidth.pct} setPct={mapWidth.setPct} save={mapWidth.save} />
        <div className="map-pane">
          <div className="map-filter">
            <select
              value={selectedDayId ?? ""}
              onChange={(e) => setSelectedDayId(e.target.value || null)}
              aria-label="Days shown on the map"
            >
              <option value="">All days</option>
              {trip.days.map((d, i) => (
                <option key={d.id} value={d.id}>
                  Day {i + 1}
                </option>
              ))}
            </select>
          </div>
          <TripMap
            trip={trip}
            selectedDayId={selectedDayId}
            highlightId={highlightId}
            onMarkerClick={(id) => {
              setHighlightId(id);
              setTab("board");
              document.getElementById(`item-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
            }}
          />
        </div>
      </div>

      {dialog?.kind === "editor" && <ItemEditor trip={trip} target={dialog.target} ai={ai} onClose={close} />}
      {dialog?.kind === "suggest" && (
        <SuggestDialog trip={trip} container={dialog.container} anchorItemId={dialog.anchorItemId} ai={ai} onClose={close} />
      )}
      {dialog?.kind === "optimize" && <OptimizeDialog trip={trip} dayId={dialog.dayId} ai={ai} onClose={close} />}
      {dialog?.kind === "import" && <ImportDialog trip={trip} ai={ai} onClose={close} />}
      {dialog?.kind === "settings" && <TripSettings trip={trip} onClose={close} />}
    </div>
  );
}
