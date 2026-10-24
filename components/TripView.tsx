"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useConfig } from "@/lib/config";
import { computeClockNotes, mergeIssues } from "@/lib/clock";
import { computeDiveWarnings } from "@/lib/diveSafety";
import { entryState } from "@/lib/entry";
import { useElevations, useHydrated, useRouteLegs, useTimeZones, useTripBudget } from "@/lib/hooks";
import { formatMoney } from "@/lib/money";
import { useTrip } from "@/lib/store";
import { dayDate, formatDayLabel } from "@/lib/time";
import { computeTripTimeline } from "@/lib/timeline";
import { tripTodos } from "@/lib/todo";
import type { ContainerId, Item } from "@/lib/types";
import { Board } from "./Board";
import { ExportMenu } from "./ExportMenu";
import type { EditorTarget } from "./ItemEditor";
import { Splitter, useMapWidth } from "./Splitter";
import { SyncBadge } from "./SyncAgent";
import { TripMap } from "./TripMap";

// Dialogs are downloaded after the board, not with it.
const dialogs = {
  editor: () => import("./ItemEditor").then((m) => m.ItemEditor),
  suggest: () => import("./SuggestDialog").then((m) => m.SuggestDialog),
  optimize: () => import("./OptimizeDialog").then((m) => m.OptimizeDialog),
  import: () => import("./ImportDialog").then((m) => m.ImportDialog),
  settings: () => import("./TripSettings").then((m) => m.TripSettings),
  todo: () => import("./TodoDialog").then((m) => m.TodoDialog),
  budget: () => import("./BudgetDialog").then((m) => m.BudgetDialog),
  entry: () => import("./EntryDialog").then((m) => m.EntryDialog),
};
const ItemEditor = dynamic(dialogs.editor, { ssr: false });
const SuggestDialog = dynamic(dialogs.suggest, { ssr: false });
const OptimizeDialog = dynamic(dialogs.optimize, { ssr: false });
const ImportDialog = dynamic(dialogs.import, { ssr: false });
const TripSettings = dynamic(dialogs.settings, { ssr: false });
const TodoDialog = dynamic(dialogs.todo, { ssr: false });
const BudgetDialog = dynamic(dialogs.budget, { ssr: false });
const EntryDialog = dynamic(dialogs.entry, { ssr: false });

/**
 * With the offline service worker running, fetch the dialogs once the board is idle: it keeps what
 * was fetched, so they open offline too, even if none was opened while online.
 */
function usePrefetchDialogs() {
  useEffect(() => {
    if (!navigator.serviceWorker?.controller) return;
    const load = () => Object.values(dialogs).forEach((fetchDialog) => fetchDialog().catch(() => undefined));
    if (!("requestIdleCallback" in window)) {
      const timer = setTimeout(load, 2000);
      return () => clearTimeout(timer);
    }
    const id = requestIdleCallback(load, { timeout: 5000 });
    return () => cancelIdleCallback(id);
  }, []);
}

type Dialog =
  | { kind: "editor"; target: EditorTarget }
  | { kind: "suggest"; container: ContainerId; anchorItemId?: string }
  | { kind: "optimize"; dayId: string }
  | { kind: "import" }
  | { kind: "settings" }
  | { kind: "todo" }
  | { kind: "budget" }
  | { kind: "entry" };

export function TripView({ tripId }: { tripId: string | null }) {
  const hydrated = useHydrated();
  const trip = useTrip(tripId);
  const [selectedDayId, setSelectedDayId] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string>();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [tab, setTab] = useState<"board" | "map">("board");
  const mapWidth = useMapWidth();
  const ai = useConfig()?.ai ?? false;

  const timelines = useMemo(() => (trip ? computeTripTimeline(trip) : []), [trip]);
  useRouteLegs(trip, timelines);
  usePrefetchDialogs();
  useElevations(trip);
  useTimeZones(trip);

  const warnings = useMemo(
    () => (trip ? mergeIssues(computeDiveWarnings(trip, timelines), computeClockNotes(trip, timelines)) : new Map()),
    [trip, timelines],
  );
  const todos = useMemo(() => (trip ? tripTodos(trip) : []), [trip]);
  const budget = useTripBudget(trip);
  const entry = useMemo(() => (trip ? entryState(trip) : undefined), [trip]);

  // Stable, so the board's cards (memoised) don't re-render because of new handlers.
  const onEdit = useCallback(
    (itemId: string, t?: "details" | "tips") => setDialog({ kind: "editor", target: { kind: "edit", itemId, tab: t } }),
    [],
  );
  const onAdd = useCallback(
    (container: ContainerId, type?: Item["type"]) => setDialog({ kind: "editor", target: { kind: "new", container, type } }),
    [],
  );
  const onSuggest = useCallback(
    (container: ContainerId, anchorItemId?: string) => setDialog({ kind: "suggest", container, anchorItemId }),
    [],
  );
  const onOptimize = useCallback((dayId: string) => setDialog({ kind: "optimize", dayId }), []);

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
            {warningCount > 0 && <span style={{ color: "var(--warn)" }}> · ⚠️ {warningCount} warning(s)</span>}
            {todos.length > 0 && (
              <>
                {" · "}
                <button className="linklike todo-link" onClick={() => setDialog({ kind: "todo" })}>
                  📝 {todos.length} to sort out
                </button>
              </>
            )}
            {" · "}
            <button
              className="linklike"
              style={entry?.kind === "stale" ? { color: "var(--warn)" } : undefined}
              title={entry?.kind === "stale" ? "The plan changed since the entry rules were checked" : undefined}
              onClick={() => setDialog({ kind: "entry" })}
            >
              🛂 {entry?.kind === "none" ? "Entry rules" : entry?.kind === "stale" ? "Entry rules ⚠️" : "Entry"}
            </button>
            {budget && (
              <>
                {" · "}
                <button
                  className="linklike"
                  style={budget.limit && budget.total > budget.limit ? { color: "var(--warn)" } : undefined}
                  onClick={() => setDialog({ kind: "budget" })}
                >
                  💰{" "}
                  {budget.lines.length || budget.limit
                    ? formatMoney(budget.total, budget.currency) +
                      (budget.limit ? ` of ${formatMoney(budget.limit, budget.currency)}` : "")
                    : "Budget"}
                </button>
              </>
            )}
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
          <Link className="btn" href="/settings" title="App settings: storage, maps, Claude">
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
          onEdit={onEdit}
          onAdd={onAdd}
          onSuggest={onSuggest}
          onOptimize={onOptimize}
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
      {dialog?.kind === "budget" && budget && (
        <BudgetDialog
          trip={trip}
          budget={budget}
          onEdit={(itemId) => setDialog({ kind: "editor", target: { kind: "edit", itemId } })}
          onClose={close}
        />
      )}
      {dialog?.kind === "entry" && <EntryDialog trip={trip} onClose={close} />}
      {dialog?.kind === "todo" && (
        <TodoDialog
          trip={trip}
          todos={todos}
          onEdit={(itemId) => setDialog({ kind: "editor", target: { kind: "edit", itemId } })}
          onAddStay={(dayId) => setDialog({ kind: "editor", target: { kind: "new", container: dayId, type: "stay" } })}
          onEntry={() => setDialog({ kind: "entry" })}
          onClose={close}
        />
      )}
    </div>
  );
}
