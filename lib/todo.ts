import { entryActions } from "./entry";
import { translator, type Lang } from "./i18n";
import { nightsOf } from "./stays";
import type { BookingStatus, EntryCountry, EntryRequirement, Item, Trip } from "./types";

/**
 * Something to sort out before the trip: a visa or form to apply for, a booking still to make or
 * confirm, or a night without a bed.
 */
export type Todo =
  | { kind: "entry"; country: EntryCountry; requirement: EntryRequirement }
  | { kind: "booking"; item: Item; status: Exclude<BookingStatus, "confirmed">; dayIndex?: number }
  | { kind: "night"; dayIndex: number };

/**
 * Entry formalities first (earliest deadline first), then in trip order: bookings to make or confirm
 * (Ideas last), and nights with nowhere to sleep.
 */
export function tripTodos(trip: Trip): Todo[] {
  const out: Todo[] = entryActions(trip).map((a) => ({ kind: "entry", ...a }));
  const nights = nightsOf(trip);
  const booking = (id: string, dayIndex?: number) => {
    const item = trip.items[id];
    const status = item?.booking?.status;
    if (item && (status === "pending" || status === "todo")) out.push({ kind: "booking", item, status, dayIndex });
  };
  trip.days.forEach((day, i) => {
    day.itemIds.forEach((id) => booking(id, i));
    if (nights[i]?.kind === "none") out.push({ kind: "night", dayIndex: i });
  });
  trip.ideas.forEach((id) => booking(id));
  return out;
}

export function todoLabel(todo: Todo, lang: Lang = "en"): string {
  const t = translator(lang);
  if (todo.kind === "entry") {
    const { country, requirement: r } = todo;
    const params = { country: country.name, title: r.title };
    return r.dueBy ? t("todo.entryBy", { ...params, date: r.dueBy }) : t("todo.entry", params);
  }
  if (todo.kind === "night") return t("todo.night", { day: todo.dayIndex + 1 });
  const where = todo.dayIndex === undefined ? t("todo.ideas") : t("todo.day", { day: todo.dayIndex + 1 });
  return t(todo.status === "todo" ? "todo.toBook" : "todo.pending", { title: todo.item.title, where });
}
