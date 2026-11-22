import { homeTimeZone } from "./clock";
import { translator, type Lang } from "./i18n";
import { dayDate, formatHm, isoDate, zonedTimeToUtc } from "./time";
import type { DayTimeline } from "./timeline";
import { itemIcon, type Item, type Trip } from "./types";

/**
 * The trip as an iCalendar file (.ics) for Google Calendar, Outlook or the phone's calendar: one
 * event per card at its planned time, stays and rentals as all-day events across their days.
 *
 * Times: a calendar needs instants, the plan has local clock times. Each card is read in the time zone
 * the traveller is in at that point – the last flight's, ferry's or train's arrival zone, before that
 * the zone the trip leaves from – and written in UTC. Without any known zone (no Google), times are
 * "floating": the calendar shows them at the same clock time wherever it is.
 */

/** Text as iCalendar wants it: backslashes, commas, semicolons and line breaks escaped. */
export function icsText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Lines longer than 75 bytes are folded (CRLF + space), never inside a UTF-8 character. */
export function foldLine(line: string): string {
  const bytes = (s: string) => new TextEncoder().encode(s).length;
  if (bytes(line) <= 75) return line;
  const parts: string[] = [];
  let current = "";
  for (const ch of line) {
    const limit = parts.length ? 74 : 75; // continuation lines start with a space
    if (bytes(current + ch) > limit) {
      parts.push(current);
      current = ch;
    } else current += ch;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

const pad = (n: number) => String(n).padStart(2, "0");
/** 20270110T144000Z */
function utcStamp(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
}
/** 20270110T144000 – local, no zone. */
function floatingStamp(date: string, minutes: number): string {
  const day = Math.floor(minutes / 1440);
  const d = isoDate(dayDate(date, day)).replace(/-/g, "");
  const m = minutes - day * 1440;
  return `${d}T${pad(Math.floor(m / 60))}${pad(m % 60)}00`;
}

/** DTSTART / DTEND value for a clock time on a date, in a zone when known. */
function timeProp(name: string, date: string, minutes: number, zone?: string): string {
  if (!zone) return `${name}:${floatingStamp(date, minutes)}`;
  const day = Math.floor(minutes / 1440);
  return `${name}:${utcStamp(zonedTimeToUtc(isoDate(dayDate(date, day)), formatHm(minutes - day * 1440), zone))}`;
}

function description(item: Item, t: ReturnType<typeof translator>): string {
  const b = item.booking;
  return [
    b?.status && t(`bookingStatus.${b.status}`),
    [b?.provider, b?.reference && `#${b.reference}`].filter(Boolean).join(" "),
    b?.price && `${b.price}${b.paid ? " ✓" : ""}`,
    b?.onSite && `${t("ics.onSite")}: ${b.onSite}${b.cash ? ` (${t("ics.cash")})` : ""}`,
    item.tour?.stops.length && item.tour.stops.map((s) => s.name).join(" → "),
    item.notes,
  ]
    .filter(Boolean)
    .join("\n");
}

export interface CalendarOptions {
  lang?: Lang;
  /** For DTSTAMP; the file is the same for the same plan otherwise. */
  now?: Date;
}

/** The .ics file's text. An early plan with open dates has nothing to put in a calendar: undefined. */
export function tripCalendar(trip: Trip, timelines: DayTimeline[], { lang = "en", now = new Date() }: CalendarOptions = {}): string | undefined {
  if (!trip.startDate) return undefined;
  const t = translator(lang);
  const stamp = utcStamp(now);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//TripDeck//Trip plan//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsText(trip.name)}`,
  ];
  const event = (uid: string, props: string[]) =>
    lines.push("BEGIN:VEVENT", `UID:${uid}@tripdeck`, `DTSTAMP:${stamp}`, ...props, "END:VEVENT");

  let zone = homeTimeZone(trip);
  timelines.forEach((tl, d) => {
    const date = isoDate(dayDate(trip.startDate!, d));
    for (const e of tl.entries) {
      const item = trip.items[e.itemId];
      if (!item) continue;
      const desc = description(item, t);
      const where = item.location?.address;
      const common = [
        `SUMMARY:${icsText(`${itemIcon(item)} ${item.title}`)}`,
        ...(where ? [`LOCATION:${icsText(where)}`] : []),
        ...(desc ? [`DESCRIPTION:${icsText(desc)}`] : []),
        ...(item.booking?.url && /^https?:\/\//.test(item.booking.url) ? [`URL:${item.booking.url}`] : []),
      ];

      if (item.type === "stay" || item.type === "rental") {
        // All day, over the nights (a stay) or the days until it goes back (a rental).
        const span = item.type === "stay" ? Math.max(1, item.stay?.nights ?? 1) : Math.max(1, item.rental?.days ?? 1) + 1;
        event(`${item.id}-${d}`, [
          `DTSTART;VALUE=DATE:${date.replace(/-/g, "")}`,
          `DTEND;VALUE=DATE:${isoDate(dayDate(date, span)).replace(/-/g, "")}`,
          "TRANSP:TRANSPARENT",
          ...common,
        ]);
        continue;
      }

      if (item.type === "transport") {
        const from = item.location?.timeZone ?? zone;
        const to = item.transport?.toLocation?.timeZone ?? from;
        const alarms =
          item.transport?.kind === "flight" && e.fixed
            ? [
                "BEGIN:VALARM",
                "ACTION:DISPLAY",
                `DESCRIPTION:${icsText(t("ics.checkin", { title: item.title }))}`,
                "TRIGGER:-P1D",
                "END:VALARM",
              ]
            : [];
        event(`${item.id}-${d}`, [
          timeProp("DTSTART", date, e.start, from ?? undefined),
          timeProp("DTEND", date, e.end, to ?? undefined),
          ...common,
          ...alarms,
        ]);
        // From here on the traveller is where it arrives.
        zone = to ?? zone;
        continue;
      }

      event(`${item.id}-${d}`, [timeProp("DTSTART", date, e.start, zone), timeProp("DTEND", date, Math.max(e.end, e.start + 15), zone), ...common]);
    }
  });

  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
