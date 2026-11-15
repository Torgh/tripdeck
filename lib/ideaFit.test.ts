import { describe, expect, it } from "vitest";
import { ideasForFreeDays, isFreeDay } from "./ideaFit";
import { tripWith } from "./testUtils";
import { computeTripTimeline } from "./timeline";
import type { Item } from "./types";

// Cancún downtown and spots around it; Tulum is ~120 km away.
const at = (id: string, type: Item["type"], lat: number, lng: number, extra: Partial<Item> = {}): Item => ({
  id,
  type,
  title: id,
  location: { lat, lng },
  ...extra,
});
const hotel = at("hotel", "stay", 21.162, -86.823, { stay: { nights: 3 } });
const tour = at("tour", "activity", 21.162, -86.823, { startTime: "08:00", durationMin: 720 });
const museo = at("museo", "place", 21.0738, -86.7771);
const market = at("market", "food", 21.1612, -86.8334);
const tulum = at("tulum", "place", 20.2124, -87.4538);
const ferry = at("ferry", "transport", 21.18, -86.8);

function withIdeas(days: Item[][], ideas: Item[]) {
  const trip = tripWith(days);
  for (const i of ideas) {
    trip.items[i.id] = i;
    trip.ideas.push(i.id);
  }
  return trip;
}

describe("ideasForFreeDays", () => {
  it("suggests the ideas near a free day, nearest first, and none for a full day or far away", () => {
    const trip = withIdeas([[hotel], [], [tour]], [museo, market, tulum, ferry]);
    const free = ideasForFreeDays(trip, computeTripTimeline(trip));
    // Day 1 (check-in) and day 2 (empty) are spent in Cancún; day 3 is a 12-hour tour.
    expect(free.map((f) => f.dayIndex)).toEqual([0, 1]);
    expect(free[1].ideas.map((n) => n.item.id)).toEqual(["market", "museo"]);
    expect(free[1].ideas[1].km).toBeGreaterThan(10);
  });

  it("counts a morning-only plan as time to spare, and needs located ideas", () => {
    const trip = withIdeas([[at("walk", "place", 21.16, -86.82, { startTime: "09:00", durationMin: 120 })]], [market]);
    const [tl] = computeTripTimeline(trip);
    expect(isFreeDay(trip, tl)).toBe(true);
    expect(ideasForFreeDays(trip, [tl])).toHaveLength(1);
    expect(ideasForFreeDays(withIdeas([[hotel]], [{ ...market, location: undefined }]), computeTripTimeline(trip))).toEqual([]);
  });
});
