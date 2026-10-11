"use client";

import { useEffect } from "react";
import { create } from "zustand";
import { ApiError } from "./api";
import { useStore } from "./store";
import type { Trip } from "./types";

export type SyncState =
  | { status: "idle" | "syncing" }
  | { status: "ok"; storage: "drive" | "local"; email?: string; at: number }
  | { status: "error"; message: string };

export const useSyncState = create<{ state: SyncState; set: (s: SyncState) => void }>((set) => ({
  state: { status: "idle" },
  set: (state) => set({ state }),
}));

interface Summary {
  id: string;
  updatedAt: string;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  } catch {
    throw new ApiError("Offline – changes are kept in this browser.", 0);
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ApiError(data.error ?? `Sync failed (${res.status}).`, res.status);
  return data;
}

let running: Promise<void> | undefined;

/**
 * Two-way sync between this browser and the server store (Google Drive, or ~/.tripdeck/trips
 * before Google is connected). Per trip the newer `updatedAt` wins, so edits made by Claude
 * through MCP show up here and edits made here are visible to Claude.
 */
export function syncNow(): Promise<void> {
  running ??= syncOnce().finally(() => (running = undefined));
  return running;
}

async function syncOnce() {
  const ui = useSyncState.getState();
  if (ui.state.status === "idle") ui.set({ status: "syncing" });
  try {
    const remote = await api<{ storage: "drive" | "local"; email?: string; trips: Summary[] }>("/api/trips");
    resetIfStorageChanged(`${remote.storage}:${remote.email ?? ""}`);
    const s = useStore.getState();

    for (const id of s.deleted) {
      await api(`/api/trips/${id}`, { method: "DELETE" });
      useStore.getState().clearDeleted(id);
    }

    const remoteById = new Map(remote.trips.map((t) => [t.id, t.updatedAt]));
    for (const r of remote.trips) {
      if (s.deleted.includes(r.id)) continue;
      const local = useStore.getState().trips[r.id];
      if (!local || r.updatedAt > local.updatedAt) {
        const { trip } = await api<{ trip: Trip }>(`/api/trips/${r.id}`);
        // Skip if the user edited it locally while we were downloading.
        const now = useStore.getState().trips[r.id];
        if (!now || now.updatedAt === local?.updatedAt) useStore.getState().receiveTrip(trip);
      } else if (local.updatedAt > r.updatedAt) {
        await push(local);
      } else if (useStore.getState().synced[r.id] !== r.updatedAt) {
        useStore.getState().markSynced(r.id, r.updatedAt);
      }
    }

    for (const local of Object.values(useStore.getState().trips)) {
      if (remoteById.has(local.id)) continue;
      // Known to the server before but gone now: it was deleted elsewhere.
      if (useStore.getState().synced[local.id]) useStore.getState().dropTrip(local.id);
      else await push(local);
    }

    ui.set({ status: "ok", storage: remote.storage, email: remote.email, at: Date.now() });
  } catch (err) {
    ui.set({ status: "error", message: (err as Error).message });
  }
}

const STORAGE_KEY = "tripdeck.syncTarget";

/**
 * After switching between local storage and Drive (or Google accounts) the new target has never
 * seen our trips. Forget what was synced so they get uploaded instead of looking "deleted".
 */
function resetIfStorageChanged(target: string) {
  try {
    if (localStorage.getItem(STORAGE_KEY) === target) return;
    localStorage.setItem(STORAGE_KEY, target);
  } catch {
    return;
  }
  useStore.setState({ synced: {}, deleted: [] });
}

async function push(trip: Trip) {
  await api(`/api/trips/${trip.id}`, { method: "PUT", body: JSON.stringify(trip) });
  useStore.getState().markSynced(trip.id, trip.updatedAt);
}

const POLL_MS = 15_000;
const PUSH_DELAY_MS = 1_500;

/** Keeps the store in sync: on load, on focus, every 15 s, and shortly after local edits. */
export function useServerSync(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    syncNow();
    const timer = setInterval(syncNow, POLL_MS);
    const onFocus = () => document.visibilityState === "visible" && syncNow();
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);

    let pushTimer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = useStore.subscribe((s, prev) => {
      const changed =
        s.deleted !== prev.deleted ||
        Object.values(s.trips).some((t) => prev.trips[t.id] !== t && s.synced[t.id] !== t.updatedAt);
      if (!changed) return;
      clearTimeout(pushTimer);
      pushTimer = setTimeout(syncNow, PUSH_DELAY_MS);
    });

    return () => {
      clearInterval(timer);
      clearTimeout(pushTimer);
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("focus", onFocus);
      unsubscribe();
    };
  }, [enabled]);
}
