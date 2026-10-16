import { NextResponse, type NextRequest } from "next/server";
import { exchangeCode } from "@/lib/server/cloudAuth";
import { writeConfig } from "@/lib/server/config";
import { assertLocal } from "@/lib/server/http";
import { copyTrips, migrateHiddenGoogleTrips, tripStore } from "@/lib/server/tripStore";
import { providerParam, type ProviderCtx } from "../provider";

/** Finishes sign-in, switches storage to this provider and copies the trips over. */
export async function GET(req: NextRequest, ctx: ProviderCtx) {
  const origin = new URL(req.url).origin;
  const { provider } = await ctx.params;
  const back = (params: Record<string, string>) => {
    const res = NextResponse.redirect(`${origin}/settings?${new URLSearchParams({ provider, ...params })}`);
    res.cookies.delete({ name: "td_oauth_state", path: `/api/auth/${provider}` });
    res.cookies.delete({ name: "td_oauth_verifier", path: `/api/auth/${provider}` });
    return res;
  };
  try {
    assertLocal(req);
    const cloud = await providerParam(ctx);
    const url = new URL(req.url);
    const error = url.searchParams.get("error");
    if (error) {
      const message = error === "access_denied" ? "Access was not granted." : (url.searchParams.get("error_description") ?? error);
      return back({ status: "error", message });
    }
    const state = url.searchParams.get("state");
    const code = url.searchParams.get("code");
    const verifier = req.cookies.get("td_oauth_verifier")?.value;
    if (!code || !state || !verifier || state !== req.cookies.get("td_oauth_state")?.value) {
      return back({ status: "error", message: "Sign-in expired or was tampered with. Please try again." });
    }
    const before = tripStore();
    await exchangeCode(cloud, { code, verifier, redirectUri: `${origin}/api/auth/${cloud}/callback` });
    if (cloud === "google") await migrateHiddenGoogleTrips();
    writeConfig({ storage: cloud });
    const after = tripStore();
    if (before.location !== after.location) await copyTrips(before, after);
    return back({ status: "connected" });
  } catch (err) {
    return back({ status: "error", message: (err as Error).message });
  }
}
