import { describe, expect, it } from "vitest";
import { computeClockNotes, homeTimeZone } from "./clock";
import { tripWith } from "./testUtils";
import { computeTripTimeline } from "./timeline";
import type { Item, Location } from "./types";

const at = (timeZone: string): Location => ({ lat: 0, lng: 0, timeZone });
const flight = (id: string, from: string, to: string, startTime: string, durationMin: number): Item => ({
  id,
  type: "transport",
  title: id,
  startTime,
  durationMin,
  location: at(from),
  transport: { kind: "flight", toLocation: at(to) },
});
const notes = (items: Item[][], startDate = "2027-01-10") => {
  const trip = tripWith(items);
  trip.startDate = startDate;
  const map = computeClockNotes(trip, computeTripTimeline(trip));
  return Object.fromEntries([...map].map(([id, list]) => [id, list.map((i) => `${i.level}: ${i.message}`)]));
};

describe("clock changes on journeys", () => {
  it("Warsaw → Doha → Bangkok: the real flight times, and jet lag once far from home", () => {
    expect(
      notes([
        [flight("QR260", "Europe/Warsaw", "Asia/Qatar", "14:40", 450)],
        [flight("QR834", "Asia/Qatar", "Asia/Bangkok", "02:00", 615)],
      ]),
    ).toEqual({
      QR260: ["info: 🕐 Clocks go forward 2 h on arrival – the flight itself takes 5h 30m."],
      QR834: [
        "info: 🕐 Clocks go forward 4 h on arrival – the flight itself takes 6h 15m.",
        "info: Local time here is 6 h ahead of home: for a day or two, mornings will feel like the middle of the night.",
      ],
    });
  });

  it("notices the hour between Mexico City and Cancún, and the long way west", () => {
    expect(
      notes(
        [
          [flight("LH498", "Europe/Berlin", "America/Mexico_City", "13:40", 320)],
          [flight("AM524", "America/Mexico_City", "America/Cancun", "12:10", 210)],
        ],
        "2027-02-13",
      ),
    ).toEqual({
      LH498: [
        "info: 🕐 Clocks go back 7 h on arrival – the flight itself takes 12h 20m.",
        "info: Local time here is 7 h behind home: for a day or two, you'll be tired early in the evening and awake before dawn.",
      ],
      AM524: ["info: 🕐 Clocks go forward 1 h on arrival – the flight itself takes 2h 30m."],
    });
  });

  it("flags an arrival time that doesn't add up and stays quiet without time zones", () => {
    expect(notes([[flight("bad", "Asia/Qatar", "Asia/Bangkok", "02:00", 120)]])).toEqual({
      bad: ["warn: With the +4 h time difference this flight would arrive before it leaves – check the local arrival time."],
    });
    const unknown = flight("x", "Asia/Qatar", "Asia/Bangkok", "02:00", 615);
    unknown.transport!.toLocation = { lat: 0, lng: 0 };
    expect(notes([[unknown]])).toEqual({});
  });

  it("takes home from the first journey with a known time zone", () => {
    const trip = tripWith([[{ id: "p", type: "place", title: "p", location: at("Asia/Tokyo") }], [flight("f", "Europe/Warsaw", "Asia/Qatar", "10:00", 300)]]);
    expect(homeTimeZone(trip)).toBe("Europe/Warsaw");
  });
});
