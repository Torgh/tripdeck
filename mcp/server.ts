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
import { centroid } from "../lib/geo";
import { bestOrder, evaluate, travelMatrix, type OptInput } from "../lib/optimize";
import { guessType, itemFieldsFromPlace } from "../lib/places";
import { defaultModeTo, rentalsOf, VEHICLE_MODE } from "../lib/rentals";
import { HttpError } from "../lib/server/errors";
import { exchangeRates } from "../lib/server/rates";
import { budgetCurrency, budgetSummary, foreignCurrencies, formatMoney, RATE_CURRENCIES, tripBudget, type Budget } from "../lib/money";
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
import { nightsOf } from "../lib/stays";
import { dayDate, daysBetween, formatDayLabel, formatDuration, formatHm, isoDate, parseHm } from "../lib/time";
import { computeTripTimeline, durationOf, findBase, freshRoute, getLeg, manualLegMinutes } from "../lib/timeline";
import { todoLabel, tripTodos } from "../lib/todo";
import { transitStepLine } from "../lib/transit";
import * as ops from "../lib/tripOps";
import {
  BOOKING_STATUS_ICON,
  BOOKING_STATUS_LABEL,
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
- To find places use search_places (by name) or nearby_places (what is around a card). Prefer adding cards with place_query so they get coordinates and a map pin.
- Before reordering a day, call optimize_day for real travel times, then decide (meals, sunset, heat, opening hours) and apply with reorder_day. Explain your reasoning briefly.
- Booking confirmations: if you have Gmail (or another mail) tools, search for confirmations (Booking.com, GetYourGuide, Viator, Airbnb, airlines, ferries, car / scooter rentals, dive centres), then add one card per booking on the right day with provider, reference, times and price. Never invent booking numbers.
- Booking status: booking.status "confirmed", "pending" (paid or requested, not confirmed yet) or "todo" (still to book). get_trip lists the pending and to-book ones, and nights with nowhere to sleep, under "To sort out" – mention them.
- Prices: booking.price as written on the confirmation, always with its currency ("€189", "1 500 THB"); booking.paid when it is already paid. get_trip adds them up under "Budget" in the trip's currency (update_trip budget_currency / budget_limit) – mention prices without a currency and a budget that is over its limit.
- Rentals (car, scooter, motorbike, bicycle): one card of type rental on the pick-up day, start_time = pick-up time, rental.days = days until the return. The board then shows it on every day up to the return. Do not use transport car_rental for new rentals.
- Organised tours (type activity): the card's place is the pick-up / meeting point (travel times go there); list the places the tour visits in tour_stops so they show on the map.
- Flights, ferries, trains (type transport): place_query = where it departs, transport.to_place_query = where it arrives, start_time = departure and transport.arrival_time = arrival, both in local time as on the ticket (arrival_next_day when it lands the next day). The route to the next card then starts at the arrival, so no flight leg is needed. get_trip notes when the clocks change and how long the journey really takes.
- Public transport (leg mode TRANSIT): the board plans it for the time in the plan and get_trip lists the lines under the leg ("via 🚆 ARL: … → 🚇 …"). Suggest it from airports and stations; if it says no public transport at that time (night flights), suggest a car instead.
- Dives: get_trip reports no-fly and altitude warnings (DAN guidance: ≥12 h after a single no-deco dive, ≥18 h after repetitive or multi-day diving). Point them out, but they are planning hints, not a substitute for the diver's computer or training.
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
      `${item.dive.dives} dive(s)${item.dive.maxDepthM ? `, max ${item.dive.maxDepthM} m` : ""}, ${item.dive.gas}${item.dive.site ? `, site ${item.dive.site}` : ""}${item.dive.center ? `, with ${item.dive.center}` : ""}`,
    );
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
  for (const { item } of b.noCurrency) lines.push(`⚠️ Price without a currency, not counted: ${item.title} [${item.id}] "${item.booking?.price}"`);
  if (b.ideas.length) lines.push(`Ideas with a price (not counted): ${b.ideas.map((l) => `${l.item.title} ${l.item.booking?.price}`).join(", ")}`);
  return [...lines, ""];
}

/** Today's rates for the trip's budget when it has prices in other currencies; without them, those aren't converted. */
async function budgetOf(trip: Trip): Promise<Budget> {
  const base = budgetCurrency(trip);
  const rates = foreignCurrencies(trip, base).length ? await exchangeRates(base).catch(() => undefined) : undefined;
  return tripBudget(trip, rates);
}

