import { computeClockNotes } from "./clock";
import { computeDiveWarnings } from "./diveSafety";
import { entryState } from "./entry";
import { tripBudget } from "./money";
import { nightsOf } from "./stays";
import type { DayTimeline } from "./timeline";
import { getLeg } from "./timeline";
import { missingReference } from "./todo";
import { MODE_LABEL, type BookingStatus, type Item, type Trip } from "./types";

/**
 * A check of the whole plan in one go, for Claude (MCP audit_trip) to go through with the traveller:
 * what contradicts itself, what is missing, and what is only estimated. Each finding names its card
 * and, where there is one, the fix.
 *
 * fix: something is wrong or missing and has a clear fix · check: worth a look, it may be right ·
 * info: good to know.
 */
export type AuditLevel = "fix" | "check" | "info";

export interface Finding {
  level: AuditLevel;
  kind:
    | "status-vs-notes"
    | "no-reference"
    | "estimated-leg"
    | "no-arrival"
    | "no-location"
    | "no-currency"
    | "timing"
    | "dive"
    | "clock"
    | "night"
    | "entry";
  message: string;
  itemId?: string;
  dayIndex?: number;
  /** What would fix it, in terms of the MCP tools. */
  fix?: string;
}

/** Notes that say the booking is still open, in English, Polish and Spanish. */
const NOT_BOOKED = /\b(not (yet )?booked|still to book|to be booked|book (it|them|tickets)|buy tickets)\b|niezarezerw|do zarezerwowania|sin reservar|por reservar/i;
// Not "unconfirmed" or "niepotwierdzone" alone: notes use them for a price or an opening time too.
const NOT_CONFIRMED = /\b(not (yet )?confirmed|awaiting confirmation|waiting for confirmation)\b|jeszcze niepotwierdz|czeka na potwierdzenie|sin confirmar|pendiente de confirmaci/i;
/** …unless they say it is sorted now. */
const DONE = /\b(now confirmed|confirmed on|booked on|paid on)\b|potwierdzon[eya] \d/i;

/** What the notes say about the booking, if anything. */
export function statusFromNotes(notes: string | undefined): Exclude<BookingStatus, "confirmed"> | undefined {
  if (!notes || DONE.test(notes)) return undefined;
  if (NOT_BOOKED.test(notes)) return "todo";
  if (NOT_CONFIRMED.test(notes)) return "pending";
  return undefined;
}

