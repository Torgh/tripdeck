import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, readConfig, readJson, writeJson } from "./config";
import { HttpError } from "./errors";

/** Only the hidden app folder on Drive plus the account e-mail. TripDeck can't see your other files. */
const SCOPES = ["openid", "email", "https://www.googleapis.com/auth/drive.appdata"];
const TOKEN_FILE = path.join(DATA_DIR, "google-token.json");

interface StoredToken {
  refreshToken: string;
  accessToken?: string;
  /** Epoch ms. */
  expiresAt?: number;
  email?: string;
}

export function googleClient() {
  const { googleClientId, googleClientSecret } = readConfig();
  return googleClientId && googleClientSecret ? { id: googleClientId, secret: googleClientSecret } : undefined;
}

export function googleAccount(): { email?: string } | undefined {
  const token = readJson<StoredToken>(TOKEN_FILE);
  return token?.refreshToken ? { email: token.email } : undefined;
}

export function pkcePair() {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function authUrl(opts: { redirectUri: string; state: string; challenge: string }): string {
  const client = googleClient();
  if (!client) throw new HttpError(400, "Add your Google OAuth client in Settings first.");
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: client.id,
    redirect_uri: opts.redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: opts.state,
    code_challenge: opts.challenge,
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const data = (await res.json()) as TokenResponse;
  if (!res.ok || data.error) {
    throw new HttpError(res.status === 400 || res.status === 401 ? 401 : 502, data.error_description ?? data.error ?? "Google sign-in failed.");
  }
  return data;
}

/** The id_token comes straight from Google over TLS, so its payload can be read without verifying. */
function emailFromIdToken(idToken?: string): string | undefined {
  try {
    const payload = JSON.parse(Buffer.from(idToken!.split(".")[1], "base64url").toString("utf8")) as { email?: string };
    return payload.email;
  } catch {
    return undefined;
  }
}

export async function exchangeCode(opts: { code: string; verifier: string; redirectUri: string }) {
  const client = googleClient();
  if (!client) throw new HttpError(400, "Google OAuth client is not configured.");
  const data = await tokenRequest({
    code: opts.code,
    client_id: client.id,
    client_secret: client.secret,
    redirect_uri: opts.redirectUri,
    grant_type: "authorization_code",
    code_verifier: opts.verifier,
  });
  if (!data.refresh_token) throw new HttpError(502, "Google did not return a refresh token. Try connecting again.");
  const token: StoredToken = {
    refreshToken: data.refresh_token,
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    email: emailFromIdToken(data.id_token),
  };
  writeJson(TOKEN_FILE, token);
  return token.email;
}

/** A valid access token, refreshed when needed. Undefined when Google is not connected. */
export async function googleAccessToken(): Promise<string | undefined> {
  const token = readJson<StoredToken>(TOKEN_FILE);
  if (!token?.refreshToken) return undefined;
  if (token.accessToken && token.expiresAt && token.expiresAt - 60_000 > Date.now()) return token.accessToken;
  const client = googleClient();
  if (!client) throw new HttpError(503, "Google OAuth client is missing from Settings.");
  try {
    const data = await tokenRequest({
      refresh_token: token.refreshToken,
      client_id: client.id,
      client_secret: client.secret,
      grant_type: "refresh_token",
    });
    writeJson(TOKEN_FILE, { ...token, accessToken: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 });
    return data.access_token;
  } catch (err) {
    if (err instanceof HttpError && err.status === 401) {
      throw new HttpError(401, "Google access expired or was revoked – reconnect Google in Settings.");
    }
    throw err;
  }
}

export async function disconnectGoogle() {
  const token = readJson<StoredToken>(TOKEN_FILE);
  if (token?.refreshToken) {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token.refreshToken)}`, {
      method: "POST",
    }).catch(() => undefined);
  }
  fs.rmSync(TOKEN_FILE, { force: true });
}
