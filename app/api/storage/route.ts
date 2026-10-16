import { z } from "zod";
import { cloudAccount } from "@/lib/server/cloudAuth";
import { writeConfig } from "@/lib/server/config";
import { assertLocal, handle, HttpError, readBody } from "@/lib/server/http";
import { copyTrips, oneDriveTripsFolder, tripStore } from "@/lib/server/tripStore";

const schema = z.object({ storage: z.enum(["local", "google", "onedrive"]) });

/** Switches where trips are stored and copies them over (per trip the newer version wins). */
export const POST = handle(async (req) => {
  assertLocal(req);
  const { storage } = await readBody(req, schema);
  if (storage === "google" && !cloudAccount("google")) throw new HttpError(400, "Connect Google Drive first.");
  if (storage === "onedrive" && !oneDriveTripsFolder()) {
    throw new HttpError(400, "No OneDrive folder found on this PC – install OneDrive or set its folder in Settings.");
  }
  const before = tripStore();
  writeConfig({ storage });
  const after = tripStore();
  const copied = before.location === after.location ? 0 : await copyTrips(before, after);
  return { ok: true, copied };
});
