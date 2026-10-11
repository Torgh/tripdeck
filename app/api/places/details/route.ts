import { z } from "zod";
import { placeDetails } from "@/lib/server/maps";
import { handle, readBody } from "@/lib/server/http";

const schema = z.object({ placeId: z.string().min(1).max(300) });

export const POST = handle(async (req) => {
  const { placeId } = await readBody(req, schema);
  return { place: await placeDetails(placeId) };
});
