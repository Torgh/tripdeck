import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TripDeck – AI trip planner",
    short_name: "TripDeck",
    description: "Plan trips day by day with maps, routes, dives and AI suggestions.",
    start_url: "/",
    display: "standalone",
    background_color: "#0f172a",
    theme_color: "#0e7490",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
