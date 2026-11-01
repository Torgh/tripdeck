"use client";

import { useMemo, useSyncExternalStore } from "react";
import { detectLang, LANG_KEY, parseLang, translator, type Lang, type T } from "./i18n";

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** The saved language, else the first of the browser's (or phone's) languages TripDeck speaks. */
export function readLang(): Lang {
  try {
    const saved = parseLang(localStorage.getItem(LANG_KEY));
    if (saved) return saved;
  } catch {
    // Storage blocked: fall back to the browser's languages.
  }
  return detectLang(navigator.languages?.length ? navigator.languages : [navigator.language]);
}

/** Shows the app in `lang` now and remembers it for the next visit. */
export function setLang(lang: Lang) {
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    // Storage blocked: the language still applies until the page is reloaded.
  }
  document.documentElement.lang = lang;
  notify();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Another tab changed the language, or the browser's languages changed.
  const onStorage = (e: StorageEvent) => e.key === LANG_KEY && listener();
  window.addEventListener("storage", onStorage);
  window.addEventListener("languagechange", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("languagechange", listener);
  };
}

/** The app's language; English during server rendering. */
export function useLang(): Lang {
  return useSyncExternalStore(subscribe, readLang, () => "en");
}

/** `t("key", params)` in the app's language. */
export function useT(): T {
  const lang = useLang();
  return useMemo(() => translator(lang), [lang]);
}
