import { createTrip } from "./store";
import type { Item, Trip } from "./types";

/** Builds a trip starting 2026-06-01 (a Monday) with the given items per day. */
export function tripWith(days: Item[][]): Trip {
  const trip = createTrip({ name: "t", destination: "x", startDate: "2026-06-01", days: days.length });
  days.forEach((items, d) => {
    for (const it of items) {
      trip.items[it.id] = it;
      trip.days[d].itemIds.push(it.id);
    }
  });
  return trip;
}
