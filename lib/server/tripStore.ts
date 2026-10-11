import fs from "node:fs";
import path from "node:path";
import type { Trip } from "../types";
import { DATA_DIR, readJson, writeJson } from "./config";
import { HttpError } from "./errors";
import { googleAccessToken, googleAccount } from "./googleAuth";

export interface TripSummary {
  id: string;
  name: string;
  updatedAt: string;
}

export interface TripStore {
  kind: "drive" | "local";
  list(): Promise<TripSummary[]>;
  get(id: string): Promise<Trip | undefined>;
  put(trip: Trip): Promise<void>;
  delete(id: string): Promise<void>;
}

const ID_RE = /^[\w-]{1,40}$/;

export function assertTripId(id: string) {
  if (!ID_RE.test(id)) throw new HttpError(400, "Invalid trip id.");
}

/** Trips as JSON files in ~/.tripdeck/trips – used until Google Drive is connected. */
class LocalStore implements TripStore {
  kind = "local" as const;
  private dir = path.join(DATA_DIR, "trips");
  private file = (id: string) => (assertTripId(id), path.join(this.dir, `${id}.json`));

  async list() {
    if (!fs.existsSync(this.dir)) return [];
    return fs
      .readdirSync(this.dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => readJson<Trip>(path.join(this.dir, f)))
      .filter((t): t is Trip => !!t?.id)
      .map((t) => ({ id: t.id, name: t.name, updatedAt: t.updatedAt }));
  }
  async get(id: string) {
    return readJson<Trip>(this.file(id));
  }
  async put(trip: Trip) {
    writeJson(this.file(trip.id), trip);
  }
  async delete(id: string) {
    fs.rmSync(this.file(id), { force: true });
  }
}

const DRIVE = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";

interface DriveFile {
  id: string;
  name: string;
  appProperties?: { tripId?: string; updatedAt?: string; name?: string };
}

/**
 * Trips in the hidden "appDataFolder" of your Google Drive: one `trip-<id>.json` per trip.
 * TripDeck only has access to this folder, never to your other Drive files.
 */
class DriveStore implements TripStore {
  kind = "drive" as const;

  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    const token = await googleAccessToken();
    if (!token) throw new HttpError(401, "Google is not connected.");
    let res: Response;
    try {
      res = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` }, cache: "no-store" });
    } catch {
      throw new HttpError(503, "Google Drive is unreachable – are you online?");
    }
    if (!res.ok && res.status !== 404) {
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      const message = body.error?.message ?? `Google Drive error ${res.status}`;
      throw new HttpError(res.status === 401 || res.status === 403 ? 503 : 502, message);
    }
    return res;
  }

  private async files(): Promise<DriveFile[]> {
    const out: DriveFile[] = [];
    let pageToken: string | undefined;
    do {
      const url = new URL(DRIVE);
      url.search = new URLSearchParams({
        spaces: "appDataFolder",
        fields: "nextPageToken,files(id,name,appProperties)",
        pageSize: "1000",
        ...(pageToken ? { pageToken } : {}),
      }).toString();
      const data = (await (await this.request(url.toString())).json()) as { files?: DriveFile[]; nextPageToken?: string };
      out.push(...(data.files ?? []).filter((f) => f.name.startsWith("trip-")));
      pageToken = data.nextPageToken;
    } while (pageToken);
    return out;
  }

  private async fileFor(id: string) {
    assertTripId(id);
    return (await this.files()).find((f) => f.appProperties?.tripId === id || f.name === `trip-${id}.json`);
  }

  async list() {
    return (await this.files()).map((f) => ({
      id: f.appProperties?.tripId ?? f.name.slice(5, -5),
      name: f.appProperties?.name ?? "",
      updatedAt: f.appProperties?.updatedAt ?? "",
    }));
  }

  async get(id: string) {
    const file = await this.fileFor(id);
    if (!file) return undefined;
    const res = await this.request(`${DRIVE}/${file.id}?alt=media`);
    return res.ok ? ((await res.json()) as Trip) : undefined;
  }

  async put(trip: Trip) {
    const existing = await this.fileFor(trip.id);
    const metadata = {
      name: `trip-${trip.id}.json`,
      mimeType: "application/json",
      // appProperties values are limited to ~124 bytes including the key.
      appProperties: { tripId: trip.id, updatedAt: trip.updatedAt, name: trip.name.slice(0, 80) },
      ...(existing ? {} : { parents: ["appDataFolder"] }),
    };
    const boundary = `tripdeck${Date.now()}`;
    const body = [
      `--${boundary}`,
      "Content-Type: application/json; charset=UTF-8",
      "",
      JSON.stringify(metadata),
      `--${boundary}`,
      "Content-Type: application/json",
      "",
      JSON.stringify(trip),
      `--${boundary}--`,
    ].join("\r\n");
    await this.request(existing ? `${UPLOAD}/${existing.id}?uploadType=multipart` : `${UPLOAD}?uploadType=multipart`, {
      method: existing ? "PATCH" : "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    });
  }

  async delete(id: string) {
    const file = await this.fileFor(id);
    if (file) await this.request(`${DRIVE}/${file.id}`, { method: "DELETE" });
  }
}

/** Google Drive once connected, the local folder otherwise. */
export function tripStore(): TripStore {
  return googleAccount() ? new DriveStore() : new LocalStore();
}

/** Copies local trips that Drive does not have yet (or has older) – run right after connecting Google. */
export async function migrateLocalToDrive() {
  const local = new LocalStore();
  const drive = new DriveStore();
  const remote = new Map((await drive.list()).map((t) => [t.id, t.updatedAt]));
  for (const t of await local.list()) {
    const remoteUpdated = remote.get(t.id);
    if (!remoteUpdated || remoteUpdated < t.updatedAt) {
      const trip = await local.get(t.id);
      if (trip) await drive.put(trip);
    }
  }
}
