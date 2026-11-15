import { translator, type Lang } from "./i18n";
import type { Expense, ExpenseKind, Item, ItemType, Trip } from "./types";

/** Currencies with daily ECB reference rates (frankfurter.dev): the ones a budget can be kept in. */
export const RATE_CURRENCIES = [
  "AUD", "BRL", "CAD", "CHF", "CNY", "CZK", "DKK", "EUR", "GBP", "HKD", "HUF", "IDR", "ILS", "INR", "ISK",
  "JPY", "KRW", "MXN", "MYR", "NOK", "NZD", "PHP", "PLN", "RON", "SEK", "SGD", "THB", "TRY", "USD", "ZAR",
] as const;

export interface Money {
  amount: number;
  /** ISO 4217 code. Missing when the price names no currency ("1500"). */
  currency?: string;
}

/** Exchange rates on `date`: 1 `base` = `rates[code]` of each other currency. */
export interface Rates {
  base: string;
  date: string;
  rates: Record<string, number>;
}

/** Today's ECB reference rates from 1 `base`: free, no key, and it allows requests from any page (CORS). */
export function ratesUrl(base: string): string {
  return `https://api.frankfurter.dev/v1/latest?base=${base}`;
}

/** Keeps the parts of frankfurter's answer the budget uses. */
export function toRates(data: Rates): Rates {
  return { base: data.base, date: data.date, rates: data.rates };
}

/** Symbols and words, longest first so "US$" wins over "$". Ambiguous ones ("kr", "R") are left out. */
const SYMBOLS: [string, string][] = [
  ["US$", "USD"], ["A$", "AUD"], ["AU$", "AUD"], ["C$", "CAD"], ["CA$", "CAD"], ["NZ$", "NZD"], ["S$", "SGD"],
  ["HK$", "HKD"], ["R$", "BRL"], ["MX$", "MXN"], ["$", "USD"], ["€", "EUR"], ["£", "GBP"], ["¥", "JPY"],
  ["₹", "INR"], ["฿", "THB"], ["₺", "TRY"], ["₩", "KRW"], ["₱", "PHP"], ["₪", "ILS"], ["₫", "VND"],
  ["zł", "PLN"], ["zl", "PLN"], ["Kč", "CZK"], ["Ft", "HUF"], ["RM", "MYR"], ["Rp", "IDR"], ["lei", "RON"],
  ["baht", "THB"], ["euros", "EUR"], ["euro", "EUR"], ["dollars", "USD"], ["złotych", "PLN"], ["zloty", "PLN"],
];

const KNOWN_CODES: Set<string> = (() => {
  try {
    return new Set(Intl.supportedValuesOf("currency"));
  } catch {
    return new Set(RATE_CURRENCIES);
  }
})();

