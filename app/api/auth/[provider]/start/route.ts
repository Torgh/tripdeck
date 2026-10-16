import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { authUrl, pkcePair } from "@/lib/server/cloudAuth";
import { assertLocal, handle } from "@/lib/server/http";
import { providerParam, type ProviderCtx } from "../provider";

export const GET = handle<ProviderCtx>(async (req, ctx) => {
  assertLocal(req);
  const provider = await providerParam(ctx);
  const origin = new URL(req.url).origin;
  const state = crypto.randomBytes(16).toString("base64url");
  const { verifier, challenge } = pkcePair();
  const res = NextResponse.redirect(authUrl(provider, { redirectUri: `${origin}/api/auth/${provider}/callback`, state, challenge }));
  const cookie = { httpOnly: true, sameSite: "lax" as const, path: `/api/auth/${provider}`, maxAge: 600 };
  res.cookies.set("td_oauth_state", state, cookie);
  res.cookies.set("td_oauth_verifier", verifier, cookie);
  return res;
});
