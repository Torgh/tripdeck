import { describe, expect, it } from "vitest";
import { tripWith } from "./testUtils";
import {
  addItem,
  containerOfItem,
  createTrip,
  moveDay,
  moveItem,
  removeItem,
  reorderDay,
  setDayCount,
  touch,
} from "./tripOps";
import { IDEAS, legKey, type Item } from "./types";

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

describe("createTrip", () => {
  it("starts with empty days, no cards and sensible defaults", () => {
    const trip = createTrip({ name: "Malta", destination: "Malta", startDate: "2026-06-01", days: 3 });
    expect(trip.days.map((d) => d.itemIds)).toEqual([[], [], []]);
    expect(trip.days.every((d) => d.startTime === "09:00")).toBe(true);
    expect(trip).toMatchObject({ ideas: [], items: {}, legs: {}, interests: "", defaultMode: "DRIVE" });
    expect(new Set(trip.days.map((d) => d.id)).size).toBe(3);
  });

  it("keeps at least one day", () => {
    expect(createTrip({ name: "x", destination: "x", startDate: "2026-06-01", days: 0 }).days).toHaveLength(1);
  });
});

describe("addItem", () => {
  it("adds at the end, or at a clamped position", () => {
    const trip = tripWith([[card("a"), card("b")]]);
    const day = trip.days[0].id;
    expect(addItem(trip, card("c"), day).days[0].itemIds).toEqual(["a", "b", "c"]);
    expect(addItem(trip, card("c"), day, 0).days[0].itemIds).toEqual(["c", "a", "b"]);
    expect(addItem(trip, card("c"), day, 99).days[0].itemIds).toEqual(["a", "b", "c"]);
    expect(addItem(trip, card("c"), day, 1).items.c).toEqual(card("c"));
  });

  it("puts the card in Ideas when the container is unknown", () => {
    const next = addItem(tripWith([[]]), card("x"), "no-such-day");
    expect(next.ideas).toEqual(["x"]);
    expect(containerOfItem(next, "x")).toBe(IDEAS);
  });

  it("does not change the original trip", () => {
    const trip = tripWith([[card("a")]]);
    const before = structuredClone(trip);
    addItem(trip, card("b"), trip.days[0].id);
    expect(trip).toEqual(before);
  });
});

describe("moveItem", () => {
  it("moves a card between days and to Ideas, keeping it exactly once", () => {
    const trip = tripWith([[card("a"), card("b")], [card("c")]]);
    const [d1, d2] = trip.days.map((d) => d.id);
    const moved = moveItem(trip, "a", d2, 0);
    expect(moved.days.map((d) => d.itemIds)).toEqual([["b"], ["a", "c"]]);
    expect(containerOfItem(moved, "a")).toBe(d2);

    const toIdeas = moveItem(moved, "c", IDEAS);
    expect(toIdeas.ideas).toEqual(["c"]);
    expect(toIdeas.days.map((d) => d.itemIds)).toEqual([["b"], ["a"]]);
    expect(moveItem(toIdeas, "c", d1, 1).days[0].itemIds).toEqual(["b", "c"]);
  });

  it("reorders within the same day", () => {
    const trip = tripWith([[card("a"), card("b"), card("c")]]);
    expect(moveItem(trip, "c", trip.days[0].id, 0).days[0].itemIds).toEqual(["c", "a", "b"]);
  });
});

describe("removeItem", () => {
  it("removes the card and every leg that touches it", () => {
    const trip = tripWith([[card("a"), card("b"), card("c")]]);
    trip.legs = {
      [legKey("a", "b")]: { mode: "WALK" },
      [legKey("b", "c")]: { mode: "DRIVE" },
      [legKey("a", "c")]: { mode: "BICYCLE" },
    };
    const next = removeItem(trip, "b");
    expect(next.days[0].itemIds).toEqual(["a", "c"]);
    expect(next.items.b).toBeUndefined();
    expect(Object.keys(next.legs)).toEqual([legKey("a", "c")]);
  });
});

describe("moveDay", () => {
  it("moves a whole day with its cards", () => {
    const trip = tripWith([[card("a")], [card("b")], [card("c")]]);
    expect(moveDay(trip, 2, 0).days.map((d) => d.itemIds)).toEqual([["c"], ["a"], ["b"]]);
  });
});

describe("reorderDay", () => {
  const trip = tripWith([[card("a"), card("b"), card("c")]]);
  const day = trip.days[0].id;

  it("applies a permutation of the day's cards", () => {
    expect(reorderDay(trip, day, ["c", "a", "b"]).days[0].itemIds).toEqual(["c", "a", "b"]);
  });

  it.each([
    ["a missing card", ["a", "b"]],
    ["a duplicate", ["a", "a", "b"]],
    ["a card from elsewhere", ["a", "b", "x"]],
  ])("rejects %s", (_, ids) => {
    expect(() => reorderDay(trip, day, ids)).toThrow(/exactly once/);
  });

  it("rejects an unknown day", () => {
    expect(() => reorderDay(trip, "nope", [])).toThrow(/Unknown day/);
  });
});

describe("touch", () => {
  it("bumps updatedAt so sync sees the change", () => {
    const trip = { ...tripWith([[]]), updatedAt: "2000-01-01T00:00:00.000Z" };
    expect(touch(trip).updatedAt > trip.updatedAt).toBe(true);
  });
});
