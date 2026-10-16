/** "system" follows the operating system's light / dark setting. */
export type ThemeChoice = "system" | "light" | "dark";
export type Theme = "light" | "dark";

export const THEME_CHOICES: ThemeChoice[] = ["system", "light", "dark"];
export const THEME_LABEL: Record<ThemeChoice, string> = { system: "System", light: "Light", dark: "Dark" };

/** localStorage key; the choice is per browser, like the trips' local copy. */
export const THEME_KEY = "tripdeck-theme";
export const DARK_QUERY = "(prefers-color-scheme: dark)";

export function parseThemeChoice(value: string | null | undefined): ThemeChoice {
  return value === "light" || value === "dark" ? value : "system";
}

export function resolveTheme(choice: ThemeChoice, systemDark: boolean): Theme {
  return choice === "system" ? (systemDark ? "dark" : "light") : choice;
}

/**
 * Runs in <head> before the first paint, so a saved Light / Dark choice never flashes the other
 * theme. CSS reads `data-theme` on <html>; without it the system setting applies.
 */
export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;
