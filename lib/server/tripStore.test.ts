import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const home = vi.hoisted(() => {
  // DATA_DIR is read when ./config is first imported.
  const dir = `${process.env.TMPDIR ?? process.env.TEMP ?? "/tmp"}/tripdeck-test-${process.pid}`;
  process.env.TRIPDECK_HOME = dir;
  return dir;
});

const { GOOGLE_APPDATA_SCOPE, GOOGLE_DRIVE_FILE_SCOPE } = await import("./cloudAuth");
const { writeConfig } = await import("./config");
const store = await import("./tripStore");
const { connectGoogle: connectGoogleIn, fakeGoogleDrive, hideOneDrive, trip } = await import("./testUtils");

const connectGoogle = (scope: string) => connectGoogleIn(home, scope);

/** A fake OneDrive folder; the real one on this PC (%OneDrive%) is never touched. */
const oneDrive = path.join(home, "OneDrive");
const useOneDrive = () => (fs.mkdirSync(oneDrive, { recursive: true }), writeConfig({ oneDriveFolder: oneDrive }));
const tripFiles = () => fs.readdirSync(path.join(oneDrive, "TripDeck")).sort();

beforeEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
  hideOneDrive();
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

  it("finds a trip's file from the last listing instead of listing the folder again", async () => {
    connectGoogle(`${GOOGLE_DRIVE_FILE_SCOPE} ${GOOGLE_APPDATA_SCOPE}`);
    const drive = fakeGoogleDrive();
    vi.stubGlobal("fetch", drive.fetch);
    const g = new store.GoogleDriveStore();
    await g.put(trip("t1", "Malta"));
    await g.list();

    drive.fetch.mockClear();
    expect((await g.get("t1"))?.name).toBe("Malta");
    await g.put(trip("t1", "Malta & Gozo", "2026-10-02T00:00:00.000Z"));
    // Just the download and the upload: no folder lookup, no listing.
    expect(drive.fetch.mock.calls.map(([url, init]) => `${init?.method ?? "GET"} ${new URL(String(url)).pathname}`)).toEqual([
      "GET /drive/v3/files/f2",
      "PATCH /upload/drive/v3/files/f2",
    ]);
    expect((await g.get("t1"))?.name).toBe("Malta & Gozo");
  });

  it("looks again when a listed file was deleted on Drive meanwhile", async () => {
    connectGoogle(`${GOOGLE_DRIVE_FILE_SCOPE} ${GOOGLE_APPDATA_SCOPE}`);
    const drive = fakeGoogleDrive();
    vi.stubGlobal("fetch", drive.fetch);
    const g = new store.GoogleDriveStore();
    await g.put(trip("t1", "Malta"));
    await g.list();
    drive.files.delete("f2");

    expect(await g.get("t1")).toBeUndefined();
    await g.put(trip("t1", "Malta again"));
    expect((await g.get("t1"))?.name).toBe("Malta again");
    expect(await g.list()).toEqual([expect.objectContaining({ id: "t1", name: "Malta again" })]);
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

