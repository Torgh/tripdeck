import { z } from "zod";
import { computeRoute } from "@/lib/server/maps";
import { handle, latLngSchema, readBody } from "@/lib/server/http";
import { ROUTABLE_MODES } from "@/lib/types";

const schema = z.object({
  origin: latLngSchema,
  destination: latLngSchema,
  mode: z.enum(ROUTABLE_MODES),
});

export const POST = handle(async (req) => {
  const { origin, destination, mode } = await readBody(req, schema);
  return { route: await computeRoute(origin, destination, mode) };
});
