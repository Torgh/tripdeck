import { useState } from "react";
import { navigationUrl } from "@/lib/itinerary";
import type { RentalDay } from "@/lib/rentals";
import { defaultModeTo, rentalSummary } from "@/lib/rentals";
import type { Night } from "@/lib/stays";
import { formatDayLabel, formatDuration, formatHm } from "@/lib/time";
import { freshRoute, getLeg, type DayTimeline, type Issue, type TimelineEntry } from "@/lib/timeline";
import { vehicleIcon } from "@/lib/transit";
import { BOOKING_STATUS_ICON, DIVE_PREP_ICON, diveGas, itemIcon, type Item, type Trip } from "@/lib/types";
import { useLang, useT } from "@/lib/useLang";
import type { Lang, T } from "@/lib/i18n";

interface DayProps {
  trip: Trip;
  timeline: DayTimeline;
  warnings: Map<string, Issue[]>;
  night: Night;
  rentals: RentalDay[];
  isToday: boolean;
  /** The card picked on the map (or tapped here), highlighted in the list. */
  highlightId?: string;
  onSelect: (itemId: string) => void;
  /** What the day's bookings cost, in the trip's budget currency. */
  spent?: string;
}

export function DayView({ trip, timeline, warnings, night, rentals, isToday, highlightId, onSelect, spent }: DayProps) {
  const t = useT();
  const lang = useLang();
  const { dayIndex, base, entries } = timeline;
  // Rentals picked up today have their own card; the others are reminders.
  const ongoing = rentals.filter((r) => r.phase !== "pickup");
  const leaving = base && !(night.kind === "stay" && night.stay.id === base.id);

  return (
    <>
      <div className="day-head">
        <h2>
          {t("common.day", { day: dayIndex + 1 })} · {formatDayLabel(timeline.date, lang)}
        </h2>
        {isToday && <span className="badge">{t("phoneDay.today")}</span>}
        {timeline.travelMin > 0 && (
          <span className="muted small">{t("phoneDay.onTheRoad", { duration: formatDuration(timeline.travelMin, lang) })}</span>
        )}
        {spent && <span className="muted small">💰 {spent}</span>}
      </div>

      {base && (
        <div className="strip stay">
          🏨 {t(leaving ? "phoneDay.checkOut" : "phoneDay.wakingUp")} <b>{base.title}</b>
          {leaving && base.stay?.checkOut && t("phoneDay.by", { time: base.stay.checkOut })}
        </div>
      )}
      {ongoing.map((r) => (
        <div key={r.rental.id} className="strip rental">
          {itemIcon(r.rental)} {t(`vehicle.${r.rental.rental?.vehicle ?? "car"}`)}
          {r.rental.booking?.provider && <> · {r.rental.booking.provider}</>}
          {r.phase === "return" ? (
            <>
              {" "}
              ·{" "}
              <b>
                {t("phoneDay.returnToday")}
                {r.rental.rental?.returnTime && t("phoneDay.by", { time: r.rental.rental.returnTime })}
              </b>
              {(r.rental.rental?.returnPlace || r.rental.location?.address) &&
                t("phoneDay.at", { place: r.rental.rental?.returnPlace ?? r.rental.location?.address ?? "" })}
            </>
          ) : (
            t("phoneDay.back", { date: r.returnLabel })
          )}
        </div>
      ))}

      {entries.length === 0 && <p className="empty muted">{t("phoneDay.nothing")}</p>}

      <ol className="timeline">
        {entries.map((entry) => {
          const item = trip.items[entry.itemId];
          if (!item) return null;
          return (
            <li key={entry.itemId}>
              {entry.fromId && entry.legMin != null && entry.legMin >= 1 && (
                <LegRow trip={trip} entry={entry} from={entry.fromId === base?.id ? base.title : undefined} />
              )}
              <ItemCard
                trip={trip}
                item={item}
                dayIndex={dayIndex}
                entry={entry}
                lang={lang}
                issues={[...entry.issues, ...(warnings.get(item.id) ?? [])]}
                highlighted={item.id === highlightId}
                onSelect={onSelect}
              />
            </li>
          );
        })}
      </ol>

      <div className="strip night">{nightLabel(night, t)}</div>
    </>
  );
}

