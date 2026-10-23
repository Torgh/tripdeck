import { describe, expect, it } from "vitest";
import {
  carryOverDone,
  countryName,
  entryActions,
  entryItinerary,
  entryRouteKey,
  entryState,
  flag,
  keepFoundLinks,
  setRequirementDone,
} from "./entry";
import { mergeTrips } from "./merge";
import { tripWith } from "./testUtils";
import { todoLabel, tripTodos } from "./todo";
import type { EntryCheck, EntryCountry, Item, Trip } from "./types";

const place = (id: string, address: string): Item => ({ id, type: "place", title: id, location: { lat: 0, lng: 0, address } });
const flight: Item = {
  id: "flight",
  type: "transport",
  title: "WAW → BKK",
  location: { lat: 52.16, lng: 20.96, address: "Żwirki i Wigury 1, 00-906 Warszawa, Poland" },
  transport: { kind: "flight", from: "WAW", to: "BKK", toLocation: { lat: 13.69, lng: 100.75, address: "Bang Phli, Samut Prakan 10540, Thailand" } },
};

const thailand = (over: Partial<EntryCountry> = {}): EntryCountry => ({
  code: "TH",
  name: "Thailand",
  from: "2026-06-02",
  to: "2026-06-03",
  summary: "No visa needed for up to 60 days",
  requirements: [
    { kind: "visa", level: "ok", title: "No visa for up to 60 days" },
    { kind: "arrival_form", level: "action", title: "TDAC arrival card", dueBy: "2026-06-02", url: "https://tdac.immigration.go.th/arrival-card" },
    { kind: "passport", level: "warn", title: "Passport valid 6 months", url: "https://visa-agency.example/thailand" },
  ],
  sources: [
    { title: "Immigration", url: "https://www.immigration.go.th/en/" },
    { title: "Agency", url: "https://visa-agency.example/" },
  ],
  ...over,
});

function plannedTrip(): Trip {
  const trip = tripWith([[flight], [place("temple", "Bangkok 10200, Thailand")], [place("market", "Bangkok, Thailand")]]);
  trip.passports = ["PL"];
  return trip;
}

const checked = (trip: Trip, countries = [thailand()]): EntryCheck => ({
  passports: ["PL"],
  routeKey: entryRouteKey(trip),
  checkedAt: "2026-05-01T10:00:00.000Z",
  countries,
});

describe("countries", () => {
  it("names countries and draws their flags", () => {
    expect(countryName("PL")).toBe("Poland");
    expect(countryName("th")).toBe("Thailand");
    expect(flag("PL")).toBe("🇵🇱");
    expect(flag("x")).toBe("🏳️");
  });
});

describe("entryRouteKey", () => {
  it("keeps the key for another card in a country already visited", () => {
    const trip = plannedTrip();
    const key = entryRouteKey(trip);
    trip.items.cafe = place("cafe", "Silom, Bangkok 10500, Thailand");
    trip.days[1].itemIds.push("cafe");
    expect(entryRouteKey(trip)).toBe(key);
  });

  it("changes with a new country, other dates or a longer stay", () => {
    const trip = plannedTrip();
    const key = entryRouteKey(trip);
    const add = (t: Trip, item: Item, day: number) => ({
      ...t,
      items: { ...t.items, [item.id]: item },
      days: t.days.map((d, i) => (i === day ? { ...d, itemIds: [...d.itemIds, item.id] } : d)),
    });
    expect(entryRouteKey(add(trip, place("angkor", "Siem Reap, Cambodia"), 2))).not.toBe(key);
    expect(entryRouteKey({ ...trip, startDate: "2026-07-01" })).not.toBe(key);
    expect(entryRouteKey(add(trip, place("park", "Lumphini, Bangkok, Thailand"), 2))).toBe(key);
  });
});

