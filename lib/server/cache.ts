import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./config";

interface Entry<T> {
  key: string;
  at: number;
  value: T;
}

/**
 * Answers from Google's paid APIs (routes, elevations, time zones), kept in ~/.tripdeck/cache so
 * the same question isn't paid for twice – across reloads, devices, trips and the MCP server,
 * which shares the folder. One small file per answer, so the two processes never overwrite each
 * other's entries. Errors are never kept.
 */
export class DiskCache<T> {
  private dir: string;
  private inFlight = new Map<string, Promise<T>>();
  private pruned = false;

  constructor(
    name: string,
    private ttlMs: number,
  ) {
    this.dir = path.join(DATA_DIR, "cache", name);
  }

  private file(key: string) {
    return path.join(this.dir, `${crypto.createHash("sha256").update(key).digest("hex").slice(0, 32)}.json`);
  }

  get(key: string): T | undefined {
    let entry: Entry<T>;
    try {
      entry = JSON.parse(fs.readFileSync(this.file(key), "utf8")) as Entry<T>;
    } catch {
      return undefined;
    }
    return entry.key === key && Date.now() - entry.at < this.ttlMs ? entry.value : undefined;
  }

  set(key: string, value: T) {
    const file = this.file(key);
    const entry: Entry<T> = { key, at: Date.now(), value };
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(entry));
      fs.renameSync(tmp, file);
    } catch (err) {
      // A cache that can't be written only costs another lookup next time.
      console.warn(`Could not cache in ${this.dir}:`, err);
    }
    if (!this.pruned) {
      this.pruned = true;
      this.prune();
    }
  }

  /** The cached answer, or `fetch()`'s – asked once even when several requests want it at the same time. */
  getOrFetch(key: string, fetch: () => Promise<T>): Promise<T> {
    const hit = this.get(key);
    if (hit !== undefined) return Promise.resolve(hit);
    let pending = this.inFlight.get(key);
    if (!pending) {
      pending = fetch()
        .then((value) => (this.set(key, value), value))
        .finally(() => this.inFlight.delete(key));
      this.inFlight.set(key, pending);
    }
    return pending;
  }

  /** Deletes expired answers, once per process (on the first new answer). */
  prune() {
    let names: string[];
    try {
      names = fs.readdirSync(this.dir);
    } catch {
      return;
    }
    for (const name of names) {
      const file = path.join(this.dir, name);
      try {
        if (Date.now() - fs.statSync(file).mtimeMs >= this.ttlMs) fs.rmSync(file, { force: true });
      } catch {
        // Removed by the other process meanwhile.
      }
    }
  }
}

export const DAY_MS = 24 * 60 * 60 * 1000;
