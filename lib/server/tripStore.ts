import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { StorageKind } from "../configStatus";
import type { Trip } from "../types";
import { accessToken, cloudAccount, GOOGLE_DRIVE_FILE_SCOPE, hasScope } from "./cloudAuth";
import { DATA_DIR, readConfig, readJson, writeJson } from "./config";
import { HttpError } from "./errors";

export interface TripSummary {
  id: string;
  name: string;
  updatedAt: string;
}

export interface TripStore {
  kind: StorageKind;
  /** Where the trips are, for people: a folder path or "My Drive › TripDeck". */
  location: string;
  list(): Promise<TripSummary[]>;
  get(id: string): Promise<Trip | undefined>;
  put(trip: Trip): Promise<void>;
  delete(id: string): Promise<void>;
}

const ID_RE = /^[\w-]{1,40}$/;

export function assertTripId(id: string) {
  if (!ID_RE.test(id)) throw new HttpError(400, "Invalid trip id.");
}

/** The folder name people see in OneDrive and Google Drive. */
export const CLOUD_FOLDER = "TripDeck";

/**
 * "Malta trip (abc123).tripdeck.json" – readable in a file browser, unique per trip, and the same
 * format as Export → JSON so the file can be imported directly. Strips characters OneDrive and
 * Windows reject.
 */
