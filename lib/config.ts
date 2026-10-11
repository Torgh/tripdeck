"use client";

import { useEffect } from "react";
import { create } from "zustand";
import type { ConfigStatus } from "./configStatus";

const useConfigStore = create<{ config?: ConfigStatus; error?: string }>(() => ({}));

let loading: Promise<void> | undefined;

export function reloadConfig(): Promise<void> {
  loading = fetch("/api/config")
    .then(async (res) => {
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not load settings.");
      useConfigStore.setState({ config: data as ConfigStatus, error: undefined });
    })
    .catch((err: Error) => useConfigStore.setState({ error: err.message }));
  return loading;
}

/** Server-side settings status (AI on/off, maps provider, Google connection). */
export function useConfig(): ConfigStatus | undefined {
  const config = useConfigStore((s) => s.config);
  useEffect(() => {
    if (!loading) reloadConfig();
  }, []);
  return config;
}
