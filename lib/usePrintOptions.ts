"use client";

import { useSyncExternalStore } from "react";
import { DEFAULT_PRINT, parsePrintOptions, PRINT_KEY, type PrintOptions } from "./printOptions";

const listeners = new Set<() => void>();

function readRaw(): string | null {
  try {
    return localStorage.getItem(PRINT_KEY);
  } catch {
    return null;
  }
}

// useSyncExternalStore needs the same object back while nothing changed.
let cache: { raw: string | null; options: PrintOptions } | undefined;
let unsaved: PrintOptions | undefined;

function snapshot(): PrintOptions {
  if (unsaved) return unsaved;
  const raw = readRaw();
  if (cache?.raw !== raw) cache = { raw, options: parsePrintOptions(raw) };
  return cache.options;
}

/** Applies the options now and remembers them for the next print. */
export function setPrintOptions(options: PrintOptions) {
  try {
    localStorage.setItem(PRINT_KEY, JSON.stringify(options));
    unsaved = undefined;
  } catch {
    // Storage blocked: the choice still applies until the page is reloaded.
    unsaved = options;
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => e.key === PRINT_KEY && listener();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** What the printable itinerary shows; the defaults during server rendering. */
export function usePrintOptions(): PrintOptions {
  return useSyncExternalStore(subscribe, snapshot, () => DEFAULT_PRINT);
}
