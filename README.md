# TripDeck

**A trip planner for people who want to see the whole trip at once – and plan it together with Claude or ChatGPT.** Each day is a column and each place is a card. Drag cards between days or move whole days. TripDeck works out how you get from one stop to the next, and flags dive-safety problems such as flying too soon after diving. An MCP server lets Claude (Claude Code / Desktop) or ChatGPT (Codex) work on the same plan using **your own subscription, no API key needed**.

![TripDeck board](docs/screenshot.png)

## Features

- **Drag-and-drop planning.** Move cards between days and the *Ideas* column, reorder them, or drag whole days. Works with mouse, touch and keyboard. Days wrap into rows that fit the window, and you can drag the divider between the board and the map to resize them (double-click resets it).
- **Flexible trip dates.** Change the first or last day in *Trip settings* at any time. Moving the first day shifts the whole trip; a later last day adds empty days, an earlier one removes days from the end and moves their cards to *Ideas*.
- **Routes between stops.** Each leg is calculated, starting from the hotel you woke up in. You choose the mode per leg: car, walk, bike, transit or scooter. Ferry, boat and flight legs take a manual duration. Every leg has a one-tap link to Google Maps directions.
- **Day timeline.** Shows estimated arrival times, warns when you would be late for a fixed-time booking, and flags places that are closed that day.
- **Stays and nights.** A stay has nights, a check-in time and a check-out time. The bottom of every day shows where you sleep that night (“Night 2 of 3”, check-in, check-out tomorrow), in the same colour on every night of that stay. Overnight flights and boats are recognised, and a night with no accommodation is flagged with a quick **+ Add stay**.
- **Dive planning.** Dive cards hold site, centre, number of dives, depth and gas. TripDeck warns about flights less than 12 h after a single dive or 18 h after repetitive diving (DAN guidance), about going above 300 m altitude in that window, and suggests a rest day after long dive streaks.
- **Plan with Claude or ChatGPT (MCP).** Ask in plain language, for example “plan day 3 around Gozo”, “what's worth seeing near my hotel?” or “find my Booking.com and GetYourGuide confirmations in Gmail and add them”. The cards appear on the board within seconds.
- **No keys needed for maps.** OpenStreetMap powers the map (OpenFreeMap tiles), search (Photon), nearby places (Overpass, with a Wikipedia fallback), routing (OSRM) and elevation (Open-Meteo). If you add Google Maps keys, TripDeck uses Google's richer data and falls back to OSM if a Google API fails.
- **Your choice of storage: this PC, OneDrive or Google Drive.** Trips start in `~/.tripdeck/trips`. Choose OneDrive and they go into a visible **TripDeck** folder in OneDrive, synced by the OneDrive app, with no sign-in needed. Choose Google and they go into *My Drive › TripDeck*; TripDeck can't see your other Drive files. Each trip is one `Name (id).tripdeck.json` file, the same format as *Export → JSON*. Switch in *Settings* at any time; your trips are copied to the new place.
- **Optional in-app AI.** With an Anthropic API key, the ✨ buttons give AI suggestions, an AI day optimizer, visiting tips and booking import (paste an email or upload a PDF or screenshot) directly in the app.
- **Export as PDF or JSON.** *Export → PDF* opens a printable itinerary to save as a PDF: a map zoomed on the trip's area (flights more than 1000 km from all your stops, such as the flights from home, are left out), an overview of days and nights, a table of every booking with references and prices, and a day-by-day plan. *Export → JSON* downloads a backup you can import again.
- **PWA.** Installable and works offline.

## Quick start

