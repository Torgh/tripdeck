"use client";

import Link from "next/link";
import { STORAGE_LABEL } from "@/lib/configStatus";
import { useHydrated } from "@/lib/hooks";
import { useServerSync, useSyncState } from "@/lib/sync";
import { useT } from "@/lib/useLang";

/** Mounted once in the layout: hydrates the local store and keeps it in sync with the server. */
export function SyncAgent() {
  const hydrated = useHydrated();
  useServerSync(hydrated);
  return null;
}

/** Small status pill: where trips are saved and whether the last sync worked. */
export function SyncBadge() {
  const t = useT();
  const state = useSyncState((s) => s.state);
  const label =
    state.status === "ok"
      ? state.storage === "local"
        ? t("sync.savedLocal")
        : `☁ ${STORAGE_LABEL[state.storage]}${state.email ? ` · ${state.email}` : ""}`
      : state.status === "error"
        ? t("sync.notSynced")
        : t("sync.syncing");
  return (
    <Link
      href="/settings"
      className="badge"
      style={{ textDecoration: "none", whiteSpace: "nowrap" }}
      title={state.status === "error" ? state.message : t("sync.settings")}
    >
      {label}
    </Link>
  );
}