export function auditTrip(trip: Trip, timelines: DayTimeline[]): Finding[] {
  const out: Finding[] = [];
  const where = (d?: number) => (d === undefined ? "Ideas" : `day ${d + 1}`);
  const name = (item: Item) => `"${item.title}" [${item.id}]`;
  const located = new Map<string, number | undefined>();
  trip.days.forEach((day, d) => day.itemIds.forEach((id) => located.set(id, d)));
  trip.ideas.forEach((id) => located.set(id, undefined));

  // Notes and booking status that disagree.
  for (const [id, d] of located) {
    const item = trip.items[id];
    if (!item) continue;
    const said = statusFromNotes(item.notes);
    const status = item.booking?.status;
    if (said && status !== said && !(said === "pending" && status === "todo")) {
      out.push({
        level: "fix",
        kind: "status-vs-notes",
        message: `${name(item)} (${where(d)}): the notes say ${said === "todo" ? "it is not booked yet" : "it is not confirmed yet"}, but its status is ${status ?? "not set"}.`,
        itemId: id,
        dayIndex: d,
        fix: `update_item booking.status "${said}" – or, if it is sorted now, update the notes`,
      });
    }
    if (d !== undefined && missingReference(item)) {
      out.push({
        level: "check",
        kind: "no-reference",
        message: `${name(item)} (${where(d)}) is booked${item.booking?.provider ? ` with ${item.booking.provider}` : ""} but has no booking number.`,
        itemId: id,
        dayIndex: d,
        fix: "find it in the confirmation (mail, app) and update_item booking.reference – never guess it",
      });
    }
    if (d !== undefined && !item.location) {
      out.push({
        level: "fix",
        kind: "no-location",
        message: `${name(item)} (${where(d)}) has no location: no route to it, no pin on the map.`,
        itemId: id,
        dayIndex: d,
        fix: "update_item place_query",
      });
    }
    if (item.type === "transport" && item.transport && item.transport.kind !== "car_rental" && !item.transport.toLocation) {
      out.push({
        level: "fix",
        kind: "no-arrival",
        message: `${name(item)} (${where(d)}) has no arrival place: the next leg starts from where it departs.`,
        itemId: id,
        dayIndex: d,
        fix: "update_item transport.to_place_query (keep kind, from, to and number)",
      });
    }
  }

  // Travel times that are only straight-line estimates, and the timeline's own warnings.
  timelines.forEach((tl, d) => {
    for (const e of tl.entries) {
      const item = trip.items[e.itemId];
      if (!item) continue;
      if (e.fromId && e.legEstimated && (e.legMin ?? 0) >= 1) {
        const from = trip.items[e.fromId];
        const leg = getLeg(trip, e.fromId, e.itemId);
        out.push({
          level: "check",
          kind: "estimated-leg",
          message: `Day ${d + 1}: ${from?.title ?? e.fromId} → ${item.title} by ${MODE_LABEL[leg.mode]} is only estimated (~${Math.round(e.legMin!)} min) – no route was found${leg.mode === "TRANSIT" ? " by public transport" : ""}.`,
          itemId: item.id,
          dayIndex: d,
          fix:
            leg.mode === "TRANSIT"
              ? `set_leg ${e.fromId} → ${item.id} DRIVE (taxi), or check the bus or colectivo and keep it`
              : "open the board so it fetches the route, or set_leg another mode",
        });
      }
      for (const issue of e.issues) {
        if (issue.level === "warn") out.push({ level: "check", kind: "timing", message: `Day ${d + 1}, ${name(item)}: ${issue.message}`, itemId: item.id, dayIndex: d });
      }
    }
  });

  for (const [kind, map] of [
    ["dive", computeDiveWarnings(trip, timelines)],
    ["clock", computeClockNotes(trip, timelines)],
  ] as const) {
    for (const [id, issues] of map) {
      const item = trip.items[id];
      for (const issue of issues) {
        if (issue.level !== "warn") continue;
        out.push({ level: "check", kind, message: `${item ? name(item) : id} (${where(located.get(id))}): ${issue.message}`, itemId: id, dayIndex: located.get(id) });
      }
    }
  }

  for (const { item, dayIndex, text } of tripBudget(trip).noCurrency) {
    out.push({
      level: "fix",
      kind: "no-currency",
      message: `${name(item)}: the price "${text}" has no currency, so the budget leaves it out.`,
      itemId: item.id,
      dayIndex,
      fix: 'update_item booking.price with the currency, e.g. "1 500 THB"',
    });
  }

  if (trip.startDate) {
    nightsOf(trip).forEach((n, d) => {
      if (n?.kind === "none") out.push({ level: "fix", kind: "night", message: `Night after day ${d + 1}: nowhere to sleep yet.`, dayIndex: d, fix: "add a stay (add_item type stay, stay_nights)" });
    });
  }

  const entry = entryState(trip);
  if (entry.kind === "none" && trip.startDate) {
    out.push({ level: "info", kind: "entry", message: "Entry rules (visas, arrival forms) not checked yet.", fix: "research them and save_entry_check" });
  }
  if (entry.kind === "stale") {
    out.push({ level: "check", kind: "entry", message: `Entry rules out of date: ${entry.reasons.join(" and ")}.`, fix: "research them again and save_entry_check" });
  }

  const order: Record<AuditLevel, number> = { fix: 0, check: 1, info: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level] || (a.dayIndex ?? 999) - (b.dayIndex ?? 999));
}
