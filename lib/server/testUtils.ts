import path from "node:path";
import { vi } from "vitest";
import type { Trip } from "../types";
import { writeJson } from "./config";
import { forgetDriveListings } from "./tripStore";

/**
 * Helpers for server tests. Every test file sets its own TRIPDECK_HOME in vi.hoisted() before
 * importing server modules, because DATA_DIR is read once at import time.
 */

/** Keeps tests away from the real OneDrive folder on this PC. */
export function hideOneDrive() {
  for (const name of ["OneDriveConsumer", "OneDrive", "OneDriveCommercial"]) vi.stubEnv(name, "");
}

export const trip = (id: string, name: string, updatedAt = "2026-10-01T00:00:00.000Z") =>
  ({ id, name, updatedAt, startDate: "2026-11-01", days: [], ideas: [], items: {}, legs: {} }) as unknown as Trip;

/** Pretends Google is connected with these scopes and a still-valid access token. */
export function connectGoogle(home: string, scope: string) {
  writeJson(path.join(home, "google-token.json"), {
    refreshToken: "r",
    accessToken: "a",
    expiresAt: Date.now() + 3_600_000,
    email: "me@example.com",
    scope,
  });
}

/** Just enough of the Google Drive v3 API: folders, the hidden appDataFolder and multipart uploads. */
export function fakeGoogleDrive() {
  forgetDriveListings();
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
    if (id && !files.has(id)) return Response.json({ error: { message: "File not found" } }, { status: 404 });
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

