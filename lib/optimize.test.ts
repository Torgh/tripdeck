import { describe, expect, it } from "vitest";
import { bestOrder, evaluate, travelMatrix, type OptInput } from "./optimize";

// Start at 0, stops at positions 3, 1, 2 on a line; travel minutes = 10 x distance.
const pos = [0, 3, 1, 2];
const matrix = pos.map((a) => pos.map((b) => Math.abs(a - b) * 10));
const base = { matrix, hasStart: true, dayStartMin: 540, weekday: 1 };

describe("optimizer", () => {
  it("visits stops on a line in order", () => {
    const input: OptInput = { ...base, stops: [1, 2, 3].map((i) => ({ id: `s${i}`, durationMin: 30 })) };
    const order = bestOrder(input);
    expect(order).toEqual([1, 2, 0]);
    expect(evaluate(input, order).travelMin).toBe(30);
  });

  it("respects a fixed start time over pure distance", () => {
    const input: OptInput = {
      ...base,
      stops: [
        { id: "far", durationMin: 30, fixedStart: 540 + 30 },
        { id: "near", durationMin: 30 },
        { id: "mid", durationMin: 30 },
      ],
    };
    const order = bestOrder(input);
    expect(order[0]).toBe(0);
    expect(evaluate(input, order).lateMin).toBe(0);
  });

  it("returns a valid, short permutation for larger days", () => {
    const n = 11;
    const pts = Array.from({ length: n + 1 }, (_, i) => (i * 7) % (n + 1));
    const input: OptInput = {
      ...base,
      stops: Array.from({ length: n }, (_, i) => ({ id: `s${i}`, durationMin: 10 })),
      matrix: pts.map((a) => pts.map((b) => Math.abs(a - b))),
    };
    const order = bestOrder(input);
    expect([...order].sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, i) => i));
    expect(evaluate(input, order).travelMin).toBeLessThanOrEqual(n + 1);
  });
});

it("lets a fixed first stop set the departure time", () => {
  const input: OptInput = { ...base, stops: [{ id: "dive", durationMin: 60, fixedStart: 540 }] };
  expect(evaluate(input, [0]).lateMin).toBe(0);
});

it("builds the travel matrix from arrival points and keeps the legs entered by hand", async () => {
  const nodes = [
    { id: "home", at: { lat: 0, lng: 0 } },
    { id: "flight", at: { lat: 0, lng: 0.01 }, leavesFrom: { lat: 5, lng: 5 } },
    { id: "hotel", at: { lat: 5, lng: 5.01 } },
  ];
  let asked: unknown[] = [];
  const route = async (points: unknown[]) => {
    asked = points;
    // 10 minutes per point index apart, so origins are easy to tell apart
    return points.map((_, i) => points.map((_, j) => Math.abs(i - j) * 10));
  };
  const { minutes, estimated } = await travelMatrix(nodes, "DRIVE", route, (from, to) =>
    from === "home" && to === "flight" ? 45 : undefined,
  );
  expect(estimated).toBe(false);
  expect(asked).toHaveLength(4); // the three places plus the flight's arrival
  expect(minutes[0][1]).toBe(45); // entered by hand
  expect(minutes[1][2]).toBe(10); // from the arrival point (index 3) to the hotel (index 2)
  expect(minutes[2][1]).toBe(10); // to a flight you still go to its departure

  const offline = await travelMatrix(nodes, "DRIVE", () => Promise.reject(new Error("no key")));
  expect(offline.estimated).toBe(true);
  expect(offline.minutes[1][2]).toBeLessThan(offline.minutes[0][2]);
});
