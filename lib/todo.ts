import { nightsOf } from "./stays";
import type { BookingStatus, Item, Trip } from "./types";

/** Something to sort out before the trip: a booking still to make or confirm, or a night without a bed. */
export type Todo =
  | { kind: "booking"; item: Item; status: Exclude<BookingStatus, "confirmed">; dayIndex?: number }
  | { kind: "night"; dayIndex: number };

/** In trip order: bookings to make or confirm (Ideas last), and nights with nowhere to sleep. */
export function tripTodos(trip: Trip): Todo[] {
  const out: Todo[] = [];
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

export function todoLabel(todo: Todo): string {
  if (todo.kind === "night") return `Night after day ${todo.dayIndex + 1}: nowhere to sleep yet`;
  const where = todo.dayIndex === undefined ? "Ideas" : `day ${todo.dayIndex + 1}`;
  return `${todo.item.title} (${where}): ${todo.status === "todo" ? "to book" : "waiting for confirmation"}`;
}
