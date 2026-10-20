import { describe, expect, it } from "vitest";
import {
  dayDate,
  daysBetween,
  formatDayLabel,
  formatDistance,
  formatDuration,
  formatHm,
  isoDate,
  parseHm,
  zonedTimeToUtc,
} from "./time";

describe("parseHm", () => {
  it.each([
    ["09:00", 540],
    ["9:05", 545],
    [" 23:59 ", 1439],
    ["00:00", 0],
  ])("parses %j", (hm, minutes) => expect(parseHm(hm)).toBe(minutes));

  it.each([undefined, "", "24:00", "12:60", "noon", "9h"])("rejects %j", (hm) => expect(parseHm(hm)).toBeUndefined());
});

describe("formatHm", () => {
  it("formats times and marks the next day", () => {
    expect(formatHm(545)).toBe("09:05");
    expect(formatHm(1440 + 90)).toBe("01:30 +1");
    expect(formatHm(59.6)).toBe("01:00");
  });
});

describe("formatting", () => {
  it("shows durations and distances the way the board does", () => {
    expect([formatDuration(45), formatDuration(60), formatDuration(135)]).toEqual(["45 min", "1h", "2h 15m"]);
    expect([formatDistance(368), formatDistance(6800), formatDistance(23_400)]).toEqual(["368 m", "6.8 km", "23 km"]);
  });
});

describe("dates", () => {
  it("counts trip days in UTC across month and DST boundaries", () => {
    expect(isoDate(dayDate("2026-10-24", 2))).toBe("2026-10-26");
    expect(isoDate(dayDate("2027-01-30", 3))).toBe("2027-02-02");
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2);
    expect(daysBetween("2026-11-21", "2026-11-21")).toBe(0);
    expect(formatDayLabel(dayDate("2026-11-21", 0))).toBe("Sat 21 Nov");
  });
});

describe("zonedTimeToUtc", () => {
  it.each([
    ["2027-01-11", "12:45", "Asia/Bangkok", "2027-01-11T05:45:00.000Z"],
    ["2027-02-13", "19:20", "America/Mexico_City", "2027-02-14T01:20:00.000Z"],
    ["2027-01-10", "14:40", "Europe/Warsaw", "2027-01-10T13:40:00.000Z"],
    ["2027-07-01", "14:40", "Europe/Warsaw", "2027-07-01T12:40:00.000Z"],
  ])("%s %s in %s", (date, time, zone, utc) => expect(zonedTimeToUtc(date, time, zone).toISOString()).toBe(utc));
});
