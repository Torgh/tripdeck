import { z } from "zod";
import { computeRoute } from "@/lib/server/maps";
import { handle, latLngSchema, readBody } from "@/lib/server/http";
import { ROUTABLE_MODES } from "@/lib/types";

const schema = z.object({
  origin: latLngSchema,
  destination: latLngSchema,
  mode: z.enum(ROUTABLE_MODES),
  /** Public transport: plan for this local departure (or arrival) instead of right now. */
  time: z
    .object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      time: z.string().regex(/^\d{2}:\d{2}$/),
      arriveBy: z.boolean().optional(),
    })
    .optional(),
});

export const POST = handle(async (req) => {
  const { origin, destination, mode, time } = await readBody(req, schema);
  return { route: await computeRoute(origin, destination, mode, time) };
});
