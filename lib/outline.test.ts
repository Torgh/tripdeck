import { describe, expect, it } from "vitest";
import { mergeTrips } from "./merge";
import { applyOutline, ideasByStop, outlineDayStops, outlineDays, outlineFit, outlineLine, outlineStop, setOutline } from "./outline";
import { createTrip } from "./tripOps";
import type { Item, Trip } from "./types";

const hanoi = { lat: 21.03, lng: 105.85 };
const hoiAn = { lat: 15.88, lng: 108.33 };

function plan(): Trip {
  return {
    ...createTrip({ name: "Vietnam", destination: "Vietnam", timing: "Feb 2028, ~2 weeks" }),
    outline: [outlineStop("Hanoi", 3, hanoi), outlineStop("Ha Long Bay", 2), outlineStop("Hoi An", 4, hoiAn)],
  };
}

describe("outline", () => {
  it("adds up the days and writes the route", () => {
    const t = plan();
    expect(outlineDays(t.outline)).toBe(9);
    expect(outlineLine(t.outline)).toBe("Hanoi 3 → Ha Long Bay 2 → Hoi An 4");
    expect(outlineDayStops(t.outline)).toEqual([0, 0, 0, 1, 1, 2, 2, 2, 2]);
  });

  it("rounds a stop to at least one day", () => {
    expect(outlineStop("  Hue ", 0).days).toBe(1);
    expect(outlineStop("Hue", 2.6)).toMatchObject({ name: "Hue", days: 3 });
  });

  it("makes the days and labels them", () => {
    const t = applyOutline(plan());
    expect(t.days).toHaveLength(9);
    expect(t.days.map((d) => d.label)).toEqual([
      "Hanoi", "Hanoi", "Hanoi", "Ha Long Bay", "Ha Long Bay", "Hoi An", "Hoi An", "Hoi An", "Hoi An",
    ]);
  });

  it("never removes days and clears only the labels it set", () => {
    const t = applyOutline(plan());
    const extra = { ...t, days: [...t.days, { id: "x", itemIds: [], startTime: "09:00", label: "Saigon" }] };
    const shorter = setOutline(extra, extra.outline!.slice(0, 2), { days: true });
    expect(shorter.days).toHaveLength(10);
    expect(shorter.days.map((d) => d.label)).toEqual([
      "Hanoi", "Hanoi", "Hanoi", "Ha Long Bay", "Ha Long Bay", undefined, undefined, undefined, undefined, "Saigon",
    ]);
  });

  it("saves an outline without touching the days unless asked", () => {
    const t = applyOutline(plan());
    const kept = setOutline(t, [outlineStop("Hue", 2)]);
    expect(kept.days.map((d) => d.label)[0]).toBe("Hanoi");
    expect(setOutline(t, []).outline).toBeUndefined();
  });

  it("compares the outline with the days", () => {
    expect(outlineFit(createTrip({ name: "x", destination: "y" })).kind).toBe("none");
    expect(outlineFit(plan())).toEqual({ kind: "long", outline: 9, days: 0 });
    expect(outlineFit(applyOutline(plan())).kind).toBe("match");
    const t = applyOutline(plan());
    expect(outlineFit({ ...t, outline: t.outline!.slice(0, 1) }).kind).toBe("short");
  });

  it("groups the ideas by their nearest stop", () => {
    const t = plan();
    const idea = (id: string, lat: number, lng: number): Item => ({ id, type: "place", title: id, location: { lat, lng } });
    const items = {
      temple: idea("temple", 21.04, 105.84),
      lantern: idea("lantern", 15.87, 108.32),
      far: idea("far", 10.77, 106.7),
    };
    const grouped = ideasByStop({ ...t, items, ideas: ["far", "lantern", "temple"] });
    expect(grouped.get(t.outline![0].id)?.map((i) => i.id)).toEqual(["temple"]);
    expect(grouped.get(t.outline![2].id)?.map((i) => i.id)).toEqual(["lantern"]);
    expect(grouped.has(t.outline![1].id)).toBe(false);
  });

  it("merges the outline and day labels from either side", () => {
    const base = applyOutline(plan());
    const local = { ...base, days: base.days.map((d, i) => (i === 0 ? { ...d, label: "Hanoi old town" } : d)) };
    const remote = { ...base, outline: [...base.outline!, outlineStop("Saigon", 2)] };
    const merged = mergeTrips(base, local, remote);
    expect(merged.outline).toHaveLength(4);
    expect(merged.days[0].label).toBe("Hanoi old town");
    expect(merged.days[1].label).toBe("Hanoi");
  });
});
