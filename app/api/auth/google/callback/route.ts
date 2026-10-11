import { NextResponse, type NextRequest } from "next/server";
import { exchangeCode } from "@/lib/server/googleAuth";
import { assertLocal } from "@/lib/server/http";
import { migrateLocalToDrive } from "@/lib/server/tripStore";

export async function GET(req: NextRequest) {
  const origin = new URL(req.url).origin;
  const back = (params: Record<string, string>) => {
    const res = NextResponse.redirect(`${origin}/settings?${new URLSearchParams(params)}`);
    res.cookies.delete({ name: "td_oauth_state", path: "/api/auth/google" });
    res.cookies.delete({ name: "td_oauth_verifier", path: "/api/auth/google" });
    return res;
  };
  try {
    assertLocal(req);
    const url = new URL(req.url);
    const error = url.searchParams.get("error");
    if (error) return back({ google: "error", message: error === "access_denied" ? "Access was not granted." : error });
    const state = url.searchParams.get("state");
    const code = url.searchParams.get("code");
    const verifier = req.cookies.get("td_oauth_verifier")?.value;
    if (!code || !state || !verifier || state !== req.cookies.get("td_oauth_state")?.value) {
      return back({ google: "error", message: "Sign-in expired or was tampered with. Please try again." });
    }
    await exchangeCode({ code, verifier, redirectUri: `${origin}/api/auth/google/callback` });
    await migrateLocalToDrive();
    return back({ google: "connected" });
  } catch (err) {
    return back({ google: "error", message: (err as Error).message });
  }
}
