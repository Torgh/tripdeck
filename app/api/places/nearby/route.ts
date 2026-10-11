import { z } from "zod";
import { handle, latLngSchema, readBody } from "@/lib/server/http";
import { nearbyPlaces, OSM_CATEGORIES } from "@/lib/server/maps";

const schema = z.object({
  center: latLngSchema,
  radiusKm: z.number().min(0.2).max(30),
  categories: z.array(z.enum(Object.keys(OSM_CATEGORIES) as [string, ...string[]])).max(7).optional(),
});

export const POST = handle(async (req) => {
  const { center, radiusKm, categories } = await readBody(req, schema);
  return { places: await nearbyPlaces({ center, radiusM: radiusKm * 1000, categories, maxResults: 20 }) };
});
