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

export const PUT = handle<Ctx>(async (req, { params }) => {
  assertLocal(req);
  const { id } = await params;
  assertTripId(id);
  const trip = (await readBody(req, tripSchema)) as unknown as Trip;
  if (trip.id !== id) throw new HttpError(400, "Trip id mismatch.");
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
