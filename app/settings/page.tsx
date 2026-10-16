"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { SyncBadge } from "@/components/SyncAgent";
import { LICENSE_URL, SOURCE_URL } from "@/lib/about";
import { reloadConfig, useConfig } from "@/lib/config";
import {
  CLOUD_PROVIDERS,
  STORAGE_LABEL,
  type CloudProvider,
  type ConfigKey,
  type ConfigStatus,
  type StorageKind,
} from "@/lib/configStatus";
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
    if (params.get("status") === "connected") {
      reloadConfig();
      syncNow();
    }
  }, [params]);

  if (!config) return <main className="home muted">Loading settings…</main>;

  const failed = params.get("status") === "error" ? params.get("provider") : null;
  const signInError =
    failed && (CLOUD_PROVIDERS as string[]).includes(failed)
      ? `${STORAGE_LABEL[failed as CloudProvider]} sign-in failed: ${params.get("message")}`
      : null;

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
        <h2>☁ Where your trips are stored</h2>
        <p className="muted" style={{ margin: 0 }}>
          Keep trips on this PC, or in a visible <strong>TripDeck</strong> folder in OneDrive or on Google Drive. Claude
          (via MCP) and this app read and write the same trips. Switching copies your trips to the new place; per trip
          the newer version wins.
        </p>
        {signInError && <div className="error">{signInError}</div>}
        <StoragePicker config={config} />
        <OneDriveFolder config={config} />
        <CloudAccount provider="google" config={config} origin={origin} />
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

      <section className="card stack">
        <h2>ℹ️ About</h2>
        <p className="small" style={{ margin: 0 }}>
          TripDeck © 2026 Krzysztof Liszankowski. Free software under the{" "}
          <a href={LICENSE_URL} target="_blank" rel="noreferrer">
            GNU Affero General Public License v3
          </a>{" "}
          or later – you may use, study, share and modify it under its terms. It comes with ABSOLUTELY NO WARRANTY.
        </p>
        <p className="small" style={{ margin: 0 }}>
          Source code:{" "}
          <a href={SOURCE_URL} target="_blank" rel="noreferrer">
            {SOURCE_URL.replace("https://", "")}
          </a>
        </p>
      </section>
    </main>
  );
}


function StoragePicker({ config }: { config: ConfigStatus }) {
  const [state, setState] = useState<{ busy?: StorageKind; message?: string; error?: string }>({});

  const choose = async (storage: StorageKind) => {
    setState({ busy: storage });
    try {
      const res = await fetch("/api/storage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storage }),
      });
      const data = (await res.json()) as { copied?: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Switching failed.");
      await reloadConfig();
      await syncNow();
      setState({ message: data.copied ? `Copied ${data.copied} trip(s) ✓` : "Switched ✓" });
    } catch (err) {
      setState({ error: (err as Error).message });
    }
  };

  const google = config.cloud.google;
  const options: { kind: StorageKind; where: string; available: boolean }[] = [
    { kind: "local", where: `${config.dataDir}${config.dataDir.includes("\\") ? "\\" : "/"}trips`, available: true },
    {
      kind: "onedrive",
      where: config.oneDriveFolder ?? "OneDrive not found on this PC – set its folder below",
      available: !!config.oneDriveFolder,
    },
    {
      kind: "google",
      where: !google.connected
        ? "connect below first"
        : `${google.needsReconnect ? "hidden app folder – reconnect to make it visible" : "My Drive › TripDeck"}${google.email ? ` · ${google.email}` : ""}`,
      available: google.connected,
    },
  ];

  return (
    <div className="stack" style={{ gap: 6 }} role="radiogroup" aria-label="Storage">
      {options.map((o) => (
        <label
          key={o.kind}
          className="row"
          style={{ gap: 8, opacity: o.available ? 1 : 0.55, cursor: o.available ? "pointer" : "default" }}
        >
          <input
            type="radio"
            name="storage"
            style={{ width: "auto" }}
            checked={config.storage === o.kind}
            disabled={!o.available || !!state.busy}
            onChange={() => choose(o.kind)}
          />
          <span>
            <strong>
              {o.kind === "local" ? "💾" : "☁"} {STORAGE_LABEL[o.kind]}
            </strong>{" "}
            <span className="small muted">{state.busy === o.kind ? "copying trips…" : o.where}</span>
          </span>
        </label>
      ))}
      {state.message && <span className="small">{state.message}</span>}
      {state.error && <span className="small" style={{ color: "var(--danger)" }}>{state.error}</span>}
      {config.storage === "google" && config.cloud.google.needsReconnect && (
        <div className="error">
          Your trips are still in Google Drive&apos;s hidden app folder. Click <strong>Reconnect</strong> under Google Drive
          below to move them to a visible TripDeck folder.
        </div>
      )}
    </div>
  );
}

