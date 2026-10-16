import type { CloudProvider } from "@/lib/configStatus";
import { isCloudProvider } from "@/lib/server/cloudAuth";
import { HttpError } from "@/lib/server/errors";

export type ProviderCtx = { params: Promise<{ provider: string }> };

export async function providerParam(ctx: ProviderCtx): Promise<CloudProvider> {
  const { provider } = await ctx.params;
  if (!isCloudProvider(provider)) throw new HttpError(404, "Unknown storage provider.");
  return provider;
}
