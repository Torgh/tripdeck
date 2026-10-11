"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { SyncBadge } from "@/components/SyncAgent";
import { reloadConfig, useConfig } from "@/lib/config";
import type { ConfigKey, ConfigStatus } from "@/lib/configStatus";
import { syncNow } from "@/lib/sync";

export default function Page() {
  return (
    <Suspense fallback={<main className="home muted">Loading…</main>}>
      <Settings />
    </Suspense>
  );
}

function Settings() {
  const config = useConfig();
  const params = useSearchParams();
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  useEffect(() => {
    if (params.get("google") === "connected") {
      reloadConfig();
      syncNow();
    }
  }, [params]);

  if (!config) return <main className="home muted">Loading settings…</main>;

  const googleError = params.get("google") === "error" ? params.get("message") : null;

  return (
    <main className="home stack" style={{ gap: 20 }}>
      <header>
        <Link href="/" className="btn ghost" aria-label="Back">
          ←
        </Link>
        <h1 className="grow">Settings</h1>
        <SyncBadge />
      </header>

      <section className="card stack">
        <h2>☁ Google account – sync your trips</h2>
        {config.google.connected ? (
          <>
            <p style={{ margin: 0 }}>
              ✅ Connected as <strong>{config.google.email ?? "your Google account"}</strong>. Trips are stored in a
              hidden TripDeck folder on your Google Drive – TripDeck cannot see your other files. Claude (via MCP) and
              this app read and write the same trips.
            </p>
            <div className="row">
              <button className="btn" onClick={() => syncNow()}>
                ⟳ Sync now
              </button>
              <DisconnectButton />
            </div>
          </>
        ) : (
          <>
            <p className="muted" style={{ margin: 0 }}>
              Right now trips are saved on this PC in <code>{config.dataDir}</code>. Connect Google to keep them on your
              Google Drive instead (hidden app folder, only TripDeck can see it).
            </p>
            {googleError && <div className="error">Google sign-in failed: {googleError}</div>}
            <GoogleClientSetup config={config} origin={origin} />
            <div className="row">
              <a
                className={`btn primary${config.google.clientConfigured ? "" : " disabled"}`}
                href={config.google.clientConfigured ? "/api/auth/google/start" : undefined}
                aria-disabled={!config.google.clientConfigured}
                style={config.google.clientConfigured ? undefined : { opacity: 0.5, pointerEvents: "none" }}
              >
                Connect Google
              </a>
              {!config.google.clientConfigured && <span className="small muted">Save the client ID and secret first.</span>}
            </div>
          </>
        )}
      </section>

      <section className="card stack">
        <h2>🤖 Plan with Claude or ChatGPT – no API key</h2>
        <p className="muted" style={{ margin: 0 }}>
          TripDeck includes an MCP server. Connect it once and plan in a chat with your own subscription; changes appear
          on the board within seconds.
        </p>
        <McpSetup config={config} />
      </section>

      <section className="card stack">
        <h2>🗺️ Maps</h2>
        <p style={{ margin: 0 }}>
          Using{" "}
          <strong>
            {config.mapsProvider === "google" ? "Google Maps Platform" : "OpenStreetMap (free, no key needed)"}
          </strong>
          {config.googleMapsBrowserKey ? " with a Google map in the browser" : " with an OpenStreetMap map"}.
        </p>
        <details>
          <summary className="small">Optional: use Google for richer place data (ratings, opening hours)</summary>
          <div className="stack" style={{ marginTop: 10 }}>
            <p className="small muted" style={{ margin: 0 }}>
              Needs a Google Cloud project with billing and these APIs enabled: Places API (New), Routes API, Elevation
              API (server key) and Maps JavaScript API (browser key, restricted to <code>{origin}</code>). If a Google
              API fails, TripDeck falls back to OpenStreetMap automatically.
            </p>
            <KeyForm
              config={config}
              fields={[
                { key: "googleMapsServerKey", label: "Server key (Places, Routes, Elevation)", secret: true },
                { key: "googleMapsBrowserKey", label: "Browser key (Maps JavaScript API)", secret: false },
                { key: "googleMapId", label: "Map ID (optional)", secret: false },
              ]}
            />
          </div>
        </details>
      </section>

      <section className="card stack">
        <h2>✨ In-app AI buttons (optional)</h2>
        <p className="muted" style={{ margin: 0 }}>
          Without a key, “Optimize” uses the fastest-route algorithm and “Suggest” lists notable nearby places – Claude
          via MCP does the smart part. Add an Anthropic API key (billed per use) to get AI suggestions, tips and booking
          import directly in the app.
        </p>
        <KeyForm config={config} fields={[{ key: "anthropicApiKey", label: "Anthropic API key", secret: true }]} />
      </section>
    </main>
  );
}

