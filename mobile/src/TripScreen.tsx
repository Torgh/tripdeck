import { useEffect, useMemo, useRef, useState } from "react";
import { computeDiveWarnings } from "@/lib/diveSafety";
import { defaultDayIndex, todayIndex } from "@/lib/itinerary";
import { rentalsOf } from "@/lib/rentals";
import { nightsOf } from "@/lib/stays";
import { dayDate } from "@/lib/time";
import { computeTripTimeline } from "@/lib/timeline";
import type { Trip } from "@/lib/types";
import { DayView, IdeasView } from "./DayView";

const IDEAS_TAB = -1;
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
  const select = (i: number) => {
    setSelected(i);
    content.current?.scrollTo({ top: 0 });
  };

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

      <main
        className="content"
        ref={content}
        onTouchStart={(e) => (touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })}
        onTouchEnd={onTouchEnd}
      >
        {selected === IDEAS_TAB ? (
          <IdeasView trip={trip} />
        ) : (
          <DayView
            key={selected}
            trip={trip}
            timeline={timelines[selected]}
            warnings={warnings}
            night={nights[selected]}
            rentals={rentals[selected]}
            isToday={selected === today}
          />
        )}
      </main>
    </div>
  );
}
