# TripDeck

**A trip planner for people who want to see the whole trip at once – and plan it together with Claude or ChatGPT.** Each day is a column and each place is a card. Drag cards between days or move whole days. TripDeck works out how you get from one stop to the next, and flags dive-safety problems such as flying too soon after diving. An MCP server lets Claude (Claude Code / Desktop) or ChatGPT (Codex) work on the same plan using **your own subscription, no API key needed**.

![TripDeck board](docs/screenshot.png)

## Features

- **Drag-and-drop planning.** Move cards between days and the *Ideas* column, reorder them, or drag whole days. Works with mouse, touch and keyboard.
- **Routes between stops.** Each leg is calculated, starting from the hotel you woke up in. You choose the mode per leg: car, walk, bike, transit or scooter. Ferry, boat and flight legs take a manual duration. Every leg has a one-tap link to Google Maps directions.
- **Day timeline.** Shows estimated arrival times, warns when you would be late for a fixed-time booking, and flags places that are closed that day.
- **Dive planning.** Dive cards hold site, centre, number of dives, depth and gas. TripDeck warns about flights less than 12 h after a single dive or 18 h after repetitive diving (DAN guidance), about going above 300 m altitude in that window, and suggests a rest day after long dive streaks.
- **Plan with Claude or ChatGPT (MCP).** Ask in plain language, for example “plan day 3 around Gozo”, “what's worth seeing near my hotel?” or “find my Booking.com and GetYourGuide confirmations in Gmail and add them”. The cards appear on the board within seconds.
- **No keys needed for maps.** OpenStreetMap powers the map (OpenFreeMap tiles), search (Photon), nearby places (Overpass, with a Wikipedia fallback), routing (OSRM) and elevation (Open-Meteo). If you add Google Maps keys, TripDeck uses Google's richer data and falls back to OSM if a Google API fails.
- **Google Drive sync.** Connect your Google account once and your trips live in a hidden TripDeck folder on your Drive. TripDeck can't see your other files. Until you connect, trips are saved in `~/.tripdeck/trips`.
- **Optional in-app AI.** With an Anthropic API key, the ✨ buttons give AI suggestions, an AI day optimizer, visiting tips and booking import (paste an email or upload a PDF or screenshot) directly in the app.
- **PWA.** Installable, works offline, and lets you export and import trips as JSON.

## Quick start

