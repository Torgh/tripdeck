import { disconnect } from "@/lib/server/cloudAuth";
import { writeConfig } from "@/lib/server/config";
import { assertLocal, handle } from "@/lib/server/http";
import { activeStorage, copyTrips, storeFor } from "@/lib/server/tripStore";
import { providerParam, type ProviderCtx } from "../provider";

/** Signs out. If this provider held the trips, they are copied to this PC first (they also stay in the cloud). */
export const POST = handle<ProviderCtx>(async (req, ctx) => {
  assertLocal(req);
  const provider = await providerParam(ctx);
  if (activeStorage() === provider) {
    await copyTrips(storeFor(provider), storeFor("local")).catch(() => undefined);
    writeConfig({ storage: "local" });
  }
  await disconnect(provider);
  return { ok: true };
});
