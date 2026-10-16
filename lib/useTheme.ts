"use client";

import { useSyncExternalStore } from "react";
import { DARK_QUERY, parseThemeChoice, resolveTheme, THEME_KEY, type Theme, type ThemeChoice } from "./theme";

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function readThemeChoice(): ThemeChoice {
  try {
    return parseThemeChoice(localStorage.getItem(THEME_KEY));
  } catch {
    return "system";
  }
}

function applyChoice(choice: ThemeChoice) {
  if (choice === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = choice;
}

/** Shows the theme now and, unless `save` is false, remembers it for the next visit. */
export function setThemeChoice(choice: ThemeChoice, { save = true } = {}) {
  if (save) {
    try {
      if (choice === "system") localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, choice);
    } catch {
      // Storage blocked: the choice still applies until the page is reloaded.
    }
  }
  applyChoice(choice);
  notify();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const media = window.matchMedia(DARK_QUERY);
  // Another tab changed the choice, or the OS switched between light and dark.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== THEME_KEY) return;
    applyChoice(parseThemeChoice(e.newValue));
    listener();
  };
  window.addEventListener("storage", onStorage);
  media.addEventListener("change", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
    media.removeEventListener("change", listener);
  };
}

/** The saved choice; "system" during server rendering. */
export function useThemeChoice(): ThemeChoice {
  return useSyncExternalStore(subscribe, readThemeChoice, () => "system");
}

/** The theme actually shown, for things CSS cannot reach (e.g. the Google map). Light on the server. */
export function useTheme(): Theme {
  return useSyncExternalStore(
    subscribe,
    () => resolveTheme(readThemeChoice(), window.matchMedia(DARK_QUERY).matches),
    () => "light",
  );
}
