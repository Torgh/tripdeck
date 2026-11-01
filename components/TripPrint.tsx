"use client";

import Link from "next/link";
import { useEffect, useMemo, type ReactNode } from "react";
import { computeClockNotes, mergeIssues } from "@/lib/clock";
import { computeDiveWarnings } from "@/lib/diveSafety";
import { focusItems, mercatorAspect } from "@/lib/geo";
import { useHydrated, useTripBudget } from "@/lib/hooks";
import { budgetSummary } from "@/lib/money";
import { rentalsOf, type RentalDay } from "@/lib/rentals";
import { nightsOf, type Night } from "@/lib/stays";
import { dayColor } from "@/lib/mapLayers";
import { PRINT_PARTS, PRINT_PRESETS, presetOf, type PrintOptions, type PrintPreset } from "@/lib/printOptions";
import { useTrip } from "@/lib/store";
import { dayDate, formatDayLabel, formatDuration, formatHm } from "@/lib/time";
import { computeTripTimeline, getLeg, type Issue } from "@/lib/timeline";
import type { T } from "@/lib/i18n";
import { BOOKING_STATUS_ICON, DIVE_PREP_ICON, diveGas, itemIcon, type Item } from "@/lib/types";
import { useLang, useT } from "@/lib/useLang";
import { setPrintOptions, usePrintOptions } from "@/lib/usePrintOptions";
import { TripMap } from "./TripMap";

