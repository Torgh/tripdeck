import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { haversineM } from "@/lib/geo";
import { agent } from "@/lib/server/claude";
import { nearbyPlaces, OSM_CATEGORIES, searchPlaces, type PlaceResult } from "@/lib/server/maps";
import { handle, latLngSchema, readBody } from "@/lib/server/http";
import { dayDate } from "@/lib/time";

export const maxDuration = 120;

const schema = z.object({
  destination: z.string().max(200),
  interests: z.string().max(500).default(""),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  dayItems: z
    .array(z.object({ title: z.string().max(200), type: z.string(), time: z.string().optional() }))
    .max(40)
    .default([]),
  anchor: latLngSchema.extend({ name: z.string().max(200) }),
  radiusKm: z.number().min(0.5).max(50).default(10),
  count: z.number().int().min(1).max(8).default(5),
  note: z.string().max(500).optional(),
  excludePlaceIds: z.array(z.string()).max(500).default([]),
});

const outputSchema = z.object({
  summary: z.string().describe("One or two sentences about the overall recommendation."),
  suggestions: z.array(
    z.object({
      place_id: z.string().describe("Exact place_id from a tool result."),
      reason: z.string().describe("Why it is worth visiting, 1-2 sentences."),
      suggested_duration_min: z.number().int(),
      best_time: z.string().describe('When to go, e.g. "Late afternoon for the sunset".'),
      category: z.string().describe('Short label, e.g. "Viewpoint", "Beach", "Local food".'),
    }),
  ),
});

const SYSTEM = `You are the travel-planning assistant inside TripDeck, a trip planner.
You suggest places worth visiting near a given point, grounded in Google Places data that you look up with your tools.

Rules:
- Only suggest places that appeared in your tool results, referenced by their exact place_id.
- Weigh rating together with the number of reviews; avoid obscure places with only a handful of reviews unless they fit the interests unusually well.
- Fit the traveller's interests and the rest of their day; offer variety unless the request is specific.
- Skip places that are closed on the given date when hours are known, and places that duplicate what is already planned.
- Use a few targeted searches (2–5 tool calls), then answer. Write in English, concise and concrete.`;

function compact(p: PlaceResult, anchor: { lat: number; lng: number }, weekday?: number) {
  // weekdayDescriptions start on Monday; Date.getUTCDay() is 0 = Sunday
  const hours = weekday != null && p.weekdayHours ? p.weekdayHours[(weekday + 6) % 7] : undefined;
  return {
    place_id: p.placeId,
    name: p.name,
    type: p.primaryType,
    rating: p.rating,
    reviews: p.userRatingCount,
    distance_km: Math.round(haversineM(anchor, p) / 100) / 10,
    hours_on_date: hours,
    summary: p.editorialSummary,
  };
}

export const POST = handle(async (req) => {
  const input = await readBody(req, schema);
  const anchor = { lat: input.anchor.lat, lng: input.anchor.lng };
  const radiusM = input.radiusKm * 1000;
  const weekday = input.date ? dayDate(input.date, 0).getUTCDay() : undefined;
  const excluded = new Set(input.excludePlaceIds);
  const seen = new Map<string, PlaceResult>();

  const remember = (places: PlaceResult[]) => {
    const fresh = places.filter((p) => !excluded.has(p.placeId) && haversineM(anchor, p) <= radiusM * 1.5);
    for (const p of fresh) seen.set(p.placeId, p);
    return JSON.stringify(fresh.map((p) => compact(p, anchor, weekday)));
  };

  const tools = [
    betaZodTool({
      name: "search_places",
      description:
        "Free-text Google Places search around the anchor point, e.g. 'snorkeling spots', 'traditional seafood restaurant', 'sunset viewpoint'. Returns up to 10 places with rating, review count, distance and opening hours on the trip date.",
      inputSchema: z.object({ query: z.string().describe("What to look for, in English.") }),
      run: async ({ query }) => remember(await searchPlaces(query, { bias: anchor, radiusM, maxResults: 10 })),
    }),
    betaZodTool({
      name: "nearby_places",
      description: "Notable places of the given categories within the search radius, most notable first.",
      inputSchema: z.object({
        categories: z
          .array(z.enum(Object.keys(OSM_CATEGORIES) as [string, ...string[]]))
          .min(1)
          .max(4),
      }),
      run: async ({ categories }) => remember(await nearbyPlaces({ center: anchor, radiusM, categories })),
    }),
  ];

  const request = {
    destination: input.destination,
    traveller_interests: input.interests || "not specified",
    date: input.date
      ? `${input.date} (${dayDate(input.date, 0).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" })})`
      : "not set",
    already_planned_that_day: input.dayItems,
    anchor: `${input.anchor.name} (${anchor.lat.toFixed(5)}, ${anchor.lng.toFixed(5)})`,
    radius_km: input.radiusKm,
    number_of_suggestions: input.count,
    extra_wishes: input.note || "none",
  };

  const result = await agent({
    system: SYSTEM,
    content: `Suggest places to visit for this request:\n${JSON.stringify(request, null, 2)}`,
    tools,
    schema: outputSchema,
    effort: "medium",
  });

  const suggestions = result.suggestions
    .filter((s) => seen.has(s.place_id))
    .slice(0, input.count)
    .map((s) => ({
      place: seen.get(s.place_id)!,
      reason: s.reason,
      suggestedDurationMin: s.suggested_duration_min,
      bestTime: s.best_time,
      category: s.category,
    }));

  return { summary: result.summary, suggestions };
});
