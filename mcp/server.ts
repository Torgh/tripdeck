/**
 * TripDeck MCP server: lets Claude Code / Claude Desktop (or Codex with a ChatGPT plan) plan your
 * trips using your own subscription. No API key needed – the client's model does the thinking,
 * this server exposes your trips, maps search, routing and the dive-safety checks.
 *
 * It reads and writes the same trips as the web app (Google Drive once connected in Settings,
 * ~/.tripdeck/trips otherwise), so changes show up on the board within a few seconds.
 *
 *   claude mcp add --scope user tripdeck -- <path-to-bun> <path-to-tripdeck>/mcp/server.ts
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { computeClockNotes, mergeIssues } from "../lib/clock";
import { computeDiveWarnings } from "../lib/diveSafety";
import {
  carryOverDone,
  COUNTRY_CODES,
  countryName,
  ENTRY_RESEARCH_GUIDE,
  entryRouteKey,
  entryState,
  flag,
  keepFoundLinks,
  normalizeCountries,
  setRequirementDone,
} from "../lib/entry";
import { centroid } from "../lib/geo";
import { bestOrder, evaluate, travelMatrix, type OptInput } from "../lib/optimize";
import { guessType, itemFieldsFromPlace } from "../lib/places";
import { defaultModeTo, rentalsOf, VEHICLE_MODE } from "../lib/rentals";
import { HttpError } from "../lib/server/errors";
import { exchangeRates } from "../lib/server/rates";
import { climateLine, regionLabel, regionsOf, tripMonths } from "../lib/climate";
import { ideasForFreeDays } from "../lib/ideaFit";
import { climateAt } from "../lib/server/climate";
import {
  budgetCurrency,
  budgetSummary,
  foreignCurrencies,
  formatMoney,
  parsePrice,
  RATE_CURRENCIES,
  tripBudget,
  tripSpending,
  type Budget,
  type Spending,
} from "../lib/money";
import { tripSummary } from "../lib/summary";
import {
  elevation,
  mapsProvider,
  nearbyPlaces,
  OSM_CATEGORIES,
  routeMatrix,
  searchPlaces,
  timeZone,
  type PlaceResult,
} from "../lib/server/maps";
import { saveIfUnchanged } from "../lib/server/tripLock";
import { summaryOf, tripStore } from "../lib/server/tripStore";
import { mergeTrips } from "../lib/merge";
import { ideasByStop, outlineFit, outlineLine, outlineStop, setOutline } from "../lib/outline";
import { nightsOf } from "../lib/stays";
import { dayDate, daysBetween, formatDayLabel, formatDuration, formatHm, isoDate, parseHm } from "../lib/time";
import { computeTripTimeline, durationOf, findBase, freshRoute, getLeg, manualLegMinutes } from "../lib/timeline";
import { todoLabel, tripTodos } from "../lib/todo";
import { transitStepLine } from "../lib/transit";
import * as ops from "../lib/tripOps";
import {
  BOOKING_STATUS_ICON,
  BOOKING_STATUS_LABEL,
  DIVE_PREP_LABEL,
  diveGas,
  divePrepUrl,
  EXPENSE_ICON,
  EXPENSE_KINDS,
  IDEAS,
  isRoutable,
  ITEM_TYPE_LABEL,
  itemIcon,
  leavesFrom,
  legKey,
  MANUAL_MODES,
  MODE_LABEL,
  RENTAL_VEHICLES,
  ROUTABLE_MODES,
  type ContainerId,
  type Expense,
  type ExpenseKind,
  type Item,
  type LatLng,
  type Location,
  type RentalVehicle,
  type TourStop,
  type Trip,
} from "../lib/types";

const INSTRUCTIONS = `TripDeck is the user's trip planner. Trips have numbered days (columns) of cards (places, food, activities, stays, rentals, dives, transport) plus an "Ideas" list for unscheduled cards.
The user sees every change live on a drag-and-drop board with a map, so make changes with the tools instead of only describing them.

How to work:
- Start with list_trips / get_trip. Refer to cards by their item_id. Days are numbered from 1; day 0 means Ideas.
- Early plans: a trip can start with its dates open – no start_date, perhaps no days, only Ideas and a rough timing ("spring 2027, about 10 days"). When the user is only starting to think about a trip, create it that way (create_trip without start_date), sketch the route in broad strokes with set_outline (regions and days in each, e.g. Hanoi 3 → Ha Long Bay 2 → Hoi An 4), collect places as Ideas, and fill in timing, days and finally the dates with update_trip as the plan firms up. Without dates there are no weekdays, so opening days and entry deadlines cannot be checked yet – say so. The climate tool shows the typical weather month by month in each region, to help choose when to go.
- To find places use search_places (by name) or nearby_places (what is around a card). Prefer adding cards with place_query so they get coordinates and a map pin.
- Days with time to spare: get_trip lists the ideas near them ("Time to spare – ideas nearby"). Offer them to the user, and move the ones they want with move_item.
- Before reordering a day, call optimize_day for real travel times, then decide (meals, sunset, heat, opening hours) and apply with reorder_day. Explain your reasoning briefly.
- Booking confirmations: if you have Gmail (or another mail) tools, search for confirmations (Booking.com, GetYourGuide, Viator, Airbnb, airlines, ferries, car / scooter rentals, dive centres), then add one card per booking on the right day with provider, reference, times and price. Never invent booking numbers.
- Booking status: booking.status "confirmed", "pending" (paid or requested, not confirmed yet) or "todo" (still to book). get_trip lists the pending and to-book ones, and nights with nowhere to sleep, under "To sort out" – mention them.
- Entry & paperwork (visas, passport rules, arrival forms, driving permits): research them on the web yourself for the trip's passports (update_trip passports – ask which passports when get_trip says they are not set) and save them with save_entry_check, whose description says what to look for. The board shows them under 🛂, the open ones with deadlines under "To sort out". When get_trip says they are missing or out of date, offer to check; mark one done with set_entry_done when the user says it is sorted. Never present entry rules from memory as certain.
- Expenses during the trip (meals, taxis, tickets bought on the spot): add_expense with the amount and its currency, from receipts, bank notifications or what the user says; get_trip shows what was spent against the plan, and trip_summary recaps the trip.
- Prices: booking.price as written on the confirmation, always with its currency ("€189", "1 500 THB"); booking.paid when it is already paid. What is still paid at the place (entrance fees, park fees, a balance due on arrival) goes in booking.on_site, with cash: true when only cash is taken – get_trip then lists the cash to bring per day. get_trip adds them up under "Budget" in the trip's currency (update_trip budget_currency / budget_limit) – mention prices without a currency and a budget that is over its limit.
- Rentals (car, scooter, motorbike, bicycle): one card of type rental on the pick-up day, start_time = pick-up time, rental.days = days until the return. The board then shows it on every day up to the return. Do not use transport car_rental for new rentals.
- Organised tours (type activity): the card's place is the pick-up / meeting point (travel times go there); list the places the tour visits in tour_stops so they show on the map.
- Flights, ferries, trains (type transport): place_query = where it departs, transport.to_place_query = where it arrives, start_time = departure and transport.arrival_time = arrival, both in local time as on the ticket (arrival_next_day when it lands the next day). The route to the next card then starts at the arrival, so no flight leg is needed. get_trip notes when the clocks change and how long the journey really takes.
- Public transport (leg mode TRANSIT): the board plans it for the time in the plan and get_trip lists the lines under the leg ("via 🚆 ARL: … → 🚇 …"). Suggest it from airports and stations; if it says no public transport at that time (night flights), suggest a car instead.
- Dives: get_trip reports no-fly and altitude warnings (DAN guidance: ≥12 h after a single no-deco dive, ≥18 h after repetitive or multi-day diving). Point them out, but they are planning hints, not a substitute for the diver's computer or training. dive.gas is the kind (air, nitrox, trimix); save the mix in dive.mix once the user knows it ("EAN32", "Tx 18/45").
- Dive preparation: when the diver uses DiveDeck (its MCP server), its coach prepares each dive card from the diver's log; save the verdict on the card with save_dive_prep (ready, or check when something is still to sort out) with a one-line summary, the link to the full preparation and its text (details), so the board shows it and the phone can show it offline.
- Answer in the user's language. Keep card titles short; the app UI is in English.`;

const server = new McpServer({ name: "tripdeck", title: "TripDeck", version: "0.2.0" }, { instructions: INSTRUCTIONS });

const store = () => tripStore();

/** Serialises writes so two tool calls never overwrite each other's changes. */
let queue: Promise<unknown> = Promise.resolve();
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => undefined);
  return next;
}

async function loadTrip(tripId: string): Promise<Trip> {
  const trip = await store().get(tripId);
  if (!trip) throw new HttpError(404, `No trip with id "${tripId}". Use list_trips.`);
  return trip;
}

