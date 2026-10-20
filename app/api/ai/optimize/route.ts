import { z } from "zod";
import { bestOrder, evaluate, travelMatrix, type OptInput, type OptMetrics } from "@/lib/optimize";
import { aiConfigured, structured } from "@/lib/server/claude";
import { routeMatrix } from "@/lib/server/maps";
import { handle, HttpError, latLngSchema, readBody } from "@/lib/server/http";
import { dayDate, formatHm, parseHm } from "@/lib/time";
import { legKey, ROUTABLE_MODES, MANUAL_MODES, type OpeningPeriod } from "@/lib/types";

export const maxDuration = 120;

const point = z.object({ day: z.number().int().min(0).max(6), hour: z.number(), minute: z.number() });

const schema = z.object({
  destination: z.string().max(200),
  interests: z.string().max(500).default(""),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dayStartTime: z.string().regex(/^\d{1,2}:\d{2}$/),
  mode: z.enum([...ROUTABLE_MODES, ...MANUAL_MODES]),
  base: latLngSchema.extend({ id: z.string().max(50).optional(), title: z.string().max(200) }).optional(),
  items: z
    .array(
      latLngSchema.extend({
        id: z.string().max(50),
        title: z.string().max(200),
        type: z.string(),
        durationMin: z.number().min(0).max(1440),
        fixedStart: z.string().optional(),
        openingPeriods: z
          .array(z.object({ open: point, close: point.optional() }))
          .max(30)
          .optional(),
        notes: z.string().max(500).optional(),
        /** Where you set off from afterwards (a flight's arrival airport). */
        leavesFrom: latLngSchema.optional(),
      }),
    )
    .min(2)
    .max(12),
  /** Ferry, boat and flight legs the user entered, keyed "fromId>toId". */
  manualLegs: z.record(z.string().max(110), z.number().min(0).max(2000)).optional(),
  note: z.string().max(500).optional(),
});

const outputSchema = z.object({
  order: z.array(z.string()).describe("Every stop id exactly once, in the recommended visiting order."),
  reasoning: z.string().describe("2-4 sentences explaining the order."),
  tips: z.array(z.string()).describe("Up to 3 short practical tips for the day."),
});

const SYSTEM = `You are the day-planning assistant inside TripDeck, a trip planner.
You reorder the stops of one day of a trip to make it as enjoyable and efficient as possible.

You get a travel-time matrix, durations, fixed start times, opening hours, and a baseline order computed by an algorithm that only minimises travel time, lateness and closed visits.
Start from the baseline and change it only when there is a real benefit the algorithm cannot see: meals at sensible times, viewpoints or beaches at the best time of day, museums before crowds, heat in the middle of the day, avoiding backtracking.
Never move a stop so it misses a fixed start time or arrives outside its opening hours. Write in English.`;

function hoursOn(periods: OpeningPeriod[] | undefined, weekday: number): string {
  if (!periods?.length) return "unknown";
  if (periods.some((p) => !p.close)) return "open 24h";
  const today = periods.filter((p) => p.open.day === weekday);
  if (!today.length) return "closed";
  return today
    .map((p) => `${formatHm(p.open.hour * 60 + p.open.minute)}–${formatHm(p.close!.hour * 60 + p.close!.minute)}`)
    .join(", ");
}

export const POST = handle(async (req) => {
  const input = await readBody(req, schema);
  const ids = new Set(input.items.map((i) => i.id));
  if (ids.size !== input.items.length) throw new HttpError(400, "Stop ids must be unique.");

  const weekday = dayDate(input.date, 0).getUTCDay();
  const nodes = [
    ...(input.base ? [{ id: input.base.id ?? "START", at: input.base }] : []),
    ...input.items.map((it) => ({ id: it.id, at: it, leavesFrom: it.leavesFrom })),
  ];
  // Without a Google key (or over quota) the matrix falls back to straight-line estimates.
  const { minutes, estimated } = await travelMatrix(nodes, input.mode, routeMatrix, (from, to) =>
    input.manualLegs?.[legKey(from, to)],
  );

  const optInput: OptInput = {
    stops: input.items.map((it) => ({
      id: it.id,
      durationMin: it.durationMin,
      fixedStart: parseHm(it.fixedStart),
      periods: it.openingPeriods,
    })),
    matrix: minutes,
    hasStart: !!input.base,
    dayStartMin: parseHm(input.dayStartTime) ?? 540,
    weekday,
  };

  const currentIdx = input.items.map((_, i) => i);
  const baselineIdx = bestOrder(optInput);
  const toIds = (order: number[]) => order.map((i) => input.items[i].id);
  const labels = [...(input.base ? ["START"] : []), ...input.items.map((i) => i.id)];

  const prompt = {
    destination: input.destination,
    traveller_interests: input.interests || "not specified",
    date: `${input.date} (${dayDate(input.date, 0).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" })})`,
    day_starts_at: input.dayStartTime,
    travel_mode: input.mode,
    start_point: input.base ? `${input.base.title} (index START)` : "the first stop",
    stops: input.items.map((it) => ({
      id: it.id,
      title: it.title,
      type: it.type,
      duration_min: it.durationMin,
      fixed_start: it.fixedStart ?? null,
      opening_hours_that_day: hoursOn(it.openingPeriods, weekday),
      notes: it.notes ?? null,
    })),
    travel_minutes: Object.fromEntries(
      labels.map((from, i) => [
        from,
        Object.fromEntries(
          labels.map((to, j) => [to, Math.round(minutes[i][j])]).filter(([to]) => to !== from && to !== "START"),
        ),
      ]),
    ),
    travel_times_are_estimates: estimated,
    current_order: toIds(currentIdx),
    current_metrics: evaluate(optInput, currentIdx),
    baseline_order: toIds(baselineIdx),
    baseline_metrics: evaluate(optInput, baselineIdx),
    extra_wishes: input.note || "none",
  };

  // Without an API key the in-app optimizer returns the algorithmic order (Claude can still refine it via MCP).
  const ai = aiConfigured()
    ? await structured({
        system: SYSTEM,
        content: `Recommend the visiting order for this day:\n${JSON.stringify(prompt, null, 2)}`,
        schema: outputSchema,
        effort: "medium",
      })
    : {
        order: toIds(baselineIdx),
        reasoning: "Fastest order by travel time, keeping fixed start times and opening hours.",
        tips: [],
      };

  const valid =
    ai.order.length === ids.size && new Set(ai.order).size === ids.size && ai.order.every((id) => ids.has(id));
  const indexOf = new Map(input.items.map((it, i) => [it.id, i]));
  const proposedIdx = valid ? ai.order.map((id) => indexOf.get(id)!) : baselineIdx;

  const metrics: Record<"current" | "baseline" | "proposed", OptMetrics> = {
    current: evaluate(optInput, currentIdx),
    baseline: evaluate(optInput, baselineIdx),
    proposed: evaluate(optInput, proposedIdx),
  };

  return {
    order: toIds(proposedIdx),
    baselineOrder: toIds(baselineIdx),
    reasoning: valid
      ? ai.reasoning
      : "Claude's answer did not contain every stop exactly once, so the travel-time optimised order is shown instead.",
    tips: ai.tips.slice(0, 3),
    metrics,
    estimated,
  };
});
