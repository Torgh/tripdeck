import { useMemo } from "react";
import { demoTrip } from "@/lib/demo";
import { nextTripId, sortTrips, tripCountdown } from "@/lib/itinerary";
import { dayDate, formatDayLabel } from "@/lib/time";
import type { Trip } from "@/lib/types";

interface Props {
  trips: Trip[];
  now: Date;
  onOpen: (id: string) => void;
  onImport: () => void;
  onDemo: () => void;
  onDelete: (id: string) => void;
}

export function TripList({ trips, now, onOpen, onImport, onDemo, onDelete }: Props) {
  const sorted = sortTrips(trips, now);
  const next = nextTripId(trips, now);
  const demo = useMemo(() => demoTrip(), []);

  return (
    <div className="screen">
      <header className="appbar">
        <img src="./icon.svg" alt="" className="logo" />
        <h1>TripDeck</h1>
      </header>

      <main className="content">
        {sorted.length === 0 && (
          // An empty deck: a slot for the first trip, and the demo as a real trip tile.
          <div className="first-trip">
            <button className="first-slot" onClick={onImport}>
              <span className="first-plus" aria-hidden>
                +
              </span>
              <span className="trip-text">
                <span className="trip-name">Your first trip goes here</span>
                <span className="muted small">
                  Import the <code>.tripdeck.json</code> you exported on your PC
                </span>
              </span>
            </button>
            <p className="muted small first-or">Or look around first</p>
            <div className="trip-deck">
              <button className="trip-card" onClick={onDemo}>
                <img src="./trip-thumb.svg" alt="" className="trip-thumb" />
                <span className="trip-text">
                  <span className="trip-name">{demo.name}</span>
                  <span className="muted small">Demo · {demo.days.length} days · dives, ferries, a rental car</span>
                </span>
                <span className="try">Try ›</span>
              </button>
            </div>
            <p className="first-how muted small">
              <b>How to bring a trip:</b> on your PC choose Export → JSON in a trip, then save the file to OneDrive,
              Google Drive or Downloads, or email it to yourself.
            </p>
          </div>
        )}

        {sorted.map((trip) => {
          const days = trip.days.length;
          const countdown = tripCountdown(trip, now);
          const tone = countdown.phase === "ended" ? " ended" : trip.id === next ? " next" : "";
          return (
            <div key={trip.id} className="trip-row">
              <div className="trip-deck">
                <button className="trip-card" onClick={() => onOpen(trip.id)}>
                  <img src="./trip-thumb.svg" alt="" className="trip-thumb" />
                  <span className="trip-text">
                    <span className="trip-name">{trip.name}</span>
                    <span className="muted small">
                      {trip.destination} · {formatDayLabel(dayDate(trip.startDate, 0))} –{" "}
                      {formatDayLabel(dayDate(trip.startDate, days - 1))} · {days} {days === 1 ? "day" : "days"}
                    </span>
                  </span>
                  <span className={`countdown${tone}`}>
                    <b>{countdown.value}</b>
                    <span>{countdown.label}</span>
                  </span>
                </button>
              </div>
              <button
                className="icon-btn"
                aria-label={`Remove ${trip.name} from this phone`}
                onClick={() => {
                  if (confirm(`Remove “${trip.name}” from this phone? The trip on your PC is not affected.`)) {
                    onDelete(trip.id);
                  }
                }}
              >
                🗑
              </button>
            </div>
          );
        })}

        {sorted.length > 0 && (
          <>
            {/* The next trip's slot at the end of the deck, as on an empty list. */}
            <div className="trip-row">
              <button className="first-slot next-slot" onClick={onImport}>
                <span className="first-plus" aria-hidden>
                  +
                </span>
                <span className="trip-text">
                  <span className="trip-name">Add a trip</span>
                  <span className="muted small">
                    Import a <code>.tripdeck.json</code> you exported on your PC
                  </span>
                </span>
              </button>
            </div>
            <div className="actions">
              <button className="btn" onClick={onDemo}>
                🏝️ Load demo trip
              </button>
            </div>
            <p className="muted small center">Importing a newer export of the same trip replaces it.</p>
          </>
        )}
      </main>
    </div>
  );
}