/**
 * Read-modify-write of one trip. The web app saves to the same store at the same time (the board
 * stores routes it fetched, the user drags cards), so the save happens under the trip's lock and only
 * if nobody saved in between. If someone did while `fn` ran (place lookups can take a while), both
 * edits are merged – the way the browser merges – instead of one overwriting the other.
 */
async function updateTrip(tripId: string, fn: (trip: Trip) => Trip | Promise<Trip>): Promise<Trip> {
  return exclusive(async () => {
    const base = await loadTrip(tripId);
    let next = ops.touch(ops.pruneLegs(await fn(base)));
    let seen = base;
    for (let attempt = 0; attempt < 5; attempt++) {
      const result = await saveIfUnchanged(store(), next, seen.updatedAt);
      if (result.saved) return next;
      // `seen` is what this edit already includes; merge in what changed after it.
      next = ops.touch(mergeTrips(seen, next, result.current));
      seen = result.current;
    }
    throw new HttpError(409, "The trip keeps changing in the app – try again in a moment.");
  });
}

function containerFor(trip: Trip, day: number): ContainerId {
  if (day === 0) return IDEAS;
  const d = trip.days[day - 1];
  if (!d) throw new HttpError(400, `Day ${day} does not exist (trip has ${trip.days.length} days; 0 = Ideas).`);
  return d.id;
}

function requireItem(trip: Trip, itemId: string): Item {
  const item = trip.items[itemId];
  if (!item) throw new HttpError(404, `No card with id "${itemId}" in this trip.`);
  return item;
}

function tripCenter(trip: Trip): LatLng | undefined {
  return centroid(Object.values(trip.items).flatMap((i) => (i.location ? [i.location] : [])));
}

// ---------- Rendering ----------

function placeLine(p: PlaceResult, from?: LatLng): string {
  const bits = [
    `${p.name} [place_id ${p.placeId}]`,
    p.primaryType,
    p.rating ? `★${p.rating.toFixed(1)} (${p.userRatingCount ?? 0})` : undefined,
    from ? `${haversineKm(from, p).toFixed(1)} km away` : undefined,
    p.address,
    p.weekdayHours?.length ? `hours: ${p.weekdayHours.join("; ")}` : undefined,
    p.editorialSummary,
    `(${p.lat.toFixed(5)}, ${p.lng.toFixed(5)})`,
  ];
  return `- ${bits.filter(Boolean).join(" · ")}`;
}

