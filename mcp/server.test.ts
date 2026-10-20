import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Runs the real MCP server the way Claude Code does (Bun over stdio) against a temporary
 * TRIPDECK_HOME. Only tools that need no network are called.
 */

function findBun(): string | undefined {
  const candidates = [
    process.env.BUN_PATH,
    path.join(os.homedir(), ".bun", "bin", process.platform === "win32" ? "bun.exe" : "bun"),
    "bun",
  ];
  return candidates.find((c) => c && spawnSync(c, ["--version"]).status === 0);
}

const bun = findBun();
const home = fs.mkdtempSync(path.join(os.tmpdir(), "tripdeck-mcp-test-"));
let client: Client;

const call = async (name: string, args: Record<string, unknown> = {}) => {
  const res = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
  return { text: res.content.map((c) => c.text).join("\n"), isError: !!res.isError };
};
const ok = async (name: string, args: Record<string, unknown> = {}) => {
  const res = await call(name, args);
  if (res.isError) throw new Error(`${name} failed: ${res.text}`);
  return res.text;
};
const idIn = (text: string, label: RegExp) => text.match(label)![1];

describe.skipIf(!bun)("MCP server", () => {
  beforeAll(async () => {
    // Keep storage on the temporary folder: no Google token, OneDrive hidden.
    fs.writeFileSync(path.join(home, "config.json"), JSON.stringify({ storage: "local" }));
    const env = Object.fromEntries(
      Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined && !/^OneDrive/i.test(e[0])),
    );
    client = new Client({ name: "tripdeck-test", version: "1.0.0" });
    await client.connect(
      new StdioClientTransport({
        command: bun!,
        args: [path.join(process.cwd(), "mcp", "server.ts")],
        env: { ...env, TRIPDECK_HOME: home, GOOGLE_MAPS_API_KEY: "", ANTHROPIC_API_KEY: "" },
        stderr: "pipe",
      }),
    );
  }, 30_000);

  afterAll(async () => {
    await client?.close();
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("lists every documented tool and prompt", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        "add_item",
        "create_trip",
        "get_trip",
        "list_trips",
        "move_day",
        "move_item",
        "nearby_places",
        "optimize_day",
        "remove_item",
        "reorder_day",
        "search_places",
        "set_leg",
        "update_item",
        "update_trip",
      ].sort(),
    );
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name).sort()).toEqual(["import-bookings", "plan-day"]);
    expect(client.getInstructions()).toContain("list_trips");
  });

  it("plans a trip end to end and flags flying too soon after diving", async () => {
    expect(await ok("list_trips")).toMatch(/No trips yet/);

    const created = await ok("create_trip", { name: "Malta test", destination: "Malta", start_date: "2026-11-21", days: 2 });
    const tripId = idIn(created, /trip_id ([\w-]+)/);

    const dive = idIn(
      await ok("add_item", {
        trip_id: tripId,
        day: 1,
        type: "dive",
        title: "Cirkewwa wrecks",
        start_time: "09:00",
        duration_min: 240,
        dive: { dives: 2, max_depth_m: 30, gas: "nitrox" },
      }),
      /\[([\w-]+)\]/,
    );
    await ok("add_item", { trip_id: tripId, day: 1, type: "food", title: "Lunch" });
    await ok("add_item", {
      trip_id: tripId,
      day: 2,
      type: "transport",
      title: "Flight home",
      start_time: "06:00",
      transport: { kind: "flight", from: "MLA", to: "KRK" },
    });

    const plan = await ok("get_trip", { trip_id: tripId });
    expect(plan).toContain("Cirkewwa wrecks");
    expect(plan).toMatch(/18 h/); // repetitive dives → 18 h no-fly window

    // The web app reads the same file.
    const saved = JSON.parse(fs.readFileSync(path.join(home, "trips", `${tripId}.json`), "utf8"));
    expect(saved.days[0].itemIds).toHaveLength(2);

    await ok("move_item", { trip_id: tripId, item_id: dive, day: 0 });
    expect(await ok("get_trip", { trip_id: tripId })).not.toMatch(/18 h/);

    await ok("remove_item", { trip_id: tripId, item_id: dive });
    expect(await ok("list_trips")).toMatch(/Malta test.*2 days · 2 cards/);
  });

  it("adds a scooter rental that shows on every day until it goes back", async () => {
    const created = await ok("create_trip", { name: "Chiang Mai", destination: "Thailand", start_date: "2027-01-14", days: 4 });
    const tripId = idIn(created, /trip_id ([\w-]+)/);
    expect(
      await ok("add_item", {
        trip_id: tripId,
        day: 1,
        type: "rental",
        title: "Honda ADV 160",
        start_time: "18:00",
        rental: { vehicle: "scooter", days: 2, return_time: "18:00" },
        booking: { reference: "#2202", price: "6127.65 THB" },
      }),
    ).toContain("🛵");

    const plan = await ok("get_trip", { trip_id: tripId });
    expect(plan).toContain("scooter rental, 2 day(s), return by 18:00");
    expect(plan).toMatch(/Day 2[^#]*Has rental: Honda ADV 160 \[[\w-]+\] until Sat 16 Jan/);
    expect(plan).toMatch(/Day 3[^#]*Return rental today: Honda ADV 160 \[[\w-]+\] by 18:00/);
    expect(plan).not.toMatch(/Day 4[^#]*rental/i);
  });

  it("keeps the places an organised tour visits, apart from its pick-up point", async () => {
    const created = await ok("create_trip", { name: "Yucatán", destination: "Mexico", start_date: "2027-02-20", days: 1 });
    const tripId = idIn(created, /trip_id ([\w-]+)/);
    const tour = idIn(
      await ok("add_item", {
        trip_id: tripId,
        day: 1,
        type: "activity",
        title: "Chichén Itzá tour",
        lat: 21.162,
        lng: -86.823,
        tour_stops: [
          { name: "Chichén Itzá", lat: 20.6843, lng: -88.5678 },
          { name: "Valladolid", lat: 20.6896, lng: -88.2011 },
        ],
      }),
      /\[([\w-]+)\]/,
    );
    expect(await ok("get_trip", { trip_id: tripId })).toContain("tour visits: Chichén Itzá → Valladolid");

    // The pick-up point stays the card's location, so travel times still go there.
    const saved = JSON.parse(fs.readFileSync(path.join(home, "trips", `${tripId}.json`), "utf8"));
    expect(saved.items[tour].location).toMatchObject({ lat: 21.162, lng: -86.823 });
    expect(saved.items[tour].tour.stops[1]).toEqual({ name: "Valladolid", location: { lat: 20.6896, lng: -88.2011 } });

    await ok("update_item", { trip_id: tripId, item_id: tour, tour_stops: [] });
    expect(await ok("get_trip", { trip_id: tripId })).not.toContain("tour visits");
  });

  it("clears a fixed time, keeps a flight's arrival and the legs entered by hand", async () => {
    const created = await ok("create_trip", { name: "Islands", destination: "Thailand", start_date: "2027-01-29", days: 1 });
    const tripId = idIn(created, /trip_id ([\w-]+)/);
    const add = async (args: Record<string, unknown>) =>
      idIn(await ok("add_item", { trip_id: tripId, day: 1, ...args }), /\[([\w-]+)\]/);
    const flight = await add({
      type: "transport",
      title: "Flight URT → DMK",
      lat: 9.134,
      lng: 99.143,
      start_time: "13:25",
      duration_min: 75,
      transport: { kind: "flight", number: "FD 3240", to_lat: 13.918, to_lng: 100.601 },
    });
    const hotel = await add({ type: "stay", title: "Hotel", lat: 13.743, lng: 100.53, start_time: "14:00" });

    let plan = await ok("get_trip", { trip_id: tripId });
    expect(plan).toContain("arrives at  (13.91800, 100.60100)");
    expect(plan).not.toMatch(/after the fixed start/); // a stay's time is a check-in, not an appointment

    // Changing other transport details keeps the arrival; "" removes a fixed time.
    await ok("update_item", { trip_id: tripId, item_id: flight, transport: { kind: "flight", number: "FD 3241" } });
    await ok("update_item", { trip_id: tripId, item_id: hotel, start_time: "" });
    const saved = JSON.parse(fs.readFileSync(path.join(home, "trips", `${tripId}.json`), "utf8"));
    expect(saved.items[flight].transport).toMatchObject({ number: "FD 3241", toLocation: { lat: 13.918, lng: 100.601 } });
    expect(saved.items[hotel].startTime).toBeUndefined();
    plan = await ok("get_trip", { trip_id: tripId });
    expect(plan).toContain("Hotel [");
    expect(plan).not.toMatch(/Hotel \[[\w-]+\] 🔒/);

    await ok("set_leg", { trip_id: tripId, from_item_id: flight, to_item_id: hotel, mode: "BOAT", minutes: 33 });
    const optimized = await ok("optimize_day", { trip_id: tripId, day: 1, mode: "FERRY" });
    expect(optimized).toMatch(/Flight URT → DMK: Hotel 33m/);
  });

  it("lists the public-transport lines the board found for a leg", async () => {
    const created = await ok("create_trip", { name: "Bangkok", destination: "Thailand", start_date: "2027-01-11", days: 1 });
    const tripId = idIn(created, /trip_id ([\w-]+)/);
    const add = async (args: Record<string, unknown>) =>
      idIn(await ok("add_item", { trip_id: tripId, day: 1, ...args }), /\[([\w-]+)\]/);
    const airport = await add({ type: "transport", title: "Landed", lat: 13.6819, lng: 100.74687, start_time: "12:15", duration_min: 30 });
    const hotel = await add({ type: "stay", title: "Hotel", lat: 13.71842, lng: 100.52195 });
    await ok("set_leg", { trip_id: tripId, from_item_id: airport, to_item_id: hotel, mode: "TRANSIT" });

    // The board saves routes it fetched into the trip; do the same here.
    const file = path.join(home, "trips", `${tripId}.json`);
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    saved.legs[`${airport}>${hotel}`].result = {
      key: "TRANSIT|13.68190,100.74687|13.71842,100.52195",
      at: "2027-01-11 12:45",
      durationSec: 4200,
      distanceM: 32000,
      walkMin: 12,
      transit: [
        { vehicle: "HEAVY_RAIL", line: "ARL", from: "Suvarnabhumi", to: "Phaya Thai", stops: 7, departs: "12:53" },
        { vehicle: "SUBWAY", line: "Silom", from: "Siam", to: "Surasak", stops: 5 },
      ],
    };
    fs.writeFileSync(file, JSON.stringify(saved));

    expect(await ok("get_trip", { trip_id: tripId })).toContain(
      "via 12:53 🚆 ARL: Suvarnabhumi → Phaya Thai (7 stops) → 🚇 Silom: Siam → Surasak (5 stops) · 🚶 12 min on foot · timetable for 2027-01-11 12:45",
    );
  });

  it("lists what is still to sort out and where each night is spent", async () => {
    const created = await ok("create_trip", { name: "North", destination: "Thailand", start_date: "2027-01-14", days: 3 });
    const tripId = idIn(created, /trip_id ([\w-]+)/);
    const add = async (day: number, args: Record<string, unknown>) =>
      idIn(await ok("add_item", { trip_id: tripId, day, ...args }), /\[([\w-]+)\]/);
    await add(1, { type: "stay", title: "Hongkhao Village", lat: 18.76, lng: 99.0, stay_nights: 1 });
    const dives = await add(2, { type: "activity", title: "Big Blue Best-Of", booking: { provider: "Big Blue", status: "pending" } });
    await add(2, { type: "transport", title: "Ferry", transport: { kind: "ferry" }, booking: { status: "todo" } });

    const plan = await ok("get_trip", { trip_id: tripId });
    expect(plan).toContain(
      "## To sort out\n- Big Blue Best-Of (day 2): waiting for confirmation\n- Ferry (day 2): to book\n",
    );
    expect(plan).toMatch(/Night: Hongkhao Village \[[\w-]+\] \(night 1 of 1\)/);
    // Day 2 ends on the ferry, so its night is on the way; nothing is missing.
    expect(plan).toMatch(/Night: on the way – Ferry/);
    expect(plan).toContain("status: ⏳ Waiting for confirmation");

    await ok("update_item", { trip_id: tripId, item_id: dives, booking: { status: "confirmed" } });
    expect(await ok("get_trip", { trip_id: tripId })).not.toContain("Big Blue Best-Of (day 2)");
  });

  it("rides a rented scooter only while it is rented", async () => {
    const created = await ok("create_trip", {
      name: "Loop",
      destination: "Thailand",
      start_date: "2027-01-14",
      days: 2,
      default_mode: "TWO_WHEELER",
    });
    const tripId = idIn(created, /trip_id ([\w-]+)/);
    await ok("add_item", { trip_id: tripId, day: 1, type: "place", title: "Airport", lat: 18.77, lng: 98.97 });
    await ok("add_item", { trip_id: tripId, day: 1, type: "stay", title: "Hotel", lat: 18.76, lng: 99.0 });
    await ok("add_item", {
      trip_id: tripId,
      day: 1,
      type: "rental",
      title: "Scooter",
      lat: 18.76,
      lng: 99.0,
      start_time: "18:00",
      rental: { vehicle: "scooter", days: 1 },
    });
    await ok("add_item", { trip_id: tripId, day: 2, type: "place", title: "Waterfall", lat: 19.11, lng: 98.77 });
    const plan = await ok("get_trip", { trip_id: tripId });
    expect(plan).toContain("default travel: 🛵 Scooter while rented, 🚗 Car otherwise");
    expect(plan).toMatch(/↓ 🚗 Car [^\n]*\n2\. 🏨 Hotel/); // landed, no scooter yet
    expect(plan).toMatch(/↓ 🛵 Scooter [^\n]*\n1\. 📍 Waterfall/);
  });

  it("takes the local arrival time from the ticket", async () => {
    const created = await ok("create_trip", { name: "Fly", destination: "Thailand", start_date: "2027-01-10", days: 2 });
    const tripId = idIn(created, /trip_id ([\w-]+)/);
    const flight = idIn(
      await ok("add_item", {
        trip_id: tripId,
        day: 2,
        type: "transport",
        title: "QR 834",
        lat: 25.27,
        lng: 51.6,
        start_time: "02:00",
        transport: { kind: "flight", to_lat: 13.69, to_lng: 100.75, arrival_time: "12:15" },
      }),
      /\[([\w-]+)\]/,
    );
    expect(await ok("get_trip", { trip_id: tripId })).toMatch(/QR 834 \[[\w-]+\] 🔒02:00–12:15/);

    await ok("update_item", {
      trip_id: tripId,
      item_id: flight,
      start_time: "21:00",
      transport: { kind: "flight", arrival_time: "06:00", arrival_next_day: true },
    });
    expect(await ok("get_trip", { trip_id: tripId })).toMatch(/🔒21:00–06:00 \+1/);

    const backwards = await call("update_item", {
      trip_id: tripId,
      item_id: flight,
      transport: { kind: "flight", arrival_time: "20:00" },
    });
    expect(backwards).toMatchObject({ isError: true, text: expect.stringMatching(/arrival_next_day/) });
  });

  it("reports invalid requests as tool errors instead of crashing", async () => {
    const missing = await call("get_trip", { trip_id: "does-not-exist" });
    expect(missing.isError).toBe(true);

    const created = await ok("create_trip", { name: "x", destination: "x", start_date: "2026-01-01", days: 1 });
    const tripId = idIn(created, /trip_id ([\w-]+)/);
    const badOrder = await call("reorder_day", { trip_id: tripId, day: 1, item_ids: ["nope"] });
    expect(badOrder).toMatchObject({ isError: true, text: expect.stringMatching(/exactly once/) });

    // The server is still alive.
    expect(await ok("list_trips")).toContain("x");
  });
});
