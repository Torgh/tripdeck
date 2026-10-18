import { describe, expect, it } from "vitest";
import { equal, mergeTrips } from "./merge";
import type { Item, Trip } from "./types";

const card = (id: string, extra: Partial<Item> = {}): Item => ({ id, type: "place", title: id, ...extra });

/** Day 1 holds a and b, day 2 holds c, Ideas hold i. */
function base(): Trip {
  return {
    id: "t",
    name: "Mexico",
    destination: "Mexico",
    startDate: "2027-02-13",
    interests: "",
    defaultMode: "TRANSIT",
    days: [
      { id: "d1", itemIds: ["a", "b"], startTime: "09:00" },
      { id: "d2", itemIds: ["c"], startTime: "09:00" },
    ],
    ideas: ["i"],
    items: { a: card("a"), b: card("b"), c: card("c"), i: card("i") },
    legs: {},
    updatedAt: "2026-10-18T10:00:00.000Z",
  };
}

const clone = (t: Trip): Trip => structuredClone(t);

describe("mergeTrips", () => {
  it("keeps a card Claude added while the board computed a route (the lost-update bug)", () => {
    const b = base();
    const local = clone(b);
    local.legs["a>b"] = { mode: "TRANSIT", result: { key: "k", durationSec: 600, distanceM: 3000 } };
    local.updatedAt = "2026-10-18T10:00:05.000Z";
    const remote = clone(b);
    remote.items.e = card("e", { title: "Evening in Roma" });
    remote.days[0].itemIds.push("e");
    remote.days[1].startTime = "10:00";
    remote.updatedAt = "2026-10-18T10:00:02.000Z";

    const merged = mergeTrips(b, local, remote);
    expect(merged.days[0].itemIds).toEqual(["a", "b", "e"]);
    expect(merged.items.e.title).toBe("Evening in Roma");
    expect(merged.days[1].startTime).toBe("10:00");
    expect(merged.legs["a>b"].result?.durationSec).toBe(600);
  });

  it("merges edits to different fields of the same card", () => {
    const b = base();
    const local = clone(b);
    local.items.a = { ...local.items.a, notes: "bring cash" };
    const remote = clone(b);
    remote.items.a = { ...remote.items.a, durationMin: 320 };
    expect(mergeTrips(b, local, remote).items.a).toMatchObject({ notes: "bring cash", durationMin: 320 });
  });

  it("lets this browser win when both sides changed the same field", () => {
    const b = base();
    const local = clone(b);
    local.items.a.title = "mine";
    const remote = clone(b);
    remote.items.a.title = "theirs";
    expect(mergeTrips(b, local, remote).items.a.title).toBe("mine");
  });

  it("applies deletions from either side, but keeps a card edited on the other", () => {
    const b = base();
    const local = clone(b);
    delete local.items.b;
    local.days[0].itemIds = ["a"];
    delete local.items.c;
    local.days[1].itemIds = [];
    const remote = clone(b);
    remote.items.c.notes = "edited by Claude";

    const merged = mergeTrips(b, local, remote);
    expect(merged.items.b).toBeUndefined();
    expect(merged.days[0].itemIds).toEqual(["a"]);
    expect(merged.items.c.notes).toBe("edited by Claude");
    expect(merged.days[1].itemIds).toEqual(["c"]);
  });

  it("moves a card where it was moved, and keeps the other side's reordering", () => {
    const b = base();
    const local = clone(b);
    local.days[0].itemIds = ["a"];
    local.days[1].itemIds = ["c", "b"]; // dragged b to day 2
    const remote = clone(b);
    remote.items.x = card("x");
    remote.days[0].itemIds = ["x", "b", "a"]; // Claude added x and reordered day 1

    const merged = mergeTrips(b, local, remote);
    expect(merged.days[0].itemIds).toEqual(["x", "a"]);
    expect(merged.days[1].itemIds).toEqual(["c", "b"]);
  });

  it("puts every card in exactly one place", () => {
    const b = base();
    const local = clone(b);
    local.days[0].itemIds = ["a"];
    local.ideas = ["i", "b"];
    const remote = clone(b);
    remote.days[0].itemIds = ["a"];
    remote.days[1].itemIds = ["c", "b"];

    const merged = mergeTrips(b, local, remote);
    const all = [...merged.ideas, ...merged.days.flatMap((d) => d.itemIds)];
    expect(all.sort()).toEqual(["a", "b", "c", "i"]);
  });

  it("merges trip settings and added days", () => {
    const b = base();
    const local = clone(b);
    local.name = "Mexico 2027";
    const remote = clone(b);
    remote.days.push({ id: "d3", itemIds: [], startTime: "08:00" });
    remote.interests = "diving";

    const merged = mergeTrips(b, local, remote);
    expect(merged).toMatchObject({ name: "Mexico 2027", interests: "diving" });
    expect(merged.days.map((d) => d.id)).toEqual(["d1", "d2", "d3"]);
  });
});

describe("equal", () => {
  it("ignores key order and compares arrays in order", () => {
    expect(equal({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(true);
    expect(equal([1, 2], [2, 1])).toBe(false);
    expect(equal({ a: undefined }, {})).toBe(true);
  });
});
