import { isOpenDuring } from "./timeline";
import type { OpeningPeriod } from "./types";

export interface OptStop {
  id: string;
  durationMin: number;
  /** Fixed start, minutes after midnight. */
  fixedStart?: number;
  periods?: OpeningPeriod[];
}

export interface OptInput {
  stops: OptStop[];
  /**
   * Travel minutes between points. When `hasStart` is true, index 0 is the start point
   * (e.g. the hotel) and stop i is at index i + 1; otherwise stop i is at index i.
   */
  matrix: number[][];
  hasStart: boolean;
  dayStartMin: number;
  weekday: number;
}

export interface OptMetrics {
  travelMin: number;
  /** Total minutes arriving after fixed start times. */
  lateMin: number;
  /** Stops that would be visited outside their opening hours. */
  closedCount: number;
  endMin: number;
  score: number;
}

const LATE_WEIGHT = 4;
const CLOSED_PENALTY = 120;
const BRUTE_FORCE_MAX = 8;

/** Simulates a day visiting stops in `order` (indices into input.stops). */
export function evaluate(input: OptInput, order: number[]): OptMetrics {
  const offset = input.hasStart ? 1 : 0;
  let cursor = input.dayStartMin;
  let prev: number | undefined = input.hasStart ? 0 : undefined;
  let travelMin = 0;
  let lateMin = 0;
  let closedCount = 0;
  order.forEach((i, k) => {
    const stop = input.stops[i];
    const idx = i + offset;
    const t = prev === undefined ? 0 : input.matrix[prev][idx];
    // The first appointment of the day sets when you leave (same rule as the board timeline).
    if (k === 0 && stop.fixedStart != null) cursor = stop.fixedStart - t;
    travelMin += t;
    cursor += t;
    if (stop.fixedStart != null) {
      lateMin += Math.max(0, cursor - stop.fixedStart);
      cursor = Math.max(cursor, stop.fixedStart);
    }
    if (isOpenDuring(stop.periods, input.weekday, cursor, cursor + stop.durationMin) === false) closedCount++;
    cursor += stop.durationMin;
    prev = idx;
  });
  return {
    travelMin,
    lateMin,
    closedCount,
    endMin: cursor,
    score: travelMin + LATE_WEIGHT * lateMin + CLOSED_PENALTY * closedCount,
  };
}

/** Best order by score: exhaustive for small days, nearest-neighbour + 2-opt for larger ones. */
export function bestOrder(input: OptInput): number[] {
  const n = input.stops.length;
  if (n <= 1) return n ? [0] : [];
  if (n <= BRUTE_FORCE_MAX) return bruteForce(input);
  return twoOpt(input, nearestNeighbour(input));
}

function bruteForce(input: OptInput): number[] {
  const n = input.stops.length;
  let best: number[] = [];
  let bestScore = Infinity;
  const used = new Array<boolean>(n).fill(false);
  const order: number[] = [];
  const recurse = () => {
    if (order.length === n) {
      const { score } = evaluate(input, order);
      if (score < bestScore) {
        bestScore = score;
        best = [...order];
      }
      return;
    }
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      used[i] = true;
      order.push(i);
      recurse();
      order.pop();
      used[i] = false;
    }
  };
  recurse();
  return best;
}

function nearestNeighbour(input: OptInput): number[] {
  const offset = input.hasStart ? 1 : 0;
  const remaining = new Set(input.stops.map((_, i) => i));
  const order: number[] = [];
  let prev = input.hasStart ? 0 : undefined;
  while (remaining.size) {
    let pick = -1;
    let pickT = Infinity;
    for (const i of remaining) {
      const t = prev === undefined ? 0 : input.matrix[prev][i + offset];
      if (t < pickT) {
        pick = i;
        pickT = t;
      }
    }
    order.push(pick);
    remaining.delete(pick);
    prev = pick + offset;
  }
  return order;
}

function twoOpt(input: OptInput, start: number[]): number[] {
  let best = start;
  let bestScore = evaluate(input, best).score;
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < best.length - 1; i++) {
      for (let j = i + 1; j < best.length; j++) {
        const candidate = [...best.slice(0, i), ...best.slice(i, j + 1).reverse(), ...best.slice(j + 1)];
        const score = evaluate(input, candidate).score;
        if (score < bestScore - 1e-9) {
          best = candidate;
          bestScore = score;
          improved = true;
        }
      }
    }
  }
  return best;
}