export function IdeasView({
  trip,
  highlightId,
  onSelect,
}: {
  trip: Trip;
  highlightId?: string;
  onSelect: (itemId: string) => void;
}) {
  const t = useT();
  const lang = useLang();
  return (
    <>
      <div className="day-head">
        <h2>{t("common.ideas")}</h2>
        <span className="muted small">{t("phoneDay.notScheduled")}</span>
      </div>
      <ol className="timeline">
        {trip.ideas.map((id) => {
          const item = trip.items[id];
          return item ? (
            <li key={id}>
              <ItemCard
                trip={trip}
                item={item}
                dayIndex={-1}
                lang={lang}
                issues={[]}
                highlighted={item.id === highlightId}
                onSelect={onSelect}
              />
            </li>
          ) : null;
        })}
      </ol>
    </>
  );
}

function nightLabel(night: Night, t: T): string {
  switch (night.kind) {
    case "stay":
      return `🌙 ${night.stay.title}${night.nights > 1 ? t("phoneDay.nightOf", { n: night.night, nights: night.nights }) : ""}`;
    case "transport":
      return t("phoneDay.overnight", { title: night.item.title });
    case "none":
      return t("phoneDay.noStay");
    case "end":
      return t("phoneDay.lastDay");
  }
}

function LegRow({ trip, entry, from }: { trip: Trip; entry: TimelineEntry; from?: string }) {
  const t = useT();
  const lang = useLang();
  const mode = getLeg(trip, entry.fromId!, entry.itemId).mode;
  const origin = trip.items[entry.fromId!];
  const target = trip.items[entry.itemId];
  // Saved with the trip, so the lines and stops are there offline too.
  const route = origin && target ? freshRoute(trip, origin, target) : undefined;
  const transit = route?.transit;
  return (
    <div className="leg">
      {t(`mode.${mode}`)} · {entry.legEstimated ? "~" : ""}
      {formatDuration(entry.legMin!, lang)}
      {from && t("phoneDay.from", { place: from })}
      {transit?.length ? (
        <ol className="transit">
          {transit.map((s, i) => (
            <li key={i}>
              <span
                className="transit-line"
                style={s.color ? { background: s.color, color: s.textColor ?? "#fff" } : undefined}
              >
                {vehicleIcon(s.vehicle)} {s.line}
              </span>{" "}
              {s.departs && <strong>{s.departs} </strong>}
              {s.from} → {s.to}
              {s.stops ? ` · ${t("transit.stops", { n: s.stops })}` : ""}
            </li>
          ))}
          {route?.sampledOn && <li>{t("phoneDay.typicalWeek")}</li>}
        </ol>
      ) : null}
    </div>
  );
}

/** One line under the title: what kind of card it is, in its own terms. */
function subtitle(trip: Trip, item: Item, dayIndex: number, t: T, lang: Lang): string | undefined {
  switch (item.type) {
    case "transport": {
      const tr = item.transport;
      const route = [tr?.from, tr?.to].filter(Boolean).join(" → ");
      return [route, tr?.number].filter(Boolean).join(" · ") || undefined;
    }
    case "stay": {
      const s = item.stay;
      const nights = Math.max(1, s?.nights ?? 1);
      return [t("board.nights", { n: nights }), s?.checkIn && t("phoneDay.checkIn", { time: s.checkIn })]
        .filter(Boolean)
        .join(" · ");
    }
    case "rental":
      return rentalSummary(trip, item, dayIndex, lang);
    case "dive": {
      const d = item.dive;
      if (!d) return undefined;
      return [
        t("board.dives", { n: d.dives }),
        d.site,
        d.maxDepthM != null && t("phoneDay.maxDepth", { m: d.maxDepthM }),
        diveGas(d) !== "air" && diveGas(d),
        d.center,
        d.prep && `${DIVE_PREP_ICON[d.prep.status]} ${t(`divePrep.${d.prep.status}`)}`,
      ]
        .filter(Boolean)
        .join(" · ");
    }
    case "activity":
      // An organised tour's location is where it picks you up, not what you see.
      return item.tour?.stops.length && item.location?.address
        ? t("phoneDay.pickUp", { place: item.location.address })
        : item.location?.address;
    default:
      return item.location?.address;
  }
}