// Thousands grouped by spaces or apostrophes only in threes ("1 500", "1'500"), so "€30 2 people" stays 30.
const NUMBER = /\d{1,3}(?:[   '’]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)*/g;
const FREE = /^\s*(free|included|incl\.?|0)\s*$/i;

/** "1,200" / "1.200" / "1 200" → 1200; "12,50" / "12.5" → 12.5; "1.234,56" / "1,234.56" → 1234.56. */
function parseNumber(token: string): number {
  const t = token.replace(/[\s  '’]/g, "");
  const lastDot = t.lastIndexOf(".");
  const lastComma = t.lastIndexOf(",");
  let normal: string;
  if (lastDot >= 0 && lastComma >= 0) {
    const decimal = lastDot > lastComma ? "." : ",";
    const group = decimal === "." ? "," : ".";
    normal = t.split(group).join("").replace(decimal, ".");
  } else {
    const sep = lastDot >= 0 ? "." : lastComma >= 0 ? "," : "";
    const parts = sep ? t.split(sep) : [t];
    // One separator followed by exactly three digits, or several separators, group thousands.
    const grouping = parts.length > 2 || (parts.length === 2 && parts[1].length === 3);
    normal = grouping ? parts.join("") : parts.join(".");
  }
  return Number(normal);
}

/** The currency written right before (`before`) or right after a number. */
function currencyNear(text: string, before: boolean): string | undefined {
  const s = before ? text.trimEnd() : text.trimStart();
  for (const [symbol, code] of SYMBOLS) {
    const lower = symbol.toLowerCase();
    const near = before ? s.toLowerCase().endsWith(lower) : s.toLowerCase().startsWith(lower);
    if (!near) continue;
    // A word must stand alone ("RM 50", not "FARM 50"); symbols can touch anything.
    const neighbour = before ? s[s.length - symbol.length - 1] : s[symbol.length];
    if (/[a-z]/i.test(symbol) && neighbour && /[a-z]/i.test(neighbour)) continue;
    return code;
  }
  const code = before ? /(?:^|[^A-Za-z])([A-Za-z]{3})$/.exec(s)?.[1] : /^([A-Za-z]{3})(?![A-Za-z])/.exec(s)?.[1];
  if (!code) return undefined;
  const upper = code.toUpperCase();
  // Lower case only for the common ones ("1500 thb"), so words like "all" or "per" aren't currencies.
  const known = code === upper ? KNOWN_CODES.has(upper) : (RATE_CURRENCIES as readonly string[]).includes(upper);
  return known ? upper : undefined;
}

/**
 * Reads a price as people write it: "€189", "1 500 THB", "THB 1,500", "300 zł", "$1,234.50", "Free".
 * When the text has several amounts ("€35 pp, €70 total") the largest one with a currency is the
 * price. Null when there is no number at all.
 */
export function parsePrice(text: string | undefined): Money | null {
  if (!text) return null;
  if (FREE.test(text)) return { amount: 0 };
  const found: Money[] = [];
  for (const m of text.matchAll(NUMBER)) {
    const amount = parseNumber(m[0]);
    if (!Number.isFinite(amount)) continue;
    const currency =
      currencyNear(text.slice(0, m.index), true) ?? currencyNear(text.slice(m.index + m[0].length), false);
    found.push({ amount, currency });
  }
  if (!found.length) return null;
  const priced = found.filter((f) => f.currency);
  const pool = priced.length ? priced : found;
  return pool.reduce((best, f) => (f.amount > best.amount ? f : best));
}

/** `money` in `rates.base`, or undefined without a rate for its currency. */
export function convert(money: Money, base: string, rates?: Rates): number | undefined {
  if (!money.currency) return money.amount === 0 ? 0 : undefined;
  if (money.currency === base) return money.amount;
  const rate = rates?.base === base ? rates.rates[money.currency] : undefined;
  return rate ? money.amount / rate : undefined;
}

/** "€1,235" – whole units from 100 up, cents below. */
export function formatMoney(amount: number, currency: string): string {
  const digits = Math.abs(amount) >= 100 || Number.isInteger(amount) ? 0 : 2;
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      maximumFractionDigits: digits,
      minimumFractionDigits: digits,
    }).format(amount);
  } catch {
    return `${amount.toFixed(digits)} ${currency}`;
  }
}

export interface BudgetLine {
  item: Item;
  /** Undefined for cards in Ideas. */
  dayIndex?: number;
  price: Money;
  /** In the budget's currency; undefined without an exchange rate. */
  converted?: number;
  paid: boolean;
  /** The part paid at the place itself (`booking.onSite`), never paid in advance. */
  onSite?: boolean;
  /** Only cash is taken there. */
  cash?: boolean;
}

/** Cash to bring in one currency: the on-site payments that take only cash, per day. */
export interface CashNeed {
  currency: string;
  amount: number;
  byDay: { dayIndex: number; amount: number }[];
}

export interface Budget {
  currency: string;
  limit?: number;
  /** Priced cards on the days, in trip order; a card paid partly on site has a second, `onSite` line. */
  lines: BudgetLine[];
  /** Priced cards in Ideas: not counted. */
  ideas: BudgetLine[];
  /** Prices that name no currency: not counted. `text` is the price as written. */
  noCurrency: { item: Item; dayIndex?: number; text: string }[];
  /** Cash-only payments on site, by currency (most first). */
  cash: CashNeed[];
  /** Currencies on the days with no exchange rate (yet): those prices aren't in the totals. */
  unconverted: string[];
  /** The day of the exchange rates used, when any price was converted. */
  ratesDate?: string;
  total: number;
  paid: number;
  byDay: number[];
  byType: Partial<Record<ItemType, number>>;
}

/** The trip's currency: the one chosen, else the most used one among its prices, else euros. */
export function budgetCurrency(trip: Trip): string {
  if (trip.budget?.currency) return trip.budget.currency;
  const count = new Map<string, number>();
  for (const item of Object.values(trip.items)) {
    const c = parsePrice(item.booking?.price)?.currency;
    if (c && (RATE_CURRENCIES as readonly string[]).includes(c)) count.set(c, (count.get(c) ?? 0) + 1);
  }
  return [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "EUR";
}

/** Currencies of the trip's prices other than `base`: what needs exchange rates. */
export function foreignCurrencies(trip: Trip, base: string): string[] {
  const out = new Set<string>();
  for (const item of Object.values(trip.items)) {
    for (const text of [item.booking?.price, item.booking?.onSite]) {
      const c = parsePrice(text)?.currency;
      if (c && c !== base) out.add(c);
    }
  }
  for (const expense of Object.values(trip.expenses ?? {})) {
    const c = parsePrice(expense.amount)?.currency;
    if (c && c !== base) out.add(c);
  }
  return [...out];
}

/**
 * What the trip costs, from the prices on its cards, in the budget's currency. A stay or rental is
 * counted once, on the day it starts. What is still paid on site (`booking.onSite`, e.g. a cenote's
 * entrance) counts too, as still to pay. Cards in Ideas are listed but not counted.
 */
export function tripBudget(trip: Trip, rates?: Rates): Budget {
  const currency = budgetCurrency(trip);
  const budget: Budget = {
    currency,
    limit: trip.budget?.limit,
    lines: [],
    ideas: [],
    noCurrency: [],
    cash: [],
    unconverted: [],
    total: 0,
    paid: 0,
    byDay: trip.days.map(() => 0),
    byType: {},
  };
  const unconverted = new Set<string>();
  const cash = new Map<string, CashNeed>();
  const addLine = (item: Item, text: string | undefined, dayIndex: number | undefined, onSite: boolean) => {
    const price = parsePrice(text);
    if (!price) return;
    if (!price.currency && price.amount !== 0) {
      budget.noCurrency.push({ item, dayIndex, text: text! });
      return;
    }
    const line: BudgetLine = {
      item,
      dayIndex,
      price,
      converted: convert(price, currency, rates),
      paid: !onSite && !!item.booking?.paid,
      ...(onSite && { onSite: true, cash: !!item.booking?.cash }),
    };
    if (dayIndex === undefined) {
      budget.ideas.push(line);
      return;
    }
    budget.lines.push(line);
    if (line.cash && price.currency && price.amount > 0) {
      const need = cash.get(price.currency) ?? { currency: price.currency, amount: 0, byDay: [] };
      need.amount += price.amount;
      const day = need.byDay.find((d) => d.dayIndex === dayIndex);
      if (day) day.amount += price.amount;
      else need.byDay.push({ dayIndex, amount: price.amount });
      cash.set(price.currency, need);
    }
    if (line.converted === undefined) {
      unconverted.add(price.currency!);
      return;
    }
    if (price.currency && price.currency !== currency) budget.ratesDate = rates?.date;
    budget.total += line.converted;
    if (line.paid) budget.paid += line.converted;
    budget.byDay[dayIndex] += line.converted;
    budget.byType[item.type] = (budget.byType[item.type] ?? 0) + line.converted;
  };
  const add = (id: string, dayIndex?: number) => {
    const item = trip.items[id];
    if (!item?.booking) return;
    addLine(item, item.booking.price, dayIndex, false);
    addLine(item, item.booking.onSite, dayIndex, true);
  };
  trip.days.forEach((day, i) => day.itemIds.forEach((id) => add(id, i)));
  trip.ideas.forEach((id) => add(id));
  budget.unconverted = [...unconverted];
  budget.cash = [...cash.values()].sort((a, b) => b.amount - a.amount);
  return budget;
}

/** One line for the trip header and get_trip: "€1,235 · €420 paid · €815 to pay · €765 left of €2,000". */
export function budgetSummary(b: Budget, lang: Lang = "en"): string {
  const t = translator(lang);
  const m = (n: number) => formatMoney(n, b.currency);
  const bits = [m(b.total)];
  if (b.paid > 0) bits.push(t("budget.paid", { amount: m(b.paid) }), t("budget.toPay", { amount: m(b.total - b.paid) }));
  if (b.limit) {
    const limit = m(b.limit);
    bits.push(b.total <= b.limit ? t("budget.left", { amount: m(b.limit - b.total), limit }) : t("budget.over", { amount: m(b.total - b.limit), limit }));
  }
  return bits.join(" · ");
}

export interface ExpenseLine {
  expense: Expense;
  /** Undefined for the trip as a whole (or a day that was removed). */
  dayIndex?: number;
  money: Money;
  /** In the budget's currency; undefined without an exchange rate. */
  converted?: number;
}

/** What the trip has cost so far, against the plan: paid bookings plus what was spent on the way. */
export interface Spending {
  currency: string;
  /** Expenses in trip order: by day, then as entered; the trip-wide ones last. */
  lines: ExpenseLine[];
  /** All expenses, in the budget's currency. */
  expenses: number;
  /** Bookings already paid plus the expenses. */
  spent: number;
  /** What the cards cost (the budget's total). */
  planned: number;
  /** Expenses per day. */
  byDay: number[];
  byKind: Partial<Record<ExpenseKind, number>>;
  /** Currencies of expenses with no exchange rate (yet): not in the totals. */
  unconverted: string[];
  /** Expenses whose amount names no currency: not counted. */
  noCurrency: Expense[];
}

export function tripSpending(trip: Trip, budget: Budget, rates?: Rates): Spending {
  const dayOf = new Map(trip.days.map((d, i) => [d.id, i]));
  const out: Spending = {
    currency: budget.currency,
    lines: [],
    expenses: 0,
    spent: budget.paid,
    planned: budget.total,
    byDay: trip.days.map(() => 0),
    byKind: {},
    unconverted: [],
    noCurrency: [],
  };
  const unconverted = new Set<string>();
  const order = (e: Expense) => dayOf.get(e.dayId ?? "") ?? Infinity;
  const sorted = Object.values(trip.expenses ?? {}).sort(
    (a, b) => order(a) - order(b) || a.createdAt.localeCompare(b.createdAt),
  );
  for (const expense of sorted) {
    const money = parsePrice(expense.amount);
    if (!money) continue;
    if (!money.currency && money.amount !== 0) {
      out.noCurrency.push(expense);
      continue;
    }
    const dayIndex = dayOf.get(expense.dayId ?? "");
    const line: ExpenseLine = { expense, dayIndex, money, converted: convert(money, budget.currency, rates) };
    out.lines.push(line);
    if (line.converted === undefined) {
      unconverted.add(money.currency!);
      continue;
    }
    out.expenses += line.converted;
    if (dayIndex !== undefined) out.byDay[dayIndex] += line.converted;
    out.byKind[expense.kind] = (out.byKind[expense.kind] ?? 0) + line.converted;
  }
  out.spent += out.expenses;
  out.unconverted = [...unconverted];
  return out;
}
