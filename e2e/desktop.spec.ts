import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { E2E_HOME } from "../playwright.config";
import { parseTripFile } from "../lib/tripOps";
import { expect, test } from "./fixtures";

/** Loads the demo trip from the home page and returns its id. */
async function loadDemo(page: Page): Promise<string> {
  await page.goto("/");
  await page.getByRole("button", { name: "Load demo trip" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Malta & Gozo dive week (demo)");
  return new URL(page.url()).searchParams.get("id")!;
}

const header = (page: Page) => page.locator(".topbar");
const day = (page: Page, n: number) => page.locator("section.column").filter({ has: page.getByRole("heading", { name: new RegExp(`^Day ${n} ·`) }) });
const card = (page: Page, title: string) => page.locator("article.item").filter({ hasText: title });

test("loads the demo with its days, to-dos, budget and map", async ({ page }) => {
  await loadDemo(page);
  await expect(page.getByRole("heading", { name: /^Day \d+ ·/ })).toHaveCount(7);
  await expect(header(page)).toContainText("📝 2 to sort out");
  await expect(header(page)).toContainText("💰 €1,307 of €1,500");
  await expect(header(page)).toContainText(/⚠️ \d+ warning/);
  await expect(card(page, "St John's Co-Cathedral")).toContainText("Closed on this weekday");
  await expect(page.locator(".maplibregl-marker").first()).toBeVisible();
});

test("moves a card to another day by dragging, and keeps it after a reload", async ({ page }) => {
  await loadDemo(page);
  const dinner = card(page, "Dinner at Spinola Bay");
  await expect(day(page, 1)).toContainText("Dinner at Spinola Bay");

  // The card is last in a day that scrolls; bring it into view, then drag it to day 2 next door.
  await dinner.scrollIntoViewIfNeeded();
  const from = (await dinner.boundingBox())!;
  const to = (await day(page, 2).locator(".column-body").boundingBox())!;
  await page.mouse.move(from.x + 40, from.y + 15);
  await page.mouse.down();
  // The board starts dragging after the pointer moves a few pixels.
  await page.mouse.move(from.x + 60, from.y + 30, { steps: 5 });
  await expect(page.locator(".item.overlay")).toBeVisible();
  await page.mouse.move(to.x + to.width / 2, Math.max(to.y, 120) + 40, { steps: 25 });
  await page.mouse.up();

  await expect(day(page, 2)).toContainText("Dinner at Spinola Bay");
  await expect(day(page, 1)).not.toContainText("Dinner at Spinola Bay");
  await page.reload();
  await expect(day(page, 2)).toContainText("Dinner at Spinola Bay");
});

test("adds a card with a price, marks it paid and deletes it again", async ({ page }) => {
  await loadDemo(page);
  await day(page, 2).getByRole("button", { name: "+ Add" }).click();
  const editor = page.getByRole("dialog");
  await editor.getByLabel("Title").fill("Gelato at Valletta");
  const price = editor.getByLabel("Price");
  await price.fill("1500");
  await expect(editor).toContainText("Add the currency");
  await price.fill("€12.50");
  await expect(editor).toContainText("Budget: €12.50");
  await editor.getByLabel("Paid").check();
  await editor.getByRole("button", { name: "Save" }).click();

  await expect(day(page, 2)).toContainText("Gelato at Valletta");
  await expect(header(page)).toContainText("💰 €1,320 of €1,500");

  page.once("dialog", (d) => d.accept());
  await card(page, "Gelato at Valletta").dblclick();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(day(page, 2)).not.toContainText("Gelato at Valletta");
  await expect(header(page)).toContainText("💰 €1,307 of €1,500");
});

test("shows what is left to sort out", async ({ page }) => {
  await loadDemo(page);
  await header(page).getByRole("button", { name: "📝 2 to sort out" }).click();
  const todo = page.getByRole("dialog");
  await expect(todo).toContainText("Waiting for confirmation");
  await expect(todo).toContainText("To book");
});

test("budget: paid ticks, another currency, the limit converted with it", async ({ page }) => {
  await loadDemo(page);
  await header(page).getByRole("button", { name: /💰/ }).click();
  const budget = page.getByRole("dialog");
  await expect(budget).toContainText("€609 paid · €698 to pay");

  await budget.locator("li", { hasText: "Rental car" }).getByLabel("Paid").check();
  await expect(budget).toContainText("€777 paid · €530 to pay");

  // 1 EUR = 4.25 PLN in the tests: €1,307 → zł 5,555, and the €1,500 limit → zł 6,375.
  await budget.getByLabel("Currency").selectOption("PLN");
  await expect(budget.locator(".budget-amount")).toContainText("5,555");
  await expect(budget).toContainText("6,375");
});

test("trip settings: a later last day adds days", async ({ page }) => {
  await loadDemo(page);
  await header(page).getByRole("button", { name: /Trip/ }).click();
  const settings = page.getByRole("dialog");
  const last = settings.getByLabel("Last day");
  const end = new Date(`${await last.inputValue()}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  await last.fill(end.toISOString().slice(0, 10));
  await expect(settings).toContainText("8 days · 1 empty days added at the end");
  await settings.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: /^Day \d+ ·/ })).toHaveCount(8);
});

test("a pin on the map highlights its card", async ({ page }) => {
  await loadDemo(page);
  // Pins overlap where cards are close together, so the click goes to the pin itself.
  await page.locator(".maplibregl-marker").first().dispatchEvent("click");
  await expect(page.locator("article.item.highlight")).toHaveCount(1);
});

test("exports the trip as JSON that imports again, and prints the itinerary", async ({ page }) => {
  const id = await loadDemo(page);
  await header(page).getByRole("button", { name: /Export/ }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: /JSON/ }).click();
  const file = await (await download).path();
  const trip = parseTripFile(JSON.parse(fs.readFileSync(file, "utf8")), { keepId: true });
  expect(trip.id).toBe(id);
  expect(trip.days).toHaveLength(7);
  expect(trip.budget).toEqual({ currency: "EUR", limit: 1500 });

  await page.goto(`/trip/print?id=${id}`);
  await expect(page.getByRole("heading", { name: "Bookings" })).toBeVisible();
  await expect(page.locator("p", { hasText: "Total:" })).toContainText("€1,307 · €609 paid");
});

test("saves the trip on this PC", async ({ page }) => {
  const id = await loadDemo(page);
  await expect(page.getByText("Saved on this PC")).toBeVisible();
  const file = path.join(E2E_HOME, "trips", `${id}.json`);
  await expect.poll(() => fs.existsSync(file)).toBe(true);
  expect(JSON.parse(fs.readFileSync(file, "utf8")).name).toBe("Malta & Gozo dive week (demo)");
});