Requirements: [Bun](https://bun.sh). It runs the MCP server and can also run the app. Node.js 20.9+ works for the web app.

```bash
git clone https://github.com/<you>/tripdeck.git
cd tripdeck
bun install
bun run dev          # http://localhost:3000 (bound to 127.0.0.1)
```

Click **Load demo trip** to explore a Malta & Gozo dive week. The demo includes a deliberate no-fly warning.

Everything else is configured in the app under **⚙ Settings**, with no `.env` editing needed. Settings are stored in `~/.tripdeck/config.json` on your machine.

### 1. Plan with Claude or ChatGPT (MCP, no API key)

Settings shows the exact commands for your machine. Typically:

```bash
# Claude Code (Claude Pro/Max)
claude mcp add --scope user tripdeck -- ~/.bun/bin/bun /path/to/tripdeck/mcp/server.ts

# Codex CLI (ChatGPT Plus/Pro)
codex mcp add tripdeck -- ~/.bun/bin/bun /path/to/tripdeck/mcp/server.ts
```

For Claude Desktop, add the same command to `mcpServers` in its config. The MCP server reads and writes the same trips as the web app, so keep the app open to watch changes arrive.

| MCP tool | What it does |
|---|---|
| `list_trips`, `get_trip` | Trips, and the full plan with times, legs, bookings and warnings |
| `create_trip`, `update_trip` | New trip; rename, change dates or interests, add days, set a day's start time |
| `add_item`, `update_item` | Cards of any type; `place_query` finds the location |
| `move_item`, `remove_item`, `move_day`, `reorder_day` | Rearrange the plan |
| `set_leg` | Travel mode between two cards (incl. ferry/boat/flight minutes) |
| `search_places`, `nearby_places` | Find places by name, or notable places around a card |
| `optimize_day` | Real travel-time matrix and the fastest order; Claude decides and calls `reorder_day` |

Prompts: `/mcp__tripdeck__plan-day` and `/mcp__tripdeck__import-bookings`. Booking import works best with the Gmail connector enabled in Claude.

### 2. Sync with Google Drive (optional)

Settings → *Google account* walks you through a one-time setup:

1. In Google Cloud, enable the **Google Drive API**.
2. Under *Google Auth Platform*, set the audience to *External* and **publish the app**. Apps left in testing mode get logged out every 7 days. TripDeck only requests the `drive.appdata` scope, which needs no Google review.
3. Create an OAuth client of type *Web application* with the redirect URI `http://localhost:3000/api/auth/google/callback`.
4. Paste the client ID and secret into Settings and click **Connect Google**. Your existing trips are copied to Drive.

### 3. Google Maps and in-app AI (optional)

- **Google Maps:** a server key for Places API (New), Routes API and Elevation API, plus a browser key for the Maps JavaScript API restricted by HTTP referrer.
- **Anthropic API key:** turns on the in-app ✨ AI features (billed per use). It defaults to `claude-opus-5-5`; override it with the `ANTHROPIC_MODEL` environment variable.

Environment variables still work and take precedence over Settings: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_MAPS_API_KEY`, `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, `NEXT_PUBLIC_GOOGLE_MAP_ID`, `ANTHROPIC_API_KEY`, and `TRIPDECK_HOME` (data directory).

## Security model

TripDeck is a **personal, local app**:

- The server binds to `127.0.0.1`.
- Settings, tokens and trip endpoints only accept requests addressed to `localhost`, which defeats DNS rebinding.
- These endpoints require a JSON content type, which blocks cross-site form posts.
- The Google refresh token is stored in `~/.tripdeck/google-token.json` and can only access TripDeck's own hidden Drive folder.

Do not expose this app to the internet as-is.

## How it works

```
app/
  page.tsx, trip/, settings/   UI (Next.js 16, React 19, dnd-kit, MapLibre / Google Maps)
  api/trips/                   trip storage (Drive or ~/.tripdeck/trips) used by the browser sync
  api/config, api/auth/google  settings + Google OAuth (PKCE)
  api/places|route|elevation   maps facade: Google when configured, OSM otherwise
  api/ai/*                     optional in-app AI (Claude API)
mcp/server.ts                  MCP server (stdio) – same storage and maps facade
lib/
  tripOps.ts                   pure trip operations (shared by browser and MCP)
  timeline.ts, diveSafety.ts   arrival times, opening hours, no-fly / altitude rules
  optimize.ts                  exact (≤ 8 stops) or 2-opt day ordering
  sync.ts                      browser ⇄ server sync (newest updatedAt wins per trip, polls every 15 s)
  server/osm.ts, google.ts     map providers; server/tripStore.ts – local folder / Google Drive
```

## Scripts

```bash
bun run dev        # development server on http://localhost:3000
bun run build      # production build
bun run start      # serve the production build
bun run mcp        # run the MCP server manually (normally Claude/Codex starts it)
bun run typecheck
bun run test
```

## Disclaimer

The dive-safety checks follow DAN's published, conservative guidance. They are planning hints only and **not a substitute for your dive computer, your training or medical advice**. Place data comes from OpenStreetMap or Google and may be out of date, so check opening hours and prices before you go.

## License

Copyright © 2026 Krzysztof Liszankowski

TripDeck is free software: you can redistribute it and/or modify it under the terms of the
[GNU Affero General Public License](LICENSE) as published by the Free Software Foundation, either
version 3 of the License, or (at your option) any later version.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even
the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General
Public License for more details.

If you run a modified version of TripDeck as a network service, the AGPL requires you to offer its
users the corresponding source code.
