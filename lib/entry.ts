import { dayDate, isoDate } from "./time";
import { ITEM_TYPE_LABEL, type EntryCheck, type EntryCountry, type EntryKind, type EntryRequirement, type Trip } from "./types";

/** Passports and countries: ISO 3166-1 alpha-2 codes of every country and territory. */
export const COUNTRY_CODES = (
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
  "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR " +
  "GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO " +
  "JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR " +
  "MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO " +
  "RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV " +
  "TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW"
).split(" ");

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

export function countryName(code: string): string {
  try {
    return regionNames.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

/** 🇵🇱 for "PL": two regional-indicator letters. */
export function flag(code: string): string {
  if (!/^[A-Za-z]{2}$/.test(code)) return "🏳️";
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

export const ENTRY_KIND_LABEL: Record<EntryKind, string> = {
  visa: "Visa",
  passport: "Passport",
  arrival_form: "Arrival form",
  health: "Health",
  insurance: "Insurance",
  driving: "Driving",
  customs: "Customs",
  other: "Other",
};

/** Where an address is: its last part, which is the country in Google's and OpenStreetMap's addresses. */
function countryOf(address: string | undefined): string | undefined {
  const last = address?.split(",").pop()?.trim();
  return last && !/\d/.test(last) ? last : undefined;
}

/**
 * The parts of the plan that decide which countries are visited and when: the dates, the destination,
 * and the country of every card's address (with the days it is on). Adding a café in the same country
 * keeps it; a card or flight in another country, or other dates, change it.
 */
export function entryRouteKey(trip: Trip): string {
  const days = new Map<string, number[]>();
  const add = (country: string | undefined, d: number) => {
    if (!country) return;
    const key = country.toLowerCase();
    const range = days.get(key);
    if (!range) days.set(key, [d, d]);
    else range[1] = Math.max(range[1], d);
  };
  trip.days.forEach((day, d) => {
    for (const id of day.itemIds) {
      const item = trip.items[id];
      add(countryOf(item?.location?.address), d);
      add(countryOf(item?.transport?.toLocation?.address), d);
    }
  });
  const countries = [...days].map(([c, [a, b]]) => `${c}:${a}-${b}`).sort();
  return [trip.startDate, trip.days.length, trip.destination.trim().toLowerCase(), ...countries].join("|");
}

export type EntryState = { kind: "none" } | { kind: "fresh" } | { kind: "stale"; reasons: string[] };

/** Whether the saved check still matches the trip's passports and route. */
export function entryState(trip: Trip): EntryState {
  if (!trip.entry) return { kind: "none" };
  const reasons: string[] = [];
  const same = (a: string[], b: string[]) => [...a].sort().join() === [...b].sort().join();
  if (!same(trip.entry.passports, trip.passports ?? [])) reasons.push("the passports changed");
  if (trip.entry.routeKey !== entryRouteKey(trip)) reasons.push("the dates or countries in the plan changed");
  return reasons.length ? { kind: "stale", reasons } : { kind: "fresh" };
}

/** Formalities still to do: applications and forms not ticked off, earliest deadline first. */
export function entryActions(trip: Trip): { country: EntryCountry; requirement: EntryRequirement }[] {
  const out = (trip.entry?.countries ?? []).flatMap((country) =>
    country.requirements.filter((r) => r.level === "action" && !r.done).map((requirement) => ({ country, requirement })),
  );
  return out.sort((a, b) => (a.requirement.dueBy ?? "9999").localeCompare(b.requirement.dueBy ?? "9999"));
}

const sameRequirement = (code: string, r: EntryRequirement) => `${code}|${r.kind}|${r.title.trim().toLowerCase()}`;

/** A new check keeps the ticks of formalities that are still the same. */
export function carryOverDone(previous: EntryCheck | undefined, next: EntryCheck): EntryCheck {
  const done = new Set(
    (previous?.countries ?? []).flatMap((c) => c.requirements.filter((r) => r.done).map((r) => sameRequirement(c.code, r))),
  );
  if (!done.size) return next;
  return {
    ...next,
    countries: next.countries.map((c) => ({
      ...c,
      requirements: c.requirements.map((r) => (done.has(sameRequirement(c.code, r)) ? { ...r, done: true } : r)),
    })),
  };
}

export function setRequirementDone(check: EntryCheck, code: string, index: number, done: boolean): EntryCheck {
  return {
    ...check,
    countries: check.countries.map((c) =>
      c.code === code ? { ...c, requirements: c.requirements.map((r, i) => (i === index ? { ...r, done } : r)) } : c,
    ),
  };
}

/**
 * Links Claude may show: only pages its web research really returned (same host), so a remembered or
 * made-up address – or a look-alike visa agency – never becomes a link. Unmatched links are dropped.
 */
export function keepFoundLinks(countries: EntryCountry[], foundUrls: Iterable<string>): EntryCountry[] {
  const hosts = new Set<string>();
  for (const u of foundUrls) {
    const host = hostOf(u);
    if (host) hosts.add(host);
  }
  const ok = (url: string | undefined) => !!url && /^https?:\/\//i.test(url) && hosts.has(hostOf(url) ?? "");
  return countries.map((c) => ({
    ...c,
    requirements: c.requirements.map(({ url, ...r }) => (ok(url) ? { ...r, url } : r)),
    sources: c.sources.filter((s) => ok(s.url)),
  }));
}

export function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return undefined;
  }
}

/** How to research entry rules – for Claude, who searches the web itself and saves the result through MCP. */
export const ENTRY_RESEARCH_GUIDE = `Find the current, official entry rules for every country on the route, for the trip's passports and dates: each country they stay in, and each one they only pass through (changing planes or ships – airside transit can need a transit visa). Skip the passport's own country unless something applies there.
Per country: visa (needed or not; visa-free, on arrival, e-visa, or an electronic authorisation such as ESTA / ETA / ETIAS / K-ETA; how long a stay it allows; how and how early to apply; the fee) · passport validity, blank pages, whether an ID card is enough · pre-arrival registrations and arrival cards, with the window to fill them in · vaccinations or health declarations required for entry · mandatory insurance · when the plan rents a car, scooter or motorbike: which licence or International Driving Permit (which convention) is accepted · customs rules that commonly catch travellers out (drones, medicines, e-cigarettes, cash), only when notable · rules announced for the coming months that affect these dates.
Search the web – entry rules change, so never answer from memory – and read the official pages: the country's immigration authority, foreign ministry or official e-visa portal, its embassies, and the passport country's foreign ministry travel advice (Polish passports: gov.pl/web/dyplomacja). Commercial agencies run sites that look official and charge several times the real fee: never use them as sources or links, and warn about them where they are common. When official sources disagree or are unclear, say so in the details.
Levels: "ok" – nothing to do (always state the visa situation); "action" – something to apply for, register or fill in, with due_by = the last day it can be done, worked out from the trip dates (e.g. "at least 72 hours before arrival" on 2026-11-05 → 2026-11-02; put the window in the details when it can't be done too early either); "warn" – rules that can stop boarding or entry (passport validity, onward ticket, staying longer than allowed); "info" – good to know. Short titles, practical details (how, where, cost). Links and sources: only official pages you actually opened.`;

/** Countries as Claude returns them (snake_case, nulls): upper-case codes, valid dates, deadlines only on actions. */
export function normalizeCountries(
  raw: {
    code: string;
    name?: string | null;
    transit?: boolean | null;
    from?: string | null;
    to?: string | null;
    summary: string;
    requirements: {
      kind: EntryKind;
      level: EntryRequirement["level"];
      title: string;
      details?: string | null;
      due_by?: string | null;
      url?: string | null;
    }[];
    sources?: { title: string; url: string }[] | null;
  }[],
): EntryCountry[] {
  const day = (s: string | null | undefined) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined);
  return raw
    .filter((c) => COUNTRY_CODES.includes(c.code.toUpperCase()))
    .map((c) => {
      const code = c.code.toUpperCase();
      return {
        code,
        name: c.name || countryName(code),
        ...(c.transit && { transit: true }),
        ...(day(c.from) && { from: day(c.from) }),
        ...(day(c.to) && { to: day(c.to) }),
        summary: c.summary,
        requirements: c.requirements.map((r) => ({
          kind: r.kind,
          level: r.level,
          title: r.title,
          ...(r.details && { details: r.details }),
          ...(r.level === "action" && day(r.due_by) && { dueBy: day(r.due_by) }),
          ...(r.url && { url: r.url }),
        })),
        sources: c.sources ?? [],
      };
    });
}

/** The plan as the research needs it: dates and where each day's cards are; flights with both ends. */
export function entryItinerary(trip: Trip): string {
  return trip.days
    .map((day, d) => {
      const cards = day.itemIds.flatMap((id) => {
        const item = trip.items[id];
        if (!item) return [];
        const bits = [`${ITEM_TYPE_LABEL[item.type]}: ${item.title}`];
        if (item.transport) {
          const t = item.transport;
          bits.push(`${t.kind} ${t.from ?? item.location?.address ?? "?"} → ${t.to ?? t.toLocation?.address ?? "?"}`);
        } else if (item.location?.address) bits.push(item.location.address);
        if (item.rental) bits.push(`renting a ${item.rental.vehicle} for ${item.rental.days} days`);
        return [`  - ${bits.join(" · ")}`];
      });
      return [`Day ${d + 1} (${isoDate(dayDate(trip.startDate, d))})`, ...(cards.length ? cards : ["  (nothing planned yet)"])].join("\n");
    })
    .join("\n");
}
