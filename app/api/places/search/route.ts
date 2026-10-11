import { z } from "zod";
import { searchPlaces } from "@/lib/server/maps";
import { handle, latLngSchema, readBody } from "@/lib/server/http";

const schema = z.object({
  query: z.string().trim().min(2).max(200),
  bias: latLngSchema.optional(),
});

export const POST = handle(async (req) => {
  const { query, bias } = await readBody(req, schema);
  return { places: await searchPlaces(query, { bias, maxResults: 8 }) };
});
