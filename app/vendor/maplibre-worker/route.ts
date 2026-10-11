import fs from "node:fs/promises";
import path from "node:path";

/**
 * Serves MapLibre's web worker from node_modules. Bundlers can't resolve the worker URL that
 * MapLibre derives from import.meta.url, so OsmMap points setWorkerUrl() here instead.
 */
export async function GET() {
  const file = path.join(process.cwd(), "node_modules", "maplibre-gl", "dist", "maplibre-gl-worker.mjs");
  return new Response(await fs.readFile(file), {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
