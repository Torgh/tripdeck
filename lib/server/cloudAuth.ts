import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CLOUD_PROVIDERS, STORAGE_LABEL, type CloudProvider } from "../configStatus";
import { DATA_DIR, readConfig, readJson, writeJson } from "./config";
import { HttpError } from "./errors";

/** Google: only files TripDeck created (its visible TripDeck folder). TripDeck can't see your other files. */
export const GOOGLE_DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
/** Google: the hidden app folder used before trips moved to a visible folder – kept to migrate them. */
export const GOOGLE_APPDATA_SCOPE = "https://www.googleapis.com/auth/drive.appdata";

interface StoredToken {
  refreshToken: string;
  accessToken?: string;
  /** Epoch ms. */
  expiresAt?: number;
  email?: string;
  /** Space-separated scopes granted (missing in tokens saved by older versions). */
  scope?: string;
}

interface ProviderSpec {
  authUrl: string;
  tokenUrl: string;
  scopes: string[];
  authParams: Record<string, string>;
  clientIds(): { id?: string; secret?: string };
  revoke?(refreshToken: string): Promise<unknown>;
}

const PROVIDERS: Record<CloudProvider, ProviderSpec> = {
  google: {
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: ["openid", "email", GOOGLE_DRIVE_FILE_SCOPE, GOOGLE_APPDATA_SCOPE],
    authParams: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
    clientIds: () => {
      const c = readConfig();
      return { id: c.googleClientId, secret: c.googleClientSecret };
    },
    revoke: (refreshToken) =>
      fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`, { method: "POST" }),
  },
};

const tokenFile = (provider: CloudProvider) => path.join(DATA_DIR, `${provider}-token.json`);

export function isCloudProvider(value: string): value is CloudProvider {
  return (CLOUD_PROVIDERS as string[]).includes(value);
}

export function oauthClient(provider: CloudProvider): { id: string; secret: string } | undefined {
  const { id, secret } = PROVIDERS[provider].clientIds();
  return id && secret ? { id, secret } : undefined;
}

export function cloudAccount(provider: CloudProvider): { email?: string } | undefined {
  const token = readJson<StoredToken>(tokenFile(provider));
  return token?.refreshToken ? { email: token.email } : undefined;
}

/** Whether the stored token was granted `scope`. Tokens from older versions don't record scopes. */
export function hasScope(provider: CloudProvider, scope: string): boolean {
  return !!readJson<StoredToken>(tokenFile(provider))?.scope?.split(" ").includes(scope);
}

export function pkcePair() {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function authUrl(provider: CloudProvider, opts: { redirectUri: string; state: string; challenge: string }): string {
  const client = oauthClient(provider);
  if (!client) throw new HttpError(400, `Add your ${STORAGE_LABEL[provider]} OAuth client in Settings first.`);
  const spec = PROVIDERS[provider];
  const url = new URL(spec.authUrl);
  url.search = new URLSearchParams({
    client_id: client.id,
    redirect_uri: opts.redirectUri,
    response_type: "code",
    scope: spec.scopes.join(" "),
    state: opts.state,
    code_challenge: opts.challenge,
    code_challenge_method: "S256",
    ...spec.authParams,
  }).toString();
  return url.toString();
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  id_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

async function tokenRequest(provider: CloudProvider, params: Record<string, string>): Promise<TokenResponse> {
  const client = oauthClient(provider);
  if (!client) throw new HttpError(503, `The ${STORAGE_LABEL[provider]} OAuth client is missing from Settings.`);
  let res: Response;
  try {
    res = await fetch(PROVIDERS[provider].tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...params, client_id: client.id, client_secret: client.secret }),
    });
  } catch {
    throw new HttpError(503, `${STORAGE_LABEL[provider]} sign-in is unreachable – are you online?`);
  }
  const data = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || data.error) {
    const message = data.error_description?.split("\r\n")[0] ?? data.error ?? `${STORAGE_LABEL[provider]} sign-in failed.`;
    throw new HttpError(res.status === 400 || res.status === 401 ? 401 : 502, message);
  }
  return data;
}

/** The id_token comes straight from the provider over TLS, so its payload can be read without verifying. */
function emailFromIdToken(idToken?: string): string | undefined {
  try {
    const payload = JSON.parse(Buffer.from(idToken!.split(".")[1], "base64url").toString("utf8")) as { email?: string };
    return payload.email;
  } catch {
    return undefined;
  }
}

export async function exchangeCode(provider: CloudProvider, opts: { code: string; verifier: string; redirectUri: string }) {
  const data = await tokenRequest(provider, {
    code: opts.code,
    redirect_uri: opts.redirectUri,
    grant_type: "authorization_code",
    code_verifier: opts.verifier,
  });
  if (!data.refresh_token) {
    throw new HttpError(502, `${STORAGE_LABEL[provider]} did not return a refresh token. Try connecting again.`);
  }
  const token: StoredToken = {
    refreshToken: data.refresh_token,
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    email: emailFromIdToken(data.id_token),
    scope: data.scope,
  };
  writeJson(tokenFile(provider), token);
  return token.email;
}

/** A valid access token, refreshed when needed. Undefined when the provider is not connected. */
export async function accessToken(provider: CloudProvider): Promise<string | undefined> {
  const file = tokenFile(provider);
  const token = readJson<StoredToken>(file);
  if (!token?.refreshToken) return undefined;
  if (token.accessToken && token.expiresAt && token.expiresAt - 60_000 > Date.now()) return token.accessToken;
  try {
    const data = await tokenRequest(provider, { refresh_token: token.refreshToken, grant_type: "refresh_token" });
    writeJson(file, {
      ...token,
      refreshToken: data.refresh_token ?? token.refreshToken,
      accessToken: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
      scope: data.scope ?? token.scope,
    } satisfies StoredToken);
    return data.access_token;
  } catch (err) {
    if (err instanceof HttpError && err.status === 401) {
      throw new HttpError(401, `${STORAGE_LABEL[provider]} access expired or was revoked – reconnect it in Settings.`);
    }
    throw err;
  }
}

export async function disconnect(provider: CloudProvider) {
  const file = tokenFile(provider);
  const token = readJson<StoredToken>(file);
  if (token?.refreshToken) await PROVIDERS[provider].revoke?.(token.refreshToken).catch(() => undefined);
  fs.rmSync(file, { force: true });
}
