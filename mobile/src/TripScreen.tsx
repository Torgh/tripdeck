import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { computeDiveWarnings } from "@/lib/diveSafety";
import { defaultDayIndex, todayIndex } from "@/lib/itinerary";
import { buildLayers, type Marker } from "@/lib/mapLayers";
import { rentalsOf } from "@/lib/rentals";
import { nightsOf } from "@/lib/stays";
import { dayDate, formatHm } from "@/lib/time";
import { computeTripTimeline } from "@/lib/timeline";
import { itemIcon, type Trip } from "@/lib/types";
import { DayView, IdeasView } from "./DayView";

// The map library is big; load it only once a trip is open so the trip list starts instantly.
const MapView = lazy(() => import("./MapView").then((m) => ({ default: m.MapView })));

const IDEAS_TAB = -1;

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

interface Props {
  trip: Trip;
  now: Date;
  onBack: () => void;
}

export function TripScreen({ trip, now, onBack }: Props) {
  const [picked, setSelected] = useState(() => defaultDayIndex(trip, now));
  // A re-imported trip can be shorter than the day that was open.
  const selected = picked === IDEAS_TAB ? IDEAS_TAB : Math.min(picked, trip.days.length - 1);
  const today = todayIndex(trip, now);

  const timelines = useMemo(() => computeTripTimeline(trip), [trip]);
  const warnings = useMemo(() => computeDiveWarnings(trip, timelines), [trip, timelines]);
  const nights = useMemo(() => nightsOf(trip), [trip]);
  const rentals = useMemo(() => rentalsOf(trip), [trip]);

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
  const dayId = selected === IDEAS_TAB ? null : trip.days[selected].id;
  const layers = useMemo(
    () => (dayId ? buildLayers(trip, dayId) : buildLayers(trip, null, new Set(trip.ideas))),
    [trip, dayId],
  );
  const hasMap = layers.markers.length > 0;

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
    pinned && selected !== IDEAS_TAB ? timelines[selected].entries.find((e) => e.itemId === pinned.id) : undefined;

  const touch = useRef<{ x: number; y: number } | null>(null);
  const last = trip.days.length - 1;
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touch.current;
    touch.current = null;
    if (!start || selected === IDEAS_TAB) return;
    const dx = e.changedTouches[0].clientX - start.x;
    const dy = e.changedTouches[0].clientY - start.y;
    if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx < 0 && selected < last) select(selected + 1);
    if (dx > 0 && selected > 0) select(selected - 1);
  };

  return (
    <div className="screen">
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
              <MapView layers={layers} fitKey={`${selected}|${mapMode}`} highlightId={highlightId} onPinTap={onPinTap} />
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
        {selected === IDEAS_TAB ? (
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
          />
        )}
      </main>
    </div>
  );
}
