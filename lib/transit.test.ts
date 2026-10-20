import { describe, expect, it } from "vitest";
import { legRouteTime, transitStepLine, vehicleIcon } from "./transit";

describe("legRouteTime", () => {
  it("asks for the leg's local date and time, in five-minute steps", () => {
    expect(legRouteTime("2027-01-10", 1, { legAt: { min: 12 * 60 + 47, arriveBy: false } }, "2026-10-20")).toEqual({
      date: "2027-01-11",
      time: "12:45",
      arriveBy: undefined,
    });
  });

  it("rolls past midnight into the next day and keeps arrive-by", () => {
    expect(legRouteTime("2027-01-10", 1, { legAt: { min: 1440 + 30, arriveBy: true } }, "2026-10-20")).toEqual({
      date: "2027-01-12",
      time: "00:30",
      arriveBy: true,
    });
  });

  it("leaves out legs without a time and trips in the past", () => {
    expect(legRouteTime("2027-01-10", 0, {}, "2026-10-20")).toBeUndefined();
    expect(legRouteTime("2025-01-10", 0, { legAt: { min: 600, arriveBy: false } }, "2026-10-20")).toBeUndefined();
  });
});

describe("transit labels", () => {
  it("names a ride with its time, line and stops", () => {
    expect(
      transitStepLine({ vehicle: "HEAVY_RAIL", line: "ARL", from: "Suvarnabhumi", to: "Phaya Thai", stops: 7, departs: "13:53" }),
    ).toBe("13:53 🚆 ARL: Suvarnabhumi → Phaya Thai (7 stops)");
    expect(transitStepLine({ vehicle: "BUS", line: "29", from: "A", to: "B", stops: 1 })).toBe("🚌 29: A → B (1 stop)");
    expect(vehicleIcon("SOMETHING_NEW")).toBe("🚉");
  });
});
