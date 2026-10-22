import { expect, test as base, type BrowserContext, type Page } from "@playwright/test";

export { expect };

/** Exchange rates for every test, from 1 EUR – so conversions are known in advance. */
const EUR_RATES: Record<string, number> = { EUR: 1, PLN: 4.25, THB: 38, USD: 1.1 };

function ratesFrom(base: string) {
  const from = EUR_RATES[base] ?? 1;
  const rates = Object.fromEntries(
    Object.entries(EUR_RATES)
      .filter(([code]) => code !== base)
      .map(([code, perEur]) => [code, perEur / from]),
  );
  return { amount: 1, base, date: "2026-10-22", rates };
}

/** A plain map style: no tiles to download, the pins still show. */
const MAP_STYLE = {
  version: 8,
  sources: {},
  layers: [{ id: "land", type: "background", paint: { "background-color": "#e8eef2" } }],
};

const isLocal = (url: URL) => ["127.0.0.1", "localhost"].includes(url.hostname);

/**
 * No outside services: anything leaving this machine is blocked, the map gets a plain style, and the
 * exchange rates are the ones above. The desktop app's own routes that call Google or OpenStreetMap
 * answer as if offline, so the board shows straight-line estimates – as it does without internet.
 */
async function offline(context: BrowserContext) {
  // Later routes take precedence, so the catch-all comes first.
  await context.route((url) => !isLocal(url), (route) => route.abort("internetdisconnected"));
  await context.route("https://tiles.openfreemap.org/styles/**", (route) => route.fulfill({ json: MAP_STYLE }));
  await context.route("https://api.frankfurter.dev/**", (route) =>
    route.fulfill({ json: ratesFrom(new URL(route.request().url()).searchParams.get("base") ?? "EUR") }),
  );
  await context.route(/\/api\/(route|elevation|timezone|places|ai)(\/|$|\?)/, (route) =>
    route.fulfill({ status: 503, json: { error: "Offline in the end-to-end tests." } }),
  );
  await context.route(/\/api\/rates$/, (route) =>
    route.fulfill({ json: ratesFrom((route.request().postDataJSON() as { base: string }).base) }),
  );
}

export const test = base.extend<{ page: Page }>({
  // Every test runs offline and fails on an error in the page (blocked requests aside).
  page: async ({ page }, run) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) errors.push(m.text());
    });
    await offline(page.context());
    await run(page);
    expect(errors, "errors in the page").toEqual([]);
  },
});
