import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { StorageKind } from "../configStatus";

/**
 * Local data directory shared by the web app and the MCP server.
 * Holds settings, the cloud tokens and (when "This PC" is the storage) the trips themselves.
 */
export const DATA_DIR = process.env.TRIPDECK_HOME || path.join(os.homedir(), ".tripdeck");

export interface AppConfig {
  googleClientId?: string;
  googleClientSecret?: string;
  /** The OneDrive folder on this PC, when it isn't found automatically. Trips go into its TripDeck subfolder. */
  oneDriveFolder?: string;
  /** Where trips are stored. Unset means Google Drive when connected (the behaviour before OneDrive). */
  storage?: StorageKind;
  /** Optional: Google Places / Routes / Elevation. Without it OpenStreetMap services are used. */
  googleMapsServerKey?: string;
  /** Optional: Google map in the browser. Without it an OpenStreetMap-based map is shown. */
  googleMapsBrowserKey?: string;
  googleMapId?: string;
  /** Optional: enables the in-app AI buttons. Not needed when you plan through MCP. */
  anthropicApiKey?: string;
}

const CONFIG_FILE = path.join(DATA_DIR, "config.json");

/** Environment variables win over the settings file, so deployments can still use .env. */
const ENV: Record<Exclude<keyof AppConfig, "storage">, string> = {
  googleClientId: "GOOGLE_CLIENT_ID",
  googleClientSecret: "GOOGLE_CLIENT_SECRET",
  oneDriveFolder: "TRIPDECK_ONEDRIVE_FOLDER",
  googleMapsServerKey: "GOOGLE_MAPS_API_KEY",
  googleMapsBrowserKey: "NEXT_PUBLIC_GOOGLE_MAPS_API_KEY",
  googleMapId: "NEXT_PUBLIC_GOOGLE_MAP_ID",
  anthropicApiKey: "ANTHROPIC_API_KEY",
};

export function readJson<T>(file: string): T | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return undefined;
  }
}

/** Writes atomically (temp file + rename) so a crash never leaves half a file. */
export function writeJson(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export function readFileConfig(): AppConfig {
  return readJson<AppConfig>(CONFIG_FILE) ?? {};
}

export function readConfig(): AppConfig {
  const config = readFileConfig();
  for (const [key, env] of Object.entries(ENV) as [keyof typeof ENV, string][]) {
    const value = process.env[env]?.trim();
    if (value) config[key] = value;
  }
  return config;
}

/** Which settings come from the environment (and so can't be changed in the Settings page). */
export function envOverrides(): (keyof typeof ENV)[] {
  return (Object.entries(ENV) as [keyof typeof ENV, string][])
    .filter(([, env]) => process.env[env]?.trim())
    .map(([key]) => key);
}

/** Merges `patch` into the settings file. Empty strings remove a setting. */
export function writeConfig(patch: Partial<AppConfig>) {
  const next: AppConfig = { ...readFileConfig() };
  for (const [key, value] of Object.entries(patch) as [keyof AppConfig, string | undefined][]) {
    if (value === undefined) continue;
    if (value.trim()) (next as Record<string, string>)[key] = value.trim();
    else delete next[key];
  }
  writeJson(CONFIG_FILE, next);
}
