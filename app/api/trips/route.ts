import { googleAccount } from "@/lib/server/googleAuth";
import { assertLocal, handle } from "@/lib/server/http";
import { tripStore } from "@/lib/server/tripStore";

export const GET = handle(async (req) => {
  assertLocal(req);
  const store = tripStore();
  return { storage: store.kind, email: googleAccount()?.email, trips: await store.list() };
});
