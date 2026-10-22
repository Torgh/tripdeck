import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    // Changes with every build: the service worker is registered with it, so a new build installs a
    // new worker with its own cache and the previous build's files are deleted.
    TRIPDECK_BUILD: Date.now().toString(36),
  },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
    ];
  },
};

export default nextConfig;
