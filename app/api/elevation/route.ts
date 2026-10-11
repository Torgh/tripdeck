import { elevation } from "@/lib/server/maps";
import { handle, latLngSchema, readBody } from "@/lib/server/http";

export const POST = handle(async (req) => {
  const point = await readBody(req, latLngSchema);
  return { elevationM: await elevation(point) };
});
