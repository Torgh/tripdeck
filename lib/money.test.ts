import { describe, expect, it } from "vitest";
import { budgetCurrency, budgetSummary, convert, foreignCurrencies, formatMoney, parsePrice, tripBudget, type Rates } from "./money";
import { tripWith } from "./testUtils";
import type { Item, ItemType } from "./types";

const card = (id: string, price?: string, extra: { type?: ItemType; paid?: boolean } = {}): Item => ({
  id,
  type: extra.type ?? "activity",
  title: id,
  booking: price ? { price, paid: extra.paid } : undefined,
});

// 1 EUR = 38 THB = 4.25 PLN
const rates: Rates = { base: "EUR", date: "2026-10-22", rates: { THB: 38, PLN: 4.25 } };

describe("parsePrice", () => {
  it.each([
    ["€189", 189, "EUR"],
    ["1 500 THB", 1500, "THB"],
    ["THB 1,500", 1500, "THB"],
    ["฿1,200", 1200, "THB"],
    ["300 zł", 300, "PLN"],
    ["300 PLN", 300, "PLN"],
    ["1500 thb", 1500, "THB"],
    ["$1,234.50", 1234.5, "USD"],
    ["US$ 99", 99, "USD"],
    ["1.234,56 €", 1234.56, "EUR"],
    ["12,50 EUR", 12.5, "EUR"],
    ["1.200 EUR", 1200, "EUR"],
    ["CHF 1'250", 1250, "CHF"],
    ["2 500 baht", 2500, "THB"],
    ["€35 pp, €70 total", 70, "EUR"],
    ["2 × €35", 35, "EUR"],
    ["€30 2 people", 30, "EUR"],
  ])("%s", (text, amount, currency) => {
    expect(parsePrice(text)).toEqual({ amount, currency });
  });

  it("keeps an amount without a currency, and reads free as zero", () => {
    expect(parsePrice("1500")).toEqual({ amount: 1500, currency: undefined });
    expect(parsePrice("70 all inclusive")).toEqual({ amount: 70, currency: undefined });
    expect(parsePrice("Free")).toEqual({ amount: 0 });
  });

  it("is null without a number", () => {
    expect(parsePrice("pay at the hotel")).toBeNull();
    expect(parsePrice("")).toBeNull();
    expect(parsePrice(undefined)).toBeNull();
  });
});

describe("convert and formatMoney", () => {
  it("converts with the rates of the same base, and only those", () => {
    expect(convert({ amount: 380, currency: "THB" }, "EUR", rates)).toBe(10);
    expect(convert({ amount: 5, currency: "EUR" }, "EUR")).toBe(5);
    expect(convert({ amount: 5, currency: "VND" }, "EUR", rates)).toBeUndefined();
    expect(convert({ amount: 380, currency: "THB" }, "PLN", rates)).toBeUndefined();
  });

  it("shows whole units from 100 up", () => {
    expect(formatMoney(1234.4, "EUR")).toBe("€1,234");
    expect(formatMoney(12.5, "EUR")).toBe("€12.50");
    expect(formatMoney(1500, "THB")).toBe("฿1,500");
  });
});

describe("tripBudget", () => {
  it("adds up the days in the trip's currency, paid apart, per day and per kind of card", () => {
    const trip = tripWith([
      [card("hotel", "€420", { type: "stay", paid: true }), card("tour", "1 900 THB")],
      [card("dinner", "€40", { type: "food" }), card("museum")],
    ]);
    trip.items.boat = card("boat", "€99");
    trip.ideas.push("boat");
    const b = tripBudget(trip, rates);
    expect(b.currency).toBe("EUR");
    expect(b.lines.map((l) => [l.item.id, l.converted])).toEqual([
      ["hotel", 420],
      ["tour", 50],
      ["dinner", 40],
    ]);
    expect(b.total).toBe(510);
    expect(b.paid).toBe(420);
    expect(b.byDay).toEqual([470, 40]);
    expect(b.byType).toEqual({ stay: 420, activity: 50, food: 40 });
    expect(b.ideas.map((l) => l.item.id)).toEqual(["boat"]);
    expect(budgetSummary(b)).toBe("€510 · €420 paid · €90 to pay");
  });

  it("leaves out prices without a currency or without a rate, and says so", () => {
    const trip = tripWith([[card("a", "€10"), card("b", "1500"), card("c", "100 VND")]]);
    const b = tripBudget(trip, rates);
    expect(b.total).toBe(10);
    expect(b.noCurrency.map((n) => n.item.id)).toEqual(["b"]);
    expect(b.unconverted).toEqual(["VND"]);
    // Offline, before any rates arrived.
    expect(tripBudget({ ...trip, budget: { currency: "THB" } }).unconverted).toEqual(["EUR", "VND"]);
  });

  it("uses the chosen currency and limit, else the most used currency", () => {
    const trip = tripWith([[card("a", "€10"), card("b", "380 THB"), card("c", "760 THB")]]);
    expect(budgetCurrency(trip)).toBe("THB");
    expect(foreignCurrencies(trip, "THB")).toEqual(["EUR"]);
    trip.budget = { currency: "EUR", limit: 25 };
    const b = tripBudget(trip, rates);
    expect(b.total).toBe(40);
    expect(budgetSummary(b)).toBe("€40 · €15 over €25");
    expect(budgetCurrency(tripWith([[card("x")]]))).toBe("EUR");
  });
});