describe("entryState", () => {
  it("is missing, fresh, or out of date with the reasons", () => {
    const trip = plannedTrip();
    expect(entryState(trip)).toEqual({ kind: "none" });
    trip.entry = checked(trip);
    expect(entryState(trip)).toEqual({ kind: "fresh" });
    expect(entryState({ ...trip, passports: ["PL", "DE"] })).toEqual({ kind: "stale", reasons: ["the passports changed"] });
    expect(entryState({ ...trip, startDate: "2026-07-01" })).toEqual({
      kind: "stale",
      reasons: ["the dates or countries in the plan changed"],
    });
  });
});

describe("formalities to do", () => {
  it("lists open applications, earliest deadline first, ahead of bookings in To sort out", () => {
    const trip = plannedTrip();
    const later = { kind: "visa" as const, level: "action" as const, title: "e-Visa", dueBy: "2026-05-20" };
    const undated = { kind: "insurance" as const, level: "action" as const, title: "Insurance" };
    trip.entry = checked(trip, [thailand(), { ...thailand({ code: "KH", name: "Cambodia" }), requirements: [undated, later] }]);
    trip.items.temple.booking = { status: "todo" };

    expect(entryActions(trip).map((a) => a.requirement.title)).toEqual(["e-Visa", "TDAC arrival card", "Insurance"]);
    expect(tripTodos(trip).map(todoLabel)).toEqual([
      "Cambodia: e-Visa – by 2026-05-20",
      "Thailand: TDAC arrival card – by 2026-06-02",
      "Cambodia: Insurance",
      "temple (day 2): to book",
      "Night after day 2: nowhere to sleep yet",
    ]);
  });

  it("drops a formality once ticked off, and keeps the tick through a new check", () => {
    const trip = plannedTrip();
    trip.entry = setRequirementDone(checked(trip), "TH", 1, true);
    expect(entryActions(trip)).toEqual([]);

    const again = carryOverDone(trip.entry, checked(trip));
    expect(again.countries[0].requirements.map((r) => !!r.done)).toEqual([false, true, false]);
    expect(carryOverDone(undefined, checked(trip))).toEqual(checked(trip));
  });
});

describe("keepFoundLinks", () => {
  it("keeps only links to hosts the web research returned", () => {
    const [c] = keepFoundLinks([thailand()], ["https://tdac.immigration.go.th/", "https://immigration.go.th/en/x", "not a url"]);
    expect(c.requirements.map((r) => r.url)).toEqual([undefined, "https://tdac.immigration.go.th/arrival-card", undefined]);
    expect(c.sources.map((s) => s.url)).toEqual(["https://www.immigration.go.th/en/"]);
  });

  it("drops links that aren't web pages", () => {
    const [c] = keepFoundLinks([thailand({ sources: [{ title: "x", url: "javascript:alert(1)" }] })], ["javascript:alert(1)"]);
    expect(c.sources).toEqual([]);
  });
});

describe("entryItinerary", () => {
  it("lists each day's date and where its cards are", () => {
    const trip = plannedTrip();
    trip.items.scooter = { id: "scooter", type: "rental", title: "Scooter", rental: { vehicle: "scooter", days: 2 } };
    trip.days[2].itemIds.push("scooter");
    trip.days.push({ id: "d4", itemIds: [], startTime: "09:00" });
    expect(entryItinerary(trip)).toBe(
      [
        "Day 1 (2026-06-01)",
        "  - Transport: WAW → BKK · flight WAW → BKK",
        "Day 2 (2026-06-02)",
        "  - Place: temple · Bangkok 10200, Thailand",
        "Day 3 (2026-06-03)",
        "  - Place: market · Bangkok, Thailand",
        "  - Rental (car, scooter, bike): Scooter · renting a scooter for 2 days",
        "Day 4 (2026-06-04)",
        "  (nothing planned yet)",
      ].join("\n"),
    );
  });
});

describe("sync", () => {
  it("merges passports and the entry check like the other trip settings", () => {
    const base = plannedTrip();
    const local = { ...base, passports: ["PL", "DE"] };
    const remote = { ...base, entry: checked(base) };
    const merged = mergeTrips(base, local, remote);
    expect(merged.passports).toEqual(["PL", "DE"]);
    expect(merged.entry).toEqual(checked(base));
  });
});
