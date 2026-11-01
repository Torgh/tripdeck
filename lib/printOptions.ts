/** What the printable itinerary shows; each part can be left out of the PDF. */
export const PRINT_PARTS = [
  "map",
  "overview",
  "bookings",
  "prices",
  "references",
  "legs",
  "warnings",
  "notes",
  "addresses",
  "ideas",
] as const;

export type PrintPart = (typeof PRINT_PARTS)[number];
export type PrintOptions = Record<PrintPart, boolean>;

const all = (on: boolean) => Object.fromEntries(PRINT_PARTS.map((p) => [p, on])) as PrintOptions;

/** Until something is changed: the whole itinerary, without the unscheduled ideas. */
export const DEFAULT_PRINT: PrintOptions = { ...all(true), ideas: false };

export const PRINT_PRESETS = {
  /** Everything, ideas included. */
  full: all(true),
  /** For the people you travel with: no prices, booking numbers or personal notes. */
  share: { ...DEFAULT_PRINT, prices: false, references: false, notes: false },
} satisfies Record<string, PrintOptions>;

export type PrintPreset = keyof typeof PRINT_PRESETS;

/** localStorage key; like the theme, the choice is per browser. */
export const PRINT_KEY = "tripdeck-print";

/** Saved options, with defaults for anything missing or unreadable (and for parts added later). */
export function parsePrintOptions(value: string | null | undefined): PrintOptions {
  let saved: unknown;
  try {
    saved = value ? JSON.parse(value) : undefined;
  } catch {
    saved = undefined;
  }
  const out = { ...DEFAULT_PRINT };
  if (saved && typeof saved === "object") {
    for (const part of PRINT_PARTS) {
      const on = (saved as Record<string, unknown>)[part];
      if (typeof on === "boolean") out[part] = on;
    }
  }
  return out;
}

/** The preset these options match exactly, if any. */
export function presetOf(options: PrintOptions): PrintPreset | undefined {
  return (Object.keys(PRINT_PRESETS) as PrintPreset[]).find((name) =>
    PRINT_PARTS.every((p) => PRINT_PRESETS[name][p] === options[p]),
  );
}
