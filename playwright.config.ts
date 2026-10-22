import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests: the real apps in a real browser. The desktop app runs as a production build,
 * the phone app as its Vite build. Outside services (routes, places, maps, exchange rates) are
 * replaced in the browser (e2e/fixtures.ts), so the tests need no keys and no internet.
 */

/** The desktop app's data folder (trips, settings, caches): a temporary one, never your ~/.tripdeck. */
export const E2E_HOME = path.join(os.tmpdir(), "tripdeck-e2e");

// Playwright loads this file in every worker too; only the main process starts from an empty folder.
if (!process.env.TEST_WORKER_INDEX) {
  fs.rmSync(E2E_HOME, { recursive: true, force: true });
  fs.mkdirSync(E2E_HOME, { recursive: true });
  fs.writeFileSync(path.join(E2E_HOME, "config.json"), JSON.stringify({ storage: "local" }));
}

const DESKTOP = "http://127.0.0.1:3210";
const PHONE = "http://localhost:5210";
// Set (even empty) variables win over .env.local, so your keys never reach the apps under test.
const NO_KEYS = {
  GOOGLE_MAPS_API_KEY: "",
  NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: "",
  ANTHROPIC_API_KEY: "",
  GOOGLE_CLIENT_ID: "",
  GOOGLE_CLIENT_SECRET: "",
  NEXT_TELEMETRY_DISABLED: "1",
};
const CI = !!process.env.CI;

export default defineConfig({
  testDir: "e2e",
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  workers: CI ? 2 : undefined,
  reporter: CI ? [["github"], ["html", { open: "never" }]] : [["list"], ["html", { open: "never" }]],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    // CI installs Playwright's Chromium; on Windows the installed Edge does without the download.
    channel: !CI && process.platform === "win32" ? "msedge" : undefined,
    // A service worker would fetch past the stubs in e2e/fixtures.ts.
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", testMatch: /desktop\.spec\.ts/, use: { baseURL: DESKTOP, viewport: { width: 1400, height: 900 } } },
    { name: "phone", testMatch: /phone\.spec\.ts/, use: { ...devices["Pixel 7"], baseURL: PHONE } },
  ],
  webServer: [
    {
      command: "bun run build && bunx next start -H 127.0.0.1 -p 3210",
      url: DESKTOP,
      env: { ...NO_KEYS, TRIPDECK_HOME: E2E_HOME },
      reuseExistingServer: !CI,
      timeout: 300_000,
    },
    {
      command: "bun run build:mobile && bunx vite preview --config mobile/vite.config.mts --port 5210 --strictPort",
      url: PHONE,
      env: NO_KEYS,
      reuseExistingServer: !CI,
      timeout: 120_000,
    },
  ],
});
