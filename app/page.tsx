"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { SyncBadge } from "@/components/SyncAgent";
import { SOURCE_URL } from "@/lib/about";
import { demoTrip } from "@/lib/demo";
import { useHydrated } from "@/lib/hooks";
import { createTrip, parseTripFile, useStore } from "@/lib/store";
import { dayDate, formatDayLabel, isoDate } from "@/lib/time";
import { MODE_LABEL, ROUTABLE_MODES, type TravelMode } from "@/lib/types";

export default function Home() {
  const hydrated = useHydrated();
  const trips = useStore((s) => s.trips);
  const saveTrip = useStore((s) => s.saveTrip);
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
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

  const list = Object.values(trips).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return (
    <main className="home">
      <header>
        <img src="/icon.svg" alt="" />
        <div className="grow">
          <h1>TripDeck</h1>
          <div className="muted">Plan trips day by day – routes, dives, bookings and AI suggestions.</div>
        </div>
        <SyncBadge />
        <Link href="/settings" className="btn" title="Google sync, maps, Claude">
          ⚙ Settings
        </Link>
      </header>

      <section>
        <div className="row">
          <h2 className="grow">Your trips</h2>
          <button className="btn" onClick={() => fileRef.current?.click()}>
            ⬆ Import trip file
          </button>
          <button
            className="btn"
            onClick={() => {
              const t = demoTrip();
              saveTrip(t);
              open(t.id);
            }}
          >
            🤿 Load demo trip
          </button>
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
          <p className="muted">No trips yet. Create one below or load the demo.</p>
        ) : (
          <div className="trip-list">
            {list.map((t) => (
              <Link key={t.id} href={`/trip?id=${t.id}`} className="card trip-tile">
                <strong>{t.name}</strong>
                <span className="muted small">
                  {t.destination} · {formatDayLabel(dayDate(t.startDate, 0))} – {formatDayLabel(dayDate(t.startDate, t.days.length - 1))}
                </span>
                <span className="small">
                  {t.days.length} days · {Object.keys(t.items).length} places
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <h2 style={{ marginBottom: 12 }}>New trip</h2>
        <form className="stack" onSubmit={create}>
          <div className="grid2">
            <label>
              Destination
              <input
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
              Number of days
              <input
                type="number"
                min={1}
                max={60}
                value={form.days}
                onChange={(e) => setForm({ ...form, days: Number(e.target.value) })}
              />
            </label>
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
            <span className="muted small grow">Trips sync to this PC or your Google Drive (see Settings), so Claude can work on them too.</span>
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
