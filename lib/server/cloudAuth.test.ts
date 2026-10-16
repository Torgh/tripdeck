import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const home = vi.hoisted(() => {
  const dir = `${process.env.TMPDIR ?? process.env.TEMP ?? "/tmp"}/tripdeck-auth-test-${process.pid}`;
  process.env.TRIPDECK_HOME = dir;
  return dir;
});

const auth = await import("./cloudAuth");
const { readJson, writeConfig, writeJson } = await import("./config");

const tokenFile = path.join(home, "google-token.json");
const idToken = (claims: object) => `x.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;
/** Records token-endpoint calls and answers with `reply`. */
function tokenEndpoint(reply: { status?: number; body: object }) {
  const fetch = vi.fn(async (_url: string | URL, _init?: RequestInit) =>
    Response.json(reply.body, { status: reply.status ?? 200 }),
  );
  vi.stubGlobal("fetch", fetch);
  return {
    fetch,
    params: (call = 0) => new URLSearchParams(String(fetch.mock.calls[call][1]!.body)),
  };
}

beforeEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
  writeConfig({ googleClientId: "client-id", googleClientSecret: "client-secret" });
});
afterEach(() => vi.unstubAllGlobals());

describe("oauthClient", () => {
  it("needs both the client id and the secret", () => {
    expect(auth.oauthClient("google")).toEqual({ id: "client-id", secret: "client-secret" });
    writeConfig({ googleClientSecret: "" });
    expect(auth.oauthClient("google")).toBeUndefined();
  });

  it("knows its providers", () => {
    expect(auth.isCloudProvider("google")).toBe(true);
    expect(auth.isCloudProvider("dropbox")).toBe(false);
  });
});

describe("authUrl", () => {
  it("asks Google for offline access with PKCE and only the Drive file scopes", () => {
    const { challenge } = auth.pkcePair();
    const url = new URL(auth.authUrl("google", { redirectUri: "http://localhost:3000/cb", state: "s1", challenge }));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    const p = Object.fromEntries(url.searchParams);
    expect(p).toMatchObject({
      client_id: "client-id",
      redirect_uri: "http://localhost:3000/cb",
      response_type: "code",
      state: "s1",
      code_challenge: challenge,
      code_challenge_method: "S256",
      access_type: "offline",
    });
    expect(p.scope.split(" ").sort()).toEqual(
      ["email", "openid", auth.GOOGLE_APPDATA_SCOPE, auth.GOOGLE_DRIVE_FILE_SCOPE].sort(),
    );
    expect(p).not.toHaveProperty("client_secret");
  });

  it("refuses without a configured client", () => {
    writeConfig({ googleClientId: "" });
    expect(() => auth.authUrl("google", { redirectUri: "x", state: "s", challenge: "c" })).toThrow(/OAuth client/);
  });

  it("creates a fresh, matching PKCE pair each time", async () => {
    const a = auth.pkcePair();
    const b = auth.pkcePair();
    expect(a.verifier).not.toBe(b.verifier);
    const { createHash } = await import("node:crypto");
    expect(createHash("sha256").update(a.verifier).digest("base64url")).toBe(a.challenge);
  });
});

describe("exchangeCode", () => {
  it("stores the refresh token, e-mail and granted scopes", async () => {
    const endpoint = tokenEndpoint({
      body: {
        access_token: "at",
        expires_in: 3600,
        refresh_token: "rt",
        id_token: idToken({ email: "me@gmail.com" }),
        scope: auth.GOOGLE_DRIVE_FILE_SCOPE,
      },
    });
    const email = await auth.exchangeCode("google", { code: "c0de", verifier: "v", redirectUri: "http://localhost/cb" });
    expect(email).toBe("me@gmail.com");
    expect(Object.fromEntries(endpoint.params())).toMatchObject({
      grant_type: "authorization_code",
      code: "c0de",
      code_verifier: "v",
      client_id: "client-id",
      client_secret: "client-secret",
    });
    expect(auth.cloudAccount("google")).toEqual({ email: "me@gmail.com" });
    expect(auth.hasScope("google", auth.GOOGLE_DRIVE_FILE_SCOPE)).toBe(true);
    expect(auth.hasScope("google", auth.GOOGLE_APPDATA_SCOPE)).toBe(false);
  });

  it("fails clearly when Google sends no refresh token", async () => {
    tokenEndpoint({ body: { access_token: "at", expires_in: 3600 } });
    await expect(auth.exchangeCode("google", { code: "c", verifier: "v", redirectUri: "x" })).rejects.toThrow(
      /refresh token/,
    );
    expect(auth.cloudAccount("google")).toBeUndefined();
  });

  it("passes Google's error description on", async () => {
    tokenEndpoint({ status: 400, body: { error: "invalid_grant", error_description: "Bad Request" } });
    await expect(auth.exchangeCode("google", { code: "c", verifier: "v", redirectUri: "x" })).rejects.toMatchObject({
      status: 401,
      message: "Bad Request",
    });
  });
});

describe("accessToken", () => {
  it("is undefined while not connected", async () => {
    await expect(auth.accessToken("google")).resolves.toBeUndefined();
  });

  it("reuses a token that is still valid", async () => {
    const endpoint = tokenEndpoint({ body: {} });
    writeJson(tokenFile, { refreshToken: "rt", accessToken: "cached", expiresAt: Date.now() + 600_000 });
    await expect(auth.accessToken("google")).resolves.toBe("cached");
    expect(endpoint.fetch).not.toHaveBeenCalled();
  });

  it("refreshes an expiring token and keeps the refresh token and scopes", async () => {
    const endpoint = tokenEndpoint({ body: { access_token: "fresh", expires_in: 3600 } });
    writeJson(tokenFile, { refreshToken: "rt", accessToken: "old", expiresAt: Date.now() + 30_000, scope: "s1", email: "e" });
    await expect(auth.accessToken("google")).resolves.toBe("fresh");
    expect(Object.fromEntries(endpoint.params())).toMatchObject({ grant_type: "refresh_token", refresh_token: "rt" });
    expect(readJson(tokenFile)).toMatchObject({ refreshToken: "rt", accessToken: "fresh", scope: "s1", email: "e" });
  });

  it("asks to reconnect when the refresh token was revoked", async () => {
    tokenEndpoint({ status: 400, body: { error: "invalid_grant" } });
    writeJson(tokenFile, { refreshToken: "rt" });
    await expect(auth.accessToken("google")).rejects.toMatchObject({
      status: 401,
      message: expect.stringContaining("reconnect"),
    });
  });

  it("reports being offline as 503", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    writeJson(tokenFile, { refreshToken: "rt" });
    await expect(auth.accessToken("google")).rejects.toMatchObject({ status: 503 });
  });
});

describe("disconnect", () => {
  it("revokes the refresh token and forgets it, even if revoking fails", async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError("offline"));
    vi.stubGlobal("fetch", fetch);
    writeJson(tokenFile, { refreshToken: "rt/+" });
    await auth.disconnect("google");
    expect(String(fetch.mock.calls[0][0])).toBe("https://oauth2.googleapis.com/revoke?token=rt%2F%2B");
    expect(fs.existsSync(tokenFile)).toBe(false);
    expect(auth.cloudAccount("google")).toBeUndefined();
  });
});
