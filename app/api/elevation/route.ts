import { z } from "zod";
import { elevations } from "@/lib/server/maps";
import { handle, latLngSchema, readBody } from "@/lib/server/http";

/** Up to 100 places in one request: Google bills the request, not each place. */
const schema = z.object({ points: z.array(latLngSchema).min(1).max(100) });

export const POST = handle(async (req) => {
  const { points } = await readBody(req, schema);
  return { elevations: await elevations(points) };
});