interface CardProps {
  trip: Trip;
  item: Item;
  dayIndex: number;
  entry?: TimelineEntry;
  issues: Issue[];
  highlighted: boolean;
  onSelect: (itemId: string) => void;
  lang: Lang;
}

function ItemCard({ trip, item, dayIndex, entry, issues, highlighted, onSelect, lang }: CardProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const sub = subtitle(trip, item, dayIndex, t, lang);
  // Head for the card the way the plan travels there.
  const mode = entry?.fromId ? getLeg(trip, entry.fromId, entry.itemId).mode : defaultModeTo(trip, item.id);
  const nav = navigationUrl(item, mode);
  const b = item.booking;
  const links = [
    b?.url && { href: b.url, label: t("phoneDay.booking") },
    item.place?.websiteUri && { href: item.place.websiteUri, label: t("phoneDay.website") },
    item.place?.googleMapsUri && { href: item.place.googleMapsUri, label: "Google Maps" },
  ].filter(Boolean) as { href: string; label: string }[];
  const details = Boolean(item.notes || item.tips || links.length || item.aiReason);

  return (
    <article id={`card-${item.id}`} className={`card type-${item.type}${highlighted ? " highlight" : ""}`}>
      <div className="card-row">
        <button
          className="card-main"
          // Tapping a card also shows it on the map; only cards with details fold open.
          onClick={() => {
            onSelect(item.id);
            if (details) setOpen(!open);
          }}
          aria-expanded={details ? open : undefined}
        >
          {entry && (
            <div className="time">
              <span className={entry.fixed ? "fixed" : undefined}>{formatHm(entry.start)}</span>
              <span className="muted">{formatHm(entry.end)}</span>
            </div>
          )}
          <div className="card-body">
            <div className="card-title">
              <span aria-hidden>{itemIcon(item)}</span> {item.title}
            </div>
            {sub && <div className="muted small">{sub}</div>}
            {item.type === "rental" && item.rental?.returnPlace && (
              <div className="muted small">{t("phoneDay.returnAt", { place: item.rental.returnPlace })}</div>
            )}
            {item.tour?.stops.length ? (
              <div className="small">🗺️ {item.tour.stops.map((s) => s.name).join(" → ")}</div>
            ) : null}
            {b && (b.provider || b.reference || b.price || b.status) && (
              <div className="booking small">
                {[
                  b.status && `${BOOKING_STATUS_ICON[b.status]} ${t(`bookingStatus.${b.status}`)}`,
                  b.provider,
                  b.reference && `#${b.reference}`,
                  b.price && (b.paid ? t("phoneDay.paid", { price: b.price }) : b.price),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            )}
          </div>
          {details && <span className="chevron" aria-hidden>{open ? "▴" : "▾"}</span>}
        </button>
        {nav && (
          <a className="nav-btn" href={nav} target="_blank" rel="noreferrer" aria-label={t("phoneDay.navigate", { title: item.title })}>
            🧭
          </a>
        )}
      </div>

      {issues.map((issue, i) => (
        <div key={i} className={`issue ${issue.level}`}>
          {issue.level === "warn" ? "⚠️" : "ℹ️"} {issue.message}
        </div>
      ))}

      {open && (
        <div className="card-details">
          {item.aiReason && <p className="muted">💡 {item.aiReason}</p>}
          {item.notes && <p className="notes">{item.notes}</p>}
          {item.tips && (
            <div className="tips">
              <p>{item.tips.summary}</p>
              <p className="small">
                <b>{t("phoneDay.bestTime")}</b> {item.tips.bestTime}
              </p>
              {item.tips.tickets && (
                <p className="small">
                  <b>{t("phoneDay.tickets")}</b> {item.tips.tickets}
                </p>
              )}
              {item.tips.parking && (
                <p className="small">
                  <b>{t("phoneDay.parking")}</b> {item.tips.parking}
                </p>
              )}
              {item.tips.tips.length > 0 && (
                <ul className="small">
                  {item.tips.tips.map((tip) => (
                    <li key={tip}>{tip}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {links.length > 0 && (
            <div className="links">
              {links.map((l) => (
                <a key={l.label} className="btn small" href={l.href} target="_blank" rel="noreferrer">
                  {l.label} ↗
                </a>
              ))}
            </div>
          )}
        </div>
      )}

    </article>
  );
}