function renderTrip(trip: Trip, budget?: Budget): string {
  const timelines = computeTripTimeline(trip);
  const diveWarnings = mergeIssues(computeDiveWarnings(trip, timelines), computeClockNotes(trip, timelines));
  const rentals = rentalsOf(trip);
  const lines: string[] = [];
  const last = dayDate(trip.startDate, trip.days.length - 1);
  const rentsDefault = Object.values(trip.items).some(
    (i) => i.type === "rental" && i.rental && VEHICLE_MODE[i.rental.vehicle] === trip.defaultMode,
  );
  lines.push(
    `# ${trip.name} [trip_id ${trip.id}]`,
    `${trip.destination} · ${trip.startDate} → ${isoDate(last)} (${trip.days.length} days) · default travel: ${MODE_LABEL[trip.defaultMode]}${rentsDefault ? " while rented, 🚗 Car otherwise" : ""}`,
    `Interests: ${trip.interests || "not set"}`,
    "",
  );
  const todos = tripTodos(trip);
  if (todos.length) lines.push("## To sort out", ...todos.map((t) => `- ${todoLabel(t)}`), "");
  if (budget) lines.push(...budgetLines(budget));
  const nights = nightsOf(trip);

  timelines.forEach((tl, d) => {
    const day = trip.days[d];
    lines.push(`## Day ${d + 1} · ${formatDayLabel(tl.date)} (starts ${day.startTime})`);
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
            `     via ${rides.transit.map(transitStepLine).join(" → ")}${rides.walkMin ? ` · 🚶 ${rides.walkMin} min on foot` : ""}${rides.at ? ` · timetable for ${rides.at}` : ""}${rides.sampledOn ? ` (not published yet – same weekday on ${rides.sampledOn})` : ""}`,
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
      site: a.dive.site,
      center: a.dive.center,
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
  if (a.booking) item.booking = { ...item.booking, ...a.booking };
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
          s.startDate !== undefined && s.days !== undefined && s.cards !== undefined
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
        .sort((a, b) => (a.startDate ?? "").localeCompare(b.startDate ?? ""))
        .map(
          (t) =>
            `- ${t.name} [trip_id ${t.id}] · ${t.destination ?? ""} · ${t.startDate}, ${t.days} days · ${t.cards} cards`,
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
    return renderTrip(trip, await budgetOf(trip));
  }),
);

server.registerTool(
  "create_trip",
  {
    title: "Create trip",
    description: "Creates a new trip with empty days.",
    inputSchema: {
      name: z.string().min(1).max(120),
      destination: z.string().min(1).max(120),
      start_date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .describe("YYYY-MM-DD of day 1"),
      days: z.number().int().min(1).max(60),
      interests: z.string().max(300).optional().describe("Used for suggestions, e.g. 'diving, viewpoints, local food'"),
      default_mode: z.enum(ROUTABLE_MODES).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  tool(async (a) => {
    const trip = ops.createTrip({
      name: a.name,
      destination: a.destination,
      startDate: a.start_date,
      days: a.days,
      interests: a.interests,
      defaultMode: a.default_mode,
    });
    await exclusive(() => store().put(trip));
    return `Created "${trip.name}" [trip_id ${trip.id}] with ${trip.days.length} days starting ${trip.startDate}.`;
  }),
);

server.registerTool(
  "update_trip",
  {
    title: "Update trip",
    description: "Changes trip details, changes the date range (end_date adds or removes days at the end; cards from removed days move to Ideas), adds days at the end, sets the start time of a day, or sets the budget currency and spending limit.",
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
      interests: z.string().max(300).optional(),
      default_mode: z.enum(ROUTABLE_MODES).optional(),
      add_days: z.number().int().min(1).max(30).optional(),
      budget_currency: z.enum(RATE_CURRENCIES).optional().describe("The currency the trip's prices add up in"),
      budget_limit: z.number().min(0).optional().describe("Spending limit in the budget currency; 0 removes it"),
      day_start: z
        .object({ day: z.number().int().min(1), time: hhmm })
        .optional()
        .describe("When a given day starts"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  tool(async (a) => {
    const trip = await updateTrip(a.trip_id, (t) => {
      let next: Trip = {
        ...t,
        name: a.name ?? t.name,
        destination: a.destination ?? t.destination,
        startDate: a.start_date ?? t.startDate,
        interests: a.interests ?? t.interests,
        defaultMode: a.default_mode ?? t.defaultMode,
      };
      if (a.budget_currency || a.budget_limit !== undefined) {
        next.budget = {
          ...t.budget,
          currency: a.budget_currency ?? budgetCurrency(t),
          ...(a.budget_limit !== undefined && { limit: a.budget_limit > 0 ? a.budget_limit : undefined }),
        };
      }
      if (a.end_date) {
        const count = daysBetween(next.startDate, a.end_date) + 1;
        if (count < 1 || count > 60) throw new HttpError(400, "end_date must be on or after the first day, at most 60 days later");
        next = ops.setDayCount(next, count);
      }
      if (a.add_days) next = { ...next, days: [...next.days, ...Array.from({ length: a.add_days }, ops.newDay)] };
      if (a.day_start) {
        const id = containerFor(next, a.day_start.day);
        next = { ...next, days: next.days.map((d) => (d.id === id ? { ...d, startTime: a.day_start!.time } : d)) };
      }
      return next;
    });
    return `Updated. "${trip.name}" now has ${trip.days.length} days from ${trip.startDate}.`;
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
      weekday: dayDate(trip.startDate, dayIndex).getUTCDay(),
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
