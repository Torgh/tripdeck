"use client";

import { useEffect } from "react";

/** Registers the offline service worker in production builds, once per build (see next.config.ts). */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register(`/sw.js?v=${process.env.TRIPDECK_BUILD}`).catch((err) => console.warn("Service worker registration failed", err));
  }, []);
  return null;
}
