import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// The phone app: a static React build that Capacitor wraps into an Android app (see capacitor.config.ts).
export default defineConfig({
  root: here("./"),
  base: "./",
  plugins: [react()],
  // Shares the trip logic in lib/ with the desktop app, under the same "@/lib/..." imports.
  resolve: { alias: { "@": here("../") } },
  // The desktop app's browser key (.env.local) also gives the phone Google's map tiles. Only that one
  // variable is exposed; without it the app uses OpenFreeMap.
  envDir: here("../"),
  envPrefix: ["VITE_", "NEXT_PUBLIC_GOOGLE_MAPS_API_KEY"],
  build: { outDir: here("./dist"), emptyOutDir: true, target: "es2022" },
  // Reachable from the emulator (10.0.2.2) and phones on the same Wi-Fi for live reload.
  server: { host: true, port: 5173, strictPort: true },
});