function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const s =
    Math.sin(toRad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(toRad(b.lng - a.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function itemLine(item: Item): string {
  const bits: string[] = [];
  if (item.dive) {
    bits.push(
      `${item.dive.dives} dive(s)${item.dive.maxDepthM ? `, max ${item.dive.maxDepthM} m` : ""}, ${diveGas(item.dive)}${item.dive.site ? `, site ${item.dive.site}` : ""}${item.dive.center ? `, with ${item.dive.center}` : ""}`,
    );
    const prep = item.dive.prep;
    if (prep) bits.push(`dive prep: ${DIVE_PREP_LABEL[prep.status].toLowerCase()} – ${prep.summary}${prep.url ? ` (${prep.url})` : ""}${prep.details ? " · full text saved" : " · no full text (details) yet"}`);
  }
  if (item.transport) {
    const to = item.transport.toLocation;
    bits.push(
      `${item.transport.kind}${item.transport.number ? ` ${item.transport.number}` : ""}${item.transport.from || item.transport.to ? ` ${item.transport.from ?? "?"} → ${item.transport.to ?? "?"}` : ""}${to ? ` · arrives at ${to.address ?? ""} (${to.lat.toFixed(5)}, ${to.lng.toFixed(5)})` : ""}`,
    );
  }
  if (item.stay) {
    bits.push(`${item.stay.nights} night(s)`);
    if (item.stay.checkIn) bits.push(`check-in from ${item.stay.checkIn}`);
    if (item.stay.checkOut) bits.push(`check-out by ${item.stay.checkOut}`);
  }
  if (item.rental) {
    const r = item.rental;
    bits.push(
      `${r.vehicle} rental, ${r.days} day(s)${r.returnTime ? `, return by ${r.returnTime}` : ""}${r.returnPlace ? ` at ${r.returnPlace}` : ""}`,
    );
  }
  if (item.tour?.stops.length) bits.push(`tour visits: ${item.tour.stops.map((s) => s.name).join(" → ")}`);
  if (item.booking?.provider || item.booking?.reference || item.booking?.price) {
    bits.push(
      `booked: ${[item.booking.provider, item.booking.reference, item.booking.price].filter(Boolean).join(" ")}${item.booking.paid ? " (paid)" : ""}`,
    );
  }
  if (item.booking?.onSite) bits.push(`to pay on site: ${item.booking.onSite}${item.booking.cash ? " (cash only)" : ""}`);
  if (item.booking?.status) bits.push(`status: ${BOOKING_STATUS_ICON[item.booking.status]} ${BOOKING_STATUS_LABEL[item.booking.status]}`);
  if (item.location) {
    bits.push(
      `📍 ${item.location.address ?? ""} (${item.location.lat.toFixed(5)}, ${item.location.lng.toFixed(5)})${item.location.elevationM != null ? ` ${Math.round(item.location.elevationM)} m a.s.l.` : ""}`,
    );
  } else bits.push("no location");
  if (item.notes) bits.push(`notes: ${item.notes.replace(/\s+/g, " ").slice(0, 200)}`);
  return bits.join(" · ");
}

function budgetLines(b: Budget): string[] {
  if (!b.lines.length && !b.noCurrency.length && !b.limit) return [];
  const m = (n: number) => formatMoney(n, b.currency);
  const lines = ["## Budget", `Total ${budgetSummary(b)} (${b.currency}${b.ratesDate ? `, ECB rates of ${b.ratesDate}` : ""})`];
  const days = b.byDay.map((n, i) => (n > 0 ? `day ${i + 1} ${m(n)}` : "")).filter(Boolean);
  if (days.length) lines.push(`Per day: ${days.join(", ")}`);
  if (b.unconverted.length) lines.push(`⚠️ Not in the total – no exchange rate for ${b.unconverted.join(", ")}`);
  for (const { item, text } of b.noCurrency) lines.push(`⚠️ Price without a currency, not counted: ${item.title} [${item.id}] "${text}"`);
  for (const need of b.cash) {
    const days = need.byDay.map((d) => `day ${d.dayIndex + 1} ${formatMoney(d.amount, need.currency)}`).join(", ");
    lines.push(`💵 Cash to bring: ${formatMoney(need.amount, need.currency)} (${days})`);
  }
  if (b.ideas.length) {
    lines.push(`Ideas with a price (not counted): ${b.ideas.map((l) => `${l.item.title} ${formatMoney(l.price.amount, l.price.currency ?? b.currency)}`).join(", ")}`);
  }
  return [...lines, ""];
}

/**
 * The budget and what was spent so far, with today's rates when there are prices in other currencies;
 * without the rates, those aren't converted.
 */
async function moneyOf(trip: Trip): Promise<{ budget: Budget; spending: Spending }> {
  const base = budgetCurrency(trip);
  const rates = foreignCurrencies(trip, base).length ? await exchangeRates(base).catch(() => undefined) : undefined;
  const budget = tripBudget(trip, rates);
  return { budget, spending: tripSpending(trip, budget, rates) };
}

/** Expenses and spent against planned, for get_trip; nothing until an expense is entered. */
function spendingLines(s: Spending): string[] {
  if (!s.lines.length && !s.noCurrency.length) return [];
  const m = (n: number) => formatMoney(n, s.currency);
  const lines = [
    "## Spent during the trip",
    `Spent ${m(s.spent)} of ${m(s.planned)} planned (bookings paid ${m(s.spent - s.expenses)} + expenses ${m(s.expenses)})`,
  ];
  for (const l of s.lines) {
    const amount = l.money.currency ? formatMoney(l.money.amount, l.money.currency) : l.expense.amount;
    lines.push(
      `- ${EXPENSE_ICON[l.expense.kind]} ${amount}${l.expense.note ? ` ${l.expense.note}` : ""} · ${l.dayIndex !== undefined ? `day ${l.dayIndex + 1}` : "whole trip"} [expense ${l.expense.id}]`,
    );
  }
  if (s.unconverted.length) lines.push(`⚠️ Not in the total – no exchange rate for ${s.unconverted.join(", ")}`);
  for (const e of s.noCurrency) lines.push(`⚠️ Expense without a currency, not counted: "${e.amount}" [expense ${e.id}]`);
  return [...lines, ""];
}

/** The saved entry check: one line per country, its warnings and what is still to do (also under To sort out). */
function entryLines(trip: Trip): string[] {
  const passports = trip.passports?.length ? trip.passports.map((c) => countryName(c)).join(", ") : "not set";
  const state = entryState(trip);
  if (!trip.entry) {
    return ["## Entry & paperwork", `Passports: ${passports}. Not checked yet – research it and save it with save_entry_check.`, ""];
  }
  const lines = ["## Entry & paperwork", `Passports: ${passports} · checked ${trip.entry.checkedAt.slice(0, 10)}`];
  if (state.kind === "stale") lines.push(`⚠️ Out of date: ${state.reasons.join(" and ")} – research it again and save_entry_check`);
  for (const c of trip.entry.countries) {
    lines.push(`${flag(c.code)} ${c.name}${c.transit ? " (transit)" : ""}${c.from ? ` ${c.from}${c.to && c.to !== c.from ? `→${c.to}` : ""}` : ""}: ${c.summary}`);
    c.requirements.forEach((r, i) => {
      if (r.level === "warn") lines.push(`   ⚠️ ${r.title}${r.details ? ` – ${r.details}` : ""}`);
      if (r.level === "action") {
        lines.push(`   ${r.done ? "☑️ done:" : "📝"} ${r.title} [${c.code} ${i + 1}]${r.dueBy ? ` (by ${r.dueBy})` : ""}${r.url ? ` ${r.url}` : ""}`);
      }
    });
  }
  return [...lines, ""];
}

/** The route outline, how it fits the days, and the ideas near each stop. */
function outlineLines(trip: Trip): string[] {
  if (!trip.outline?.length) return [];
  const fit = outlineFit(trip);
  const ideas = ideasByStop(trip);
  const lines = ["## Route outline", `${outlineLine(trip.outline)} (days) · ${fit.outline} days`];
  if (fit.kind === "long") lines.push(`⚠️ The outline needs ${fit.outline} days, the trip has ${fit.days} – set_outline make_days adds them.`);
  if (fit.kind === "short") lines.push(`ℹ️ The outline fills ${fit.outline} of the ${fit.days} days.`);
  for (const stop of trip.outline) {
    const near = ideas.get(stop.id) ?? [];
    lines.push(
      `- ${stop.name}: ${stop.days} day(s)${stop.location ? ` (${stop.location.lat.toFixed(3)}, ${stop.location.lng.toFixed(3)})` : " · not located"}${near.length ? ` · ideas nearby: ${near.map((i) => `${i.title} [${i.id}]`).join(", ")}` : ""}`,
    );
  }
  return [...lines, ""];
}

/** "2027-05-01 → 2027-05-10 (10 days)", or for an early plan its open dates and rough timing. */
function datesLine(trip: Trip): string {
  const days = `${trip.days.length} ${trip.days.length === 1 ? "day" : "days"}`;
  if (!trip.startDate) {
    const when = trip.timing ? `roughly: ${trip.timing}` : "no rough timing yet";
    return `dates open (${when}; ${trip.days.length ? `${days}, undated` : "no days yet – cards wait in Ideas"})`;
  }
  return `${trip.startDate} → ${isoDate(dayDate(trip.startDate, trip.days.length - 1))} (${days})`;
}

function renderTrip(trip: Trip, budget?: Budget, spending?: Spending): string {
  const timelines = computeTripTimeline(trip);
  const diveWarnings = mergeIssues(computeDiveWarnings(trip, timelines), computeClockNotes(trip, timelines));
  const rentals = rentalsOf(trip);
  const lines: string[] = [];
  const rentsDefault = Object.values(trip.items).some(
    (i) => i.type === "rental" && i.rental && VEHICLE_MODE[i.rental.vehicle] === trip.defaultMode,
  );
  lines.push(
    `# ${trip.name} [trip_id ${trip.id}]`,
    `${trip.destination} · ${datesLine(trip)} · default travel: ${MODE_LABEL[trip.defaultMode]}${rentsDefault ? " while rented, 🚗 Car otherwise" : ""}`,
    `Interests: ${trip.interests || "not set"}`,
    "",
  );
  if (!trip.startDate) {
    lines.push(
      "## Early plan – dates open",
      "Help narrow it down: save the rough timing (update_trip timing), sketch the route with set_outline (regions × days; make_days lays it over the days) and collect places as Ideas (add_item day 0). Once the dates are known, set start_date and end_date.",
      "",
    );
  }
  lines.push(...outlineLines(trip));
  const todos = tripTodos(trip);
  if (todos.length) lines.push("## To sort out", ...todos.map((t) => `- ${todoLabel(t)}`), "");
  if (budget) lines.push(...budgetLines(budget));
  if (spending) lines.push(...spendingLines(spending));
  lines.push(...entryLines(trip));
  const nights = nightsOf(trip);
  const freeDays = new Map(ideasForFreeDays(trip, timelines).map((f) => [f.dayIndex, f]));

  timelines.forEach((tl, d) => {
    const day = trip.days[d];
    lines.push(`## Day ${d + 1}${tl.date ? ` · ${formatDayLabel(tl.date)}` : ""}${day.label ? ` · ${day.label}` : ""} (starts ${day.startTime})`);
    if (tl.base) lines.push(`Wakes up at: ${tl.base.title} [${tl.base.id}]`);
    for (const r of rentals[d]) {
      if (r.phase === "during") lines.push(`Has rental: ${r.rental.title} [${r.rental.id}] until ${r.returnLabel}`);
      if (r.phase === "return") {
        lines.push(
          `Return rental today: ${r.rental.title} [${r.rental.id}]${r.rental.rental?.returnTime ? ` by ${r.rental.rental.returnTime}` : ""}`,
        );
      }
    }
    if (!tl.entries.length) lines.push("(empty)");
    tl.entries.forEach((e, n) => {
      const item = trip.items[e.itemId];
      if (e.fromId && e.legMin != null) {
        const leg = getLeg(trip, e.fromId, e.itemId);
        lines.push(`   ↓ ${MODE_LABEL[leg.mode]} ${formatDuration(e.legMin)}${e.legEstimated ? " (estimate)" : ""}`);
        const from = trip.items[e.fromId];
        const rides = from && freshRoute(trip, from, item);
        if (rides?.transit?.length) {
          lines.push(
            `     via ${rides.transit.map((s) => transitStepLine(s)).join(" → ")}${rides.walkMin ? ` · 🚶 ${rides.walkMin} min on foot` : ""}${rides.at ? ` · timetable for ${rides.at}` : ""}${rides.sampledOn ? ` (not published yet – same weekday on ${rides.sampledOn})` : ""}`,
          );
        }
      }
      lines.push(
        `${n + 1}. ${itemIcon(item)} ${item.title} [${item.id}] ${e.fixed ? "🔒" : "~"}${formatHm(e.start)}–${formatHm(e.end)} · ${ITEM_TYPE_LABEL[item.type]} · ${itemLine(item)}`,
      );
      for (const issue of [...e.issues, ...(diveWarnings.get(item.id) ?? [])]) {
        lines.push(`   ${issue.level === "warn" ? "⚠️" : "ℹ️"} ${issue.message}`);
      }
    });
    if (tl.entries.length) {
      lines.push(`${tl.travelMin >= 1 ? `Travel ${formatDuration(tl.travelMin)} · ` : ""}ends ~${formatHm(tl.endMin)}`);
    }
    const night = nights[d];
    if (night?.kind === "stay") lines.push(`Night: ${night.stay.title} [${night.stay.id}] (night ${night.night} of ${night.nights})`);
    if (night?.kind === "transport") lines.push(`Night: on the way – ${night.item.title} [${night.item.id}]`);
    if (night?.kind === "none") lines.push("Night: ⚠️ nowhere to sleep yet");
    const free = freeDays.get(d);
    if (free) {
      lines.push(
        `💡 Time to spare – ideas nearby: ${free.ideas.map((n) => `${n.item.title} [${n.item.id}] ${n.km < 1 ? "<1" : Math.round(n.km)} km`).join(", ")}`,
      );
    }
    lines.push("");
  });

  lines.push("## Ideas (unscheduled, day 0)");
  if (!trip.ideas.length) lines.push("(empty)");
  for (const id of trip.ideas) {
    const item = trip.items[id];
    if (item)
      lines.push(`- ${itemIcon(item)} ${item.title} [${item.id}] · ${ITEM_TYPE_LABEL[item.type]} · ${itemLine(item)}`);
  }
  return lines.join("\n");
}

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

/** Turns thrown errors into readable tool errors instead of protocol failures. */
function tool<A>(fn: (args: A) => Promise<string>) {
  return async (args: A) => {
    try {
      return text(await fn(args));
    } catch (err) {
      return { ...text(`Error: ${(err as Error).message}`), isError: true };
    }
  };
}

// ---------- Shared schemas ----------

const tripId = z.string().describe("Trip id from list_trips.");
const dayNumber = z.number().int().min(0).describe("Day number starting at 1; 0 = Ideas (unscheduled).");
const hhmm = z.string().regex(/^\d{1,2}:\d{2}$/, "Use HH:MM");
const modes = z.enum([...ROUTABLE_MODES, ...MANUAL_MODES]);

const cardFields = {
  title: z.string().min(1).max(120).optional(),
  type: z.enum(["place", "food", "activity", "stay", "rental", "dive", "transport"]).optional(),
  place_query: z
    .string()
    .max(200)
    .optional()
    .describe('Find the location by name, e.g. "Blue Grotto, Malta". The best match sets the coordinates.'),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  start_time: hhmm
    .or(z.literal(""))
    .optional()
    .describe('Fixed start time (HH:MM). Omit to flow after the previous card; "" removes a fixed time.'),
  duration_min: z.number().int().min(0).max(1440).optional(),
  notes: z.string().max(2000).optional(),
  dive: z
    .object({
      dives: z.number().int().min(1).max(5),
      max_depth_m: z.number().min(0).max(150).optional(),
      gas: z.enum(["air", "nitrox", "trimix"]).optional(),
      mix: z.string().max(40).optional().describe('The mix once known: "EAN32", "Tx 18/45". "" removes it.'),
      site: z.string().max(120).optional(),
      center: z.string().max(120).optional(),
    })
    .optional(),
  transport: z
    .object({
      kind: z.enum(["flight", "ferry", "train", "bus", "car_rental", "boat", "other"]),
      from: z.string().max(80).optional(),
      to: z.string().max(80).optional(),
      number: z.string().max(40).optional(),
      to_place_query: z
        .string()
        .max(200)
        .optional()
        .describe("Where it arrives, e.g. 'Don Mueang Airport'. The card's own place is the departure."),
      to_lat: z.number().min(-90).max(90).optional(),
      to_lng: z.number().min(-180).max(180).optional(),
      arrival_time: hhmm
        .optional()
        .describe("Local arrival time as on the ticket; sets the card's length from start_time"),
      arrival_next_day: z.boolean().optional().describe("It arrives the day after it leaves"),
    })
    .optional(),
  stay_nights: z.number().int().min(1).max(60).optional(),
  stay_check_in: hhmm.optional().describe("Stays: earliest check-in time"),
  stay_check_out: hhmm.optional().describe("Stays: latest check-out time"),
  rental: z
    .object({
      vehicle: z.enum(RENTAL_VEHICLES as [RentalVehicle, ...RentalVehicle[]]),
      days: z.number().int().min(1).max(90).describe("Rental length; it goes back on the day `days` after pick-up."),
      return_time: hhmm.optional(),
      return_place: z.string().max(120).optional().describe("Only when it goes back somewhere else."),
    })
    .optional()
    .describe("Rentals (type rental): put the card on the pick-up day with start_time = pick-up time."),
  tour_stops: z
    .array(
      z.object({
        name: z.string().min(1).max(120),
        place_query: z.string().max(200).optional().describe("Find the stop by name, e.g. \"Valladolid, Yucatán\"."),
        lat: z.number().min(-90).max(90).optional(),
        lng: z.number().min(-180).max(180).optional(),
      }),
    )
    .max(20)
    .optional()
    .describe(
      "Organised tours (type activity): the places the tour visits, in order. The card's own place is the pick-up / meeting point. Replaces the list; [] clears it.",
    ),
  booking: z
    .object({
      provider: z.string().max(60).optional(),
      reference: z.string().max(80).optional(),
      url: z.string().max(500).optional(),
      price: z.string().max(60).optional().describe('As written, with the currency: "€189", "1 500 THB"'),
      paid: z.boolean().optional().describe("Already paid"),
      on_site: z
        .string()
        .max(60)
        .optional()
        .describe('Still to pay at the place itself, with the currency: "600 MXN" (a cenote entrance, a park fee); "" clears it'),
      cash: z.boolean().optional().describe("The place takes only cash for on_site"),
      status: z
        .enum(["confirmed", "pending", "todo"])
        .optional()
        .describe("confirmed; pending = paid or requested but not confirmed yet; todo = still to book"),
    })
    .optional(),
};

type CardArgs = { [K in keyof typeof cardFields]?: z.infer<(typeof cardFields)[K]> };

/** Applies tool arguments to a card, resolving place_query to coordinates. */
async function applyCard(trip: Trip, base: Item, a: CardArgs): Promise<{ item: Item; matched?: string }> {
  const item: Item = { ...base };
  let matched: string | undefined;
  if (a.place_query) {
    const [place] = await searchPlaces(a.place_query, { bias: tripCenter(trip), maxResults: 1 });
    if (!place)
      throw new HttpError(404, `No place found for "${a.place_query}". Try a more specific query or lat/lng.`);
    Object.assign(item, itemFieldsFromPlace(place));
    if (!a.type && !base.title) item.type = guessType(place);
    if (!item.title) item.title = place.name;
    matched = `${place.name}${place.address ? `, ${place.address}` : ""}`;
  } else if (a.lat != null && a.lng != null) {
    item.location = { lat: a.lat, lng: a.lng };
    item.place = undefined;
  }
  if (a.title) item.title = a.title;
  if (a.type) item.type = a.type;
  if (a.start_time !== undefined) item.startTime = a.start_time || undefined;
  if (a.duration_min !== undefined) item.durationMin = a.duration_min;
  if (a.notes !== undefined) item.notes = a.notes || undefined;
  if (a.dive) {
    item.dive = {
      dives: a.dive.dives,
      maxDepthM: a.dive.max_depth_m,
      gas: a.dive.gas ?? item.dive?.gas ?? "air",
      mix: a.dive.mix === undefined ? item.dive?.mix : a.dive.mix.trim() || undefined,
      site: a.dive.site,
      center: a.dive.center,
      // The preparation belongs to the coach (save_dive_prep), not to the card's details.
      prep: item.dive?.prep,
    };
  } else if (item.type === "dive" && !item.dive) item.dive = { dives: 2, gas: "air" };
  if (a.transport) {
    const { to_place_query, to_lat, to_lng, arrival_time, arrival_next_day, ...details } = a.transport;
    let toLocation: Location | undefined = item.transport?.toLocation;
    if (to_place_query) {
      const [place] = await searchPlaces(to_place_query, { bias: tripCenter(trip), maxResults: 1 });
      if (!place) throw new HttpError(404, `No place found for arrival "${to_place_query}".`);
      toLocation = { lat: place.lat, lng: place.lng, address: place.address, placeId: place.placeId };
    } else if (to_lat != null && to_lng != null) toLocation = { lat: to_lat, lng: to_lng };
    item.transport = { ...details, toLocation };
    if (arrival_time) {
      const leaves = parseHm(item.startTime);
      if (leaves === undefined) throw new HttpError(400, "arrival_time needs the departure as start_time.");
      item.durationMin = parseHm(arrival_time)! + (arrival_next_day ? 1440 : 0) - leaves;
      if (item.durationMin < 0) throw new HttpError(400, "It arrives before it leaves – set arrival_next_day.");
    }
  } else if (item.type === "transport" && !item.transport) item.transport = { kind: "other" };
  if (a.stay_nights || a.stay_check_in || a.stay_check_out) {
    item.stay = {
      ...item.stay,
      nights: a.stay_nights ?? item.stay?.nights ?? 1,
      checkIn: a.stay_check_in ?? item.stay?.checkIn,
      checkOut: a.stay_check_out ?? item.stay?.checkOut,
    };
  } else if (item.type === "stay" && !item.stay) item.stay = { nights: 1 };
  if (a.rental) {
    item.rental = {
      vehicle: a.rental.vehicle,
      days: a.rental.days,
      returnTime: a.rental.return_time,
      returnPlace: a.rental.return_place,
    };
  } else if (item.type === "rental" && !item.rental) item.rental = { vehicle: "car", days: 1 };
  if (a.tour_stops) {
    const stops: TourStop[] = [];
    for (const s of a.tour_stops) {
      if (s.place_query) {
        const [place] = await searchPlaces(s.place_query, { bias: item.location ?? tripCenter(trip), maxResults: 1 });
        if (!place) throw new HttpError(404, `No place found for tour stop "${s.place_query}".`);
        stops.push({ name: s.name, location: { lat: place.lat, lng: place.lng, address: place.address, placeId: place.placeId } });
      } else {
        stops.push({ name: s.name, location: s.lat != null && s.lng != null ? { lat: s.lat, lng: s.lng } : undefined });
      }
    }
    item.tour = stops.length ? { stops } : undefined;
  }
  if (a.booking) {
    const { on_site, ...rest } = a.booking;
    item.booking = { ...item.booking, ...rest };
    if (on_site !== undefined) item.booking.onSite = on_site || undefined;
  }
  if (!item.title) item.title = "Untitled";

  // Elevation feeds the dive altitude checks, so only look it up on trips with dives (best-effort).
  const hasDives = item.type === "dive" || Object.values(trip.items).some((i) => i.type === "dive");
  if (hasDives && item.location && item.location.elevationM === undefined) {
    try {
      item.location = { ...item.location, elevationM: await elevation(item.location) };
    } catch {
      // the board retries elevation later
    }
  }
  // Time zones show when the clocks change on a journey (best-effort, needs Google).
  if (item.type === "transport") {
    const zone = async (loc?: Location) => {
      if (!loc || loc.timeZone !== undefined) return loc;
      try {
        return { ...loc, timeZone: await timeZone(loc) };
      } catch {
        return loc; // the board looks it up later
      }
    };
    item.location = await zone(item.location);
    if (item.transport?.toLocation) item.transport = { ...item.transport, toLocation: await zone(item.transport.toLocation) };
  }
  return { item, matched };
}

// ---------- Tools ----------

server.registerTool(
  "list_trips",
  {
    title: "List trips",
    description: "All of the user's trips with ids, destinations and dates, plus where they are stored.",
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  tool(async () => {
    // The listing has what is shown; only trips saved before it did (on Drive) are downloaded.
    const trips = (
      await Promise.all(
        (await store().list()).map(async (s) =>
          s.days !== undefined && s.cards !== undefined
            ? s
            : store()
                .get(s.id)
                .then((t) => t && summaryOf(t)),
        ),
      )
    ).filter((t) => !!t);
    const where = store().location;
    if (!trips.length) return `No trips yet (storage: ${where}). Create one with create_trip.`;
    return [
      `Storage: ${where}. Maps data: ${mapsProvider() === "google" ? "Google" : "OpenStreetMap"}.`,
      ...trips
        // Dated trips by start; early plans with open dates after them.
        .sort((a, b) => (a.startDate ?? "~").localeCompare(b.startDate ?? "~"))
        .map(
          (t) =>
            `- ${t.name} [trip_id ${t.id}] · ${t.destination ?? ""} · ${t.startDate ? `${t.startDate}, ${t.days} days` : `dates open${t.days ? `, ${t.days} undated days` : ""}`} · ${t.cards} cards`,
        ),
    ].join("\n");
  }),
);

server.registerTool(
  "get_trip",
  {
    title: "Get trip plan",
    description:
      "The full plan: every day with cards in order, estimated times, travel legs, bookings, locations, and timing / dive-safety warnings. Card ids in [brackets].",
    inputSchema: { trip_id: tripId },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  tool(async ({ trip_id }) => {
    const trip = await loadTrip(trip_id);
    const { budget, spending } = await moneyOf(trip);
    return renderTrip(trip, budget, spending);
  }),
);

server.registerTool(
  "create_trip",
  {
    title: "Create trip",
    description:
      "Creates a new trip with empty days. Leave out start_date for an early plan whose dates are not decided yet: it gets `days` undated days (none by default, the cards wait in Ideas) and an optional rough timing; set the dates later with update_trip.",
    inputSchema: {
      name: z.string().min(1).max(120),
      destination: z.string().min(1).max(120),
      start_date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .describe("YYYY-MM-DD of day 1. Omit while the dates are open"),
      days: z
        .number()
        .int()
        .min(0)
        .max(60)
        .optional()
        .describe("Number of days; required with start_date (at least 1). Without it: 0 or the days the user expects"),
      timing: z
        .string()
        .max(120)
        .optional()
        .describe("Only without start_date: when, roughly, in the user's words, e.g. 'spring 2027, about 10 days'"),
      interests: z.string().max(300).optional().describe("Used for suggestions, e.g. 'diving, viewpoints, local food'"),
      default_mode: z.enum(ROUTABLE_MODES).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  tool(async (a) => {
    if (a.start_date && !a.days) throw new HttpError(400, "days (at least 1) is required with start_date.");
    const trip = ops.createTrip({
      name: a.name,
      destination: a.destination,
      startDate: a.start_date,
      days: a.days,
      timing: a.start_date ? undefined : a.timing,
      interests: a.interests,
      defaultMode: a.default_mode,
    });
    await exclusive(() => store().put(trip));
    return `Created "${trip.name}" [trip_id ${trip.id}]: ${datesLine(trip)}.`;
  }),
);

server.registerTool(
  "update_trip",
  {
    title: "Update trip",
    description:
      "Changes trip details, changes the date range (end_date adds or removes days at the end; cards from removed days move to Ideas), adds days at the end, sets the start time of a day, sets the budget currency and spending limit, or the travellers' passports. For an early plan with open dates: timing saves when, roughly; start_date with end_date (or with the undated days it has) gives it dates; dates_open: true opens the dates of a dated trip again (its days stay, undated).",
    inputSchema: {
      trip_id: tripId,
      name: z.string().max(120).optional(),
      destination: z.string().max(120).optional(),
      start_date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
      end_date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .describe("Last day of the trip. Without it, changing start_date keeps the number of days"),
      timing: z
        .string()
        .max(120)
        .optional()
        .describe("While the dates are open: when, roughly, e.g. 'May or June 2027, 8–10 days'; empty clears it"),
      dates_open: z
        .boolean()
        .optional()
        .describe("true: the dates are not decided (any more) – removes start_date, keeps the days undated"),
      interests: z.string().max(300).optional(),
      default_mode: z.enum(ROUTABLE_MODES).optional(),
      add_days: z.number().int().min(1).max(30).optional(),
      budget_currency: z.enum(RATE_CURRENCIES).optional().describe("The currency the trip's prices add up in"),
      budget_limit: z.number().min(0).optional().describe("Spending limit in the budget currency; 0 removes it"),
      passports: z
        .array(z.enum(COUNTRY_CODES as [string, ...string[]]))
        .max(5)
        .optional()
        .describe("Passports the travellers hold, ISO 3166-1 alpha-2 (e.g. ['PL']); entry rules are checked for these"),
      day_start: z
        .object({ day: z.number().int().min(1), time: hhmm })
        .optional()
        .describe("When a given day starts"),
      day_label: z
        .object({ day: z.number().int().min(1), label: z.string().max(60) })
        .optional()
        .describe("Where a given day is, e.g. 'Hanoi' (shown in its header); '' clears it"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  tool(async (a) => {
    const trip = await updateTrip(a.trip_id, (t) => {
      if (a.dates_open && (a.start_date || a.end_date)) {
        throw new HttpError(400, "dates_open cannot be combined with start_date or end_date.");
      }
      let next: Trip = {
        ...t,
        name: a.name ?? t.name,
        destination: a.destination ?? t.destination,
        interests: a.interests ?? t.interests,
        defaultMode: a.default_mode ?? t.defaultMode,
        passports: a.passports ?? t.passports,
      };
      if (a.budget_currency || a.budget_limit !== undefined) {
        next.budget = {
          ...t.budget,
          currency: a.budget_currency ?? budgetCurrency(t),
          ...(a.budget_limit !== undefined && { limit: a.budget_limit > 0 ? a.budget_limit : undefined }),
        };
      }
      if (a.dates_open) next = ops.clearDates(next, a.timing ?? next.timing);
      else if (a.timing !== undefined && !(a.start_date ?? next.startDate)) next = ops.clearDates(next, a.timing);
      const startDate = a.start_date ?? next.startDate;
      if (a.end_date && !startDate) throw new HttpError(400, "The dates are open: give start_date together with end_date.");
      if (startDate && (a.start_date || a.end_date)) {
        const count = a.end_date ? daysBetween(startDate, a.end_date) + 1 : next.days.length;
        if (!a.end_date && count < 1) throw new HttpError(400, "This early plan has no days yet: give end_date with start_date.");
        if (count < 1 || count > 60) throw new HttpError(400, "end_date must be on or after the first day, at most 60 days later");
        next = ops.setDates(next, startDate, count);
      }
      if (a.add_days) next = { ...next, days: [...next.days, ...Array.from({ length: a.add_days }, ops.newDay)] };
      if (a.day_start) {
        const id = containerFor(next, a.day_start.day);
        next = { ...next, days: next.days.map((d) => (d.id === id ? { ...d, startTime: a.day_start!.time } : d)) };
      }
      if (a.day_label) {
        const id = containerFor(next, a.day_label.day);
        const label = a.day_label.label.trim();
        next = {
          ...next,
          days: next.days.map((d) => {
            if (d.id !== id) return d;
            const { label: _old, ...rest } = d;
            return label ? { ...rest, label } : rest;
          }),
        };
      }
      return next;
    });
    return `Updated. "${trip.name}": ${datesLine(trip)}.`;
  }),
);

server.registerTool(
  "set_outline",
  {
    title: "Sketch the route",
    description:
      "Saves the trip's route in broad strokes: the regions or towns in order and how many days in each, e.g. Hanoi 3 → Ha Long Bay 2 → Hoi An 4. Good for an early plan, before the days are planned; each stop is located on the map (and for the climate and the ideas nearby). Replaces the outline; [] removes it. make_days lays it over the days: adds days up to the outline's total (never removes any) and labels each day with its stop.",
    inputSchema: {
      trip_id: tripId,
      stops: z
        .array(
          z.object({
            name: z.string().min(1).max(60),
            days: z.number().int().min(1).max(60),
            place_query: z
              .string()
              .max(200)
              .optional()
              .describe("Where it is, when the name alone is ambiguous, e.g. 'Hoi An, Vietnam'. Default: the name and the destination"),
            lat: z.number().min(-90).max(90).optional(),
            lng: z.number().min(-180).max(180).optional(),
          }),
        )
        .max(20),
      make_days: z.boolean().optional().describe("Also add the days and label them with the stops"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  tool(async (a) => {
    const unlocated: string[] = [];
    const trip = await updateTrip(a.trip_id, async (t) => {
      const center = tripCenter(t);
      const stops = await Promise.all(
        a.stops.map(async (s) => {
          if (s.lat != null && s.lng != null) return outlineStop(s.name, s.days, { lat: s.lat, lng: s.lng });
          const old = t.outline?.find((o) => o.name === s.name.trim() && o.location);
          if (old && !s.place_query) return { ...outlineStop(s.name, s.days, old.location), id: old.id };
          const [place] = await searchPlaces(s.place_query ?? `${s.name}, ${t.destination}`, { bias: center, maxResults: 1 }).catch(
            () => [],
          );
          if (!place) unlocated.push(s.name);
          return outlineStop(s.name, s.days, place ? { lat: place.lat, lng: place.lng } : undefined);
        }),
      );
      return setOutline(t, stops, { days: a.make_days });
    });
    if (!trip.outline) return "Removed the outline.";
    const fit = outlineFit(trip);
    return [
      `Outline: ${outlineLine(trip.outline)} – ${fit.outline} days${a.make_days ? `; the trip now has ${fit.days} days, labelled` : fit.kind === "long" ? ` (the trip has ${fit.days} – make_days adds them)` : ""}.`,
      unlocated.length ? `Not found on the map: ${unlocated.join(", ")} – give a place_query.` : "",
    ]
      .filter(Boolean)
      .join(" ");
  }),
);

server.registerTool(
  "add_item",
  {
    title: "Add card",
    description:
      "Adds a card (place, food, activity, stay, rental, dive or transport) to a day or to Ideas. Use place_query (or lat/lng) so it appears on the map. Stays: set stay_nights on the check-in day; later days then start from it. Rentals: put the card on the pick-up day and set rental.days. Organised tours: place = pick-up point, tour_stops = places visited.",
    inputSchema: {
      trip_id: tripId,
      day: dayNumber,
      position: z.number().int().min(1).optional().describe("1-based position in the day; default: at the end"),
      ...cardFields,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  tool(async (a) => {
    let summary = "";
    await updateTrip(a.trip_id, async (t) => {
      const { item, matched } = await applyCard(t, { id: ops.newId(), type: a.type ?? "place", title: "" }, a);
      summary = `Added ${itemIcon(item)} "${item.title}" [${item.id}] to ${a.day === 0 ? "Ideas" : `day ${a.day}`}${matched ? ` – located at ${matched}` : item.location ? "" : " (no location)"}.`;
      return ops.addItem(t, item, containerFor(t, a.day), a.position ? a.position - 1 : undefined);
    });
    return summary;
  }),
);

server.registerTool(
  "update_item",
  {
    title: "Update card",
    description: "Changes a card's fields. Only the given fields change. Use place_query or lat/lng to relocate it.",
    inputSchema: { trip_id: tripId, item_id: z.string(), ...cardFields },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  tool(async (a) => {
    let summary = "";
    await updateTrip(a.trip_id, async (t) => {
      const { item, matched } = await applyCard(t, requireItem(t, a.item_id), a);
      summary = `Updated "${item.title}"${matched ? ` – now at ${matched}` : ""}.`;
      return { ...t, items: { ...t.items, [item.id]: item } };
    });
    return summary;
  }),
);

server.registerTool(
  "move_item",
  {
    title: "Move card",
    description: "Moves a card to another day (or Ideas = 0) and/or position.",
    inputSchema: {
      trip_id: tripId,
      item_id: z.string(),
      day: dayNumber,
      position: z.number().int().min(1).optional().describe("1-based; default: at the end"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  tool(async (a) => {
    let title = "";
    await updateTrip(a.trip_id, (t) => {
      title = requireItem(t, a.item_id).title;
      return ops.moveItem(t, a.item_id, containerFor(t, a.day), a.position ? a.position - 1 : undefined);
    });
    return `Moved "${title}" to ${a.day === 0 ? "Ideas" : `day ${a.day}`}${a.position ? `, position ${a.position}` : ""}.`;
  }),
);

server.registerTool(
  "remove_item",
  {
    title: "Remove card",
    description:
      "Deletes a card from the trip. Prefer moving it to Ideas (move_item day 0) if the user may want it later.",
    inputSchema: { trip_id: tripId, item_id: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  },
  tool(async (a) => {
    let title = "";
    await updateTrip(a.trip_id, (t) => {
      title = requireItem(t, a.item_id).title;
      return ops.removeItem(t, a.item_id);
    });
    return `Removed "${title}".`;
  }),
);

server.registerTool(
  "move_day",
  {
    title: "Move day",
    description: "Moves a whole day (all its cards) to another position; dates follow the new order.",
    inputSchema: { trip_id: tripId, from_day: z.number().int().min(1), to_day: z.number().int().min(1) },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  tool(async (a) => {
    await updateTrip(a.trip_id, (t) => {
      containerFor(t, a.from_day);
      containerFor(t, a.to_day);
      return ops.moveDay(t, a.from_day - 1, a.to_day - 1);
    });
    return `Moved day ${a.from_day} to position ${a.to_day}.`;
  }),
);

server.registerTool(
  "reorder_day",
  {
    title: "Reorder day",
    description: "Sets the visiting order of a day. item_ids must list every card of that day exactly once.",
    inputSchema: { trip_id: tripId, day: z.number().int().min(1), item_ids: z.array(z.string()).min(1) },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  tool(async (a) => {
    const trip = await updateTrip(a.trip_id, (t) => ops.reorderDay(t, containerFor(t, a.day), a.item_ids));
    return `Day ${a.day} reordered: ${a.item_ids.map((id) => trip.items[id]?.title).join(" → ")}.`;
  }),
);

server.registerTool(
  "set_leg",
  {
    title: "Set travel mode",
    description:
      "Sets how the user travels between two consecutive cards (car, walk, bike, transit, scooter, or ferry/boat/flight with manual minutes).",
    inputSchema: {
      trip_id: tripId,
      from_item_id: z.string(),
      to_item_id: z.string(),
      mode: modes,
      minutes: z.number().int().min(0).max(2000).optional().describe("Required for FERRY, BOAT and FLIGHT"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  tool(async (a) => {
    if (!isRoutable(a.mode) && a.minutes == null) throw new HttpError(400, `${a.mode} legs need minutes.`);
    await updateTrip(a.trip_id, (t) => {
      requireItem(t, a.from_item_id);
      requireItem(t, a.to_item_id);
      const key = legKey(a.from_item_id, a.to_item_id);
      return { ...t, legs: { ...t.legs, [key]: { ...t.legs[key], mode: a.mode, manualMin: a.minutes, auto: false } } };
    });
    return `Leg set to ${MODE_LABEL[a.mode]}${a.minutes != null ? ` (${a.minutes} min)` : ""}.`;
  }),
);

server.registerTool(
  "search_places",
  {
    title: "Search places",
    description:
      "Finds places by name or description near the trip (or a card / coordinates). Source: Google Places when configured, otherwise OpenStreetMap.",
    inputSchema: {
      query: z.string().min(2).max(200),
      trip_id: z.string().optional(),
      near_item_id: z.string().optional(),
      lat: z.number().optional(),
      lng: z.number().optional(),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  tool(async (a) => {
    let bias: LatLng | undefined = a.lat != null && a.lng != null ? { lat: a.lat, lng: a.lng } : undefined;
    if (!bias && a.trip_id) {
      const trip = await loadTrip(a.trip_id);
      bias = (a.near_item_id ? trip.items[a.near_item_id]?.location : undefined) ?? tripCenter(trip);
    }
    const places = await searchPlaces(a.query, { bias, maxResults: 8 });
    return places.length ? places.map((p) => placeLine(p, bias)).join("\n") : "No places found.";
  }),
);

server.registerTool(
  "nearby_places",
  {
    title: "What's nearby",
    description: `Notable places around a card or coordinates, by category (${Object.keys(OSM_CATEGORIES).join(", ")}). Most notable first. Pick what fits the traveller's interests and day, then add_item.`,
    inputSchema: {
      trip_id: tripId,
      near_item_id: z.string().optional().describe("Card to search around (default: centre of the trip)"),
      lat: z.number().optional(),
      lng: z.number().optional(),
      radius_km: z.number().min(0.2).max(30).default(5),
      categories: z
        .array(z.enum(Object.keys(OSM_CATEGORIES) as [string, ...string[]]))
        .max(7)
        .optional(),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  tool(async (a) => {
    const trip = await loadTrip(a.trip_id);
    const center =
      a.lat != null && a.lng != null
        ? { lat: a.lat, lng: a.lng }
        : a.near_item_id
          ? requireItem(trip, a.near_item_id).location
          : tripCenter(trip);
    if (!center)
      throw new HttpError(400, "No location to search around – give near_item_id with a location, or lat/lng.");
    const existing = new Set(
      Object.values(trip.items)
        .map((i) => i.location?.placeId)
        .filter(Boolean),
    );
    const places = (
      await nearbyPlaces({ center, radiusM: a.radius_km * 1000, categories: a.categories, maxResults: 20 })
    ).filter((p) => !existing.has(p.placeId));
    return places.length
      ? `${places.length} places within ${a.radius_km} km (already-planned ones excluded):\n${places.map((p) => placeLine(p, center)).join("\n")}`
      : "Nothing found – try a larger radius or other categories.";
  }),
);

server.registerTool(
  "optimize_day",
  {
    title: "Optimize day (travel times)",
    description:
      "Computes real travel times between a day's cards and the fastest order that keeps fixed start times and opening hours. Does not change the plan: decide the final order (meals, sunsets, heat…) and apply it with reorder_day.",
    inputSchema: { trip_id: tripId, day: z.number().int().min(1), mode: modes.optional() },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  tool(async (a) => {
    const trip = await loadTrip(a.trip_id);
    const dayIndex = a.day - 1;
    const day = trip.days[dayIndex];
    if (!day) throw new HttpError(400, `Day ${a.day} does not exist.`);
    const items = day.itemIds.map((id) => trip.items[id]).filter(Boolean);
    const located = items.filter((i) => i.location);
    if (located.length < 2) return "Need at least two cards with a location on that day.";
    const base = findBase(trip, dayIndex);
    // Without a mode: how this day gets around by default (by scooter only once it is picked up).
    const mode = a.mode ?? defaultModeTo(trip, day.itemIds.at(-1) ?? "");
    const nodes = [...(base?.location ? [base] : []), ...located].map((i) => ({
      id: i.id,
      at: i.location!,
      leavesFrom: i.transport?.toLocation && leavesFrom(i),
    }));
    const { minutes, estimated } = await travelMatrix(nodes, mode, routeMatrix, (from, to) =>
      manualLegMinutes(trip, from, to),
    );
    const input: OptInput = {
      stops: located.map((i) => ({
        id: i.id,
        durationMin: durationOf(i),
        // A stay's time is the earliest check-in, not an appointment to be on time for.
        fixedStart: i.type === "stay" ? undefined : parseHm(i.startTime),
        periods: i.place?.openingPeriods,
      })),
      matrix: minutes,
      hasStart: !!base?.location,
      dayStartMin: parseHm(day.startTime) ?? 540,
      weekday: trip.startDate ? dayDate(trip.startDate, dayIndex).getUTCDay() : undefined,
    };
    const current = located.map((_, i) => i);
    const best = bestOrder(input);
    const fmt = (order: number[]) => {
      const m = evaluate(input, order);
      return `${order.map((i) => `${located[i].title} [${located[i].id}]`).join(" → ")}\n  travel ${formatDuration(m.travelMin)}, ends ~${formatHm(m.endMin)}${m.lateMin ? `, ${Math.round(m.lateMin)} min late for fixed times` : ""}${m.closedCount ? `, ${m.closedCount} stop(s) outside opening hours` : ""}`;
    };
    const labels = [...(input.hasStart ? [`START ${base!.title}`] : []), ...located.map((i) => i.title)];
    const table = labels
      .map(
        (from, i) =>
          `${from}: ${labels
            .map((to, j) => (i === j || to.startsWith("START") ? null : `${to} ${Math.round(minutes[i][j])}m`))
            .filter(Boolean)
            .join(", ")}`,
      )
      .join("\n");
    const unlocated = items.filter((i) => !i.location);
    return [
      `Day ${a.day}, ${MODE_LABEL[mode]}${estimated ? " (straight-line estimates – no routing available)" : ""}; ferry, boat and flight legs you set keep their minutes. Day starts ${day.startTime}.`,
      `Current order:\n  ${fmt(current)}`,
      `Fastest order:\n  ${fmt(best)}`,
      `Travel minutes:\n${table}`,
      unlocated.length
        ? `Cards without location (keep them in reorder_day): ${unlocated.map((i) => `${i.title} [${i.id}]`).join(", ")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");
  }),
);

const entryKind = z.enum(["visa", "passport", "arrival_form", "health", "insurance", "driving", "customs", "other"]);
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

server.registerTool(
  "save_entry_check",
  {
    title: "Save entry requirements",
    description: `Saves what it takes to enter the countries on the trip's route – visas, passport rules, arrival forms and other formalities – after you researched them on the web. Replaces the previous check; formalities already ticked off stay ticked. How to research:\n${ENTRY_RESEARCH_GUIDE}`,
    inputSchema: {
      trip_id: tripId,
      passports: z
        .array(z.enum(COUNTRY_CODES as [string, ...string[]]))
        .min(1)
        .max(5)
        .optional()
        .describe("The passports it was checked for (ISO 3166-1 alpha-2); default: the trip's"),
      countries: z
        .array(
          z.object({
            code: z.string().describe("ISO 3166-1 alpha-2"),
            name: z.string().optional(),
            transit: z.boolean().optional().describe("Only changing planes / ships there"),
            from: isoDay.optional().describe("First day in the country"),
            to: isoDay.optional().describe("Last day in the country"),
            summary: z.string().max(200).describe("One line, e.g. 'No visa needed for up to 60 days'"),
            requirements: z
              .array(
                z.object({
                  kind: entryKind,
                  level: z.enum(["ok", "action", "warn", "info"]),
                  title: z.string().max(120),
                  details: z.string().max(600).optional().describe("How, where, cost, the window to do it in"),
                  due_by: isoDay.optional().describe("Last day to do it (level action)"),
                  url: z.string().url().optional().describe("Official page for it, on the site of one of the sources"),
                }),
              )
              .max(20),
            sources: z
              .array(z.object({ title: z.string(), url: z.string().url() }))
              .min(1)
              .max(10)
              .describe("The official pages you read for this country"),
          }),
        )
        .max(15)
        .describe("In route order, transit countries included"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  tool(async (a) => {
    let summary = "";
    await updateTrip(a.trip_id, (t) => {
      const passports = a.passports ?? t.passports;
      if (!passports?.length) {
        throw new HttpError(400, "The trip has no passports yet – pass passports (ask the user which they travel on).");
      }
      const countries = normalizeCountries(a.countries);
      // A link has to be on one of the sites given as sources, so no stray agency page slips in.
      const linked = keepFoundLinks(countries, countries.flatMap((c) => c.sources.map((s) => s.url)));
      const links = (cs: typeof countries) => cs.flatMap((c) => c.requirements).filter((r) => r.url).length;
      const dropped = links(countries) - links(linked);
      const next: Trip = { ...t, passports };
      next.entry = carryOverDone(t.entry, {
        passports,
        routeKey: entryRouteKey(next),
        checkedAt: new Date().toISOString(),
        countries: linked,
      });
      const open = linked.flatMap((c) => c.requirements).filter((r) => r.level === "action").length;
      summary =
        `Saved entry rules for ${linked.map((c) => `${flag(c.code)} ${c.name}`).join(", ") || "no countries"} ` +
        `(passports: ${passports.join(", ")}); ${open} ${open === 1 ? "formality" : "formalities"} to do.` +
        (dropped ? ` Left out ${dropped} link(s) not on a source's site.` : "");
      return next;
    });
    return summary;
  }),
);

server.registerTool(
  "add_expense",
  {
    title: "Add expense",
    description:
      "Records money spent during the trip that no card holds (meals, taxis, tickets bought on the spot, souvenirs), e.g. from a receipt, a bank notification or what the user says. get_trip then shows what was spent against the plan. Never invent amounts.",
    inputSchema: {
      trip_id: tripId,
      amount: z.string().min(1).max(40).describe('As written, with its currency: "350 THB", "€12.50"'),
      kind: z.enum(EXPENSE_KINDS as [ExpenseKind, ...ExpenseKind[]]).default("other"),
      day: z.number().int().min(0).optional().describe("The day it was spent on (1 = first day); 0 or none = the trip as a whole"),
      note: z.string().max(120).optional().describe("What it was, e.g. 'Dinner at Louisvanich'"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  tool(async (a) => {
    const money = parsePrice(a.amount);
    if (!money || (!money.currency && money.amount !== 0)) {
      throw new HttpError(400, `Write the amount with its currency, e.g. "350 THB" (got "${a.amount}").`);
    }
    const id = ops.newId();
    const trip = await updateTrip(a.trip_id, (t) => {
      const dayId = a.day ? t.days[a.day - 1]?.id : undefined;
      if (a.day && !dayId) throw new HttpError(400, `Day ${a.day} does not exist (trip has ${t.days.length} days).`);
      const expense: Expense = {
        id,
        dayId,
        amount: a.amount.trim(),
        kind: a.kind,
        note: a.note?.trim() || undefined,
        createdAt: new Date().toISOString(),
      };
      return { ...t, expenses: { ...t.expenses, [id]: expense } };
    });
    const { spending } = await moneyOf(trip);
    return `Added expense [${id}]. Spent so far: ${formatMoney(spending.spent, spending.currency)} of ${formatMoney(spending.planned, spending.currency)} planned.`;
  }),
);

server.registerTool(
  "remove_expense",
  {
    title: "Remove expense",
    description: "Deletes an expense listed by get_trip ([expense id]).",
    inputSchema: { trip_id: tripId, expense_id: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  },
  tool(async (a) => {
    await updateTrip(a.trip_id, (t) => {
      if (!t.expenses?.[a.expense_id]) throw new HttpError(404, `No expense ${a.expense_id}.`);
      const { [a.expense_id]: _removed, ...rest } = t.expenses;
      return { ...t, expenses: rest };
    });
    return `Removed expense ${a.expense_id}.`;
  }),
);

server.registerTool(
  "trip_summary",
  {
    title: "Trip summary",
    description:
      "The trip in numbers: days and nights, places, dives, flights / ferries / trains, kilometres by way of travel, countries, the highest point, and what it cost against the plan. Good for a recap after the trip.",
    inputSchema: { trip_id: tripId },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  tool(async ({ trip_id }) => {
    const trip = await loadTrip(trip_id);
    const s = tripSummary(trip, computeTripTimeline(trip));
    const { spending } = await moneyOf(trip);
    const m = (n: number) => formatMoney(n, spending.currency);
    const km = Object.entries(s.km)
      .filter(([, n]) => n > 0)
      .map(([way, n]) => `${way} ${n} km`)
      .join(", ");
    return [
      `# ${trip.name} in numbers`,
      `${s.days} days, ${s.nights} nights in ${s.stays} stays · ${s.places} places, meals and activities`,
      s.dives ? `${s.dives} dives on ${s.diveDays} days` : "",
      `${s.flights} flights, ${s.ferries} ferries / boats, ${s.trains} trains`,
      km ? `Distance: ${km}${s.roadEstimated ? " (roads partly estimated)" : ""}` : "",
      s.countries.length ? `Countries: ${s.countries.join(", ")}` : "",
      s.highest ? `Highest point: ${s.highest.m} m (${s.highest.title})` : "",
      spending.planned || spending.spent ? `Money: spent ${m(spending.spent)} of ${m(spending.planned)} planned (expenses ${m(spending.expenses)})` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }),
);

server.registerTool(
  "climate",
  {
    title: "Climate by month",
    description:
      "The typical weather month by month in each region of the trip (its places grouped within ~150 km): average daily high / low and rainy days, from the last ten years of observations (Open-Meteo). Use it to suggest when to go for an early plan with open dates, or what to expect on a dated trip (its months are marked).",
    inputSchema: { trip_id: tripId },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  tool(async ({ trip_id }) => {
    const trip = await loadTrip(trip_id);
    const regions = regionsOf(trip);
    if (!regions.length) return "No located places yet – add places (place_query) to see their climate.";
    const climates = await Promise.all(regions.map((r) => climateAt(r.center)));
    const months = new Set(tripMonths(trip));
    const name = (m: number) => new Date(Date.UTC(2001, m - 1, 1)).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
    const lines = [
      trip.startDate ? `Trip months marked with ◀.` : `Dates open${trip.timing ? ` (roughly: ${trip.timing})` : ""}.`,
      "Average daily high/low °C, days with ≥1 mm rain, rain per month (last 10 years, Open-Meteo).",
    ];
    regions.forEach((r, i) => {
      lines.push("", `## ${regionLabel(r)} (${r.center.lat}, ${r.center.lng})`);
      for (const c of climates[i]) lines.push(`${name(c.month)}: ${climateLine(c)}${months.has(c.month) ? " ◀" : ""}`);
    });
    return lines.join("\n");
  }),
);

server.registerTool(
  "save_dive_prep",
  {
    title: "Save dive preparation",
    description:
      "Shows on a dive card how ready the diver is, as prepared by the coach of DiveDeck from the diver's dive log: ready, or check (something to sort out first: the mix, a refresher, a depth not dived yet), a one-line summary and the link to the full preparation. status none removes it.",
    inputSchema: {
      trip_id: tripId,
      item_id: z.string().describe("The dive card's id."),
      status: z.enum(["ready", "check", "none"]),
      summary: z.string().max(300).optional().describe("One or two sentences; needed unless status is none."),
      url: z.string().url().max(500).optional().describe("The preparation in DiveDeck, e.g. http://localhost:3001/trips/<trip id>#card-<item id>."),
      details: z
        .string()
        .max(3000)
        .optional()
        .describe(
          "The preparation itself as plain text, a few short lines or '- ' bullets: limits (depth, time, gas reserve), the gas plan, what to ask the dive centre, what to practise. The phone shows it offline during the trip, where a localhost link opens nothing. Leave out to keep the saved text; '' clears it.",
        ),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  tool(async (a) => {
    if (a.url && !divePrepUrl({ url: a.url })) throw new HttpError(400, "The link must be an http(s) address.");
    if (a.status !== "none" && !a.summary?.trim()) throw new HttpError(400, "Give a short summary of the preparation.");
    let title = "";
    await updateTrip(a.trip_id, (t) => {
      const item = requireItem(t, a.item_id);
      if (item.type !== "dive" || !item.dive) throw new HttpError(400, `"${item.title}" is not a dive card.`);
      title = item.title;
      const details = a.details === undefined ? item.dive.prep?.details : a.details.trim() || undefined;
      const prep =
        a.status === "none"
          ? undefined
          : { status: a.status, summary: a.summary!.trim(), url: a.url, details, updatedAt: new Date().toISOString() };
      return { ...t, items: { ...t.items, [item.id]: { ...item, dive: { ...item.dive, prep } } } };
    });
    return a.status === "none" ? `Removed the preparation from "${title}".` : `"${title}": ${DIVE_PREP_LABEL[a.status].toLowerCase()}.`;
  }),
);

server.registerTool(
  "set_entry_done",
  {
    title: "Tick off a formality",
    description: "Marks an entry formality listed by get_trip ([TH 2] = country TH, formality 2) as done, or as not done again.",
    inputSchema: {
      trip_id: tripId,
      country: z.string().describe("ISO code, e.g. TH"),
      number: z.number().int().min(1),
      done: z.boolean().default(true),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  tool(async (a) => {
    let title = "";
    await updateTrip(a.trip_id, (t) => {
      const code = a.country.toUpperCase();
      const r = t.entry?.countries.find((c) => c.code === code)?.requirements[a.number - 1];
      if (!t.entry || !r) throw new HttpError(404, `No formality ${code} ${a.number} in this trip's entry check.`);
      title = r.title;
      return { ...t, entry: setRequirementDone(t.entry, code, a.number - 1, a.done) };
    });
    return `${a.done ? "Done" : "Not done"}: ${title}.`;
  }),
);

server.registerPrompt(
  "entry-requirements",
  {
    title: "Check entry requirements",
    description: "Research visas, passport rules and arrival forms for a trip's route and save them on the board",
    argsSchema: { trip: z.string().describe("Trip name or id") },
  },
  ({ trip }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `Check the entry requirements for my trip "${trip}" in TripDeck. Get the trip; if its passports are not set, ask me which passports I travel on. Search the web for the current official rules for every country on the route, transit countries included, and save them with save_entry_check. Then summarise what I have to do and by when, and anything the sources disagreed on.`,
        },
      },
    ],
  }),
);

server.registerPrompt(
  "import-bookings",
  {
    title: "Import bookings from e-mail",
    description: "Find booking confirmations in your mail and add them to a trip",
    argsSchema: { trip: z.string().describe("Trip name or id") },
  },
  ({ trip }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `Find my booking confirmations for the trip "${trip}" in my e-mail (Booking.com, GetYourGuide, Viator, Airbnb, airlines, ferries, car rental, dive centres). Use the TripDeck tools: get the trip, then add one card per booking on the right day with provider, reference, times, price and a place_query for the location. Skip bookings that are already on the board. Summarise what you added and anything you were unsure about.`,
        },
      },
    ],
  }),
);

server.registerPrompt(
  "plan-day",
  {
    title: "Plan a day",
    description: "Suggest what to see around a day's stops and put the day in a good order",
    argsSchema: { trip: z.string().describe("Trip name or id"), day: z.string().describe("Day number") },
  },
  ({ trip, day }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `Look at day ${day} of my trip "${trip}" in TripDeck. Suggest 3–5 worthwhile places nearby that fit my interests and the rest of the day (use nearby_places / search_places), ask me which ones to add, then optimise the order with optimize_day and apply it with reorder_day. Mention any timing or dive-safety warnings.`,
        },
      },
    ],
  }),
);

async function main() {
  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error("TripDeck MCP server failed:", err);
  process.exit(1);
});
