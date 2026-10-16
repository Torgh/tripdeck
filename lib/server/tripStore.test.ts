import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Trip } from "../types";

const home = vi.hoisted(() => {
  // DATA_DIR is read when ./config is first imported.
  const dir = `${process.env.TMPDIR ?? process.env.TEMP ?? "/tmp"}/tripdeck-test-${process.pid}`;
  process.env.TRIPDECK_HOME = dir;
  return dir;
});

const { GOOGLE_APPDATA_SCOPE, GOOGLE_DRIVE_FILE_SCOPE } = await import("./cloudAuth");
const { writeConfig, writeJson } = await import("./config");
const store = await import("./tripStore");

const trip = (id: string, name: string, updatedAt = "2026-10-01T00:00:00.000Z") =>
  ({ id, name, updatedAt, startDate: "2026-11-01", days: [], ideas: [], items: {}, legs: {} }) as unknown as Trip;

function connectGoogle(scope: string) {
  writeJson(path.join(home, "google-token.json"), {
    refreshToken: "r",
    accessToken: "a",
    expiresAt: Date.now() + 3_600_000,
    email: "me@example.com",
    scope,
  });
}

/** Just enough of the Google Drive v3 API: folders, the hidden appDataFolder and multipart uploads. */
function fakeGoogleDrive() {
  type File = { id: string; name: string; parent: string; folder?: boolean; appProperties?: object; content?: string };
  const files = new Map<string, File>();
  const add = (f: Omit<File, "id">) => {
    const file = { ...f, id: `f${files.size + 1}` };
    files.set(file.id, file);
    return file;
  };
  const fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const q = url.searchParams.get("q") ?? "";
    const id = url.pathname.split("/files/")[1];
    const list = (pick: (f: File) => boolean) =>
      Response.json({ files: [...files.values()].filter(pick).map(({ id, name, appProperties }) => ({ id, name, appProperties })) });
    if (url.pathname === "/drive/v3/files" && method === "GET") {
      if (q.includes("mimeType")) return list((f) => !!f.folder && f.name === "TripDeck");
      const parent = q.match(/'(.+)' in parents/)?.[1];
      return list((f) => !f.folder && f.parent === (parent ?? "appDataFolder"));
    }
    if (url.pathname === "/drive/v3/files" && method === "POST") {
      return Response.json({ id: add({ ...JSON.parse(String(init!.body)), parent: "root", folder: true }).id });
    }
    if (url.pathname.startsWith("/upload/")) {
      const lines = String(init!.body).split("\r\n");
      const [metadata, content] = [JSON.parse(lines[3]), lines[7]];
      if (id) Object.assign(files.get(id)!, { name: metadata.name, appProperties: metadata.appProperties, content });
      else add({ name: metadata.name, parent: metadata.parents[0], appProperties: metadata.appProperties, content });
      return Response.json({});
    }
    if (id && method === "GET") return new Response(files.get(id)!.content);
    if (id && method === "DELETE") return files.delete(id), new Response(null, { status: 204 });
    throw new Error(`unexpected ${method} ${url}`);
  });
  return { files, fetch };
}

/** A fake OneDrive folder; the real one on this PC (%OneDrive%) is never touched. */
const oneDrive = path.join(home, "OneDrive");
const useOneDrive = () => (fs.mkdirSync(oneDrive, { recursive: true }), writeConfig({ oneDriveFolder: oneDrive }));
const tripFiles = () => fs.readdirSync(path.join(oneDrive, "TripDeck")).sort();

beforeEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
  for (const name of ["OneDriveConsumer", "OneDrive", "OneDriveCommercial"]) vi.stubEnv(name, "");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("tripFileName", () => {
  it("is readable, unique per trip and safe for OneDrive", () => {
    expect(store.tripFileName(trip("abc", "Malta & Gozo"))).toBe("Malta & Gozo (abc).tripdeck.json");
    expect(store.tripFileName(trip("abc", ' a/b:c*?"<>| '))).toBe("a b c (abc).tripdeck.json");
    expect(store.tripFileName(trip("abc", "   "))).toBe("Trip (abc).tripdeck.json");
  });
});

describe("activeStorage", () => {
  it("uses Google when it was connected before the storage choice existed", () => {
    expect(store.activeStorage()).toBe("local");
    connectGoogle(GOOGLE_APPDATA_SCOPE);
    expect(store.activeStorage()).toBe("google");
    writeConfig({ storage: "local" });
    expect(store.activeStorage()).toBe("local");
  });

  it("uses OneDrive only while its folder exists", () => {
    writeConfig({ storage: "onedrive", oneDriveFolder: path.join(home, "missing") });
    expect(store.activeStorage()).toBe("local");
    useOneDrive();
    expect(store.activeStorage()).toBe("onedrive");
    expect(store.tripStore().location).toBe(path.join(oneDrive, "TripDeck"));
  });

  it("finds OneDrive through the folder the OneDrive app announces", () => {
    fs.mkdirSync(oneDrive, { recursive: true });
    vi.stubEnv("OneDrive", oneDrive);
    expect(store.oneDriveTripsFolder()).toBe(path.join(oneDrive, "TripDeck"));
  });
});

