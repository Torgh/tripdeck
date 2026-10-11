import { z } from "zod";
import { structured } from "@/lib/server/claude";
import { placeDetails, type PlaceResult } from "@/lib/server/maps";
import { handle, latLngSchema, readBody } from "@/lib/server/http";

export const maxDuration = 60;

const schema = z.object({
  title: z.string().min(1).max(200),
  type: z.string(),
  destination: z.string().max(200),
  date: z.string().optional(),
  location: latLngSchema.extend({ address: z.string().max(300).optional() }).optional(),
  placeId: z.string().max(300).optional(),
  notes: z.string().max(1000).optional(),
});

const outputSchema = z.object({
  summary: z.string().describe("What the place is and why it is worth it, 2-3 sentences."),
  best_time: z.string().describe("Best time of day / week to visit and why."),
  suggested_duration_min: z.number().int(),
  tickets: z.string().nullable().describe("Ticket / reservation advice, or null if not applicable."),
  parking: z.string().nullable().describe("Parking or access advice, or null if not applicable."),
  tips: z.array(z.string()).describe("3-5 short, practical insider tips."),
});

const SYSTEM = `You are the travel guide inside TripDeck, a trip planner. You write short, practical visiting tips for one place.
Use the Google Places data provided when present. Do not invent exact prices, phone numbers or opening hours; when unsure, tell the traveller what to check and where.
For dive sites, cover typical conditions, entry, and what marine life to look for. Write in English.`;

export const POST = handle(async (req) => {
  const input = await readBody(req, schema);
  let place: PlaceResult | undefined;
  if (input.placeId) {
    try {
      place = await placeDetails(input.placeId);
    } catch {
      // Tips still work without Google data.
    }
  }

  const tips = await structured({
    system: SYSTEM,
    content: `Write visiting tips for:\n${JSON.stringify(
      {
        place: input.title,
        kind: input.type,
        trip_destination: input.destination,
        visit_date: input.date ?? "not set",
        address: place?.address ?? input.location?.address,
        coordinates: input.location,
        traveller_notes: input.notes,
        google: place && {
          rating: place.rating,
          reviews: place.userRatingCount,
          type: place.primaryType,
          opening_hours: place.weekdayHours,
          summary: place.editorialSummary,
          website: place.websiteUri,
        },
      },
      null,
      2,
    )}`,
    schema: outputSchema,
    effort: "low",
    maxTokens: 4000,
  });

  return {
    tips: {
      summary: tips.summary,
      bestTime: tips.best_time,
      suggestedDurationMin: tips.suggested_duration_min,
      tickets: tips.tickets ?? undefined,
      parking: tips.parking ?? undefined,
      tips: tips.tips,
      generatedAt: new Date().toISOString(),
    },
    place,
  };
});