Requirements: [Bun](https://bun.sh). It runs the MCP server and can also run the app. Node.js 20.9+ works for the web app.

```bash
git clone https://github.com/<you>/tripdeck.git
cd tripdeck
bun install
bun run dev          # http://localhost:3000 (bound to 127.0.0.1)
```

Click **Load demo trip** to explore a seven-day Malta & Gozo dive week. It uses every card type and travel mode, has three stays with check-in and check-out times, bookings with prices, opening hours, AI tips and an AI-suggested idea. It also contains three deliberate problems: a cathedral visit on a Sunday when it is closed, a late arrival for the noon gun, and a flight home less than 18 h after diving.

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
| `create_trip`, `update_trip` | New trip; rename, change the dates (`start_date`, `end_date`) or interests, add days, set a day's start time |
| `add_item`, `update_item` | Cards of any type; `place_query` finds the location; stays take `stay_nights`, `stay_check_in`, `stay_check_out` |
| `move_item`, `remove_item`, `move_day`, `reorder_day` | Rearrange the plan |
| `set_leg` | Travel mode between two cards (incl. ferry/boat/flight minutes) |
| `search_places`, `nearby_places` | Find places by name, or notable places around a card |
| `optimize_day` | Real travel-time matrix and the fastest order; Claude decides and calls `reorder_day` |

Prompts: `/mcp__tripdeck__plan-day` and `/mcp__tripdeck__import-bookings`. Booking import works best with the Gmail connector enabled in Claude.

### 2. Store trips in OneDrive or on Google Drive (optional)

*Settings → Where your trips are stored* lets you choose **This PC**, **OneDrive** or **Google Drive**. Switching copies your trips to the new place; per trip the newer version wins.

**OneDrive** puts trips in the *TripDeck* folder inside your OneDrive folder on this PC (on Windows `%OneDrive%\TripDeck`, on macOS under `~/Library/CloudStorage/OneDrive-…`). The OneDrive app syncs that folder to your other devices and to the OneDrive phone app. No Microsoft sign-in or app registration is needed. If TripDeck doesn't find OneDrive, set its folder in Settings or with `TRIPDECK_ONEDRIVE_FOLDER`. When two PCs edit the same trip offline, OneDrive keeps both files and TripDeck uses the newer one.

**Google Drive** puts trips in *My Drive › TripDeck*. It needs a one-time setup, and Settings walks you through it:

1. In Google Cloud, enable the **Google Drive API**.
2. Under *Google Auth Platform*, set the audience to *External* and **publish the app**. Apps left in testing mode get logged out every 7 days. TripDeck only requests the `drive.file` scope (files it created itself), which needs no Google review.
3. Create an OAuth client of type *Web application* with the redirect URI `http://localhost:3000/api/auth/google/callback`.
4. Paste the client ID and secret into Settings and click **Connect Google Drive**.

Connected Google before this version? Your trips are still in Drive's hidden app folder. Click **Reconnect** in Settings and TripDeck copies them into the visible folder.

### 3. Google Maps and in-app AI (optional)

- **Google Maps:** a server key for Places API (New), Routes API and Elevation API, plus a browser key for the Maps JavaScript API restricted by HTTP referrer.
- **Anthropic API key:** turns on the in-app ✨ AI features (billed per use). It defaults to `claude-opus-5-5`; override it with the `ANTHROPIC_MODEL` environment variable. If the API declines a harmless request, it is retried on Anthropic's recommended fallback model; set `AI_FALLBACKS=off` to turn that off.

Environment variables still work and take precedence over Settings: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TRIPDECK_ONEDRIVE_FOLDER`, `GOOGLE_MAPS_API_KEY`, `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, `NEXT_PUBLIC_GOOGLE_MAP_ID`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `AI_FALLBACKS`, and `TRIPDECK_HOME` (data directory).

## Security model

TripDeck is a **personal, local app**:

- The server binds to `127.0.0.1`.
- Settings, tokens and trip endpoints only accept requests addressed to `localhost`, which defeats DNS rebinding.
- These endpoints require a JSON content type, which blocks cross-site form posts.
- The Google refresh token is stored in `~/.tripdeck/google-token.json` and can only reach files TripDeck created (its TripDeck folder). OneDrive needs no token: TripDeck writes to the synced folder on this PC.

Do not expose this app to the internet as-is.

## How it works

```
app/
  page.tsx, trip/, settings/   UI (Next.js 16, React 19, dnd-kit, MapLibre / Google Maps)
  trip/print/                  printable itinerary (Export → PDF)
  api/trips/                   trip storage (this PC, OneDrive folder or Google Drive) used by the browser sync
  api/storage                  switch storage and copy the trips over
  api/config, api/auth/[provider]  settings + Google OAuth (PKCE)
  api/places|route|elevation   maps facade: Google when configured, OSM otherwise
  api/ai/*                     optional in-app AI (Claude API)
mcp/server.ts                  MCP server (stdio) – same storage and maps facade
lib/
  tripOps.ts                   pure trip operations (shared by browser and MCP)
  timeline.ts, diveSafety.ts   arrival times, opening hours, no-fly / altitude rules
  stays.ts                     where each night is spent, stay colours
  optimize.ts                  exact (≤ 8 stops) or 2-opt day ordering
  sync.ts                      browser ⇄ server sync (newest updatedAt wins per trip, polls every 15 s)
  server/osm.ts, google.ts     map providers
  server/tripStore.ts          local / OneDrive folder, Google Drive; server/cloudAuth.ts – OAuth tokens
```

## Scripts

```bash
bun run dev        # development server on http://localhost:3000
bun run build      # production build
bun run start      # serve the production build
bun run mcp        # run the MCP server manually (normally Claude/Codex starts it)
bun run typecheck
bun run lint       # ESLint (Next.js + TypeScript rules), no warnings allowed
bun run test       # unit, API and MCP integration tests
bun run test:coverage
bun run check      # everything CI runs on a pull request: typecheck, lint, tests with coverage, build
```

CI runs `bun run check` on every pull request, plus the tests on Windows. It fails when coverage drops below the thresholds in `vitest.config.mts`. Tests never touch your real trips: each suite uses its own temporary `TRIPDECK_HOME`, and the OneDrive folder is replaced with a temporary one.

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