function OneDriveFolder({ config }: { config: ConfigStatus }) {
  return (
    <details open={!config.oneDriveFolder}>
      <summary>
        <strong>OneDrive</strong>{" "}
        <span className="small muted">{config.oneDriveFolder ? "✅ found on this PC" : "not found on this PC"}</span>
      </summary>
      <div className="stack" style={{ marginTop: 10 }}>
        <p className="small muted" style={{ margin: 0 }}>
          Uses the OneDrive app on this PC – no Microsoft sign-in or app registration needed. TripDeck saves one{" "}
          <code>Name (id).tripdeck.json</code> file per trip in the <strong>TripDeck</strong> folder inside OneDrive, and
          OneDrive syncs it to your other devices, including the OneDrive phone app. Keep OneDrive running so changes
          made on another PC arrive here.
        </p>
        <KeyForm
          config={config}
          fields={[{ key: "oneDriveFolder", label: "OneDrive folder (only if it isn't found automatically)", secret: false }]}
        />
      </div>
    </details>
  );
}

function CloudAccount({ provider, config, origin }: { provider: CloudProvider; config: ConfigStatus; origin: string }) {
  const account = config.cloud[provider];
  const label = STORAGE_LABEL[provider];
  const connect = (
    <a
      className={`btn${account.connected && !account.needsReconnect ? "" : " primary"}`}
      href={account.clientConfigured ? `/api/auth/${provider}/start` : undefined}
      aria-disabled={!account.clientConfigured}
      style={account.clientConfigured ? undefined : { opacity: 0.5, pointerEvents: "none" }}
    >
      {account.connected ? "Reconnect" : `Connect ${label}`}
    </a>
  );
  return (
    <details open={!account.connected || account.needsReconnect}>
      <summary>
        <strong>{label}</strong>{" "}
        <span className="small muted">
          {account.connected ? `✅ connected${account.email ? ` as ${account.email}` : ""}` : "not connected"}
        </span>
      </summary>
      <div className="stack" style={{ marginTop: 10 }}>
        {account.connected ? (
          <div className="row">
            <button className="btn" onClick={() => syncNow()}>
              ⟳ Sync now
            </button>
            {connect}
            <DisconnectButton provider={provider} />
          </div>
        ) : (
          <>
            <GoogleClientSetup config={config} origin={origin} />
            <div className="row">
              {connect}
              {!account.clientConfigured && <span className="small muted">Save the client ID and secret first.</span>}
            </div>
          </>
        )}
      </div>
    </details>
  );
}

function GoogleClientSetup({ config, origin }: { config: ConfigStatus; origin: string }) {
  const redirect = `${origin}/api/auth/google/callback`;
  return (
    <details open={!config.cloud.google.clientConfigured}>
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
          <strong>Publish app</strong> (otherwise Google logs you out every 7 days). TripDeck only asks for files it
          creates itself (its TripDeck folder), which needs no Google review.
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

function DisconnectButton({ provider }: { provider: CloudProvider }) {
  const [busy, setBusy] = useState(false);
  const label = STORAGE_LABEL[provider];
  return (
    <button
      className="btn danger"
      disabled={busy}
      onClick={async () => {
        if (!confirm(`Disconnect ${label}? Your trips stay in ${label}; if it holds your trips, they are copied to this PC first.`)) {
          return;
        }
        setBusy(true);
        await fetch(`/api/auth/${provider}/disconnect`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        await reloadConfig();
        await syncNow();
        setBusy(false);
      }}
    >
      Disconnect
    </button>
  );
}
