"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { SyncBadge } from "@/components/SyncAgent";
import { SOURCE_URL } from "@/lib/about";
import { demoTrip } from "@/lib/demo";
import { useHydrated } from "@/lib/hooks";
import { nextTripId, sortTrips, tripCountdown } from "@/lib/itinerary";
import { createTrip, parseTripFile, useStore } from "@/lib/store";
import { dayDate, daysBetween, formatDayLabel, isoDate } from "@/lib/time";
import { ROUTABLE_MODES, type TravelMode } from "@/lib/types";
import { useLang, useT } from "@/lib/useLang";

/** The longest trip the New trip form makes. */
const MAX_DAYS = 60;

export default function Home() {
  const hydrated = useHydrated();
  const lang = useLang();
  const t = useT();
  const trips = useStore((s) => s.trips);
  const saveTrip = useStore((s) => s.saveTrip);
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const destinationRef = useRef<HTMLInputElement>(null);
  const demo = useMemo(() => demoTrip(), []);
  const [error, setError] = useState<string>();
  const [form, setForm] = useState({
    name: "",
    destination: "",
    startDate: isoDate(new Date()),
    days: 5,
    interests: "",
    defaultMode: "DRIVE" as TravelMode,
  });

  const open = (id: string) => router.push(`/trip?id=${id}`);
  const loadDemo = () => {
    const t = demoTrip();
    saveTrip(t);
    open(t.id);
  };

  // The last day and the number of days fill each other in.
  const lastDay = form.startDate && form.days >= 1 ? isoDate(dayDate(form.startDate, form.days - 1)) : "";
  const setLastDay = (date: string) => {
    if (!date || !form.startDate) return;
    const days = daysBetween(form.startDate, date) + 1;
    setForm({ ...form, days: Math.min(MAX_DAYS, Math.max(1, days)) });
  };

  const create = (e: React.FormEvent) => {
    e.preventDefault();
    const trip = createTrip({ ...form, name: form.name || form.destination || t("home.newTripName") });
    saveTrip(trip);
    open(trip.id);
  };

  const importFile = async (file: File) => {
    try {
      const trip = parseTripFile(JSON.parse(await file.text()));
      saveTrip(trip);
      open(trip.id);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  // Trips only show once hydrated, so "now" is the browser's, never the server's.
  const now = new Date();
  const list = sortTrips(Object.values(trips), now);
  const next = nextTripId(list, now);

  return (
    <main className="home">
      <header>
        {/* A small static SVG: next/image would not optimise it. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon.svg" alt="" />
        <div className="grow">
          <h1>TripDeck</h1>
          <div className="muted">{t("home.tagline")}</div>
        </div>
        <SyncBadge />
        <Link href="/settings" className="btn" title={t("home.settingsTitle")}>
          {t("home.settings")}
        </Link>
      </header>

      <section>
        <div className="row">
          <h2 className="grow">{t("home.yourTrips")}</h2>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])}
          />
        </div>
        {error && <p className="error">{error}</p>}
        {!hydrated ? (
          <p className="muted">{t("common.loading")}</p>
        ) : list.length === 0 ? (
          // An empty deck: a slot for the first trip, and the demo as a real trip tile.
          <div className="trip-list">
            <button
              className="first-slot"
              onClick={() => {
                destinationRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
                destinationRef.current?.focus({ preventScroll: true });
              }}
            >
              <span className="first-plus" aria-hidden>
                +
              </span>
              <span className="trip-text">
                <strong>{t("home.firstSlot")}</strong>
                <span className="muted small">{t("home.firstSlotHint")}</span>
              </span>
            </button>
            <div className="trip-deck">
              <button className="card trip-tile" onClick={loadDemo}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/trip-thumb.svg" alt="" className="trip-thumb" />
                <span className="trip-text">
                  <strong>{demo.name}</strong>
                  <span className="muted small">{t("home.demoMeta", { days: t("home.days", { n: demo.days.length }) })}</span>
                </span>
                <span className="try">{t("home.try")}</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="trip-list">
            {list.map((trip) => {
              const countdown = tripCountdown(trip, now, lang);
              const tone = countdown.phase === "ended" ? " ended" : trip.id === next ? " next" : "";
              return (
                <div key={trip.id} className="trip-deck">
                  <Link href={`/trip?id=${trip.id}`} className="card trip-tile">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/trip-thumb.svg" alt="" className="trip-thumb" />
                    <span className="trip-text">
                      <strong>{trip.name}</strong>
                      <span className="muted small">
                        {trip.destination} · {formatDayLabel(dayDate(trip.startDate, 0), lang)} –{" "}
                        {formatDayLabel(dayDate(trip.startDate, trip.days.length - 1), lang)}
                      </span>
                      <span className="small">
                        {t("home.days", { n: trip.days.length })} · {t("home.places", { n: Object.keys(trip.items).length })}
                      </span>
                    </span>
                    <span className={`countdown${tone}`}>
                      <b>{countdown.value}</b>
                      <span>{countdown.label}</span>
                    </span>
                  </Link>
                </div>
              );
            })}
          </div>
        )}
        {/* Under the trips, as on the phone; an empty list has the demo as a tile already. */}
        {hydrated && (
          <div className="home-actions">
            <button className="btn primary big" onClick={() => fileRef.current?.click()}>
              {t("home.importFile")}
            </button>
            {list.length > 0 && (
              <button className="btn big" onClick={loadDemo}>
                {t("home.loadDemo")}
              </button>
            )}
          </div>
        )}
        {list.length > 0 && <p className="muted small home-note">{t("home.importNote")}</p>}
      </section>

      <section className="card">
        <h2 style={{ marginBottom: 12 }}>{t("home.newTrip")}</h2>
        <form className="stack" onSubmit={create}>
          <div className="grid2">
            <label>
              {t("home.destination")}
              <input
                ref={destinationRef}
                required
                placeholder={t("home.destinationPlaceholder")}
                value={form.destination}
                onChange={(e) => setForm({ ...form, destination: e.target.value })}
              />
            </label>
            <label>
              {t("home.tripName")}
              <input
                placeholder={t("home.optional")}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
          </div>
          <div className="grid3">
            <label>
              {t("home.firstDay")}
              <input
                type="date"
                required
                value={form.startDate}
                onChange={(e) => setForm({ ...form, startDate: e.target.value })}
              />
            </label>
            <label>
              {t("home.lastDay")}
              <input
                type="date"
                required
                min={form.startDate}
                max={form.startDate ? isoDate(dayDate(form.startDate, MAX_DAYS - 1)) : undefined}
                value={lastDay}
                onChange={(e) => setLastDay(e.target.value)}
              />
            </label>
            <label>
              {t("home.numberOfDays")}
              <input
                type="number"
                min={1}
                max={MAX_DAYS}
                value={form.days}
                onChange={(e) => setForm({ ...form, days: Number(e.target.value) })}
              />
            </label>
          </div>
          <div className="grid2">
            <label>
              {t("home.interests")}
              <input
                placeholder={t("home.interestsPlaceholder")}
                value={form.interests}
                onChange={(e) => setForm({ ...form, interests: e.target.value })}
              />
            </label>
            <label>
              {t("home.defaultMode")}
              <select
                value={form.defaultMode}
                onChange={(e) => setForm({ ...form, defaultMode: e.target.value as TravelMode })}
              >
                {ROUTABLE_MODES.map((m) => (
                  <option key={m} value={m}>
                    {t(`mode.${m}`)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="row">
            <span className="muted small grow">{t("home.syncNote")}</span>
            <button className="btn primary" type="submit">
              {t("home.create")}
            </button>
          </div>
        </form>
      </section>

      <footer className="small muted" style={{ marginTop: 24, textAlign: "center" }}>
        {t("home.footer")}{" "}
        <a href={SOURCE_URL} target="_blank" rel="noreferrer">
          {t("home.sourceCode")}
        </a>
      </footer>
    </main>
  );
}
