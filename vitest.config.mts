import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": root("./"),
      "server-only": root("./test/server-only.ts"),
    },
  },
  test: {
    include: ["lib/**/*.test.ts", "app/**/*.test.ts", "mcp/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["lib/**/*.ts", "app/api/**/*.ts"],
      exclude: [
        "**/*.test.ts",
        "lib/testUtils.ts",
        "lib/server/testUtils.ts",
        // Browser-only glue (React hooks, fetch helpers) – exercised in the app, not in unit tests.
        "lib/hooks.ts",
        "lib/api.ts",
        "lib/config.ts",
        // Thin wrappers around external APIs (Claude, Google Maps, OSM).
        "lib/server/claude.ts",
        "lib/server/google.ts",
        "lib/server/osm.ts",
        "app/api/ai/**",
      ],
      reporter: ["text-summary", "text", "json-summary"],
      // A little below today's numbers: CI fails when a change drops coverage noticeably.
      thresholds: { statements: 85, branches: 80, functions: 78, lines: 87 },
    },
  },
});
