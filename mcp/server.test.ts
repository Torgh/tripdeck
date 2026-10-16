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
