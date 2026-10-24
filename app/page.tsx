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
import { MODE_LABEL, ROUTABLE_MODES, type TravelMode } from "@/lib/types";

/** The longest trip the New trip form makes. */
const MAX_DAYS = 60;

export default function Home() {
  const hydrated = useHydrated();
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
    const trip = createTrip({ ...form, name: form.name || form.destination || "New trip" });
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
          <div className="muted">Plan trips day by day – routes, dives, bookings and AI suggestions.</div>
        </div>
        <SyncBadge />
        <Link href="/settings" className="btn" title="Storage and sync, maps, Claude">
          ⚙ Settings
        </Link>
      </header>

      <section>
        <div className="row">
          <h2 className="grow">Your trips</h2>
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
          <p className="muted">Loading…</p>
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
                <strong>Your first trip goes here</strong>
                <span className="muted small">Start it in New trip below, or import a trip file</span>
              </span>
            </button>
            <div className="trip-deck">
              <button className="card trip-tile" onClick={loadDemo}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/trip-thumb.svg" alt="" className="trip-thumb" />
                <span className="trip-text">
                  <strong>{demo.name}</strong>
                  <span className="muted small">Demo · {demo.days.length} days · dives, ferries, a rental car</span>
                </span>
                <span className="try">Try ›</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="trip-list">
            {list.map((t) => {
              const countdown = tripCountdown(t, now);
              const tone = countdown.phase === "ended" ? " ended" : t.id === next ? " next" : "";
              return (
                <div key={t.id} className="trip-deck">
                  <Link href={`/trip?id=${t.id}`} className="card trip-tile">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/trip-thumb.svg" alt="" className="trip-thumb" />
                    <span className="trip-text">
                      <strong>{t.name}</strong>
                      <span className="muted small">
                        {t.destination} · {formatDayLabel(dayDate(t.startDate, 0))} – {formatDayLabel(dayDate(t.startDate, t.days.length - 1))}
                      </span>
                      <span className="small">
                        {t.days.length} days · {Object.keys(t.items).length} places
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
              📥 Import trip file
            </button>
            {list.length > 0 && (
              <button className="btn big" onClick={loadDemo}>
                🏝️ Load demo trip
              </button>
            )}
          </div>
        )}
        {list.length > 0 && <p className="muted small home-note">Importing a newer export of the same trip replaces it.</p>}
      </section>

      <section className="card">
        <h2 style={{ marginBottom: 12 }}>New trip</h2>
        <form className="stack" onSubmit={create}>
          <div className="grid2">
            <label>
              Destination
              <input
                ref={destinationRef}
                required
                placeholder="e.g. Malta, Red Sea, Lofoten"
                value={form.destination}
                onChange={(e) => setForm({ ...form, destination: e.target.value })}
              />
            </label>
            <label>
              Trip name
              <input
                placeholder="Optional"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
          </div>
          <div className="grid3">
            <label>
              First day
              <input
                type="date"
                required
                value={form.startDate}
                onChange={(e) => setForm({ ...form, startDate: e.target.value })}
              />
            </label>
            <label>
              Last day
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
              Number of days
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
              Interests (used by AI suggestions)
              <input
                placeholder="diving, viewpoints, local food, museums…"
                value={form.interests}
                onChange={(e) => setForm({ ...form, interests: e.target.value })}
              />
            </label>
            <label>
              Usual way of getting around
              <select
                value={form.defaultMode}
                onChange={(e) => setForm({ ...form, defaultMode: e.target.value as TravelMode })}
              >
                {ROUTABLE_MODES.map((m) => (
                  <option key={m} value={m}>
                    {MODE_LABEL[m]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="row">
            <span className="muted small grow">Trips sync to this PC, Google Drive or OneDrive (see Settings), so Claude can work on them too.</span>
            <button className="btn primary" type="submit">
              Create trip
            </button>
          </div>
        </form>
      </section>

      <footer className="small muted" style={{ marginTop: 24, textAlign: "center" }}>
        TripDeck is free software (AGPL-3.0) ·{" "}
        <a href={SOURCE_URL} target="_blank" rel="noreferrer">
          Source code
        </a>
      </footer>
    </main>
  );
}
