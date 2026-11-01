import { useMemo } from "react";
import { demoTrip } from "@/lib/demo";
import { nextTripId, sortTrips, tripCountdown } from "@/lib/itinerary";
import { dayDate, formatDayLabel } from "@/lib/time";
import { rich } from "@/lib/i18n/rich";
import type { Trip } from "@/lib/types";
import { useLang, useT } from "@/lib/useLang";

interface Props {
  trips: Trip[];
  now: Date;
  onOpen: (id: string) => void;
  onImport: () => void;
  onDemo: () => void;
  onDelete: (id: string) => void;
}

const code = (s: string) => <code>{s}</code>;

export function TripList({ trips, now, onOpen, onImport, onDemo, onDelete }: Props) {
  const t = useT();
  const lang = useLang();
  const sorted = sortTrips(trips, now);
  const next = nextTripId(trips, now);
  const demo = useMemo(() => demoTrip(), []);
  // The demo as a trip tile, on an empty list and at the end of a full one.
  const demoTile = (
    <div className="trip-deck">
      <button className="trip-card" onClick={onDemo}>
        <img src="./trip-thumb.svg" alt="" className="trip-thumb" />
        <span className="trip-text">
          <span className="trip-name">{demo.name}</span>
          <span className="muted small">{t("home.demoMeta", { days: t("home.days", { n: demo.days.length }) })}</span>
        </span>
        <span className="try">{t("home.try")}</span>
      </button>
    </div>
  );

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
                <span className="trip-name">{t("home.firstSlot")}</span>
                <span className="muted small">{rich(t("phone.importFirst"), { code })}</span>
              </span>
            </button>
            <p className="muted small first-or">{t("phone.lookAround")}</p>
            {demoTile}
            <p className="first-how muted small">{rich(t("phone.howTo"), { b: (s) => <b>{s}</b> })}</p>
          </div>
        )}

        {sorted.map((trip) => {
          const days = trip.days.length;
          const countdown = tripCountdown(trip, now, lang);
          const tone = countdown.phase === "ended" ? " ended" : trip.id === next ? " next" : "";
          return (
            <div key={trip.id} className="trip-row">
              <div className="trip-deck">
                <button className="trip-card" onClick={() => onOpen(trip.id)}>
                  <img src="./trip-thumb.svg" alt="" className="trip-thumb" />
                  <span className="trip-text">
                    <span className="trip-name">{trip.name}</span>
                    <span className="muted small">
                      {trip.destination} · {formatDayLabel(dayDate(trip.startDate, 0), lang)} –{" "}
                      {formatDayLabel(dayDate(trip.startDate, days - 1), lang)} · {t("home.days", { n: days })}
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
                aria-label={t("phone.removeLabel", { name: trip.name })}
                onClick={() => {
                  if (confirm(t("phone.removeConfirm", { name: trip.name }))) {
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
                  <span className="trip-name">{t("phone.addTrip")}</span>
                  <span className="muted small">{rich(t("phone.importAnother"), { code })}</span>
                </span>
              </button>
            </div>
            <div className="trip-row next-slot-row">{demoTile}</div>
            <p className="muted small center">{t("home.importNote")}</p>
          </>
        )}
      </main>
    </div>
  );
}
