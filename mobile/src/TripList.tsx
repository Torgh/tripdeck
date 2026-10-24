import { nextTripId, tripCountdown } from "@/lib/itinerary";
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
  const sorted = [...trips].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const next = nextTripId(trips, now);

  return (
    <div className="screen">
      <header className="appbar">
        <img src="./icon.svg" alt="" className="logo" />
        <h1>TripDeck</h1>
      </header>

      <main className="content">
        {sorted.length === 0 && (
          <div className="empty">
            <img src="./empty-deck.svg" alt="" className="empty-art" />
            <p className="empty-title">Your deck is empty</p>
            <p className="muted">
              No trips on this device yet. On your PC choose <b>Export → JSON</b> in a trip, then open the{" "}
              <code>.tripdeck.json</code> file here – from OneDrive, Google Drive, Downloads or an email.
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

        <div className="actions">
          <button className="btn primary" onClick={onImport}>
            📥 Import trip file
          </button>
          <button className="btn" onClick={onDemo}>
            🏝️ Load demo trip
          </button>
        </div>
        {sorted.length > 0 && (
          <p className="muted small center">Importing a newer export of the same trip replaces it.</p>
        )}
      </main>
    </div>
  );
}
