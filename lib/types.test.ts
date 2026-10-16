import { describe, expect, it } from "vitest";
import { itemIcon, legKey } from "./types";

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
