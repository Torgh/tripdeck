import fs from "node:fs/promises";
import path from "node:path";
import type { Trip } from "../types";
import { DATA_DIR } from "./config";
import { HttpError } from "./errors";
import type { TripStore } from "./tripStore";

/** A lock older than this was left behind by a crashed process. Real saves take a few seconds on Google Drive. */
const STALE_MS = 30_000;
const WAIT_MS = 20_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Runs `fn` while holding this PC's lock on one trip. The web app (saving for the browser) and the MCP
 * server (saving for Claude) are separate processes; both check the stored version and then write it.
 * On Google Drive each step takes about a second, so without the lock two saves could both pass the
 * check and the later one would silently drop the other's change.
 */
export async function withTripLock<T>(tripId: string, fn: () => Promise<T>): Promise<T> {
  const dir = path.join(DATA_DIR, "locks");
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${tripId}.lock`);
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    try {
      await fs.writeFile(file, `${process.pid} ${new Date().toISOString()}`, { flag: "wx" });
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      const stat = await fs.stat(file).catch(() => undefined);
      if (stat && Date.now() - stat.mtimeMs > STALE_MS) {
        await fs.rm(file, { force: true });
        continue;
      }
      if (Date.now() > deadline) throw new HttpError(503, "Another save of this trip is taking too long – try again.");
      await sleep(40 + Math.random() * 60);
    }
  }
  try {
    return await fn();
  } finally {
    await fs.rm(file, { force: true });
  }
}

/**
 * Saves `next` if the stored trip is still the version `base` names (its updatedAt). Otherwise nothing
 * is written and the stored trip is returned, so the caller can merge and try again.
 */
export function saveIfUnchanged(
  store: TripStore,
  next: Trip,
  base: string | undefined,
): Promise<{ saved: true } | { saved: false; current: Trip }> {
  return withTripLock(next.id, async () => {
    if (base !== undefined) {
      const current = await store.get(next.id);
      if (current && current.updatedAt !== base) return { saved: false as const, current };
    }
    await store.put(next);
    return { saved: true as const };
  });
}
