import { describe, expect, it } from "vitest";
import { diveGas, divePrepUrl, itemIcon, legKey } from "./types";

describe("itemIcon", () => {
  it("shows the vehicle of a rental and the kind of transport", () => {
    expect(itemIcon({ type: "rental", rental: { vehicle: "scooter", days: 2 } })).toBe("🛵");
    expect(itemIcon({ type: "rental", rental: { vehicle: "bicycle", days: 1 } })).toBe("🚲");
    expect(itemIcon({ type: "transport", transport: { kind: "ferry" } })).toBe("⛴️");
  });

  it("falls back to the card type", () => {
    expect(itemIcon({ type: "rental" })).toBe("🔑");
    expect(itemIcon({ type: "transport" })).toBe("✈️");
    expect(itemIcon({ type: "stay" })).toBe("🏨");
  });
});

describe("legKey", () => {
  it("joins both card ids", () => {
    expect(legKey("a", "b")).toBe("a>b");
  });
});

describe("dives", () => {
  it("names the gas by its mix once known", () => {
    expect(diveGas({ gas: "nitrox" })).toBe("nitrox");
    expect(diveGas({ gas: "nitrox", mix: " EAN32 " })).toBe("EAN32");
    expect(diveGas({ gas: "trimix", mix: "  " })).toBe("trimix");
  });

  it("opens only web links from a preparation", () => {
    expect(divePrepUrl({ url: "http://localhost:3001/trips/t#card-a" })).toBe("http://localhost:3001/trips/t#card-a");
    expect(divePrepUrl({ url: "HTTPS://example.com" })).toBe("HTTPS://example.com");
    expect(divePrepUrl({ url: "javascript:alert(1)" })).toBeUndefined();
    expect(divePrepUrl({})).toBeUndefined();
  });
});
