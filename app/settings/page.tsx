"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, useSyncExternalStore } from "react";
import { SyncBadge } from "@/components/SyncAgent";
import { LICENSE_URL, SOURCE_URL } from "@/lib/about";
import { reloadConfig, useConfig } from "@/lib/config";
import {
  CLOUD_PROVIDERS,
  STORAGE_LABEL,
  storageLabel,
  type CloudProvider,
  type ConfigKey,
  type ConfigStatus,
  type StorageKind,
} from "@/lib/configStatus";
import { LANG_NAME, LANGS } from "@/lib/i18n";
import { rich } from "@/lib/i18n/rich";
import { syncNow } from "@/lib/sync";
import { THEME_CHOICES } from "@/lib/theme";
import { setLang, useLang, useT } from "@/lib/useLang";
import { setThemeChoice, useThemeChoice } from "@/lib/useTheme";

/** The page's origin never changes, so there is nothing to subscribe to. */
const noSubscribe = () => () => undefined;

const b = (s: string) => <strong>{s}</strong>;
const code = (s: string) => <code>{s}</code>;
const link = (href: string) =>
  function ExternalLink(s: string) {
    return (
      <a href={href} target="_blank" rel="noreferrer">
        {s}
      </a>
    );
  };

export default function Page() {
  const t = useT();
  return (
    <Suspense fallback={<main className="home muted">{t("common.loading")}</main>}>
      <Settings />
    </Suspense>
  );
}

function Settings() {
  const t = useT();
  const config = useConfig();
  const params = useSearchParams();
  const origin = useSyncExternalStore(noSubscribe, () => window.location.origin, () => "");

  useEffect(() => {
    if (params.get("status") === "connected") {
      reloadConfig();
      syncNow();
    }
  }, [params]);

  if (!config) return <main className="home muted">{t("settings.loading")}</main>;

  const failed = params.get("status") === "error" ? params.get("provider") : null;
  const signInError =
    failed && (CLOUD_PROVIDERS as string[]).includes(failed)
      ? t("settings.signInFailed", { provider: STORAGE_LABEL[failed as CloudProvider], message: params.get("message") ?? "" })
      : null;

  return (
    <main className="home stack" style={{ gap: 20 }}>
      <header>
        <Link href="/" className="btn ghost" aria-label={t("common.back")}>
          ←
        </Link>
        <h1 className="grow">{t("common.settings")}</h1>
        <SyncBadge />
      </header>

      <section className="card stack">
        <h2>{t("settings.appearance")}</h2>
        <ThemePicker />
      </section>

      <section className="card stack">
        <h2>{t("settings.language")}</h2>
        <LangPicker />
      </section>

      <section className="card stack">
        <h2>{t("settings.storageTitle")}</h2>
        <p className="muted" style={{ margin: 0 }}>
          {rich(t("settings.storageIntro"), { b })}
        </p>
        {signInError && <div className="error">{signInError}</div>}
        <StoragePicker config={config} />
        <OneDriveFolder config={config} />
        <CloudAccount provider="google" config={config} origin={origin} />
      </section>

      <section className="card stack">
        <h2>{t("settings.mcpTitle")}</h2>
        <p className="muted" style={{ margin: 0 }}>
          {t("settings.mcpIntro")}
        </p>
        <McpSetup config={config} />
      </section>

      <section className="card stack">
        <h2>{t("settings.mapsTitle")}</h2>
        <p style={{ margin: 0 }}>
          {rich(t(config.mapsProvider === "google" ? "settings.mapsUsingGoogle" : "settings.mapsUsingOsm"), { b })}
          {t(config.googleMapsBrowserKey ? "settings.mapsGoogleMap" : "settings.mapsOsmMap")}
        </p>
        <details>
          <summary className="small">{t("settings.mapsOptional")}</summary>
          <div className="stack" style={{ marginTop: 10 }}>
            <p className="small muted" style={{ margin: 0 }}>
              {rich(t("settings.mapsHelp", { origin }), { code })}
            </p>
            <KeyForm
              config={config}
              fields={[
                { key: "googleMapsServerKey", label: t("settings.serverKey"), secret: true },
                { key: "googleMapsBrowserKey", label: t("settings.browserKey"), secret: false },
                { key: "googleMapId", label: t("settings.mapId"), secret: false },
              ]}
            />
          </div>
        </details>
      </section>

      <section className="card stack">
        <h2>{t("settings.aiTitle")}</h2>
        <p className="muted" style={{ margin: 0 }}>
          {t("settings.aiIntro")}
        </p>
        <KeyForm config={config} fields={[{ key: "anthropicApiKey", label: t("settings.anthropicKey"), secret: true }]} />
      </section>

      <section className="card stack">
        <h2>{t("settings.aboutTitle")}</h2>
        <p className="small" style={{ margin: 0 }}>
          {rich(t("settings.license"), { a: link(LICENSE_URL) })}
        </p>
        <p className="small" style={{ margin: 0 }}>
          {t("settings.sourceCode")}{" "}
          <a href={SOURCE_URL} target="_blank" rel="noreferrer">
            {SOURCE_URL.replace("https://", "")}
          </a>
        </p>
      </section>
    </main>
  );
}

