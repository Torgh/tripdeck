import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { authUrl, pkcePair } from "@/lib/server/googleAuth";
import { assertLocal, handle } from "@/lib/server/http";

const COOKIE = { httpOnly: true, sameSite: "lax" as const, path: "/api/auth/google", maxAge: 600 };

export const GET = handle(async (req) => {
  assertLocal(req);
  const origin = new URL(req.url).origin;
  const state = crypto.randomBytes(16).toString("base64url");
  const { verifier, challenge } = pkcePair();
  const res = NextResponse.redirect(authUrl({ redirectUri: `${origin}/api/auth/google/callback`, state, challenge }));
  res.cookies.set("td_oauth_state", state, COOKIE);
  res.cookies.set("td_oauth_verifier", verifier, COOKIE);
  return res;
});