describe("OneDrive folder", () => {
  it("stores, renames, lists and deletes trips as readable files", async () => {
    useOneDrive();
    const od = store.storeFor("onedrive");
    await od.put(trip("t1", "Malta"));
    await od.put(trip("t2", "Thailand"));
    expect(tripFiles()).toEqual(["Malta (t1).tripdeck.json", "Thailand (t2).tripdeck.json"]);

    await od.put(trip("t1", "Malta & Gozo", "2026-10-02T00:00:00.000Z"));
    expect(tripFiles()).toEqual(["Malta & Gozo (t1).tripdeck.json", "Thailand (t2).tripdeck.json"]);
    expect((await od.get("t1"))?.name).toBe("Malta & Gozo");

    // Files that aren't trips are ignored.
    fs.writeFileSync(path.join(oneDrive, "TripDeck", "notes.json"), "not json");
    expect((await od.list()).map((t) => t.id).sort()).toEqual(["t1", "t2"]);

    await od.delete("t2");
    expect((await od.list()).map((t) => t.id)).toEqual(["t1"]);
  });

  it("reads the newest of OneDrive's conflict copies and keeps newer copies when saving", async () => {
    useOneDrive();
    const od = store.storeFor("onedrive");
    await od.put(trip("t3", "Gozo", "2026-10-02T00:00:00.000Z"));
    const conflict = path.join(oneDrive, "TripDeck", "Gozo (t3)-OTHER-PC.tripdeck.json");
    fs.writeFileSync(conflict, JSON.stringify(trip("t3", "Gozo from the other PC", "2026-10-03T00:00:00.000Z")));

    expect(await od.list()).toEqual([{ id: "t3", name: "Gozo from the other PC", updatedAt: "2026-10-03T00:00:00.000Z" }]);
    expect((await od.get("t3"))?.name).toBe("Gozo from the other PC");

    // Saving an older edit must not destroy the newer copy…
    await od.put(trip("t3", "Gozo", "2026-10-02T12:00:00.000Z"));
    expect(fs.existsSync(conflict)).toBe(true);
    // …but a newer save replaces it.
    await od.put(trip("t3", "Gozo merged", "2026-10-04T00:00:00.000Z"));
    expect(tripFiles()).toEqual(["Gozo merged (t3).tripdeck.json"]);
  });
});

describe("GoogleDriveStore", () => {
  it("keeps trips in a visible TripDeck folder once drive.file is granted", async () => {
    connectGoogle(`${GOOGLE_DRIVE_FILE_SCOPE} ${GOOGLE_APPDATA_SCOPE}`);
    const drive = fakeGoogleDrive();
    vi.stubGlobal("fetch", drive.fetch);
    const g = new store.GoogleDriveStore();
    expect(g.location).toBe("My Drive › TripDeck");

    await g.put(trip("t1", "Malta"));
    await g.put(trip("t1", "Malta & Gozo", "2026-10-02T00:00:00.000Z"));
    const all = [...drive.files.values()];
    const folder = all.find((f) => f.folder)!;
    expect(all.filter((f) => f.folder)).toHaveLength(1);
    expect(all.filter((f) => !f.folder)).toEqual([
      expect.objectContaining({ name: "Malta & Gozo (t1).tripdeck.json", parent: folder.id }),
    ]);
    expect(await g.list()).toEqual([{ id: "t1", name: "Malta & Gozo", updatedAt: "2026-10-02T00:00:00.000Z" }]);
  });

  it("migrates trips out of the hidden app folder", async () => {
    connectGoogle(GOOGLE_APPDATA_SCOPE);
    const drive = fakeGoogleDrive();
    vi.stubGlobal("fetch", drive.fetch);
    const hidden = new store.GoogleDriveStore();
    expect(hidden.location).toContain("hidden");
    await hidden.put(trip("old", "Mexico"));
    expect([...drive.files.values()][0]).toEqual(expect.objectContaining({ name: "trip-old.json", parent: "appDataFolder" }));

    await store.migrateHiddenGoogleTrips(); // no drive.file yet: nothing to do
    expect(drive.files.size).toBe(1);

    connectGoogle(`${GOOGLE_DRIVE_FILE_SCOPE} ${GOOGLE_APPDATA_SCOPE}`);
    await store.migrateHiddenGoogleTrips();
    expect((await new store.GoogleDriveStore().get("old"))?.name).toBe("Mexico");
  });
});

describe("copyTrips", () => {
  it("copies missing and newer trips, never overwriting a newer copy", async () => {
    useOneDrive();
    const local = store.storeFor("local");
    const od = store.storeFor("onedrive");
    await local.put(trip("a", "A", "2026-10-02T00:00:00.000Z"));
    await local.put(trip("b", "B", "2026-10-01T00:00:00.000Z"));
    await od.put(trip("b", "B newer", "2026-10-05T00:00:00.000Z"));

    expect(await store.copyTrips(local, od)).toBe(1);
    expect((await od.get("a"))?.name).toBe("A");
    expect((await od.get("b"))?.name).toBe("B newer");
    expect(await store.copyTrips(local, od)).toBe(0);
  });
});

