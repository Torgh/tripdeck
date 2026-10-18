/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The desktop app's Google Maps browser key, baked in at build time when present. */
  readonly NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?: string;
}
