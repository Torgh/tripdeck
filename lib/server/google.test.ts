import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

/** Where the answers are cached; emptied after each test. */
const home = vi.hoisted(() => `${process.env.TMPDIR ?? process.env.TEMP ?? "/tmp"}/tripdeck-google-test-${process.pid}`);
vi.mock("./config", () => ({ DATA_DIR: home, readConfig: () => ({ googleMapsServerKey: "key" }) }));

const { computeRoute, elevations, routeMatrix } = await import("./google");

const airport = { lat: 13.6819, lng: 100.74687 };
const hotel = { lat: 13.71842, lng: 100.52195 };

/** Answers the Time Zone API with Bangkok and the Routes API with `routes`, recording the route requests. */
function mockGoogle(routes: unknown[]) {
  const sent: { body: Record<string, unknown>; fieldMask: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (String(url).includes("/timezone/")) return Response.json({ status: "OK", timeZoneId: "Asia/Bangkok" });
      const headers = init!.headers as Record<string, string>;
      sent.push({ body: JSON.parse(String(init!.body)), fieldMask: headers["X-Goog-FieldMask"] });
      return Response.json({ routes });
    }),
  );
  return sent;
}

afterEach(() => {
  vi.unstubAllGlobals();
  fs.rmSync(home, { recursive: true, force: true });
});

describe("computeRoute with public transport", () => {
  it("plans for the local time in the plan and lists the rides", async () => {
    const sent = mockGoogle([
      {
        duration: "7800s",
        distanceMeters: 32000,
        legs: [
          {
            steps: [
              { travelMode: "WALK", staticDuration: "300s" },
              {
                travelMode: "TRANSIT",
                polyline: { encodedPolyline: "abc" },
                transitDetails: {
                  stopCount: 7,
                  headsign: "Phaya Thai",
                  stopDetails: { departureStop: { name: "Suvarnabhumi" }, arrivalStop: { name: "Phaya Thai" } },
                  localizedValues: { departureTime: { time: { text: "13:53" } }, arrivalTime: { time: { text: "14:20" } } },
                  transitLine: { name: "ARL : Phaya Thai - Suvarnabhumi", color: "#a1171c", vehicle: { type: "HEAVY_RAIL" } },
                },
              },
              { travelMode: "WALK", staticDuration: "240s" },
              {
                travelMode: "TRANSIT",
                transitDetails: {
                  stopCount: 5,
                  stopDetails: {
                    departureStop: { name: "Siam" },
                    arrivalStop: { name: "Surasak" },
                    departureTime: "2027-01-11T07:40:00Z",
                  },
                  localizedValues: { departureTime: { time: { text: "2:40 PM" }, timeZone: "Asia/Bangkok" } },
                  transitLine: { nameShort: "Silom", name: "Silom Line", vehicle: { type: "SUBWAY" } },
                },
              },
            ],
          },
        ],
      },
    ]);

    const route = await computeRoute(airport, hotel, "TRANSIT", { date: "2027-01-11", time: "12:45" });

    expect(sent[0].body).toMatchObject({ travelMode: "TRANSIT", departureTime: "2027-01-11T05:45:00.000Z", languageCode: "en" });
    expect(sent[0].fieldMask).toContain("routes.legs.steps.transitDetails");
    expect(route).toMatchObject({ durationSec: 7800, walkMin: 9 });
    expect(route.transit).toEqual([
      {
        vehicle: "HEAVY_RAIL",
        line: "ARL : Phaya Thai - Suvarnabhumi",
        color: "#a1171c",
        textColor: undefined,
        from: "Suvarnabhumi",
        to: "Phaya Thai",
        stops: 7,
        departs: "13:53",
        arrives: "14:20",
        headsign: "Phaya Thai",
        polyline: "abc",
      },
      // 24-hour time on the stop's clock rather than Google's "2:40 PM"
      expect.objectContaining({ vehicle: "SUBWAY", line: "Silom", from: "Siam", to: "Surasak", stops: 5, departs: "14:40" }),
    ]);
  });

  it("plans the day's first appointment backwards and explains a night without trains", async () => {
    const sent = mockGoogle([]);
    await expect(
      computeRoute(hotel, airport, "TRANSIT", { date: "2027-01-31", time: "00:00", arriveBy: true }),
    ).rejects.toMatchObject({ status: 404, message: expect.stringMatching(/No public transport arriving by 00:00/) });
    expect(sent[0].body).toMatchObject({ arrivalTime: "2027-01-30T17:00:00.000Z" });
    expect(sent[0].body).not.toHaveProperty("departureTime");
  });

  it("falls back to the same weekday soon when the trip's timetable isn't published yet", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-20T12:00:00Z")); // a Tuesday
    const sent: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        if (String(url).includes("/timezone/")) return Response.json({ status: "OK", timeZoneId: "America/Mexico_City" });
        const body = JSON.parse(String(init!.body));
        sent.push(body);
        // Only the near date has a timetable.
        return Response.json(body.departureTime.startsWith("2027") ? {} : { routes: [{ duration: "4260s" }] });
      }),
    );
    const route = await computeRoute(hotel, airport, "TRANSIT", { date: "2027-02-13", time: "19:00" }); // a Saturday
    vi.useRealTimers();
    expect(sent.map((b) => b.departureTime)).toEqual(["2027-02-14T01:00:00.000Z", "2026-10-25T01:00:00.000Z"]);
    expect(route).toMatchObject({ durationSec: 4260, sampledOn: "2026-10-24" });
  });

  it("keeps other modes as they were", async () => {
    const sent = mockGoogle([{ duration: "600s", distanceMeters: 5000 }]);
    const route = await computeRoute(airport, hotel, "DRIVE", { date: "2027-01-11", time: "12:45" });
    expect(route).toEqual({ durationSec: 600, distanceM: 5000, polyline: undefined });
    expect(sent[0].body).not.toHaveProperty("departureTime");
    expect(sent[0].fieldMask).not.toContain("transitDetails");
  });
});

