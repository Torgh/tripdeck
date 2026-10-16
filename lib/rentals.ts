import { dayDate, formatDayLabel } from "./time";
import type { Item, Trip } from "./types";

/** A rental on one day of the trip: picked up, in use, or going back. */
export interface RentalDay {
  rental: Item;
  phase: "pickup" | "during" | "return";
  /** Days of the rental (24 h periods), at least 1. */
  days: number;
  /** "Sat 23 Jan" – the day it goes back. */
  returnLabel: string;
}

/** For each day, the rentals you have on it, in pick-up order. A rental from Ideas has no dates. */
export function rentalsOf(trip: Trip): RentalDay[][] {
  const out: RentalDay[][] = trip.days.map(() => []);
  trip.days.forEach((day, start) => {
    for (const id of day.itemIds) {
      const rental = trip.items[id];
      if (rental?.type !== "rental") continue;
      const days = Math.max(1, rental.rental?.days ?? 1);
      const returnLabel = formatDayLabel(dayDate(trip.startDate, start + days));
      for (let i = start; i <= start + days && i < trip.days.length; i++) {
        out[i].push({ rental, days, returnLabel, phase: i === start ? "pickup" : i === start + days ? "return" : "during" });
      }
    }
  });
  return out;
}

/** "9 days · back Sat 23 Jan 18:00" for a rental picked up on day `dayIndex`; empty in Ideas. */
export function rentalSummary(trip: Trip, rental: Item, dayIndex: number): string {
  const days = Math.max(1, rental.rental?.days ?? 1);
  const length = `${days} day${days > 1 ? "s" : ""}`;
  if (dayIndex < 0) return length;
  const back = formatDayLabel(dayDate(trip.startDate, dayIndex + days));
  return `${length} · back ${back}${rental.rental?.returnTime ? ` ${rental.rental.returnTime}` : ""}`;
}
