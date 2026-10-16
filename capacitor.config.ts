import type { CapacitorConfig } from "@capacitor/cli";

// The Android phone app: wraps the static build of mobile/ (see mobile/vite.config.ts).
const config: CapacitorConfig = {
  appId: "io.github.torgh.tripdeck",
  appName: "TripDeck",
  webDir: "mobile/dist",
  android: { path: "mobile/android" },
};

export default config;