describe("cached answers", () => {
  it("asks Google once for the same route, and again for another mode", async () => {
    const sent = mockGoogle([{ duration: "600s", distanceMeters: 5000 }]);
    await computeRoute(airport, hotel, "DRIVE");
    await computeRoute(airport, hotel, "DRIVE");
    expect(sent).toHaveLength(1);
    await computeRoute(airport, hotel, "WALK");
    expect(sent).toHaveLength(2);
  });

  it("keeps public transport only for a planned time", async () => {
    const sent = mockGoogle([{ duration: "600s" }]);
    const at = { date: "2027-01-11", time: "12:45" };
    await computeRoute(airport, hotel, "TRANSIT", at);
    await computeRoute(airport, hotel, "TRANSIT", at);
    expect(sent).toHaveLength(1);
    await computeRoute(airport, hotel, "TRANSIT", { ...at, arriveBy: true });
    await computeRoute(airport, hotel, "TRANSIT");
    await computeRoute(airport, hotel, "TRANSIT");
    expect(sent).toHaveLength(4);
  });

  it("does not keep a route that wasn't found", async () => {
    const sent = mockGoogle([]);
    await expect(computeRoute(airport, hotel, "DRIVE")).rejects.toMatchObject({ status: 404 });
    await expect(computeRoute(airport, hotel, "DRIVE")).rejects.toMatchObject({ status: 404 });
    expect(sent).toHaveLength(2);
  });

  it("caches travel-time matrices by mode and points", async () => {
    const fetch = vi.fn(async () => Response.json([{ originIndex: 0, destinationIndex: 1, duration: "120s", condition: "ROUTE_EXISTS" }]));
    vi.stubGlobal("fetch", fetch);
    expect(await routeMatrix([airport, hotel], "DRIVE")).toEqual([
      [0, 2],
      [null, 0],
    ]);
    await routeMatrix([airport, hotel], "DRIVE");
    expect(fetch).toHaveBeenCalledTimes(1);
    await routeMatrix([hotel, airport], "DRIVE");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("asks for the elevations it doesn't know yet in one request", async () => {
    const asked: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const locations = new URL(String(url)).searchParams.get("locations")!.split("|");
        asked.push(...locations);
        return Response.json({ status: "OK", results: locations.map((l) => ({ elevation: Math.round(Number(l.split(",")[0])) })) });
      }),
    );
    const peak = { lat: 27.98, lng: 86.92 };
    expect(await elevations([airport, peak, airport])).toEqual([14, 28, 14]);
    expect(asked).toEqual(["13.6819,100.7469", "27.9800,86.9200"]);
    expect(await elevations([hotel, peak])).toEqual([14, 28]);
    expect(asked).toHaveLength(3);
  });
});
