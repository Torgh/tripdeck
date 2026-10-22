import type { Page } from "@playwright/test";
import { demoTrip } from "../lib/demo";
import { expect, test } from "./fixtures";

const dayHead = (page: Page) => page.locator(".day-head h2");

/** A horizontal swipe across the plan (the app turns it into the next or previous day). */
async function swipe(page: Page, dx: number) {
  await page.locator("main.content").evaluate((el, dx) => {
    const at = (x: number) => new Touch({ identifier: 1, target: el, clientX: x, clientY: 400 });
    el.dispatchEvent(new TouchEvent("touchstart", { touches: [at(200)], changedTouches: [at(200)], bubbles: true }));
    el.dispatchEvent(new TouchEvent("touchend", { touches: [], changedTouches: [at(200 + dx)], bubbles: true }));
  }, dx);
}

test("shows the demo day by day, swipes between days and opens the budget", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Load demo trip/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Malta & Gozo dive week (demo)");

  await page.locator(".day-chip").first().click();
  await expect(dayHead(page)).toHaveText(/^Day 1 ·/);
  await expect(page.locator(".day-head")).toContainText("💰 €777");
  await expect(page.locator(".card", { hasText: "Flight to Malta" })).toContainText("€189 ✓ paid");

  await swipe(page, -150);
  await expect(dayHead(page)).toHaveText(/^Day 2 ·/);
  await swipe(page, 150);
  await expect(dayHead(page)).toHaveText(/^Day 1 ·/);

  await page.locator(".day-chip.budget").click();
  await expect(page.locator(".budget-amount")).toHaveText("€1,307");
  await expect(page.locator(".budget-total")).toContainText("€193 left of €1,500");
  // A row of the budget leads to its day.
  await page.locator(".budget-list li", { hasText: "Comino Blue Lagoon boat trip" }).click();
  await expect(dayHead(page)).toHaveText(/^Day 5 ·/);
});

test("imports a trip file exported on the desktop", async ({ page }) => {
  const trip = { ...demoTrip(), name: "Imported Malta" };
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "Imported Malta.tripdeck.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(trip)),
  });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Imported Malta");
  await expect(page.getByText("Imported “Imported Malta”")).toBeVisible();
});