const THEME_ICON = { system: "🖥️", light: "☀️", dark: "🌙" } as const;

function ThemePicker() {
  const t = useT();
  const choice = useThemeChoice();
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row" role="radiogroup" aria-label={t("settings.themeLabel")}>
        {THEME_CHOICES.map((c) => (
          <button
            key={c}
            role="radio"
            aria-checked={choice === c}
            className={`btn${choice === c ? " primary" : ""}`}
            onClick={() => setThemeChoice(c)}
          >
            {THEME_ICON[c]} {t(`theme.${c}`)}
          </button>
        ))}
      </div>
      <span className="small muted">{t(choice === "system" ? "settings.themeSystem" : "settings.themeSaved")}</span>
    </div>
  );
}

function LangPicker() {
  const t = useT();
  const lang = useLang();
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row" role="radiogroup" aria-label={t("settings.language")}>
        {LANGS.map((l) => (
          <button
            key={l}
            role="radio"
            lang={l}
            aria-checked={lang === l}
            className={`btn${lang === l ? " primary" : ""}`}
            onClick={() => setLang(l)}
          >
            {LANG_NAME[l]}
          </button>
        ))}
      </div>
      <span className="small muted">{t("settings.languageNote")}</span>
    </div>
  );
}

function StoragePicker({ config }: { config: ConfigStatus }) {
  const t = useT();
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
      if (!res.ok) throw new Error(data.error ?? t("settings.switchFailed"));
      await reloadConfig();
      await syncNow();
      setState({ message: data.copied ? t("settings.copiedTrips", { n: data.copied }) : t("settings.switched") });
    } catch (err) {
      setState({ error: (err as Error).message });
    }
  };

  const google = config.cloud.google;
  const options: { kind: StorageKind; where: string; available: boolean }[] = [
    { kind: "local", where: `${config.dataDir}${config.dataDir.includes("\\") ? "\\" : "/"}trips`, available: true },
    {
      kind: "onedrive",
      where: config.oneDriveFolder ?? t("settings.oneDriveMissing"),
      available: !!config.oneDriveFolder,
    },
    {
      kind: "google",
      where: !google.connected
        ? t("settings.connectFirst")
        : `${t(google.needsReconnect ? "settings.hiddenFolder" : "settings.myDrive")}${google.email ? ` · ${google.email}` : ""}`,
      available: google.connected,
    },
  ];

  return (
    <div className="stack" style={{ gap: 6 }} role="radiogroup" aria-label={t("settings.storageLabel")}>
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
              {o.kind === "local" ? "💾" : "☁"} {storageLabel(o.kind, t)}
            </strong>{" "}
            <span className="small muted">{state.busy === o.kind ? t("settings.copying") : o.where}</span>
          </span>
        </label>
      ))}
      {state.message && <span className="small">{state.message}</span>}
      {state.error && <span className="small" style={{ color: "var(--danger)" }}>{state.error}</span>}
      {config.storage === "google" && config.cloud.google.needsReconnect && (
        <div className="error">{rich(t("settings.stillHidden"), { b })}</div>
      )}
    </div>
  );
}

function OneDriveFolder({ config }: { config: ConfigStatus }) {
  const t = useT();
  return (
    <details open={!config.oneDriveFolder}>
      <summary>
        <strong>OneDrive</strong>{" "}
        <span className="small muted">{t(config.oneDriveFolder ? "settings.oneDriveFound" : "settings.oneDriveNotFound")}</span>
      </summary>
      <div className="stack" style={{ marginTop: 10 }}>
        <p className="small muted" style={{ margin: 0 }}>
          {rich(t("settings.oneDriveHelp"), { b, code })}
        </p>
        <KeyForm config={config} fields={[{ key: "oneDriveFolder", label: t("settings.oneDriveFolder"), secret: false }]} />
      </div>
    </details>
  );
}

