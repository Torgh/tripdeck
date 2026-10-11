import { disconnectGoogle } from "@/lib/server/googleAuth";
import { assertLocal, handle } from "@/lib/server/http";

export const POST = handle(async (req) => {
  assertLocal(req);
  await disconnectGoogle();
  return { ok: true };
});
