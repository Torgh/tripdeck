import { cloudAccount } from "@/lib/server/cloudAuth";
import { assertLocal, handle } from "@/lib/server/http";
import { tripStore } from "@/lib/server/tripStore";

export const GET = handle(async (req) => {
  assertLocal(req);
  const store = tripStore();
  const email = store.kind === "google" ? cloudAccount("google")?.email : undefined;
  return { storage: store.kind, email, trips: await store.list() };
});
