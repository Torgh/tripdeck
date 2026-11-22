import { describe, expect, it } from "vitest";
import { foldLine, icsText, tripCalendar } from "./ics";
import { tripShareHtml } from "./shareHtml";
import { tripWith } from "./testUtils";
import { computeTripTimeline } from "./timeline";
import type { Item, Trip } from "./types";

const flight: Item = {
  id: "fl",
  type: "transport",
  title: "Flight WAW → BKK",
  startTime: "14:40",
  durationMin: 600,
  transport: { kind: "flight", from: "WAW", to: "BKK", toLocation: { lat: 13.69, lng: 100.75, timeZone: "Asia/Bangkok" } },
  location: { lat: 52.16, lng: 20.97, address: "Chopin Airport, Warsaw", timeZone: "Europe/Warsaw" },
  booking: { provider: "Qatar Airways", reference: "7BVYOQ", price: "9646 PLN", paid: true, status: "confirmed" },
};
const hotel: Item = { id: "hotel", type: "stay", title: "Eastin Grand", stay: { nights: 2 }, booking: { status: "pending" } };
const market: Item = {
  id: "market",
  type: "place",
  title: "Market <night>",
  startTime: "18:00",
  durationMin: 120,
  notes: "Cash, small notes; bring a bag",
  booking: { onSite: "100 THB", cash: true },
};

function trip(): Trip {
  return tripWith([[flight], [hotel, market]]);
}
const now = new Date("2026-11-22T10:00:00Z");

describe("tripCalendar", () => {
  const t = trip();
  const ics = tripCalendar(t, computeTripTimeline(t), { now })!;
  const unfolded = ics.replace(/\r\n /g, "");

  it("is a valid calendar with CRLF lines of at most 75 bytes", () => {
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    for (const line of ics.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(unfolded.match(/BEGIN:VEVENT/g)).toHaveLength(3);
  });

  it("writes a flight in UTC from both airports' time zones, with a check-in alarm", () => {
    // 14:40 in Warsaw (UTC+2 in June); it lands 00:40 local (+1 day) in Bangkok (UTC+7).
    expect(unfolded).toContain("DTSTART:20260601T124000Z");
    expect(unfolded).toContain("DTEND:20260601T174000Z");
    expect(unfolded).toContain("TRIGGER:-P1D");
    expect(unfolded).toContain("DESCRIPTION:Confirmed\\nQatar Airways #7BVYOQ\\n9646 PLN ✓");
  });

  it("reads the next cards in the zone the flight arrived in, stays as all-day events", () => {
    expect(unfolded).toContain("DTSTART:20260602T110000Z"); // 18:00 in Bangkok
    expect(unfolded).toContain("DTSTART;VALUE=DATE:20260602\r\nDTEND;VALUE=DATE:20260604");
    expect(unfolded).toContain("DESCRIPTION:To pay on site: 100 THB (cash only)\\nCash\\, small notes\\; bring a bag");
  });

  it("uses floating times when no time zone is known, and has nothing for open dates", () => {
    const plain = tripWith([[market]]);
    expect(tripCalendar(plain, computeTripTimeline(plain), { now })).toContain("DTSTART:20260601T180000\r\n");
    const { startDate: _s, ...open } = plain;
    expect(tripCalendar(open, computeTripTimeline(open), { now })).toBeUndefined();
  });

  it("escapes text and folds long lines between characters", () => {
    expect(icsText("a,b;c\\d\ne")).toBe("a\\,b\\;c\\\\d\\ne");
    const folded = foldLine(`SUMMARY:${"ż".repeat(60)}`);
    expect(folded.split("\r\n ").join("")).toBe(`SUMMARY:${"ż".repeat(60)}`);
    for (const part of folded.split("\r\n")) expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
  });
});

describe("tripShareHtml", () => {
  const t = trip();
  const timelines = computeTripTimeline(t);

  it("shows the plan day by day, escaped, with what was chosen", () => {
    const html = tripShareHtml(t, timelines, { prices: false, references: true, notes: true, now });
    expect(html).toContain("<title>t</title>");
    expect(html).toContain("Market &lt;night&gt;");
    expect(html).toContain("#7BVYOQ");
    expect(html).not.toContain("9646 PLN");
    expect(html).toContain("Cash, small notes; bring a bag");
    expect(html).toContain("🌙 Eastin Grand · night 1 of 2");
  });

  it("leaves out references and notes, and shows prices, when asked", () => {
    const html = tripShareHtml(t, timelines, { prices: true, references: false, notes: false, now });
    expect(html).not.toContain("7BVYOQ");
    expect(html).not.toContain("small notes");
    expect(html).toContain("9646 PLN ✓ paid");
    expect(html).toContain("To pay on site: 100 THB (cash only)");
  });
});