function GoogleClientSetup({ config, origin }: { config: ConfigStatus; origin: string }) {
  const redirect = `${origin}/api/auth/google/callback`;
  return (
    <details open={!config.google.clientConfigured}>
      <summary className="small">One-time setup: create a Google OAuth client (about 5 minutes)</summary>
      <ol className="small" style={{ paddingLeft: 18, display: "grid", gap: 6 }}>
        <li>
          Open{" "}
          <a href="https://console.cloud.google.com/apis/library/drive.googleapis.com" target="_blank" rel="noreferrer">
            Google Drive API
          </a>{" "}
          in your Google Cloud project and click <strong>Enable</strong>.
        </li>
        <li>
          <a href="https://console.cloud.google.com/auth/branding" target="_blank" rel="noreferrer">
            Google Auth Platform → Branding
          </a>
          : app name “TripDeck”, your e-mail. Under <strong>Audience</strong> choose <em>External</em>, then click{" "}
          <strong>Publish app</strong> (otherwise Google logs you out every 7 days). TripDeck only asks for its own
          hidden Drive folder, which needs no Google review.
        </li>
        <li>
          <a href="https://console.cloud.google.com/auth/clients" target="_blank" rel="noreferrer">
            Clients → Create client
          </a>
          : type <strong>Web application</strong>, authorised redirect URI:
          <CopyField value={redirect} />
        </li>
        <li>Paste the client ID and secret below and save.</li>
      </ol>
      <KeyForm
        config={config}
        fields={[
          { key: "googleClientId", label: "Client ID", secret: false },
          { key: "googleClientSecret", label: "Client secret", secret: true },
        ]}
      />
    </details>
  );
}

function McpSetup({ config }: { config: ConfigStatus }) {
  const quote = (s: string) => (/\s/.test(s) ? `"${s}"` : s);
  const cmd = [config.mcp.command, ...config.mcp.args].map(quote).join(" ");
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div>
        <strong>Claude Code</strong> (Claude Pro/Max) – run once in a terminal:
        <CopyField value={`claude mcp add --scope user tripdeck -- ${cmd}`} />
      </div>
      <div>
        <strong>Codex CLI</strong> (ChatGPT Plus/Pro) – run once:
        <CopyField value={`codex mcp add tripdeck -- ${cmd}`} />
      </div>
      <div>
        <strong>Claude Desktop</strong> – Settings → Developer → Edit config, add to <code>mcpServers</code>:
        <CopyField
          value={JSON.stringify({ tripdeck: { command: config.mcp.command, args: config.mcp.args } }, null, 2)}
          multiline
        />
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        Then just ask, e.g. “Plan day 3 of my Malta trip around Gozo” or “Find my Booking.com and GetYourGuide
        confirmations in Gmail and add them to my trip” (with the Gmail connector enabled in Claude). Prompts:{" "}
        <code>/mcp__tripdeck__plan-day</code>, <code>/mcp__tripdeck__import-bookings</code>.
      </p>
    </div>
  );
}

function CopyField({ value, multiline }: { value: string; multiline?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="row" style={{ alignItems: "flex-start", marginTop: 4 }}>
      {multiline ? (
        <textarea readOnly rows={value.split("\n").length} value={value} style={{ fontFamily: "monospace", fontSize: 12 }} />
      ) : (
        <input readOnly value={value} style={{ fontFamily: "monospace", fontSize: 12 }} onFocus={(e) => e.target.select()} />
      )}
      <button
        className="btn small"
        onClick={() =>
          navigator.clipboard.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
        }
      >
        {copied ? "Copied ✓" : "Copy"}
      </button>
    </div>
  );
}

function KeyForm({
  config,
  fields,
}: {
  config: ConfigStatus;
  fields: { key: ConfigKey; label: string; secret: boolean }[];
}) {
  const [values, setValues] = useState<Partial<Record<ConfigKey, string>>>({});
  const [state, setState] = useState<{ saving: boolean; message?: string; error?: string }>({ saving: false });

  const save = async (patch: Partial<Record<ConfigKey, string>>) => {
    setState({ saving: true });
    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Saving failed.");
      setValues({});
      await reloadConfig();
      setState({ saving: false, message: "Saved ✓" });
    } catch (err) {
      setState({ saving: false, error: (err as Error).message });
    }
  };

  return (
    <div className="stack" style={{ gap: 8 }}>
      {fields.map((f) => {
        const fromEnv = config.fromEnv.includes(f.key);
        const isSet = !!config.set[f.key];
        return (
          <label key={f.key}>
            <span>
              {f.label} {fromEnv ? "· set in environment" : isSet ? "· ✅ saved" : ""}
            </span>
            <div className="row">
              <input
                type={f.secret ? "password" : "text"}
                autoComplete="off"
                disabled={fromEnv}
                placeholder={isSet ? (f.secret ? "•••••••• (leave empty to keep)" : "saved – type to replace") : ""}
                value={values[f.key] ?? ""}
                onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
              />
              {isSet && !fromEnv && (
                <button className="btn small ghost danger" title="Remove" onClick={() => save({ [f.key]: "" })}>
                  Remove
                </button>
              )}
            </div>
          </label>
        );
      })}
      <div className="row">
        <button
          className="btn primary"
          disabled={state.saving || !Object.values(values).some((v) => v?.trim())}
          onClick={() => save(Object.fromEntries(Object.entries(values).filter(([, v]) => v?.trim())))}
        >
          Save
        </button>
        {state.message && <span className="small">{state.message}</span>}
        {state.error && <span className="small" style={{ color: "var(--danger)" }}>{state.error}</span>}
      </div>
      <span className="small muted">Stored only on this PC in {config.dataDir}/config.json.</span>
    </div>
  );
}

function DisconnectButton() {
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="btn danger"
      disabled={busy}
      onClick={async () => {
        if (!confirm("Disconnect Google? Trips stay on Drive; this PC will use local storage until you reconnect.")) return;
        setBusy(true);
        await fetch("/api/auth/google/disconnect", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        await reloadConfig();
        await syncNow();
        setBusy(false);
      }}
    >
      Disconnect
    </button>
  );
}
