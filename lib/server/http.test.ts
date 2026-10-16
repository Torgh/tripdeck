import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { assertLocal, handle, HttpError, readBody } from "./http";

const req = (url: string, headers: Record<string, string> = {}, init: RequestInit = {}) =>
  new Request(url, { ...init, headers: { host: new URL(url).host, ...headers } });

const status = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return (err as HttpError).status;
  }
  return 200;
};

describe("assertLocal", () => {
  it.each(["http://localhost:3000/api/trips", "http://127.0.0.1:3000/api/trips", "http://[::1]:3000/api/trips"])(
    "accepts %s",
    (url) => {
      expect(status(() => assertLocal(req(url)))).toBe(200);
    },
  );

  it("accepts same-origin requests from the app's own pages", () => {
    expect(status(() => assertLocal(req("http://localhost:3000/api/trips", { origin: "http://localhost:3000" })))).toBe(200);
  });

  it("rejects requests addressed to another host", () => {
    expect(status(() => assertLocal(req("http://tripdeck.example/api/trips")))).toBe(403);
  });

  it("rejects DNS rebinding: a localhost URL with a foreign Host header", () => {
    expect(status(() => assertLocal(req("http://localhost:3000/api/trips", { host: "evil.example:3000" })))).toBe(403);
  });

  it("rejects cross-site requests from another origin", () => {
    const r = req("http://localhost:3000/api/config", { origin: "https://evil.example" });
    expect(() => assertLocal(r)).toThrow(/Cross-site/);
  });
});

describe("readBody", () => {
  const schema = z.object({ name: z.string() });
  const post = (body: string, type = "application/json") =>
    new Request("http://localhost/api", { method: "POST", headers: { "content-type": type }, body });

  it("parses and validates JSON", async () => {
    await expect(readBody(post('{"name":"Malta"}'), schema)).resolves.toEqual({ name: "Malta" });
  });

  it("requires the JSON content type, which blocks cross-site form posts", async () => {
    await expect(readBody(post('{"name":"x"}', "application/x-www-form-urlencoded"), schema)).rejects.toMatchObject({
      status: 415,
    });
  });

  it("rejects malformed JSON and schema mismatches with 400", async () => {
    await expect(readBody(post("{nope"), schema)).rejects.toMatchObject({ status: 400 });
    await expect(readBody(post('{"name":1}'), schema)).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("Invalid request"),
    });
  });
});

describe("handle", () => {
  const run = async (fn: () => Promise<unknown>) => {
    const res = await handle(fn)(new Request("http://localhost/api"), undefined);
    return { status: res.status, body: await res.json() };
  };

  it("returns results as JSON and passes Responses through", async () => {
    expect(await run(async () => ({ ok: true }))).toEqual({ status: 200, body: { ok: true } });
    const res = await handle(async () => new Response("raw", { status: 201 }))(new Request("http://localhost"), undefined);
    expect([res.status, await res.text()]).toEqual([201, "raw"]);
  });

  it("turns HttpErrors into their status and message", async () => {
    expect(
      await run(async () => {
        throw new HttpError(404, "Trip not found.");
      }),
    ).toEqual({ status: 404, body: { error: "Trip not found." } });
  });

  it("maps Claude API errors to helpful messages", async () => {
    const auth = new Anthropic.AuthenticationError(401, { error: {} }, "bad key", new Headers());
    expect(
      await run(async () => {
        throw auth;
      }),
    ).toEqual({ status: 503, body: { error: expect.stringContaining("check the API key") } });
    const limit = new Anthropic.RateLimitError(429, { error: {} }, "slow down", new Headers());
    expect(
      (
        await run(async () => {
          throw limit;
        })
      ).status,
    ).toBe(429);
  });

  it("hides unexpected errors behind a generic 500", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(
      await run(async () => {
        throw new Error("secret stack details");
      }),
    ).toEqual({ status: 500, body: { error: "Unexpected server error." } });
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
