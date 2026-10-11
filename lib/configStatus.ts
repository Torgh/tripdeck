export type ConfigKey =
  | "googleClientId"
  | "googleClientSecret"
  | "googleMapsServerKey"
  | "googleMapsBrowserKey"
  | "googleMapId"
  | "anthropicApiKey";

/** What GET /api/config tells the browser. Secrets are reported as set/unset, never returned. */
export interface ConfigStatus {
  ai: boolean;
  mapsProvider: "google" | "osm";
  googleMapsBrowserKey?: string;
  googleMapId?: string;
  google: { clientConfigured: boolean; connected: boolean; email?: string };
  storage: "drive" | "local";
  set: Partial<Record<ConfigKey, boolean>>;
  fromEnv: ConfigKey[];
  /** How to register the MCP server with Claude Code / Codex on this machine. */
  mcp: { command: string; args: string[] };
  dataDir: string;
}
