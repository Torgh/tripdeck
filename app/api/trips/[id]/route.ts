import { NextResponse } from "next/server";
import { z } from "zod";
import { assertLocal, handle, HttpError, readBody } from "@/lib/server/http";
import { assertTripId, tripStore } from "@/lib/server/tripStore";
import type { Trip } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  assertLocal(req);
  const { id } = await params;
  assertTripId(id);
  const trip = await tripStore().get(id);
  if (!trip) throw new HttpError(404, "Trip not found.");
  return { trip };
});

/** Loose shape check – the client is this app's own page. */
const tripSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    startDate: z.string(),
    updatedAt: z.string(),
    days: z.array(z.looseObject({ id: z.string(), itemIds: z.array(z.string()) })),
    items: z.record(z.string(), z.unknown()),
  })
  .loose();

/**
 * `?base=<updatedAt>` names the version the browser edited. If the stored trip has changed since
 * (Claude edited it through MCP, or another tab saved), nothing is written: the 409 carries the
 * stored trip so the browser can merge both edits and try again.
 */
export const PUT = handle<Ctx>(async (req, { params }) => {
  assertLocal(req);
  const { id } = await params;
  assertTripId(id);
  const trip = (await readBody(req, tripSchema)) as unknown as Trip;
  if (trip.id !== id) throw new HttpError(400, "Trip id mismatch.");
  const base = new URL(req.url).searchParams.get("base");
  if (base) {
    const current = await tripStore().get(id);
    if (current && current.updatedAt !== base) {
      return NextResponse.json({ error: "The trip changed elsewhere.", trip: current }, { status: 409 });
    }
  }
  await tripStore().put(trip);
  return { ok: true };
});

export const DELETE = handle<Ctx>(async (req, { params }) => {
  assertLocal(req);
  const { id } = await params;
  assertTripId(id);
  await tripStore().delete(id);
  return { ok: true };
});
