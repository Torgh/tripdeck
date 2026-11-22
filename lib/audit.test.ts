import { describe, expect, it } from "vitest";
import { auditTrip, statusFromNotes } from "./audit";
import { tripWith } from "./testUtils";
import { computeTripTimeline } from "./timeline";
import { tripTodos } from "./todo";
import type { Item, Trip } from "./types";

const at = (lat: number, lng: number) => ({ lat, lng });

const ferry: Item = {
  id: "ferry",
  type: "transport",
  title: "Ferry to Cozumel",
  location: at(20.62, -87.07),
  transport: { kind: "ferry", from: "Playa", to: "Cozumel" },
  notes: "Not booked yet. Crossing ~45 min.",
};
const hotel: Item = {
  id: "hotel",
  type: "stay",
  title: "Casa Mel",
  location: at(20.51, -86.94),
  stay: { nights: 1 },
  booking: { provider: "Booking.com", price: "1669 zł", status: "confirmed" },
  notes: "Booking number not visible in the screenshot.",
};
const dives: Item = {
  id: "dives",
  type: "dive",
  title: "Big Blue day 1",
  location: at(10.1, 99.83),
  dive: { dives: 2, gas: "air" },
  booking: { reference: "BBD-1", price: "7500", paid: true },
  notes: "Payment received – NOT yet confirmed.",
};
const lunch: Item = { id: "lunch", type: "food", title: "Lunch" };

function trip(): Trip {
  return tripWith([[ferry, hotel], [dives, lunch]]);
}

describe("statusFromNotes", () => {
  it("reads what the notes say about the booking, in English, Polish and Spanish", () => {
    expect(statusFromNotes("Not booked yet. Operators: Ultramar")).toBe("todo");
    expect(statusFromNotes("Payment received – NOT yet confirmed")).toBe("pending");
    expect(statusFromNotes("Jeszcze niezarezerwowane")).toBe("todo");
    expect(statusFromNotes("Wpłacone, jeszcze niepotwierdzone")).toBe("pending");
    expect(statusFromNotes("Pago hecho, sin confirmar")).toBe("pending");
    expect(statusFromNotes("Not yet confirmed – now confirmed on 3 Jan")).toBeUndefined();
    expect(statusFromNotes("Confirmed. Non-refundable.")).toBeUndefined();
    expect(statusFromNotes(undefined)).toBeUndefined();
    // About the price, not the booking.
    expect(statusFromNotes("Ferry ~110–120 MXN one way – unconfirmed")).toBeUndefined();
  });
});

describe("auditTrip", () => {
  const t = trip();
  const findings = auditTrip(t, computeTripTimeline(t));
  // Without a routing service every leg is an estimate here; those are checked on their own below.
  const kinds = (id: string) =>
    findings
      .filter((f) => f.itemId === id && f.kind !== "estimated-leg")
      .map((f) => f.kind)
      .sort();

  it("finds notes that contradict the booking status, with the fix", () => {
    const f = findings.find((x) => x.kind === "status-vs-notes" && x.itemId === "ferry")!;
    expect(f.level).toBe("fix");
    expect(f.fix).toContain('booking.status "todo"');
    expect(findings.find((x) => x.kind === "status-vs-notes" && x.itemId === "dives")?.fix).toContain('"pending"');
  });

  it("finds missing booking numbers, arrival places, locations and currencies", () => {
    expect(kinds("hotel")).toEqual(["no-reference"]);
    expect(kinds("ferry")).toEqual(["no-arrival", "status-vs-notes"]);
    expect(kinds("lunch")).toEqual(["no-location"]);
    expect(kinds("dives")).toEqual(["no-currency", "status-vs-notes"]);
  });

  it("flags travel times that are only straight-line estimates", () => {
    const leg = findings.find((f) => f.kind === "estimated-leg" && f.itemId === "hotel")!;
    expect(leg.level).toBe("check");
    expect(leg.message).toMatch(/Ferry to Cozumel → Casa Mel .* only estimated/);
  });

  it("puts what to fix first", () => {
    const levels = findings.map((f) => f.level);
    expect(levels.indexOf("check")).toBeGreaterThan(levels.lastIndexOf("fix"));
    expect(findings.some((f) => f.kind === "entry" && f.level === "info")).toBe(true);
  });

  it("finds nothing to fix in a tidy plan", () => {
    const tidy = tripWith([
      [{ ...hotel, booking: { ...hotel.booking, reference: "123" }, notes: undefined, stay: { nights: 2 } }],
      [{ ...lunch, location: at(20.51, -86.95) }],
    ]);
    tidy.entry = { passports: ["PL"], routeKey: "", checkedAt: "", countries: [] };
    tidy.passports = ["PL"];
    expect(auditTrip(tidy, computeTripTimeline(tidy)).filter((f) => f.level === "fix")).toEqual([]);
  });
});

describe("tripTodos", () => {
  it("lists a booking without its number as something to sort out", () => {
    const todos = tripTodos(trip());
    expect(todos.filter((x) => x.kind === "reference").map((x) => x.kind === "reference" && x.item.id)).toEqual(["hotel"]);
  });
});
