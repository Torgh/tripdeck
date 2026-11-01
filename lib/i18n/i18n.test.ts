import { isValidElement, type ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { computeDiveWarnings } from "../diveSafety";
import { tripWith } from "../testUtils";
import { formatDayLabel, formatDuration } from "../time";
import { computeTripTimeline } from "../timeline";
import { en } from "./en";
import { es } from "./es";
import { detectLang, LANGS, parseLang, translate, type Key } from "./index";
import { pl } from "./pl";
import type { Plural } from "./plural";
import { rich } from "./rich";

type Node = string | Plural | { [key: string]: Node };

/** Every text of a language as "key" → its forms, plurals as "key#form". */
function flatten(node: Node, prefix = "", out = new Map<string, string>()): Map<string, string> {
  if (typeof node === "string") out.set(prefix, node);
  else if ("plural" in node) {
    for (const [form, text] of Object.entries(node)) if (form !== "plural") out.set(`${prefix}#${form}`, text as string);
  } else for (const [k, v] of Object.entries(node)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  return out;
}

const params = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const tags = (text: string) => [...text.matchAll(/<(\w+)>/g)].map((m) => m[1]).sort();
const base = (key: string) => key.split("#")[0];

describe("translations", () => {
  const english = flatten(en as unknown as Node);
  const englishParams = new Map<string, Set<string>>();
  for (const [key, text] of english) {
    const set = englishParams.get(base(key)) ?? new Set();
    params(text).forEach((p) => set.add(p));
    englishParams.set(base(key), set);
  }

  for (const [lang, messages] of [["pl", pl], ["es", es]] as const) {
    it(`${lang} uses only the placeholders and tags English has`, () => {
      for (const [key, text] of flatten(messages as unknown as Node)) {
        const allowed = englishParams.get(base(key));
        expect(allowed, `${lang} ${key} is not in English`).toBeDefined();
        for (const p of params(text)) expect(allowed!.has(p), `${lang} ${key}: unknown {${p}}`).toBe(true);
        if (!key.includes("#")) expect(tags(text), `${lang} ${key}: tags`).toEqual(tags(english.get(key)!));
      }
    });

    it(`${lang} keeps every placeholder of a single text`, () => {
      for (const [key, text] of flatten(messages as unknown as Node)) {
        if (key.includes("#")) continue;
        expect(params(text), `${lang} ${key}`).toEqual(params(english.get(key)!));
      }
    });
  }
});

describe("translate", () => {
  it("fills in parameters", () => {
    expect(translate("en", "common.day", { day: 3 })).toBe("Day 3");
    expect(translate("pl", "common.day", { day: 3 })).toBe("Dzień 3");
    expect(translate("es", "common.day", { day: 3 })).toBe("Día 3");
  });

  it("picks the plural form by n, with Polish few and many", () => {
    const days = (lang: "en" | "pl" | "es", n: number) => translate(lang, "home.days", { n });
    expect([1, 2, 5].map((n) => days("en", n))).toEqual(["1 day", "2 days", "5 days"]);
    expect([1, 2, 5, 22, 25].map((n) => days("pl", n))).toEqual(["1 dzień", "2 dni", "5 dni", "22 dni", "25 dni"]);
    expect([1, 3, 4, 5, 12, 22].map((n) => translate("pl", "board.nights", { n }))).toEqual([
      "1 noc",
      "3 noce",
      "4 noce",
      "5 nocy",
      "12 nocy",
      "22 noce",
    ]);
    expect([1, 2].map((n) => days("es", n))).toEqual(["1 día", "2 días"]);
  });

  it("shows the key of an unknown text instead of failing", () => {
    expect(translate("pl", "no.such" as Key)).toBe("no.such");
  });
});

describe("language choice", () => {
  it("reads only supported languages", () => {
    expect(LANGS.map(parseLang)).toEqual(LANGS);
    expect(parseLang("de")).toBeUndefined();
    expect(parseLang(null)).toBeUndefined();
  });

  it("follows the first browser language TripDeck speaks", () => {
    expect(detectLang(["pl-PL", "en-US"])).toBe("pl");
    expect(detectLang(["de-DE", "es-MX", "en"])).toBe("es");
    expect(detectLang(["fr-FR"])).toBe("en");
    expect(detectLang([])).toBe("en");
  });
});

describe("formatting in the app's language", () => {
  it("writes durations and dates per language", () => {
    expect(formatDuration(95)).toBe("1h 35m");
    expect(formatDuration(95, "pl")).toBe("1 godz. 35 min");
    expect(formatDuration(120, "es")).toBe("2 h");
    expect(formatDuration(45, "pl")).toBe("45 min");
    const date = new Date(Date.UTC(2026, 10, 6));
    expect(formatDayLabel(date)).toMatch(/Fri/);
    expect(formatDayLabel(date, "pl")).toMatch(/pt/);
    expect(formatDayLabel(date, "es")).toMatch(/vie/);
  });

  it("gives the board's warnings in the chosen language and English by default", () => {
    const dive = { id: "d", type: "dive" as const, title: "Wreck", startTime: "09:00", durationMin: 180, dive: { dives: 2, gas: "air" as const } };
    const flight = { id: "f", type: "transport" as const, title: "Home", startTime: "16:00", transport: { kind: "flight" as const } };
    const trip = tripWith([[dive, flight]]);
    const warning = (lang?: "pl") => computeDiveWarnings(trip, computeTripTimeline(trip, lang), lang).get("f")?.[0].message;
    expect(warning()).toBe("Flight only 4h after diving – wait at least 18 h.");
    expect(warning("pl")).toBe("Lot tylko 4 godz. po nurkowaniu – odczekaj co najmniej 18 godz.");
  });
});

describe("rich", () => {
  it("wraps tagged chunks and keeps the text around them", () => {
    const out = rich("Click <b>Save</b> or <a>read more</a>.", { b: (s) => `[${s}]`, a: (s) => `(${s})` }) as unknown[];
    const text = out.map((n) => (isValidElement(n) ? (n as ReactElement<{ children: string }>).props.children : n)).join("");
    expect(text).toBe("Click [Save] or (read more).");
  });

  it("leaves unknown tags as they are", () => {
    expect((rich("a <x>b</x>", {}) as unknown[]).join("")).toBe("a <x>b</x>");
  });
});
