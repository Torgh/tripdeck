import { lazy, Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { computeClockNotes, mergeIssues } from "@/lib/clock";
import { computeDiveWarnings } from "@/lib/diveSafety";
import { entryActions } from "@/lib/entry";
import { defaultDayIndex, todayIndex } from "@/lib/itinerary";
import { buildLayers, type Marker } from "@/lib/mapLayers";
import { formatMoney, ratesUrl, toRates, type Rates } from "@/lib/money";
import { rentalsOf } from "@/lib/rentals";
import { nightsOf } from "@/lib/stays";
import { dayDate, formatHm } from "@/lib/time";
import { computeTripTimeline } from "@/lib/timeline";
import { itemIcon, type Trip } from "@/lib/types";
import { useTripBudgetFrom } from "@/lib/useRates";
import { BudgetView } from "./BudgetView";
import { EntryView } from "./EntryView";
import { DayView, IdeasView } from "./DayView";

// The map library is big; load it only once a trip is open so the trip list starts instantly.
const MapView = lazy(() => import("./MapView").then((m) => ({ default: m.MapView })));

const IDEAS_TAB = -1;
const BUDGET_TAB = -2;
const ENTRY_TAB = -3;

/** The phone has no TripDeck server: it asks frankfurter.dev directly. */
async function fetchRates(base: string): Promise<Rates> {
  const res = await fetch(ratesUrl(base));
  if (!res.ok) throw new Error(`Exchange rates are unavailable (${res.status}).`);
  return toRates((await res.json()) as Rates);
}

/** Open: a band above the plan. Collapsed: just its bar. Full: the whole screen. */
type MapMode = "open" | "collapsed" | "full";
const MAP_MODE_KEY = "tripdeck.mapMode";

function savedMapMode(): MapMode {
  try {
    return localStorage.getItem(MAP_MODE_KEY) === "collapsed" ? "collapsed" : "open";
  } catch {
    return "open";
  }
}
/** Horizontal swipe distance that flips to the next / previous day. */
const SWIPE_PX = 60;

/** Turning the device reshapes the map pane (sideways it moves beside the plan), so the map frames its stops again. */
const LANDSCAPE = "(orientation: landscape)";
function subscribeOrientation(onChange: () => void) {
  const query = matchMedia(LANDSCAPE);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
const isLandscape = () => matchMedia(LANDSCAPE).matches;

interface Props {
  trip: Trip;
  now: Date;
  onBack: () => void;
}

export function TripScreen({ trip, now, onBack }: Props) {
  const [picked, setSelected] = useState(() => defaultDayIndex(trip, now));
  // A re-imported trip can be shorter than the day that was open.
  const selected = picked < 0 ? picked : Math.min(picked, trip.days.length - 1);
  const today = todayIndex(trip, now);

  const timelines = useMemo(() => computeTripTimeline(trip), [trip]);
  const warnings = useMemo(
    () => mergeIssues(computeDiveWarnings(trip, timelines), computeClockNotes(trip, timelines)),
    [trip, timelines],
  );
  const nights = useMemo(() => nightsOf(trip), [trip]);
  const rentals = useMemo(() => rentalsOf(trip), [trip]);
  const budget = useTripBudgetFrom(trip, fetchRates);
  const hasBudget = !!budget && (budget.lines.length > 0 || !!budget.limit || budget.noCurrency.length > 0);

  // Keep the selected day's chip in view.
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    strip.current?.querySelector<HTMLElement>("[aria-current=true]")?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [selected]);

  const content = useRef<HTMLElement>(null);
  const [highlightId, setHighlightId] = useState<string>();
  const select = (i: number) => {
    setSelected(i);
    setHighlightId(undefined);
    content.current?.scrollTo({ top: 0 });
  };

  const landscape = useSyncExternalStore(subscribeOrientation, isLandscape);
  const [mapMode, setMapModeState] = useState<MapMode>(savedMapMode);
  const setMapMode = (mode: MapMode) => {
    setMapModeState(mode);
    // Full screen is a moment, not a preference.
    if (mode !== "full") {
      try {
        localStorage.setItem(MAP_MODE_KEY, mode);
      } catch {
        // private storage unavailable: the choice just isn't remembered
      }
    }
  };
  const dayId = selected < 0 ? null : trip.days[selected].id;
  const layers = useMemo(
    () => (dayId ? buildLayers(trip, dayId) : buildLayers(trip, null, new Set(trip.ideas))),
    [trip, dayId],
  );
  const hasMap = selected !== BUDGET_TAB && selected !== ENTRY_TAB && layers.markers.length > 0;
  const entryTodo = useMemo(() => entryActions(trip).length, [trip]);

  // Android back closes the full-screen map before leaving the trip (App listens for "app-back").
  useEffect(() => {
    if (mapMode !== "full") return;
    const onBack = (e: Event) => {
      e.preventDefault();
      setMapModeState("open");
    };
    window.addEventListener("app-back", onBack);
    return () => window.removeEventListener("app-back", onBack);
  }, [mapMode]);

  const showInPlan = (itemId: string) => {
    setHighlightId(itemId);
    document.getElementById(`card-${itemId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  /** The pin last tapped on the map; a tour stop names itself, not just its tour. */
  const [tapped, setTapped] = useState<Marker>();
  const onPinTap = (m: Marker) => {
    setTapped(m);
    if (mapMode === "full") setHighlightId(m.item.id);
    else showInPlan(m.item.id);
  };
  const pinned = highlightId ? trip.items[highlightId] : undefined;
  const pinnedStop = tapped?.item.id === highlightId ? tapped?.stopName : undefined;
  const pinnedEntry =
    pinned && selected >= 0 ? timelines[selected].entries.find((e) => e.itemId === pinned.id) : undefined;

  const touch = useRef<{ x: number; y: number } | null>(null);
  const last = trip.days.length - 1;
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touch.current;
    touch.current = null;
    if (!start || selected < 0) return;
    const dx = e.changedTouches[0].clientX - start.x;
    const dy = e.changedTouches[0].clientY - start.y;
    if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx < 0 && selected < last) select(selected + 1);
    if (dx > 0 && selected > 0) select(selected - 1);
  };

  return (
    // The map's state is on the screen: held sideways, an open map moves beside the plan (app.css).
    <div className={`screen${hasMap ? ` map-${mapMode}` : ""}`}>
      <header className="appbar">
        <button className="icon-btn" aria-label="All trips" onClick={onBack}>
          ←
        </button>
        <div className="appbar-title">
          <h1>{trip.name}</h1>
          <div className="muted small">{trip.destination}</div>
        </div>
        {today != null && selected !== today && (
          <button className="btn small" onClick={() => select(today)}>
            Today
          </button>
        )}
        {/* In the bar, not at the end of the day strip, so they show whichever day is open. */}
        {hasBudget && (
          <button
            className="appbar-tab"
            aria-label="Budget"
            aria-current={selected === BUDGET_TAB}
            onClick={() => select(BUDGET_TAB)}
          >
            💰
          </button>
        )}
        <button
          className="appbar-tab"
          aria-label={`Entry & paperwork${entryTodo ? `, ${entryTodo} to do` : ""}`}
          aria-current={selected === ENTRY_TAB}
          onClick={() => select(ENTRY_TAB)}
        >
          🛂
          {entryTodo > 0 && <span className="appbar-count">{entryTodo}</span>}
        </button>
      </header>

      <div className="day-strip" ref={strip} role="tablist">
        {trip.days.map((day, i) => {
          const date = dayDate(trip.startDate, i);
          return (
            <button
              key={day.id}
              role="tab"
              aria-current={i === selected}
              className={`day-chip${i === today ? " today" : ""}`}
              onClick={() => select(i)}
            >
              <span className="chip-weekday">
                {date.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" })}
              </span>
              <span className="chip-date">{date.getUTCDate()}</span>
            </button>
          );
        })}
        {trip.ideas.length > 0 && (
          <button
            role="tab"
            aria-current={selected === IDEAS_TAB}
            className="day-chip ideas"
            onClick={() => select(IDEAS_TAB)}
          >
            <span className="chip-weekday">Ideas</span>
            <span className="chip-date">{trip.ideas.length}</span>
          </button>
        )}
      </div>

      {hasMap && (
        <section className={`map-pane ${mapMode}`} aria-label="Map of the day">
          <div className="map-frame">
            <Suspense fallback={<div className="map" />}>
              <MapView layers={layers} fitKey={`${selected}|${mapMode}|${landscape}`} highlightId={highlightId} onPinTap={onPinTap} />
            </Suspense>
          </div>
          {mapMode === "full" && pinned && (
            <button
              className="map-pick"
              onClick={() => {
                setMapMode("open");
                // Let the list come back before scrolling to the card.
                requestAnimationFrame(() => showInPlan(pinned.id));
              }}
            >
              <span aria-hidden>{pinnedStop ? "🗺️" : itemIcon(pinned)}</span>
              <span className="map-pick-title">
                {pinnedStop ?? pinned.title}
                {pinnedStop && <span className="muted small">{pinned.title}</span>}
              </span>
              {pinnedEntry && <span className="muted small">{formatHm(pinnedEntry.start)}</span>}
              <span className="muted small">Show in plan ›</span>
            </button>
          )}
          <div className="map-bar">
            {mapMode !== "full" && (
              <button className="map-btn" onClick={() => setMapMode(mapMode === "collapsed" ? "open" : "collapsed")}>
                {mapMode === "collapsed" ? "🗺️ Show map ▾" : "▴ Hide map"}
              </button>
            )}
            <button className="map-btn" onClick={() => setMapMode(mapMode === "full" ? "open" : "full")}>
              {mapMode === "full" ? "✕ Close map" : "⛶ Full screen"}
            </button>
          </div>
        </section>
      )}

      <main
        className="content"
        ref={content}
        onTouchStart={(e) => (touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })}
        onTouchEnd={onTouchEnd}
      >
        {selected === ENTRY_TAB ? (
          <EntryView trip={trip} entry={trip.entry} />
        ) : selected === BUDGET_TAB && budget ? (
          <BudgetView trip={trip} budget={budget} onDay={select} />
        ) : selected === IDEAS_TAB ? (
          <IdeasView trip={trip} highlightId={highlightId} onSelect={setHighlightId} />
        ) : (
          <DayView
            key={selected}
            trip={trip}
            timeline={timelines[selected]}
            warnings={warnings}
            night={nights[selected]}
            rentals={rentals[selected]}
            isToday={selected === today}
            highlightId={highlightId}
            onSelect={setHighlightId}
            spent={budget?.byDay[selected] ? formatMoney(budget.byDay[selected], budget.currency) : undefined}
          />
        )}
      </main>
    </div>
  );
}
