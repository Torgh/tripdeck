"use client";

import { useEffect, useState } from "react";
import {
  COUNTRY_CODES,
  countryName,
  entryState,
  flag,
  hostOf,
  setRequirementDone,
} from "@/lib/entry";
import { LOCALE } from "@/lib/i18n";
import { useStore } from "@/lib/store";
import { dayDate, formatDayLabel } from "@/lib/time";
import type { EntryLevel, Trip } from "@/lib/types";
import { useLang, useT } from "@/lib/useLang";
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


/**
 * Visas, passports, arrival forms and other formalities for the countries on the route. Claude
 * researches them on the web through MCP (save_entry_check); here they are shown and ticked off.
 */
export function EntryDialog({ trip, onClose }: { trip: Trip; onClose: () => void }) {
  const t = useT();
  const lang = useLang();
  const updateTrip = useStore((s) => s.updateTrip);
  const [copied, setCopied] = useState(false);
  const passports = trip.passports ?? [];
  const check = trip.entry;
  const status = entryState(trip, lang);
  const ask = t("entry.ask", { name: trip.name });
  const country = (code: string) => countryName(code, lang);
  const byName = [...COUNTRY_CODES].sort((a, b) => country(a).localeCompare(country(b), lang));
  const day = (iso: string) => formatDayLabel(dayDate(iso, 0), lang);

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
    <Modal title={t("entry.title")} onClose={onClose} wide>
      <div className="entry">
        <div className="row wrap">
          <span className="muted small">{t("entry.passports")}</span>
          {passports.map((c) => (
            <span key={c} className="badge">
              {flag(c)} {country(c)}
              <button
                className="linklike"
                aria-label={t("entry.removePassport", { country: country(c) })}
                onClick={() => setPassports(passports.filter((p) => p !== c))}
              >
                ✕
              </button>
            </span>
          ))}
          <select
            className="entry-add"
            value=""
            aria-label={t("entry.addPassport")}
            onChange={(e) => e.target.value && setPassports([...passports, e.target.value])}
          >
            <option value="">{t("entry.addPassportOption")}</option>
            {byName
              .filter((c) => !passports.includes(c))
              .map((c) => (
                <option key={c} value={c}>
                  {country(c)}
                </option>
              ))}
          </select>
        </div>

        <div className="entry-ask">
          <span className="grow small">
            {t(check ? "entry.askAgain" : "entry.askFirst")} <q>{ask}</q>
          </span>
          <button className="btn small" onClick={copy}>
            {t(copied ? "entry.copied" : "common.copy")}
          </button>
        </div>

        {status.kind === "stale" && (
          <p className="issue warn">{t("entry.stale", { reasons: status.reasons.join(t("entry.and")) })}</p>
        )}

        {check?.countries.map((c) => (
          <section key={c.code} className="entry-country">
            <h3>
              {flag(c.code)} {c.name}
              {c.transit && <span className="badge">{t("entry.transit")}</span>}
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
                      <span className="muted small"> · {t(`entryKind.${r.kind}`)} </span>
                      {r.dueBy && !r.done && <span className="badge status-pending">{t("entry.by", { date: day(r.dueBy) })}</span>}
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
                      {t("entry.done")}
                    </label>
                  )}
                </li>
              ))}
            </ul>
            {c.sources.length > 0 && (
              <p className="small muted">
                {t("entry.sources")}{" "}
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
            {t("entry.checked", {
              date: new Date(check.checkedAt).toLocaleDateString(LOCALE[lang], { day: "numeric", month: "short", year: "numeric" }),
            })}
          </p>
        )}
      </div>
    </Modal>
  );
}
