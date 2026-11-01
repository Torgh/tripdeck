import { describe, expect, it } from "vitest";
import { DEFAULT_PRINT, parsePrintOptions, presetOf, PRINT_PARTS, PRINT_PRESETS } from "./printOptions";

describe("print options", () => {
  it("shows the whole itinerary but the ideas until something is changed", () => {
    expect(parsePrintOptions(null)).toEqual(DEFAULT_PRINT);
    expect(PRINT_PARTS.filter((p) => !DEFAULT_PRINT[p])).toEqual(["ideas"]);
  });

  it("keeps saved choices and fills in parts it doesn't know yet", () => {
    expect(parsePrintOptions(JSON.stringify({ prices: false, ideas: true }))).toEqual({
      ...DEFAULT_PRINT,
      prices: false,
      ideas: true,
    });
  });

  it("ignores broken or foreign values", () => {
    expect(parsePrintOptions("{not json")).toEqual(DEFAULT_PRINT);
    expect(parsePrintOptions(JSON.stringify({ prices: "no", other: false }))).toEqual(DEFAULT_PRINT);
    expect(parsePrintOptions("[]")).toEqual(DEFAULT_PRINT);
  });

  it("leaves prices, booking numbers and notes out of the version to share", () => {
    const off = PRINT_PARTS.filter((p) => !PRINT_PRESETS.share[p]);
    expect(off).toEqual(["prices", "references", "notes", "ideas"]);
    expect(PRINT_PARTS.every((p) => PRINT_PRESETS.full[p])).toBe(true);
  });

  it("names the preset the options match", () => {
    expect(presetOf(PRINT_PRESETS.full)).toBe("full");
    expect(presetOf(PRINT_PRESETS.share)).toBe("share");
    expect(presetOf(DEFAULT_PRINT)).toBeUndefined();
    expect(presetOf({ ...PRINT_PRESETS.share, map: false })).toBeUndefined();
  });
});
