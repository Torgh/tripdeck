import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { aiConfigured } from "@/lib/server/claude";
import { DATA_DIR, envOverrides, readConfig, writeConfig, type AppConfig } from "@/lib/server/config";
import { cloudAccount, GOOGLE_DRIVE_FILE_SCOPE, hasScope, oauthClient } from "@/lib/server/cloudAuth";
import { assertLocal, handle, readBody } from "@/lib/server/http";
import { mapsProvider } from "@/lib/server/maps";
import { oneDriveTripsFolder, tripStore } from "@/lib/server/tripStore";
import type { ConfigStatus } from "@/lib/configStatus";

export const GET = handle(async (req) => {
  assertLocal(req);
  const config = readConfig();
  const store = tripStore();
  const google = cloudAccount("google");
  const status: ConfigStatus = {
    ai: aiConfigured(),
    mapsProvider: mapsProvider(),
    // The browser key is public by design (restrict it by HTTP referrer in Google Cloud).
    googleMapsBrowserKey: config.googleMapsBrowserKey,
    googleMapId: config.googleMapId,
    cloud: {
      google: {
        clientConfigured: !!oauthClient("google"),
        connected: !!google,
        email: google?.email,
        needsReconnect: !!google && !hasScope("google", GOOGLE_DRIVE_FILE_SCOPE),
      },
    },
    oneDriveFolder: oneDriveTripsFolder(),
    storage: store.kind,
    storageLocation: store.location,
    set: Object.fromEntries(
      Object.entries(config)
        .filter(([k]) => k !== "storage")
        .map(([k, v]) => [k, !!v]),
    ) as ConfigStatus["set"],
    fromEnv: envOverrides(),
    mcp: { command: bunPath(), args: [path.join(process.cwd(), "mcp", "server.ts")] },
    dataDir: DATA_DIR,
  };
  return status;
});

/** The MCP server runs with Bun (TypeScript, no build step). */
function bunPath(): string {
  const local = path.join(os.homedir(), ".bun", "bin", process.platform === "win32" ? "bun.exe" : "bun");
  return fs.existsSync(local) ? local : "bun";
}

const field = z.string().max(500).optional();
const schema = z.object({
  googleClientId: field,
  googleClientSecret: field,
  oneDriveFolder: field,
  googleMapsServerKey: field,
  googleMapsBrowserKey: field,
  googleMapId: field,
  anthropicApiKey: field,
}) satisfies z.ZodType<Partial<Omit<AppConfig, "storage">>>;

export const POST = handle(async (req) => {
  assertLocal(req);
  writeConfig(await readBody(req, schema));
  return { ok: true };
});
