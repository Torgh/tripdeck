export type ConfigKey =
  | "googleClientId"
  | "googleClientSecret"
  | "oneDriveFolder"
  | "googleMapsServerKey"
  | "googleMapsBrowserKey"
  | "googleMapId"
  | "anthropicApiKey";

/**
 * Where trips are kept: this PC, the TripDeck folder inside the OneDrive folder on this PC (the
 * OneDrive app syncs it), or a visible TripDeck folder on Google Drive (through Google's API).
 */
export type StorageKind = "local" | "onedrive" | "google";
/** Storage that needs an account connected with OAuth. */
export type CloudProvider = "google";

export const CLOUD_PROVIDERS: CloudProvider[] = ["google"];

export const STORAGE_LABEL: Record<StorageKind, string> = {
  local: "This PC",
  google: "Google Drive",
  onedrive: "OneDrive",
};

export interface CloudAccountStatus {
  clientConfigured: boolean;
  connected: boolean;
  email?: string;
  /** Connected before the visible folder existed, so trips are still in Google Drive's hidden app folder. */
  needsReconnect?: boolean;
}

/** What GET /api/config tells the browser. Secrets are reported as set/unset, never returned. */
export interface ConfigStatus {
  ai: boolean;
  mapsProvider: "google" | "osm";
  googleMapsBrowserKey?: string;
  googleMapId?: string;
  cloud: Record<CloudProvider, CloudAccountStatus>;
  /** The TripDeck folder inside OneDrive on this PC; undefined when no OneDrive folder was found. */
  oneDriveFolder?: string;
  storage: StorageKind;
  /** Human-readable place where the trips are, e.g. "My Drive › TripDeck". */
  storageLocation: string;
  set: Partial<Record<ConfigKey, boolean>>;
  fromEnv: ConfigKey[];
  /** How to register the MCP server with Claude Code / Codex on this machine. */
  mcp: { command: string; args: string[] };
  dataDir: string;
}
