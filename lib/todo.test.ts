import { describe, expect, it } from "vitest";
import { tripWith } from "./testUtils";
import { todoLabel, tripTodos } from "./todo";
import type { Item } from "./types";

const card = (id: string, status?: "confirmed" | "pending" | "todo"): Item => ({
  id,
  type: "activity",
  title: id,
  booking: status ? { status } : undefined,
});
const stay = (id: string, nights: number): Item => ({ id, type: "stay", title: id, stay: { nights } });

describe("tripTodos", () => {
  it("lists bookings to make or confirm and nights without a bed, in trip order", () => {
    const trip = tripWith([[stay("hotel", 1), card("dives", "pending")], [card("ferry", "todo")], [card("museum", "confirmed")]]);
    trip.items.boat = card("boat", "todo");
    trip.ideas.push("boat");
    expect(tripTodos(trip).map(todoLabel)).toEqual([
      "dives (day 1): waiting for confirmation",
      "ferry (day 2): to book",
      "Night after day 2: nowhere to sleep yet",
      "boat (Ideas): to book",
    ]);
  });

  it("has nothing to do for a booked-up trip", () => {
    expect(tripTodos(tripWith([[stay("hotel", 1), card("dives", "confirmed")], [card("museum")]]))).toEqual([]);
  });
});
