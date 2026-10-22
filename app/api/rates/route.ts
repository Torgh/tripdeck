import { z } from "zod";
import { handle, readBody } from "@/lib/server/http";
import { exchangeRates } from "@/lib/server/rates";

export const POST = handle(async (req) => {
  const { base } = await readBody(req, z.object({ base: z.string().regex(/^[A-Z]{3}$/) }));
  return exchangeRates(base);
});
