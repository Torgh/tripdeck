"use client";

import { useEffect, useState } from "react";
import {
  COUNTRY_CODES,
  countryName,
  ENTRY_KIND_LABEL,
  entryState,
  flag,
  hostOf,
  setRequirementDone,
} from "@/lib/entry";
import { useStore } from "@/lib/store";
import { dayDate, formatDayLabel } from "@/lib/time";
import type { EntryLevel, Trip } from "@/lib/types";
import { Modal } from "./Modal";

const LEVEL_ICON: Record<EntryLevel, string> = { ok: "✅", action: "📝", warn: "⚠️", info: "ℹ️" };

const REMEMBERED = "tripdeck.passports";

/** The passports chosen last time, or the country of the browser's language (pl-PL → PL). */
function defaultPassports(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(REMEMBERED) ?? "null") as unknown;
    if (Array.isArray(saved) && saved.length && saved.every((c) => COUNTRY_CODES.includes(c))) return saved;
  } catch {
    // Blocked storage: fall back to the language.
  }
  const region = navigator.language.split("-")[1]?.toUpperCase();
  return region && COUNTRY_CODES.includes(region) ? [region] : [];
}

const byName = [...COUNTRY_CODES].sort((a, b) => countryName(a).localeCompare(countryName(b)));

const day = (iso: string) => formatDayLabel(dayDate(iso, 0));

/**
 * Visas, passports, arrival forms and other formalities for the countries on the route. Claude
 * researches them on the web through MCP (save_entry_check); here they are shown and ticked off.
 */
export function EntryDialog({ trip, onClose }: { trip: Trip; onClose: () => void }) {
  const updateTrip = useStore((s) => s.updateTrip);
  const [copied, setCopied] = useState(false);
  const passports = trip.passports ?? [];
  const check = trip.entry;
  const status = entryState(trip);
  const ask = `Check the entry requirements for my trip "${trip.name}" in TripDeck.`;

  const setPassports = (codes: string[]) => {
    updateTrip(trip.id, { passports: codes });
    try {
      localStorage.setItem(REMEMBERED, JSON.stringify(codes));
    } catch {
      // Only the default for the next trip is lost.
    }
  };

  // A trip without passports gets the usual ones, so Claude knows what to check for.
  useEffect(() => {
    if (!trip.passports?.length) {
      const codes = defaultPassports();
      if (codes.length) updateTrip(trip.id, { passports: codes });
    }
  }, [trip.id, trip.passports, updateTrip]);

  const copy = () =>
    navigator.clipboard?.writeText(ask).then(
      () => setCopied(true),
      () => undefined,
    );

  const tick = (code: string, index: number, done: boolean) =>
    check && updateTrip(trip.id, { entry: setRequirementDone(check, code, index, done) });

  return (
    <Modal title="🛂 Entry & paperwork" onClose={onClose} wide>
      <div className="entry">
        <div className="row wrap">
          <span className="muted small">Passports:</span>
          {passports.map((c) => (
            <span key={c} className="badge">
              {flag(c)} {countryName(c)}
              <button
                className="linklike"
                aria-label={`Remove ${countryName(c)}`}
                onClick={() => setPassports(passports.filter((p) => p !== c))}
              >
                ✕
              </button>
            </span>
          ))}
          <select
            className="entry-add"
            value=""
            aria-label="Add a passport"
            onChange={(e) => e.target.value && setPassports([...passports, e.target.value])}
          >
            <option value="">+ Add passport</option>
            {byName
              .filter((c) => !passports.includes(c))
              .map((c) => (
                <option key={c} value={c}>
                  {countryName(c)}
                </option>
              ))}
          </select>
        </div>

        <div className="entry-ask">
          <span className="grow small">
            {check ? "To check again, ask" : "Claude researches the current rules on the web for you. Ask"} Claude (with
            TripDeck connected): <q>{ask}</q>
          </span>
          <button className="btn small" onClick={copy}>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>

        {status.kind === "stale" && (
          <p className="issue warn">
            Checked before {status.reasons.join(" and ")} – check again so it matches the trip.
          </p>
        )}

        {check?.countries.map((c) => (
          <section key={c.code} className="entry-country">
            <h3>
              {flag(c.code)} {c.name}
              {c.transit && <span className="badge">transit</span>}
              {c.from && (
                <span className="muted small">
                  {" "}
                  {day(c.from)}
                  {c.to && c.to !== c.from ? ` – ${day(c.to)}` : ""}
                </span>
              )}
            </h3>
            <p className="muted">{c.summary}</p>
            <ul className="entry-list">
              {c.requirements.map((r, i) => (
                <li key={i} className={r.done ? "done" : undefined}>
                  <span aria-hidden>{r.done ? "☑️" : LEVEL_ICON[r.level]}</span>
                  <span className="grow">
                    <span>
                      <strong>{r.title}</strong>
                      <span className="muted small"> · {ENTRY_KIND_LABEL[r.kind]} </span>
                      {r.dueBy && !r.done && <span className="badge status-pending">by {day(r.dueBy)}</span>}
                    </span>
                    {r.details && <div className="small">{r.details}</div>}
                    {r.url && (
                      <a className="small" href={r.url} target="_blank" rel="noreferrer">
                        {hostOf(r.url)} ↗
                      </a>
                    )}
                  </span>
                  {r.level === "action" && (
                    <label className="entry-done">
                      <input type="checkbox" checked={!!r.done} onChange={(e) => tick(c.code, i, e.target.checked)} />
                      Done
                    </label>
                  )}
                </li>
              ))}
            </ul>
            {c.sources.length > 0 && (
              <p className="small muted">
                Sources:{" "}
                {c.sources.map((s, i) => (
                  <span key={s.url}>
                    {i > 0 && " · "}
                    <a href={s.url} target="_blank" rel="noreferrer" title={s.title}>
                      {hostOf(s.url)}
                    </a>
                  </span>
                ))}
              </p>
            )}
          </section>
        ))}

        {check && (
          <p className="small muted">
            Checked {new Date(check.checkedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}.
            Entry rules change: confirm on the official sites before you book and again before you go. Links lead only to the
            official sites Claude used as sources; pay visa fees only there.
          </p>
        )}
      </div>
    </Modal>
  );
}
