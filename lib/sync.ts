"use client";

import { useEffect } from "react";
import { create } from "zustand";
import { ApiError } from "./api";
import { mergeTrips } from "./merge";
import type { StorageKind } from "./configStatus";
import { useStore } from "./store";
import { touch } from "./tripOps";
import type { Trip } from "./types";

export type SyncState =
  | { status: "idle" | "syncing" }
  | { status: "ok"; storage: StorageKind; email?: string; at: number }
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
 * Two-way sync between this browser and the server store (~/.tripdeck/trips, Google Drive or
 * OneDrive, as chosen in Settings). Edits made by Claude through MCP show up here and edits made
 * here are visible to Claude; when both sides changed a trip, push() merges them.
 */
export function syncNow(): Promise<void> {
  running ??= syncOnce().finally(() => (running = undefined));
  return running;
}

async function syncOnce() {
  const ui = useSyncState.getState();
  if (ui.state.status === "idle") ui.set({ status: "syncing" });
  try {
    const remote = await api<{ storage: StorageKind; email?: string; trips: Summary[] }>("/api/trips");
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
      const synced = useStore.getState().synced[r.id];
      const edited = !!local && local.updatedAt !== synced;
      if (edited && (synced || local.updatedAt > r.updatedAt)) {
        // push() merges in whatever changed on the server since `synced`.
        await push(local);
      } else if (!local || r.updatedAt !== synced) {
        const { trip } = await api<{ trip: Trip }>(`/api/trips/${r.id}`);
        // Skip if the user edited it locally while we were downloading; the next sync merges.
        const now = useStore.getState().trips[r.id];
        if (!now || now.updatedAt === local?.updatedAt) useStore.getState().receiveTrip(trip);
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
 * After switching storage (this PC, Google Drive, OneDrive or another account) the new target has never
 * seen our trips. Forget what was synced so they get uploaded instead of looking "deleted".
 */
function resetIfStorageChanged(target: string) {
  try {
    if (localStorage.getItem(STORAGE_KEY) === target) return;
    localStorage.setItem(STORAGE_KEY, target);
  } catch {
    return;
  }
  useStore.setState({ synced: {}, bases: {}, deleted: [] });
}

const MAX_MERGES = 3;

/**
 * Uploads a trip edited here. The server refuses it (409) when the trip changed there since this
 * browser last saw it – typically Claude adding cards through MCP while the board recomputed a route.
 * Then both edits are merged and the result is uploaded instead, so neither side's changes are lost.
 */
async function push(trip: Trip) {
  for (let attempt = 0; attempt <= MAX_MERGES; attempt++) {
    const base = useStore.getState().synced[trip.id];
    const res = await fetch(`/api/trips/${trip.id}${base ? `?base=${encodeURIComponent(base)}` : ""}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(trip),
    }).catch(() => {
      throw new ApiError("Offline – changes are kept in this browser.", 0);
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string; trip?: Trip };
    if (res.ok) {
      useStore.getState().markSynced(trip);
      return;
    }
    if (res.status !== 409 || !data.trip) throw new ApiError(data.error ?? `Sync failed (${res.status}).`, res.status);
    trip = adoptMerge(data.trip);
  }
  throw new ApiError("The trip keeps changing elsewhere – try again in a moment.", 409);
}

/** Merges the latest local copy with the server's `remote`, which becomes the new common ancestor. */
function adoptMerge(remote: Trip): Trip {
  const { trips, bases } = useStore.getState();
  const local = trips[remote.id];
  if (!local) return remote;
  const base = bases[remote.id];
  // Without a common ancestor (older data) fall back to the newer copy winning.
  const merged = base ? mergeTrips(base, local, remote) : local.updatedAt > remote.updatedAt ? local : remote;
  const next = touch(merged);
  useStore.setState((s) => ({
    trips: { ...s.trips, [remote.id]: next },
    synced: { ...s.synced, [remote.id]: remote.updatedAt },
    bases: { ...s.bases, [remote.id]: remote },
  }));
  return next;
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
