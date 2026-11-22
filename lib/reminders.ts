import { entryActions } from "./entry";
import { translator, type Lang } from "./i18n";
import { formatMoney, parsePrice } from "./money";
import { dayDate, formatDayLabel, formatHm, isoDate, parseHm, zonedTimeToUtc } from "./time";
import type { DayTimeline } from "./timeline";
import { itemIcon, type Item, type Trip } from "./types";

/**
 * A reminder for the traveller's phone: online check-in, tomorrow's early start, a rental to take back,
 * a formality or a booking still to sort out. Worked out from the plan whenever it changes; `key` stays
 * the same for the same reminder, so a newer import replaces it rather than adding another.
 */
export interface Reminder {
  key: string;
  kind: ReminderKind;
  at: Date;
  title: string;
  body: string;
  itemId?: string;
  dayIndex?: number;
}

export type ReminderKind = "checkin" | "tomorrow" | "return" | "entry" | "booking";

/** Online check-in usually opens 24 h before a flight (some airlines 23 h, some 48 h). */
export const CHECKIN_BEFORE_MIN = 24 * 60;
/** The evening before a day with fixed times. */
export const EVENING = "19:00";
/** Formalities: this many days before their deadline. */
export const ENTRY_DAYS_BEFORE = 3;
/** Bookings still to make or confirm: this many days before their day. */
export const BOOKING_DAYS_BEFORE = 7;
/** A rental: this long before it has to be back. */
export const RETURN_BEFORE_MIN = 120;

/**
 * Wall-clock time on a date, as an instant: in `timeZone` when known (a flight's departure airport),
 * otherwise in the device's own zone – during the trip that is where the traveller is.
 */
export function wallTime(date: string, minutes: number, timeZone?: string | null): Date {
  const day = Math.floor(minutes / 1440);
  const d = isoDate(dayDate(date, day));
  const hm = formatHm(minutes - day * 1440);
  if (timeZone) return zonedTimeToUtc(d, hm, timeZone);
  const [y, m, dd] = d.split("-").map(Number);
  return new Date(y, m - 1, dd, 0, parseHm(hm)!);
}

const shift = (date: string, days: number) => isoDate(dayDate(date, days));

/** Cash only taken on site that day, by currency: "600 MXN". */
function cashFor(items: Item[]): string[] {
  const sums = new Map<string, number>();
  for (const i of items) {
    if (!i.booking?.cash || !i.booking.onSite) continue;
    const p = parsePrice(i.booking.onSite);
    if (p?.currency) sums.set(p.currency, (sums.get(p.currency) ?? 0) + p.amount);
  }
  return [...sums].map(([currency, amount]) => formatMoney(amount, currency));
}

/** Every reminder of a dated trip after `now`, soonest first. An early plan with open dates has none. */
export function tripReminders(trip: Trip, timelines: DayTimeline[], lang: Lang = "en", now = new Date()): Reminder[] {
  if (!trip.startDate) return [];
  const t = translator(lang);
  const start = trip.startDate;
  const out: Reminder[] = [];
  const dateOf = (i: number) => shift(start, i);
  const dayTitle = (i: number) => `${t("common.day", { day: i + 1 })} · ${formatDayLabel(dayDate(start, i), lang)}`;

  timelines.forEach((tl, d) => {
    const items = tl.entries.map((e) => ({ e, item: trip.items[e.itemId] })).filter((x) => x.item);

    // Online check-in for each flight with a fixed departure.
    for (const { e, item } of items) {
      if (item.transport?.kind !== "flight" || !e.fixed) continue;
      const leaves = wallTime(dateOf(d), e.start, item.location?.timeZone);
      out.push({
        key: `checkin:${item.id}`,
        kind: "checkin",
        at: new Date(leaves.getTime() - CHECKIN_BEFORE_MIN * 60_000),
        title: t("reminders.checkinTitle", { title: item.title }),
        body: [
          t("reminders.checkinBody", { time: formatHm(e.start) }),
          item.booking?.reference && t("reminders.reference", { reference: item.booking.reference }),
        ]
          .filter(Boolean)
          .join(" · "),
        itemId: item.id,
        dayIndex: d,
      });
    }

    // The evening before: the day's fixed times (pick-ups, dives, ferries) and the cash it needs.
    const fixed = items.filter(({ e, item }) => e.fixed && item.type !== "stay");
    const cash = cashFor(items.map((x) => x.item));
    if (fixed.length || cash.length) {
      const first = fixed.slice(0, 3).map(({ e, item }) => `${formatHm(e.start)} ${itemIcon(item)} ${item.title}`);
      out.push({
        key: `tomorrow:${tl.dayId}`,
        kind: "tomorrow",
        at: wallTime(dateOf(d - 1), parseHm(EVENING)!),
        title: t("reminders.tomorrowTitle", { day: dayTitle(d) }),
        body: [
          ...first,
          fixed.length > 3 && t("reminders.more", { n: fixed.length - 3 }),
          cash.length > 0 && `💵 ${t("reminders.cash", { amount: cash.join(" + ") })}`,
        ]
          .filter(Boolean)
          .join("\n"),
        dayIndex: d,
      });
    }

    // Bookings still to make or confirm, a week before their day.
    for (const id of trip.days[d]?.itemIds ?? []) {
      const item = trip.items[id];
      const status = item?.booking?.status;
      if (!item || (status !== "todo" && status !== "pending")) continue;
      out.push({
        key: `booking:${item.id}`,
        kind: "booking",
        at: wallTime(dateOf(d - BOOKING_DAYS_BEFORE), 10 * 60),
        title: t(status === "todo" ? "reminders.toBookTitle" : "reminders.pendingTitle", { title: item.title }),
        body: dayTitle(d),
        itemId: item.id,
        dayIndex: d,
      });
    }
  });

  // Rentals: a while before they have to go back.
  trip.days.forEach((day, d) => {
    for (const id of day.itemIds) {
      const item = trip.items[id];
      const r = item?.rental;
      if (!item || item.type !== "rental" || !r) continue;
      const back = parseHm(r.returnTime);
      const returnDay = d + r.days;
      out.push({
        key: `return:${item.id}`,
        kind: "return",
        at: wallTime(dateOf(returnDay), back !== undefined ? Math.max(0, back - RETURN_BEFORE_MIN) : 9 * 60),
        title: t("reminders.returnTitle", { icon: itemIcon(item), title: item.title }),
        body: [
          back !== undefined ? t("reminders.returnBy", { time: r.returnTime! }) : t("reminders.returnToday"),
          r.returnPlace,
        ]
          .filter(Boolean)
          .join(" · "),
        itemId: item.id,
        dayIndex: returnDay,
      });
    }
  });

  // Formalities with a deadline, a few days before it.
  for (const { country, requirement: r } of entryActions(trip)) {
    if (!r.dueBy) continue;
    out.push({
      key: `entry:${country.code}:${r.title}`,
      kind: "entry",
      at: wallTime(shift(r.dueBy, -ENTRY_DAYS_BEFORE), 10 * 60),
      title: `🛂 ${r.title}`,
      body: t("reminders.entryBody", { country: country.name, date: formatDayLabel(dayDate(r.dueBy, 0), lang) }),
    });
  }

  return out.filter((r) => r.at > now).sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** A notification id for Android: a positive 31-bit number, the same for the same trip and reminder. */
export function reminderNumber(tripId: string, key: string): number {
  let h = 2166136261;
  for (const ch of `${tripId}|${key}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 1) || 1;
}
