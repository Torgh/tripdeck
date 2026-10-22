import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const home = vi.hoisted(() => {
  const dir = `${process.env.TMPDIR ?? process.env.TEMP ?? "/tmp"}/tripdeck-api-test-${process.pid}`;
  process.env.TRIPDECK_HOME = dir;
  return dir;
});

const { GOOGLE_APPDATA_SCOPE, GOOGLE_DRIVE_FILE_SCOPE } = await import("@/lib/server/cloudAuth");
const { readFileConfig, writeConfig } = await import("@/lib/server/config");
const { storeFor } = await import("@/lib/server/tripStore");
const { connectGoogle, fakeGoogleDrive, hideOneDrive, trip } = await import("@/lib/server/testUtils");
const tripsRoute = await import("./trips/route");
const tripRoute = await import("./trips/[id]/route");
const storageRoute = await import("./storage/route");
const configRoute = await import("./config/route");
const startRoute = await import("./auth/[provider]/start/route");
const callbackRoute = await import("./auth/[provider]/callback/route");
const disconnectRoute = await import("./auth/[provider]/disconnect/route");

const ORIGIN = "http://localhost:3000";

function request(pathname: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  return new NextRequest(`${ORIGIN}${pathname}`, {
    method: init.method ?? "GET",
    headers: {
      host: "localhost:3000",
      ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

const json = async (res: Response) => ({ status: res.status, body: await res.json() });
const params = <T extends object>(p: T) => ({ params: Promise.resolve(p) });
const oneDrive = path.join(home, "OneDrive");

beforeEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
  hideOneDrive();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("/api/trips", () => {
  it("saves, lists, reads and deletes a trip", async () => {
    const t = trip("abc", "Malta");
    expect((await json(await tripRoute.PUT(request("/api/trips/abc", { method: "PUT", body: t }), params({ id: "abc" })))).body).toEqual({ ok: true });

    expect((await json(await tripsRoute.GET(request("/api/trips"), undefined))).body).toEqual({
      storage: "local",
      trips: [expect.objectContaining({ id: "abc", name: "Malta", updatedAt: t.updatedAt })],
    });
    expect((await json(await tripRoute.GET(request("/api/trips/abc"), params({ id: "abc" })))).body.trip).toEqual(t);

    await tripRoute.DELETE(request("/api/trips/abc", { method: "DELETE" }), params({ id: "abc" }));
    expect((await json(await tripRoute.GET(request("/api/trips/abc"), params({ id: "abc" })))).status).toBe(404);
  });

  it("rejects a body whose id doesn't match the URL", async () => {
    const res = await tripRoute.PUT(request("/api/trips/abc", { method: "PUT", body: trip("other", "x") }), params({ id: "abc" }));
    expect(await json(res)).toEqual({ status: 400, body: { error: "Trip id mismatch." } });
  });

  it("rejects ids that could escape the trips folder", async () => {
    const res = await tripRoute.GET(request("/api/trips/x"), params({ id: "../config" }));
    expect((await json(res)).status).toBe(400);
  });

  it("rejects bodies that are not trips", async () => {
    const res = await tripRoute.PUT(request("/api/trips/abc", { method: "PUT", body: { id: "abc" } }), params({ id: "abc" }));
    expect((await json(res)).status).toBe(400);
  });

  it("only answers on localhost", async () => {
    const res = await tripsRoute.GET(request("/api/trips", { headers: { host: "evil.example" } }), undefined);
    expect((await json(res)).status).toBe(403);
  });
});

describe("/api/storage", () => {
  it("switches to OneDrive and copies the trips there", async () => {
    fs.mkdirSync(oneDrive, { recursive: true });
    writeConfig({ oneDriveFolder: oneDrive });
    await storeFor("local").put(trip("t1", "Malta"));

    const res = await storageRoute.POST(request("/api/storage", { method: "POST", body: { storage: "onedrive" } }), undefined);
    expect(await json(res)).toEqual({ status: 200, body: { ok: true, copied: 1 } });
    expect(readFileConfig().storage).toBe("onedrive");
    expect(fs.readdirSync(path.join(oneDrive, "TripDeck"))).toEqual(["Malta (t1).tripdeck.json"]);

    // Switching back copies nothing new: this PC already has the same version.
    const back = await storageRoute.POST(request("/api/storage", { method: "POST", body: { storage: "local" } }), undefined);
    expect((await json(back)).body).toEqual({ ok: true, copied: 0 });
  });

  it("refuses storage that isn't available", async () => {
    const google = await storageRoute.POST(request("/api/storage", { method: "POST", body: { storage: "google" } }), undefined);
    expect(await json(google)).toEqual({ status: 400, body: { error: "Connect Google Drive first." } });
    const onedrive = await storageRoute.POST(request("/api/storage", { method: "POST", body: { storage: "onedrive" } }), undefined);
    expect((await json(onedrive)).status).toBe(400);
    const bogus = await storageRoute.POST(request("/api/storage", { method: "POST", body: { storage: "ftp" } }), undefined);
    expect((await json(bogus)).status).toBe(400);
    expect(readFileConfig().storage).toBeUndefined();
  });
});

describe("/api/config", () => {
  it("reports which secrets are set without ever returning them", async () => {
    writeConfig({ googleClientId: "id-123", googleClientSecret: "very-secret-value", anthropicApiKey: "sk-ant-secret" });
    const { body } = await json(await configRoute.GET(request("/api/config"), undefined));
    expect(JSON.stringify(body)).not.toMatch(/very-secret-value|sk-ant-secret/);
    expect(body.set).toMatchObject({ googleClientId: true, googleClientSecret: true, anthropicApiKey: true });
    expect(body).toMatchObject({ storage: "local", ai: true, cloud: { google: { clientConfigured: true, connected: false } } });
  });

  it("saves settings and removes them with empty strings", async () => {
    await configRoute.POST(request("/api/config", { method: "POST", body: { anthropicApiKey: "sk-1" } }), undefined);
    expect(readFileConfig().anthropicApiKey).toBe("sk-1");
    await configRoute.POST(request("/api/config", { method: "POST", body: { anthropicApiKey: "" } }), undefined);
    expect(readFileConfig().anthropicApiKey).toBeUndefined();
  });

  it("does not let the settings form change the storage choice", async () => {
    const res = await configRoute.POST(request("/api/config", { method: "POST", body: { storage: "google" } }), undefined);
    expect((await json(res)).status).toBe(200);
    expect(readFileConfig().storage).toBeUndefined();
  });

  it("flags a Google connection that still uses the hidden folder", async () => {
    connectGoogle(home, GOOGLE_APPDATA_SCOPE);
    const { body } = await json(await configRoute.GET(request("/api/config"), undefined));
    expect(body.cloud.google).toMatchObject({ connected: true, needsReconnect: true });
    expect(body.storage).toBe("google");
  });
});

describe("Google sign-in", () => {
  const cookie = (res: Response, name: string) =>
    res.headers
      .getSetCookie()
      .find((c) => c.startsWith(`${name}=`))!
      .split(";")[0]
      .split("=")[1];

  it("start sets state + PKCE cookies scoped to the provider and redirects to Google", async () => {
    writeConfig({ googleClientId: "id", googleClientSecret: "secret" });
    const res = await startRoute.GET(request("/api/auth/google/start"), params({ provider: "google" }));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/api/auth/google/callback`);
    expect(location.searchParams.get("state")).toBe(cookie(res, "td_oauth_state"));
    expect(res.headers.getSetCookie().every((c) => /HttpOnly/i.test(c) && c.includes("Path=/api/auth/google"))).toBe(true);
  });

  it("start rejects unknown providers", async () => {
    const res = await startRoute.GET(request("/api/auth/dropbox/start"), params({ provider: "dropbox" }));
    expect((await json(res)).status).toBe(404);
  });

  const callback = (query: string, cookies: Record<string, string>) =>
    callbackRoute.GET(
      request(`/api/auth/google/callback?${query}`, {
        headers: { cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ") },
      }),
      params({ provider: "google" }),
    );
  const redirectedTo = (res: Response) => Object.fromEntries(new URL(res.headers.get("location")!).searchParams);

  it("callback rejects a state that doesn't match the cookie (CSRF)", async () => {
    const res = await callback("code=c&state=attacker", { td_oauth_state: "mine", td_oauth_verifier: "v" });
    expect(redirectedTo(res)).toMatchObject({ provider: "google", status: "error" });
  });

  it("callback reports when the user declined", async () => {
    const res = await callback("error=access_denied", {});
    expect(redirectedTo(res)).toMatchObject({ status: "error", message: "Access was not granted." });
  });

  it("callback connects Google, switches storage and moves trips into the visible folder", async () => {
    writeConfig({ googleClientId: "id", googleClientSecret: "secret" });
    await storeFor("local").put(trip("local1", "From this PC"));
    // An older connection left a trip in the hidden app folder.
    connectGoogle(home, GOOGLE_APPDATA_SCOPE);
    const drive = fakeGoogleDrive();
    vi.stubGlobal("fetch", drive.fetch);
    await storeFor("google").put(trip("hidden1", "From the hidden folder"));
    // Trips are on this PC for now; signing in should switch to Google.
    writeConfig({ storage: "local" });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) =>
        String(url).startsWith("https://oauth2.googleapis.com/token")
          ? Response.json({
              access_token: "at",
              expires_in: 3600,
              refresh_token: "rt",
              scope: `${GOOGLE_DRIVE_FILE_SCOPE} ${GOOGLE_APPDATA_SCOPE}`,
            })
          : drive.fetch(url, init),
      ),
    );
    const res = await callback("code=c&state=s", { td_oauth_state: "s", td_oauth_verifier: "v" });
    expect(redirectedTo(res)).toEqual({ provider: "google", status: "connected" });
    expect(readFileConfig().storage).toBe("google");

    const visible = [...drive.files.values()].filter((f) => !f.folder && f.parent !== "appDataFolder");
    expect(visible.map((f) => f.name).sort()).toEqual([
      "From the hidden folder (hidden1).tripdeck.json",
      "From this PC (local1).tripdeck.json",
    ]);
  });

  it("disconnect copies the trips to this PC and switches back", async () => {
    connectGoogle(home, `${GOOGLE_DRIVE_FILE_SCOPE} ${GOOGLE_APPDATA_SCOPE}`);
    writeConfig({ storage: "google" });
    const drive = fakeGoogleDrive();
    vi.stubGlobal("fetch", drive.fetch);
    await storeFor("google").put(trip("g1", "On Drive"));

    const res = await disconnectRoute.POST(request("/api/auth/google/disconnect", { method: "POST", body: {} }), params({ provider: "google" }));
    expect((await json(res)).body).toEqual({ ok: true });
    expect(readFileConfig().storage).toBe("local");
    expect(fs.existsSync(path.join(home, "google-token.json"))).toBe(false);
    expect((await storeFor("local").get("g1"))?.name).toBe("On Drive");
  });
});

