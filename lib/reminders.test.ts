import { describe, expect, it } from "vitest";
import { reminderNumber, tripReminders, wallTime } from "./reminders";
import { tripWith } from "./testUtils";
import { computeTripTimeline } from "./timeline";
import type { Item, Trip } from "./types";

const flight: Item = {
  id: "fl",
  type: "transport",
  title: "Flight WAW → DOH",
  startTime: "14:40",
  durationMin: 330,
  transport: { kind: "flight" },
  booking: { reference: "7BVYOQ", status: "confirmed" },
  location: { lat: 52.16, lng: 20.97, timeZone: "Europe/Warsaw" },
};
const tour: Item = {
  id: "tour",
  type: "activity",
  title: "Tolantongo tour",
  startTime: "05:30",
  durationMin: 840,
  booking: { onSite: "600 MXN", cash: true },
};
const cenote: Item = { id: "cenote", type: "place", title: "Cenote", booking: { onSite: "200 MXN", cash: true } };
const ferry: Item = { id: "ferry", type: "transport", title: "Ferry", transport: { kind: "ferry" }, booking: { status: "todo" } };
const scooter: Item = {
  id: "scooter",
  type: "rental",
  title: "Honda ADV",
  startTime: "18:00",
  rental: { vehicle: "scooter", days: 2, returnTime: "18:00", returnPlace: "Hotel" },
};

function trip(): Trip {
  const t = tripWith([[flight], [tour, cenote], [scooter, ferry], []]);
  t.entry = {
    passports: ["PL"],
    routeKey: "",
    checkedAt: "2026-05-01T00:00:00Z",
    countries: [
      {
        code: "TH",
        name: "Thailand",
        summary: "",
        sources: [],
        requirements: [
          { kind: "arrival_form", level: "action", title: "TDAC", dueBy: "2026-06-01" },
          { kind: "visa", level: "action", title: "Done already", dueBy: "2026-06-01", done: true },
        ],
      },
    ],
  };
  return t;
}

const before = new Date("2026-05-01T00:00:00Z");

describe("tripReminders", () => {
  const plan = trip();
  const reminders = tripReminders(plan, computeTripTimeline(plan), "en", before);
  const byKey = new Map(reminders.map((r) => [r.key, r]));

  it("reminds of online check-in 24 h before the flight, in the airport's time zone", () => {
    const r = byKey.get("checkin:fl")!;
    expect(r.at.toISOString()).toBe("2026-05-31T12:40:00.000Z"); // 14:40 in Warsaw (UTC+2) the day before
    expect(r.title).toBe("✈️ Online check-in: Flight WAW → DOH");
    expect(r.body).toBe("Leaves tomorrow at 14:40 (local time) · booking 7BVYOQ");
  });

  it("sums up tomorrow's fixed times and the cash it needs the evening before", () => {
    const r = byKey.get(`tomorrow:${plan.days[1].id}`)!;
    expect(r.at.getHours()).toBe(19);
    expect(r.at.getDate()).toBe(1);
    expect(r.title).toBe("Tomorrow – Day 2 · Tue 2 Jun");
    expect(r.body).toBe("05:30 🎟️ Tolantongo tour\n💵 bring MX$800 in cash");
  });

  it("reminds to take a rental back two hours before, and bookings still to make a week before", () => {
    const back = byKey.get("return:scooter")!;
    expect([back.at.getDate(), back.at.getHours()]).toEqual([5, 16]);
    expect(back.body).toBe("back by 18:00 · Hotel");
    const ferryTodo = byKey.get("booking:ferry")!;
    expect(ferryTodo.title).toBe("📝 Still to book: Ferry");
    expect(ferryTodo.at.getDate()).toBe(27);
  });

  it("reminds of formalities not done yet, three days before their deadline", () => {
    const entry = reminders.filter((r) => r.kind === "entry");
    expect(entry.map((r) => r.title)).toEqual(["🛂 TDAC"]);
    expect(entry[0].at.getDate()).toBe(29);
  });

  it("keeps only what is still to come, soonest first", () => {
    const later = tripReminders(plan, computeTripTimeline(plan), "en", new Date(2026, 5, 2, 12));
    expect(later.map((r) => r.kind)).toEqual(["tomorrow", "return"]);
    const times = reminders.map((r) => r.at.getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it("has none while the dates are open", () => {
    const { startDate: _s, ...open } = trip();
    expect(tripReminders(open, computeTripTimeline(open), "en", before)).toEqual([]);
  });
});

describe("helpers", () => {
  it("turns a wall-clock time into an instant, past midnight too", () => {
    expect(wallTime("2026-06-01", 25 * 60, "Asia/Bangkok").toISOString()).toBe("2026-06-01T18:00:00.000Z");
  });

  it("gives each reminder a stable positive notification number", () => {
    const n = reminderNumber("trip1", "checkin:fl");
    expect(n).toBe(reminderNumber("trip1", "checkin:fl"));
    expect(n).not.toBe(reminderNumber("trip2", "checkin:fl"));
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(2 ** 31);
  });
});
