import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

const home = vi.hoisted(() => {
  const dir = `${process.env.TMPDIR ?? process.env.TEMP ?? "/tmp"}/tripdeck-rates-test-${process.pid}`;
  process.env.TRIPDECK_HOME = dir;
  return dir;
});

const { exchangeRates } = await import("./rates");

afterEach(() => {
  vi.unstubAllGlobals();
  fs.rmSync(home, { recursive: true, force: true });
});

describe("exchangeRates", () => {
  it("asks frankfurter once and keeps the answer", async () => {
    const fetch = vi.fn(async (_url: string) =>
      Response.json({ amount: 1, base: "PLN", date: "2026-10-22", rates: { EUR: 0.23, THB: 8.65 } }),
    );
    vi.stubGlobal("fetch", fetch);
    const want = { base: "PLN", date: "2026-10-22", rates: { EUR: 0.23, THB: 8.65 } };
    expect(await exchangeRates("PLN")).toEqual(want);
    expect(await exchangeRates("PLN")).toEqual(want);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe("https://api.frankfurter.dev/v1/latest?base=PLN");
  });

  it("refuses currencies without ECB rates and reports failures", async () => {
    await expect(exchangeRates("VND")).rejects.toMatchObject({ status: 400 });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
    await expect(exchangeRates("EUR")).rejects.toMatchObject({ status: 502 });
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("fetch failed"))));
    await expect(exchangeRates("USD")).rejects.toMatchObject({ status: 503 });
  });
});
