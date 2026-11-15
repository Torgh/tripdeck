import { z } from "zod";
import { MAX_REGIONS } from "@/lib/climate";
import { climateAt } from "@/lib/server/climate";
import { handle, latLngSchema, readBody } from "@/lib/server/http";

/** The typical weather month by month for each of a trip's regions. */
export const POST = handle(async (req) => {
  const { points } = await readBody(req, z.object({ points: z.array(latLngSchema).min(1).max(MAX_REGIONS) }));
  return { climates: await Promise.all(points.map((p) => climateAt(p))) };
});
