import { describe, expect, it } from "vitest";
import { tripWith } from "./testUtils";
import { setDayCount } from "./tripOps";
import type { Item } from "./types";

const card = (id: string) => ({ id, title: id, type: "place" }) as unknown as Item;

describe("setDayCount", () => {
  it("adds empty days at the end", () => {
    const trip = tripWith([[card("a")], []]);
    const next = setDayCount(trip, 4);
    expect(next.days).toHaveLength(4);
    expect(next.days.slice(0, 2)).toEqual(trip.days);
    expect(next.days[3].itemIds).toEqual([]);
  });

  it("removes days from the end and moves their cards to Ideas", () => {
    const trip = tripWith([[card("a")], [card("b")], [card("c"), card("d")]]);
    const next = setDayCount(trip, 1);
    expect(next.days).toEqual([trip.days[0]]);
    expect(next.ideas).toEqual(["b", "c", "d"]);
    expect(Object.keys(next.items)).toHaveLength(4);
  });

  it("keeps at least one day", () => {
    expect(setDayCount(tripWith([[], []]), 0).days).toHaveLength(1);
  });
});