export function tripFileName(trip: Pick<Trip, "id" | "name">): string {
  const base =
    trip.name
      .normalize("NFC")
      .replace(/[\\/:*?"<>|#%\u0000-\u001f]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60)
      .trim() || "Trip";
  return `${base} (${trip.id}).tripdeck.json`;
}

const tripJson = (trip: Trip) => JSON.stringify(trip, null, 2);

interface FileEntry {
  file: string;
  mtimeMs: number;
  size: number;
  summary?: TripSummary;
}

/** Parsed summaries per file, re-read only when the file changes (the browser polls every 15 s). */
const folderCache = new Map<string, FileEntry>();

/**
 * Trips as JSON files in a folder: ~/.tripdeck/trips, or TripDeck inside the OneDrive folder that
 * the OneDrive app syncs. A trip's file is found by the id inside it, so renamed files and OneDrive's
 * conflict copies ("… (abc)-MY-PC.tripdeck.json") still work; the newest copy wins.
 */
export class FolderStore implements TripStore {
  constructor(
    public kind: "local" | "onedrive",
    private dir: string,
    /** "<id>.json" in ~/.tripdeck/trips (as before), readable names in OneDrive. */
    private nameOf: (trip: Trip) => string,
  ) {}

  get location() {
    return this.dir;
  }

  private entries(): FileEntry[] {
    if (!fs.existsSync(this.dir)) return [];
    const out: FileEntry[] = [];
    for (const name of fs.readdirSync(this.dir)) {
      if (!name.endsWith(".json")) continue;
      const file = path.join(this.dir, name);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(file);
      } catch {
        continue; // Deleted or renamed meanwhile.
      }
      if (!stat.isFile()) continue;
      let entry = folderCache.get(file);
      if (!entry || entry.mtimeMs !== stat.mtimeMs || entry.size !== stat.size) {
        const trip = readJson<Trip>(file);
        const valid = typeof trip?.id === "string" && ID_RE.test(trip.id);
        entry = {
          file,
          mtimeMs: stat.mtimeMs,
          size: stat.size,
          summary: valid ? { id: trip.id, name: trip.name, updatedAt: trip.updatedAt } : undefined,
        };
        folderCache.set(file, entry);
      }
      out.push(entry);
    }
    return out;
  }

  /** Every file holding this trip, newest first. */
  private filesOf(id: string) {
    assertTripId(id);
    return this.entries()
      .filter((e) => e.summary?.id === id)
      .sort((a, b) => b.summary!.updatedAt.localeCompare(a.summary!.updatedAt));
  }

  async list() {
    const newest = new Map<string, TripSummary>();
    for (const { summary } of this.entries()) {
      if (!summary) continue;
      const seen = newest.get(summary.id);
      if (!seen || summary.updatedAt > seen.updatedAt) newest.set(summary.id, summary);
    }
    return [...newest.values()];
  }

  async get(id: string) {
    const [newest] = this.filesOf(id);
    return newest && readJson<Trip>(newest.file);
  }

  async put(trip: Trip) {
    const others = this.filesOf(trip.id);
    const file = path.join(this.dir, this.nameOf(trip));
    writeJson(file, trip);
    // Drop older copies (the old name after a rename, outdated conflict copies); keep newer ones.
    for (const e of others) {
      if (e.file !== file && e.summary!.updatedAt <= trip.updatedAt) fs.rmSync(e.file, { force: true });
    }
  }

  async delete(id: string) {
    for (const e of this.filesOf(id)) fs.rmSync(e.file, { force: true });
  }
}

/**
 * The OneDrive folder on this PC: from Settings, else the folder the OneDrive app announces
 * (Windows sets %OneDrive%), else OneDrive under ~/Library/CloudStorage on macOS.
 */
export function oneDriveRoot(): string | undefined {
  const configured = readConfig().oneDriveFolder;
  if (configured) return fs.existsSync(configured) ? configured : undefined;
  for (const name of ["OneDriveConsumer", "OneDrive", "OneDriveCommercial"]) {
    const dir = process.env[name];
    if (dir && fs.existsSync(dir)) return dir;
  }
  const cloudStorage = path.join(os.homedir(), "Library", "CloudStorage");
  if (fs.existsSync(cloudStorage)) {
    const found = fs.readdirSync(cloudStorage).find((d) => d.startsWith("OneDrive"));
    if (found) return path.join(cloudStorage, found);
  }
  return undefined;
}

/** The TripDeck folder inside OneDrive, if OneDrive was found on this PC. */
export function oneDriveTripsFolder(): string | undefined {
  const root = oneDriveRoot();
  return root && path.join(root, CLOUD_FOLDER);
}

/** fetch() with the provider's token, turning failures into HttpErrors. 404 is returned to the caller. */
async function cloudFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const label = "Google Drive";
  const token = await accessToken("google");
  if (!token) throw new HttpError(401, `${label} is not connected.`);
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` }, cache: "no-store" });
  } catch {
    throw new HttpError(503, `${label} is unreachable – are you online?`);
  }
  if (!res.ok && res.status !== 404) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    const message = body.error?.message ?? `${label} error ${res.status}`;
    throw new HttpError(res.status === 401 || res.status === 403 ? 503 : 502, message);
  }
  return res;
}

const DRIVE = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const FOLDER_MIME = "application/vnd.google-apps.folder";

interface DriveFile {
  id: string;
  name: string;
  appProperties?: { tripId?: string; updatedAt?: string; name?: string };
}

interface DriveListing {
  at: number;
  folder?: string;
  files: DriveFile[];
}

/**
 * How long a listing is trusted to find a trip's file. The browser lists trips every 15 s and then
 * reads or saves single trips; without this each of those would list the whole folder again.
 * Only file ids are taken from it: list() always asks Drive, and a trip missing here is looked up afresh.
 */
const DRIVE_LISTING_MS = 60_000;
const driveListings = new Map<string, DriveListing>();

/** Forgets the cached Drive listings (tests use a new fake Drive each time). */
export function forgetDriveListings() {
  driveListings.clear();
}

/**
 * Trips on Google Drive, one JSON file per trip, in a visible "TripDeck" folder in My Drive.
 * The drive.file permission only reaches files TripDeck created, never your other files.
 *
 * `hidden` is the layout before the visible folder: `trip-<id>.json` in the hidden appDataFolder.
 * It is used until Google is reconnected with the new permission, and to migrate from.
 */
export class GoogleDriveStore implements TripStore {
  kind = "google" as const;
  location: string;

  constructor(private hidden = !hasScope("google", GOOGLE_DRIVE_FILE_SCOPE)) {
    this.location = hidden ? "Google Drive (hidden app folder)" : `My Drive › ${CLOUD_FOLDER}`;
  }

  private request = (url: string, init?: RequestInit) => cloudFetch(url, init);

  /** The TripDeck folder in My Drive, created on first use. Looked up each time in case it was moved or trashed. */
  private async folderId(): Promise<string> {
    const url = new URL(DRIVE);
    url.search = new URLSearchParams({
      q: `mimeType='${FOLDER_MIME}' and name='${CLOUD_FOLDER}' and trashed=false`,
      fields: "files(id)",
      orderBy: "createdTime",
      pageSize: "1",
    }).toString();
    const found = (await (await this.request(url.toString())).json()) as { files?: { id: string }[] };
    if (found.files?.[0]) return found.files[0].id;
    const res = await this.request(`${DRIVE}?fields=id`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: CLOUD_FOLDER, mimeType: FOLDER_MIME }),
    });
    return ((await res.json()) as { id: string }).id;
  }

  /** Per Google account and layout, so switching either never reuses the other's file ids. */
  private get listingKey() {
    return `${this.hidden ? "hidden" : "folder"}|${cloudAccount("google")?.email ?? ""}`;
  }

  private recentListing(): DriveListing | undefined {
    const listing = driveListings.get(this.listingKey);
    return listing && Date.now() - listing.at < DRIVE_LISTING_MS ? listing : undefined;
  }

  /** Lists the trip files on Drive (the folder id is reused from a recent listing). */
  private async files(): Promise<DriveListing> {
    const folder = this.hidden ? undefined : (this.recentListing()?.folder ?? (await this.folderId()));
    const out: DriveFile[] = [];
    let pageToken: string | undefined;
    do {
      const url = new URL(DRIVE);
      url.search = new URLSearchParams({
        ...(folder ? { q: `'${folder}' in parents and trashed=false` } : { spaces: "appDataFolder" }),
        fields: "nextPageToken,files(id,name,appProperties)",
        pageSize: "1000",
        ...(pageToken ? { pageToken } : {}),
      }).toString();
      const data = (await (await this.request(url.toString())).json()) as { files?: DriveFile[]; nextPageToken?: string };
      out.push(...(data.files ?? []).filter((f) => (folder ? !!f.appProperties?.tripId : f.name.startsWith("trip-"))));
      pageToken = data.nextPageToken;
    } while (pageToken);
    const listing = { at: Date.now(), folder, files: out };
    driveListings.set(this.listingKey, listing);
    return listing;
  }

  /** The trip's file from a recent listing, or from a new one when it isn't there. */
  private async fileOf(id: string, fresh = false): Promise<{ folder?: string; file?: DriveFile }> {
    const recent = fresh ? undefined : this.recentListing();
    const cached = recent?.files.find((f) => GoogleDriveStore.tripId(f) === id);
    if (recent && cached) return { folder: recent.folder, file: cached };
    const { folder, files } = await this.files();
    return { folder, file: files.find((f) => GoogleDriveStore.tripId(f) === id) };
  }

  private static tripId = (f: DriveFile) => f.appProperties?.tripId ?? f.name.slice(5, -5);

  async list() {
    return (await this.files()).files.map((f) => ({
      id: GoogleDriveStore.tripId(f),
      name: f.appProperties?.name ?? "",
      updatedAt: f.appProperties?.updatedAt ?? "",
    }));
  }

  async get(id: string, fresh = false): Promise<Trip | undefined> {
    assertTripId(id);
    const { file } = await this.fileOf(id, fresh);
    if (!file) return undefined;
    const res = await this.request(`${DRIVE}/${file.id}?alt=media`);
    // Deleted on Drive since it was listed: look again.
    if (res.status === 404 && !fresh) return this.get(id, true);
    return res.ok ? ((await res.json()) as Trip) : undefined;
  }

  async put(trip: Trip, fresh = false): Promise<void> {
    assertTripId(trip.id);
    const { folder, file: existing } = await this.fileOf(trip.id, fresh);
    const metadata = {
      name: folder ? tripFileName(trip) : `trip-${trip.id}.json`,
      mimeType: "application/json",
      // appProperties values are limited to ~124 bytes including the key.
      appProperties: { tripId: trip.id, updatedAt: trip.updatedAt, name: trip.name.slice(0, 80) },
      ...(existing ? {} : { parents: [folder ?? "appDataFolder"] }),
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
      tripJson(trip),
      `--${boundary}--`,
    ].join("\r\n");
    const res = await this.request(existing ? `${UPLOAD}/${existing.id}?uploadType=multipart` : `${UPLOAD}?uploadType=multipart`, {
      method: existing ? "PATCH" : "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    });
    // The file was deleted on Drive since it was listed: list again, which creates a new one.
    if (res.status === 404 && !fresh) return this.put(trip, true);
    if (existing) existing.appProperties = metadata.appProperties;
    // A new file isn't in the listing yet; the next lookup lists again.
    else driveListings.delete(this.listingKey);
  }

  async delete(id: string) {
    assertTripId(id);
    const { file } = await this.fileOf(id);
    if (!file) return;
    await this.request(`${DRIVE}/${file.id}`, { method: "DELETE" });
    driveListings.delete(this.listingKey);
  }
}

/** The storage chosen in Settings, falling back to this PC when Google is not connected or OneDrive is missing. */
export function activeStorage(): StorageKind {
  const { storage } = readConfig();
  if (storage === "local") return "local";
  if (storage === "onedrive") return oneDriveTripsFolder() ? "onedrive" : "local";
  if (storage === "google") return cloudAccount("google") ? "google" : "local";
  // Before the choice existed, connecting Google meant storing trips there.
  return cloudAccount("google") ? "google" : "local";
}

export function storeFor(kind: StorageKind): TripStore {
  if (kind === "google") return new GoogleDriveStore();
  const oneDrive = kind === "onedrive" && oneDriveTripsFolder();
  if (oneDrive) return new FolderStore("onedrive", oneDrive, tripFileName);
  return new FolderStore("local", path.join(DATA_DIR, "trips"), (trip) => `${trip.id}.json`);
}

export function tripStore(): TripStore {
  return storeFor(activeStorage());
}

/** Copies trips that `to` does not have yet, or has in an older version. Returns how many were copied. */
export async function copyTrips(from: TripStore, to: TripStore): Promise<number> {
  const existing = new Map((await to.list()).map((t) => [t.id, t.updatedAt]));
  let copied = 0;
  for (const t of await from.list()) {
    const theirs = existing.get(t.id);
    if (theirs && theirs >= t.updatedAt) continue;
    const trip = await from.get(t.id);
    if (!trip) continue;
    await to.put(trip);
    copied++;
  }
  return copied;
}

/** After Google grants the visible-folder permission: move trips out of the hidden app folder. */
export async function migrateHiddenGoogleTrips() {
  if (!hasScope("google", GOOGLE_DRIVE_FILE_SCOPE)) return;
  await copyTrips(new GoogleDriveStore(true), new GoogleDriveStore(false));
}
