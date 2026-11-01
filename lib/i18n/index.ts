import { en } from "./en";
import { es } from "./es";
import { pl } from "./pl";
import type { Plural } from "./plural";

export type Lang = "en" | "pl" | "es";

export const LANGS: Lang[] = ["en", "pl", "es"];
/** Each language in its own name, as the picker shows it. */
export const LANG_NAME: Record<Lang, string> = { en: "English", pl: "Polski", es: "Español" };
/** The locale dates, numbers and plurals are formatted in. */
export const LOCALE: Record<Lang, string> = { en: "en-GB", pl: "pl-PL", es: "es-ES" };

/** For prompts: the language Claude writes the in-app AI answers in. */
const LANG_IN_ENGLISH: Record<Lang, string> = { en: "English", pl: "Polish", es: "Spanish" };

export function writeIn(lang: Lang): string {
  return `Write in ${LANG_IN_ENGLISH[lang]}.`;
}

/** localStorage key; like the theme, the choice is per browser. */
export const LANG_KEY = "tripdeck-lang";

export function parseLang(value: string | null | undefined): Lang | undefined {
  return LANGS.find((l) => l === value);
}

/** The first of the browser's or phone's languages TripDeck speaks; English otherwise. */
export function detectLang(preferred: readonly string[]): Lang {
  for (const tag of preferred) {
    const lang = parseLang(tag.toLowerCase().split("-")[0]);
    if (lang) return lang;
  }
  return "en";
}

type Shape<T> = { [K in keyof T]: T[K] extends string ? string : T[K] extends Plural ? Plural : Shape<T[K]> };
/** Every language has every text English has: a missing one fails the type check. */
export type Messages = Shape<typeof en>;

type Paths<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string | Plural ? `${P}${K}` : Paths<T[K], `${P}${K}.`>;
}[keyof T & string];
export type Key = Paths<typeof en>;

export type Params = Record<string, string | number>;
export type T = (key: Key, params?: Params) => string;

const MESSAGES: Record<Lang, Messages> = { en, pl, es };

function lookup(lang: Lang, key: string): string | Plural | undefined {
  let node: unknown = MESSAGES[lang];
  for (const part of key.split(".")) node = (node as Record<string, unknown> | undefined)?.[part];
  return typeof node === "string" || (node && typeof node === "object" && "plural" in node) ? (node as string | Plural) : undefined;
}

const rules = new Map<Lang, Intl.PluralRules>();

/** The text for `key` in `lang`, with `{name}` filled from `params`; a plural picks its form by `params.n`. */
export function translate(lang: Lang, key: Key, params?: Params): string {
  const value = lookup(lang, key) ?? lookup("en", key);
  let text: string;
  if (typeof value === "string") text = value;
  else if (value) {
    if (!rules.has(lang)) rules.set(lang, new Intl.PluralRules(LOCALE[lang]));
    const form = rules.get(lang)!.select(Number(params?.n ?? 0)) as "one" | "few" | "many" | "other";
    text = value[form] ?? value.other;
  } else text = key;
  return params ? text.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m)) : text;
}

export function translator(lang: Lang): T {
  return (key, params) => translate(lang, key, params);
}

/** English, for code shared with the MCP server, which always speaks English to Claude. */
export const tEn = translator("en");