/** Printable itinerary; the browser's print dialog saves it as a PDF. */
export function TripPrint({ tripId }: { tripId: string | null }) {
  const hydrated = useHydrated();
  const trip = useTrip(tripId);
  const t = useT();
  const lang = useLang();
  const timelines = useMemo(() => (trip ? computeTripTimeline(trip, lang) : []), [trip, lang]);
  const warnings = useMemo(
    () => (trip ? mergeIssues(computeDiveWarnings(trip, timelines, lang), computeClockNotes(trip, timelines, lang)) : new Map()),
    [trip, timelines, lang],
  );
  const nights = useMemo(() => (trip ? nightsOf(trip) : []), [trip]);
  const rentals = useMemo(() => (trip ? rentalsOf(trip, lang) : []), [trip, lang]);
  const budget = useTripBudget(trip);
  const show = usePrintOptions();
  const focus = useMemo(() => {
    const items = trip ? focusItems(Object.values(trip.items)) : [];
    return { ids: new Set(items.map((it) => it.id)), aspect: mercatorAspect(items.map((it) => it.location!)) };
  }, [trip]);

  useEffect(() => {
    if (!trip) return;
    // The title becomes the suggested PDF file name.
    const previous = document.title;
    document.title = t("print.docTitle", { name: trip.name });
    return () => {
      document.title = previous;
    };
  }, [trip, t]);

  if (!hydrated) return <main className="home muted">{t("common.loading")}</main>;
  if (!trip) {
    return (
      <main className="home">
        <p>{t("trip.notFound")}</p>
        <Link href="/">{t("trip.allTrips")}</Link>
      </main>
    );
  }

  const last = trip.days.length - 1;
  const date = (i: number) => formatDayLabel(dayDate(trip.startDate, i), lang);
  const booked = trip.days.flatMap((d, i) =>
    d.itemIds.map((id) => trip.items[id]).filter((it): it is Item => !!it?.booking).map((item) => ({ item, day: i })),
  );
  const ideas = trip.ideas.map((id) => trip.items[id]).filter((it): it is Item => !!it);

  return (
    <div className="print-page">
      <div className="print-toolbar">
        <Link className="btn" href={`/trip?id=${encodeURIComponent(trip.id)}`}>
          {t("print.backToBoard")}
        </Link>
        <span className="grow muted small">{t("print.hint")}</span>
        <button className="btn primary" onClick={() => window.print()}>
          {t("print.save")}
        </button>
      </div>
      <PrintOptionsBar options={show} />

      <article className="print-doc">
        <header className="print-head">
          <h1>{trip.name}</h1>
          <p>
            {trip.destination} · {date(0)} – {date(last)} · {t("home.days", { n: trip.days.length })}
          </p>
        </header>

        {show.map && focus.ids.size > 0 && (
          <section className="print-section">
            <h2>{t("print.map")}</h2>
            {/* Tall trips get a tall map; the height stays within one page. */}
            <div className="print-map" style={{ height: Math.round(Math.min(640, Math.max(320, 680 * focus.aspect))) }}>
              <TripMap trip={trip} selectedDayId={null} onlyItemIds={focus.ids} staticView />
            </div>
          </section>
        )}

        {show.overview && (
          <section className="print-section">
            <h2>{t("print.overview")}</h2>
            <table>
              <thead>
                <tr>
                  <th>{t("print.day")}</th>
                  <th>{t("print.date")}</th>
                  <th>{t("print.plan")}</th>
                  <th>{t("print.night")}</th>
                </tr>
              </thead>
              <tbody>
                {trip.days.map((d, i) => (
                  <tr key={d.id}>
                    <td className="nowrap">
                      <span className="day-dot" style={{ background: dayColor(i) }} /> {i + 1}
                    </td>
                    <td className="nowrap">{date(i)}</td>
                    <td>
                      {d.itemIds
                        .map((id) => trip.items[id])
                        .filter((it) => it && it.type !== "stay")
                        .map((it) => it!.title)
                        .join(" · ") || "–"}
                    </td>
                    <td>{nightLabel(nights[i], t)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {show.bookings && booked.length > 0 && (
          <section className="print-section">
            <h2>{t("print.bookings")}</h2>
            <table>
              <thead>
                <tr>
                  <th>{t("print.day")}</th>
                  <th>{t("print.booking")}</th>
                  <th>{t("print.provider")}</th>
                  {show.references && <th>{t("print.reference")}</th>}
                  {show.prices && <th>{t("print.price")}</th>}
                </tr>
              </thead>
              <tbody>
                {booked.map(({ item, day }) => (
                  <tr key={item.id}>
                    <td className="nowrap">
                      {day + 1} · {date(day)}
                    </td>
                    <td>
                      {itemIcon(item)} {item.title}
                      {item.booking?.status && item.booking.status !== "confirmed" && (
                        <div className="nowrap">
                          {BOOKING_STATUS_ICON[item.booking.status]} {t(`bookingStatus.${item.booking.status}`)}
                        </div>
                      )}
                    </td>
                    <td>{item.booking?.provider ?? "–"}</td>
                    {show.references && <td className="mono">{item.booking?.reference ?? "–"}</td>}
                    {show.prices && (
                      <td>
                        {item.booking?.price ?? "–"}
                        {item.booking?.paid && <div className="nowrap muted">{t("print.paid")}</div>}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {show.prices && budget && budget.lines.length > 0 && (
              <p className="small">
                <strong>{t("print.total")}</strong> {budgetSummary(budget, lang)}
                {budget.ratesDate && <span className="muted">{t("print.ecb", { date: budget.ratesDate })}</span>}
                {(budget.unconverted.length > 0 || budget.noCurrency.length > 0) && (
                  <span className="muted">{t("print.missing")}</span>
                )}
              </p>
            )}
          </section>
        )}

        <h2 className="print-days-title">{t("print.dayByDay")}</h2>
        {trip.days.map((d, i) => {
          const tl = timelines[i];
          return (
            <section key={d.id} className="print-day">
              <h3>
                {t("common.day", { day: i + 1 })} · {date(i)}
              </h3>
              {tl?.base && <p className="muted small">{t("print.wakeUp", { place: tl.base.title })}</p>}
              {rentals[i]
                ?.filter((r) => r.phase !== "pickup")
                .map((r) => (
                  <p key={r.rental.id} className="muted small">
                    {itemIcon(r.rental)} {rentalLabel(r, t)}
                  </p>
                ))}
              {tl?.entries.length ? (
                <ol className="print-entries">
                  {tl.entries.map((e) => {
                    const item = trip.items[e.itemId];
                    if (!item) return null;
                    const from = e.fromId ? trip.items[e.fromId] : undefined;
                    const issues: Issue[] = show.warnings ? [...e.issues, ...(warnings.get(item.id) ?? [])] : [];
                    return (
                      <li key={e.itemId}>
                        {show.legs && from && e.legMin !== undefined && (
                          <div className="print-leg">
                            ↓ {t(`mode.${getLeg(trip, from.id, item.id).mode}`)} {formatDuration(e.legMin, lang)}
                            {e.legEstimated ? t("print.estimate") : ""}
                          </div>
                        )}
                        <div className="print-entry">
                          <span className="print-time">
                            {e.fixed ? "" : "~"}
                            {formatHm(e.start)}
                            {e.end > e.start ? `–${formatHm(e.end)}` : ""}
                          </span>
                          <div>
                            <strong>
                              {itemIcon(item)} {item.title}
                            </strong>
                            <ItemDetails item={item} show={show} />
                            {issues.map((iss, k) => (
                              <div key={k} className={`print-issue ${iss.level}`}>
                                {iss.level === "warn" ? "⚠️" : "ℹ️"} {iss.message}
                              </div>
                            ))}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <p className="muted small">{t("print.free")}</p>
              )}
              {nights[i] && nights[i].kind !== "end" && <p className="print-night">🌙 {nightLabel(nights[i], t)}</p>}
            </section>
          );
        })}
        {show.ideas && ideas.length > 0 && (
          <section className="print-day">
            <h3>{t("print.ideas")}</h3>
            <ul className="print-entries">
              {ideas.map((item) => (
                <li key={item.id}>
                  <strong>
                    {itemIcon(item)} {item.title}
                  </strong>
                  <ItemDetails item={item} show={show} />
                </li>
              ))}
            </ul>
          </section>
        )}
        <footer className="print-foot muted small">{t("print.footer")}</footer>
      </article>
    </div>
  );
}

/** Under the toolbar, left out of the PDF: which parts the itinerary shows, and two ready-made sets. */
function PrintOptionsBar({ options }: { options: PrintOptions }) {
  const t = useT();
  const active = presetOf(options);
  const preset = (name: PrintPreset, label: ReactNode) => (
    <button
      className={`btn small${active === name ? " primary" : ""}`}
      aria-pressed={active === name}
      onClick={() => setPrintOptions(PRINT_PRESETS[name])}
    >
      {label}
    </button>
  );
  return (
    <div className="print-options" role="group" aria-label={t("print.options")}>
      <strong className="small">{t("print.options")}</strong>
      {preset("full", t("print.presetFull"))}
      {preset("share", t("print.presetShare"))}
      <span className="print-parts">
        {PRINT_PARTS.map((part) => (
          <label key={part} className="small">
            <input
              type="checkbox"
              checked={options[part]}
              onChange={(e) => setPrintOptions({ ...options, [part]: e.target.checked })}
            />
            {t(`print.part.${part}`)}
          </label>
        ))}
      </span>
    </div>
  );
}

function ItemDetails({ item, show }: { item: Item; show: PrintOptions }) {
  const t = useT();
  const bits: string[] = [];
  if (item.transport) {
    const tr = item.transport;
    bits.push([tr.number, tr.from && tr.to ? `${tr.from} → ${tr.to}` : (tr.from ?? tr.to)].filter(Boolean).join(" · "));
  }
  if (item.stay) {
    bits.push(t("board.nights", { n: item.stay.nights }));
    if (item.stay.checkIn) bits.push(t("print.checkIn", { time: item.stay.checkIn }));
    if (item.stay.checkOut) bits.push(t("print.checkOut", { time: item.stay.checkOut }));
  }
  if (item.rental) {
    const r = item.rental;
    bits.push(
      [
        t("board.days", { n: r.days }),
        r.returnTime && t("print.returnBy", { time: r.returnTime }),
        r.returnPlace && t("print.at", { place: r.returnPlace }),
      ]
        .filter(Boolean)
        .join(" · "),
    );
  }
  if (item.dive) {
    const d = item.dive;
    bits.push(
      [t("board.dives", { n: d.dives }), d.site, d.maxDepthM ? t("print.maxDepth", { m: d.maxDepthM }) : "", diveGas(d), d.center]
        .filter(Boolean)
        .join(" · "),
    );
    if (d.prep) bits.push(`${DIVE_PREP_ICON[d.prep.status]} ${t(`divePrep.${d.prep.status}`)}: ${d.prep.summary}`);
  }
  if (item.tour?.stops.length) bits.push(t("print.visits", { stops: item.tour.stops.map((s) => s.name).join(" → ") }));
  const b = item.booking;
  const reference = show.references && b?.reference;
  const price = show.prices && b?.price;
  if (b && (b.provider || reference || price)) {
    bits.push([t("print.booked"), b.provider, reference && t("print.ref", { ref: reference }), price].filter(Boolean).join(" · "));
  }
  return (
    <>
      {bits.filter(Boolean).map((bit, k) => (
        <div key={k} className="small">
          {bit}
        </div>
      ))}
      {show.addresses && item.location?.address && (
        <div className="small muted">
          📍 {item.tour?.stops.length ? t("print.pickUp") : ""}
          {item.location.address}
        </div>
      )}
      {show.notes && item.notes && <div className="small print-notes">{item.notes}</div>}
    </>
  );
}

function nightLabel(night: Night | undefined, t: T): string {
  if (!night || night.kind === "end") return "–";
  if (night.kind === "transport") return t("print.overnight", { title: night.item.title });
  if (night.kind === "none") return t("print.noStay");
  return night.nights > 1 ? `${night.stay.title} (${night.night}/${night.nights})` : night.stay.title;
}

function rentalLabel({ rental, phase, returnLabel }: RentalDay, t: T): string {
  const r = rental.rental;
  if (phase === "return") {
    return t("print.returnToday", {
      title: rental.title,
      by: r?.returnTime ? t("print.by", { time: r.returnTime }) : "",
      at: r?.returnPlace ? t("print.atPlace", { place: r.returnPlace }) : "",
    });
  }
  return t("print.back", { title: rental.title, date: returnLabel });
}
