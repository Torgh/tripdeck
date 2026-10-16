"use client";

import { useLayoutEffect } from "react";
import { readThemeChoice, setThemeChoice } from "@/lib/useTheme";

/**
 * Re-applies the saved theme after hydration. The inline script in the layout sets it before the
 * first paint, but React's development remount resets <html> attributes; in production this is a no-op.
 */
export function ThemeAgent() {
  useLayoutEffect(() => {
    setThemeChoice(readThemeChoice(), { save: false });
  }, []);
  return null;
}
