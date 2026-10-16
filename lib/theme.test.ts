import { describe, expect, it } from "vitest";
import { parseThemeChoice, resolveTheme, THEME_INIT_SCRIPT, THEME_KEY } from "./theme";

describe("parseThemeChoice", () => {
  it.each([
    ["light", "light"],
    ["dark", "dark"],
    ["system", "system"],
    [null, "system"],
    ["sepia", "system"],
  ])("%s → %s", (stored, choice) => {
    expect(parseThemeChoice(stored)).toBe(choice);
  });
});

describe("resolveTheme", () => {
  it("follows the system only for the System choice", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("THEME_INIT_SCRIPT", () => {
  /** Runs the <head> script against a stored value and returns the data-theme it set. */
  const run = (stored: string | null, storageThrows = false) => {
    const html = { dataset: {} as Record<string, string> };
    const localStorage = {
      getItem: (k: string) => {
        if (storageThrows) throw new Error("blocked");
        return k === THEME_KEY ? stored : null;
      },
    };
    new Function("document", "localStorage", THEME_INIT_SCRIPT)({ documentElement: html }, localStorage);
    return html.dataset.theme;
  };

  it("applies a saved Light or Dark choice", () => {
    expect(run("dark")).toBe("dark");
    expect(run("light")).toBe("light");
  });

  it("leaves the system setting in charge otherwise, even when storage is blocked", () => {
    expect(run(null)).toBeUndefined();
    expect(run("<img onerror>")).toBeUndefined();
    expect(run("dark", true)).toBeUndefined();
  });
});
