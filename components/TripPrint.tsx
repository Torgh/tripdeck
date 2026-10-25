"use client";

import Link from "next/link";
import { useEffect, useMemo } from "react";
import { computeClockNotes, mergeIssues } from "@/lib/clock";
import { computeDiveWarnings } from "@/lib/diveSafety";
import { focusItems, mercatorAspect } from "@/lib/geo";
import { useHydrated, useTripBudget } from "@/lib/hooks";
import { budgetSummary } from "@/lib/money";
import { rentalsOf, type RentalDay } from "@/lib/rentals";
import { nightsOf, type Night } from "@/lib/stays";
import { dayColor } from "@/lib/mapLayers";
import { useTrip } from "@/lib/store";
import { dayDate, formatDayLabel, formatDuration, formatHm } from "@/lib/time";
import { computeTripTimeline, getLeg, type Issue } from "@/lib/timeline";
import { BOOKING_STATUS_ICON, BOOKING_STATUS_LABEL, DIVE_PREP_ICON, DIVE_PREP_LABEL, diveGas, itemIcon, MODE_LABEL, type Item } from "@/lib/types";
import { TripMap } from "./TripMap";

/** Printable itinerary; the browser's print dialog saves it as a PDF. */
export function TripPrint({ tripId }: { tripId: string | null }) {
  const hydrated = useHydrated();
  const trip = useTrip(tripId);
  const timelines = useMemo(() => (trip ? computeTripTimeline(trip) : []), [trip]);
  const warnings = useMemo(
    () => (trip ? mergeIssues(computeDiveWarnings(trip, timelines), computeClockNotes(trip, timelines)) : new Map()),
    [trip, timelines],
  );
  const nights = useMemo(() => (trip ? nightsOf(trip) : []), [trip]);
  const rentals = useMemo(() => (trip ? rentalsOf(trip) : []), [trip]);
  const budget = useTripBudget(trip);
  const focus = useMemo(() => {
    const items = trip ? focusItems(Object.values(trip.items)) : [];
    return { ids: new Set(items.map((it) => it.id)), aspect: mercatorAspect(items.map((it) => it.location!)) };
  }, [trip]);

  useEffect(() => {
    if (!trip) return;
    // The title becomes the suggested PDF file name.
    const previous = document.title;
    document.title = `${trip.name} – itinerary`;
    return () => {
      document.title = previous;
    };
  }, [trip]);

  if (!hydrated) return <main className="home muted">Loading…</main>;
  if (!trip) {
    return (
      <main className="home">
        <p>Trip not found in this browser.</p>
        <Link href="/">← All trips</Link>
      </main>
    );
  }

  const last = trip.days.length - 1;
  const booked = trip.days.flatMap((d, i) =>
    d.itemIds.map((id) => trip.items[id]).filter((it): it is Item => !!it?.booking).map((item) => ({ item, day: i })),
  );

  return (
    <div className="print-page">
      <div className="print-toolbar">
        <Link className="btn" href={`/trip?id=${encodeURIComponent(trip.id)}`}>
          ← Back to the board
        </Link>
        <span className="grow muted small">In the print dialog choose “Save as PDF” as the printer.</span>
        <button className="btn primary" onClick={() => window.print()}>
          📄 Save as PDF
        </button>
      </div>

      <article className="print-doc">
        <header className="print-head">
          <h1>{trip.name}</h1>
          <p>
            {trip.destination} · {formatDayLabel(dayDate(trip.startDate, 0))} – {formatDayLabel(dayDate(trip.startDate, last))}{" "}
            · {trip.days.length} days
          </p>
        </header>

        {focus.ids.size > 0 && (
          <section className="print-section">
            <h2>Map</h2>
            {/* Tall trips get a tall map; the height stays within one page. */}
            <div className="print-map" style={{ height: Math.round(Math.min(640, Math.max(320, 680 * focus.aspect))) }}>
              <TripMap trip={trip} selectedDayId={null} onlyItemIds={focus.ids} staticView />
            </div>
          </section>
        )}

        <section className="print-section">
          <h2>Overview</h2>
          <table>
            <thead>
              <tr>
                <th>Day</th>
                <th>Date</th>
                <th>Plan</th>
                <th>Night</th>
              </tr>
            </thead>
            <tbody>
              {trip.days.map((d, i) => (
                <tr key={d.id}>
                  <td className="nowrap">
                    <span className="day-dot" style={{ background: dayColor(i) }} /> {i + 1}
                  </td>
                  <td className="nowrap">{formatDayLabel(dayDate(trip.startDate, i))}</td>
                  <td>
                    {d.itemIds
                      .map((id) => trip.items[id])
                      .filter((it) => it && it.type !== "stay")
                      .map((it) => it!.title)
                      .join(" · ") || "–"}
                  </td>
                  <td>{nightLabel(nights[i])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {booked.length > 0 && (
          <section className="print-section">
            <h2>Bookings</h2>
            <table>
              <thead>
                <tr>
                  <th>Day</th>
                  <th>Booking</th>
                  <th>Provider</th>
                  <th>Reference</th>
                  <th>Price</th>
                </tr>
              </thead>
              <tbody>
                {booked.map(({ item, day }) => (
                  <tr key={item.id}>
                    <td className="nowrap">
                      {day + 1} · {formatDayLabel(dayDate(trip.startDate, day))}
                    </td>
                    <td>
                      {itemIcon(item)} {item.title}
                    </td>
                    <td>{item.booking?.provider ?? "–"}</td>
                    <td className="mono">
                      {item.booking?.reference ?? "–"}
                      {item.booking?.status && item.booking.status !== "confirmed" && (
                        <div className="nowrap">
                          {BOOKING_STATUS_ICON[item.booking.status]} {BOOKING_STATUS_LABEL[item.booking.status]}
                        </div>
                      )}
                    </td>
                    <td>
                      {item.booking?.price ?? "–"}
                      {item.booking?.paid && <div className="nowrap muted">Paid</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {budget && budget.lines.length > 0 && (
              <p className="small">
                <strong>Total:</strong> {budgetSummary(budget)}
                {budget.ratesDate && <span className="muted"> (converted at ECB rates of {budget.ratesDate})</span>}
                {(budget.unconverted.length > 0 || budget.noCurrency.length > 0) && (
                  <span className="muted"> · some prices are not included (no currency or exchange rate)</span>
                )}
              </p>
            )}
          </section>
        )}

        <h2 className="print-days-title">Day by day</h2>
        {trip.days.map((d, i) => {
          const tl = timelines[i];
          return (
            <section key={d.id} className="print-day">
              <h3>
                Day {i + 1} · {formatDayLabel(dayDate(trip.startDate, i))}
              </h3>
              {tl?.base && <p className="muted small">Wake up at {tl.base.title}</p>}
              {rentals[i]
                ?.filter((r) => r.phase !== "pickup")
                .map((r) => (
                  <p key={r.rental.id} className="muted small">
                    {itemIcon(r.rental)} {rentalLabel(r)}
                  </p>
                ))}
              {tl?.entries.length ? (
                <ol className="print-entries">
                  {tl.entries.map((e) => {
                    const item = trip.items[e.itemId];
                    if (!item) return null;
                    const from = e.fromId ? trip.items[e.fromId] : undefined;
                    const issues: Issue[] = [...e.issues, ...(warnings.get(item.id) ?? [])];
                    return (
                      <li key={e.itemId}>
                        {from && e.legMin !== undefined && (
                          <div className="print-leg">
                            ↓ {MODE_LABEL[getLeg(trip, from.id, item.id).mode]} {formatDuration(e.legMin)}
                            {e.legEstimated ? " (estimate)" : ""}
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
                            <ItemDetails item={item} />
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
                <p className="muted small">Free day – nothing planned.</p>
              )}
              {nights[i] && nights[i].kind !== "end" && <p className="print-night">🌙 {nightLabel(nights[i])}</p>}
            </section>
          );
        })}
        <footer className="print-foot muted small">Made with TripDeck</footer>
      </article>
    </div>
  );
}

function ItemDetails({ item }: { item: Item }) {
  const bits: string[] = [];
  if (item.transport) {
    const t = item.transport;
    bits.push([t.number, t.from && t.to ? `${t.from} → ${t.to}` : (t.from ?? t.to)].filter(Boolean).join(" · "));
  }
  if (item.stay) {
    bits.push(`${item.stay.nights} night${item.stay.nights > 1 ? "s" : ""}`);
    if (item.stay.checkIn) bits.push(`check-in from ${item.stay.checkIn}`);
    if (item.stay.checkOut) bits.push(`check-out by ${item.stay.checkOut}`);
  }
  if (item.rental) {
    const r = item.rental;
    bits.push(
      [`${r.days} day${r.days > 1 ? "s" : ""}`, r.returnTime && `return by ${r.returnTime}`, r.returnPlace && `at ${r.returnPlace}`]
        .filter(Boolean)
        .join(" · "),
    );
  }
  if (item.dive) {
    const d = item.dive;
    bits.push(
      [`${d.dives} dive${d.dives > 1 ? "s" : ""}`, d.site, d.maxDepthM ? `max ${d.maxDepthM} m` : "", diveGas(d), d.center]
        .filter(Boolean)
        .join(" · "),
    );
    if (d.prep) bits.push(`${DIVE_PREP_ICON[d.prep.status]} ${DIVE_PREP_LABEL[d.prep.status]}: ${d.prep.summary}`);
  }
  if (item.tour?.stops.length) bits.push(`Visits: ${item.tour.stops.map((s) => s.name).join(" → ")}`);
  const b = item.booking;
  if (b && (b.provider || b.reference || b.price)) {
    bits.push(["Booked", b.provider, b.reference && `ref ${b.reference}`, b.price].filter(Boolean).join(" · "));
  }
  return (
    <>
      {bits.filter(Boolean).map((t, k) => (
        <div key={k} className="small">
          {t}
        </div>
      ))}
      {item.location?.address && (
        <div className="small muted">
          📍 {item.tour?.stops.length ? "Pick-up: " : ""}
          {item.location.address}
        </div>
      )}
      {item.notes && <div className="small print-notes">{item.notes}</div>}
    </>
  );
}

function nightLabel(night: Night | undefined): string {
  if (!night || night.kind === "end") return "–";
  if (night.kind === "transport") return `Overnight · ${night.item.title}`;
  if (night.kind === "none") return "No accommodation";
  return night.nights > 1 ? `${night.stay.title} (${night.night}/${night.nights})` : night.stay.title;
}

function rentalLabel({ rental, phase, returnLabel }: RentalDay): string {
  const r = rental.rental;
  if (phase === "return") {
    return `Return ${rental.title} today${r?.returnTime ? ` by ${r.returnTime}` : ""}${r?.returnPlace ? ` at ${r.returnPlace}` : ""}`;
  }
  return `${rental.title} · back ${returnLabel}`;
}