function CloudAccount({ provider, config, origin }: { provider: CloudProvider; config: ConfigStatus; origin: string }) {
  const t = useT();
  const account = config.cloud[provider];
  const label = STORAGE_LABEL[provider];
  const connect = (
    <a
      className={`btn${account.connected && !account.needsReconnect ? "" : " primary"}`}
      href={account.clientConfigured ? `/api/auth/${provider}/start` : undefined}
      aria-disabled={!account.clientConfigured}
      style={account.clientConfigured ? undefined : { opacity: 0.5, pointerEvents: "none" }}
    >
      {account.connected ? t("settings.reconnect") : t("settings.connect", { provider: label })}
    </a>
  );
  return (
    <details open={!account.connected || account.needsReconnect}>
      <summary>
        <strong>{label}</strong>{" "}
        <span className="small muted">
          {account.connected
            ? account.email
              ? t("settings.connectedAs", { email: account.email })
              : t("settings.connected")
            : t("settings.notConnected")}
        </span>
      </summary>
      <div className="stack" style={{ marginTop: 10 }}>
        {account.connected ? (
          <div className="row">
            <button className="btn" onClick={() => syncNow()}>
              {t("settings.syncNow")}
            </button>
            {connect}
            <DisconnectButton provider={provider} />
          </div>
        ) : (
          <>
            <GoogleClientSetup config={config} origin={origin} />
            <div className="row">
              {connect}
              {!account.clientConfigured && <span className="small muted">{t("settings.clientFirst")}</span>}
            </div>
          </>
        )}
      </div>
    </details>
  );
}

function GoogleClientSetup({ config, origin }: { config: ConfigStatus; origin: string }) {
  const t = useT();
  const redirect = `${origin}/api/auth/google/callback`;
  const em = (s: string) => <em>{s}</em>;
  return (
    <details open={!config.cloud.google.clientConfigured}>
      <summary className="small">{t("settings.googleSetup")}</summary>
      <ol className="small" style={{ paddingLeft: 18, display: "grid", gap: 6 }}>
        <li>{rich(t("settings.googleStep1"), { a: link("https://console.cloud.google.com/apis/library/drive.googleapis.com"), b })}</li>
        <li>{rich(t("settings.googleStep2"), { a: link("https://console.cloud.google.com/auth/branding"), b, i: em })}</li>
        <li>
          {rich(t("settings.googleStep3"), { a: link("https://console.cloud.google.com/auth/clients"), b })}
          <CopyField value={redirect} />
        </li>
        <li>{t("settings.googleStep4")}</li>
      </ol>
      <KeyForm
        config={config}
        fields={[
          { key: "googleClientId", label: t("settings.clientId"), secret: false },
          { key: "googleClientSecret", label: t("settings.clientSecret"), secret: true },
        ]}
      />
    </details>
  );
}

function McpSetup({ config }: { config: ConfigStatus }) {
  const t = useT();
  const quote = (s: string) => (/\s/.test(s) ? `"${s}"` : s);
  const cmd = [config.mcp.command, ...config.mcp.args].map(quote).join(" ");
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div>
        {rich(t("settings.mcpClaudeCode"), { b })}
        <CopyField value={`claude mcp add --scope user tripdeck -- ${cmd}`} />
      </div>
      <div>
        {rich(t("settings.mcpCodex"), { b })}
        <CopyField value={`codex mcp add tripdeck -- ${cmd}`} />
      </div>
      <div>
        {rich(t("settings.mcpDesktop"), { b, code })}
        <CopyField
          value={JSON.stringify({ tripdeck: { command: config.mcp.command, args: config.mcp.args } }, null, 2)}
          multiline
        />
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        {t("settings.mcpExamples")} <code>/mcp__tripdeck__plan-day</code>, <code>/mcp__tripdeck__import-bookings</code>.
      </p>
    </div>
  );
}

function CopyField({ value, multiline }: { value: string; multiline?: boolean }) {
  const t = useT();
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
        {copied ? t("common.copied") : t("common.copy")}
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
  const t = useT();
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
      if (!res.ok) throw new Error(data.error ?? t("settings.savingFailed"));
      setValues({});
      await reloadConfig();
      setState({ saving: false, message: t("common.saved") });
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
              {f.label} {fromEnv ? t("settings.fromEnv") : isSet ? t("settings.keySaved") : ""}
            </span>
            <div className="row">
              <input
                type={f.secret ? "password" : "text"}
                autoComplete="off"
                disabled={fromEnv}
                placeholder={isSet ? t(f.secret ? "settings.keepSecret" : "settings.replace") : ""}
                value={values[f.key] ?? ""}
                onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
              />
              {isSet && !fromEnv && (
                <button className="btn small ghost danger" title={t("common.remove")} onClick={() => save({ [f.key]: "" })}>
                  {t("common.remove")}
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
          {t("common.save")}
        </button>
        {state.message && <span className="small">{state.message}</span>}
        {state.error && <span className="small" style={{ color: "var(--danger)" }}>{state.error}</span>}
      </div>
      <span className="small muted">{t("settings.storedAt", { path: `${config.dataDir}/config.json` })}</span>
    </div>
  );
}

function DisconnectButton({ provider }: { provider: CloudProvider }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const label = STORAGE_LABEL[provider];
  return (
    <button
      className="btn danger"
      disabled={busy}
      onClick={async () => {
        if (!confirm(t("settings.disconnectConfirm", { provider: label }))) {
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
      {t("settings.disconnect")}
    </button>
  );
}
