import { describe, expect, it } from "vitest";
import { decodePolyline, focusItems, haversineM, mercatorAspect, parseCoordinates } from "./geo";
import type { Item } from "./types";

describe("decodePolyline", () => {
  it("decodes Google's reference example", () => {
    const pts = decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
    expect(pts).toEqual([
      { lat: 38.5, lng: -120.2 },
      { lat: 40.7, lng: -120.95 },
      { lat: 43.252, lng: -126.453 },
    ]);
  });
});

describe("parseCoordinates", () => {
  it("reads @lat,lng links", () => {
    expect(parseCoordinates("https://www.google.com/maps/place/X/@35.8989,14.5146,15z")).toEqual({
      lat: 35.8989,
      lng: 14.5146,
    });
  });
  it("prefers the exact !3d!4d pin over the viewport", () => {
    expect(parseCoordinates("https://www.google.com/maps/place/X/@35.1,14.1,15z/data=!3d35.8989!4d14.5146")).toEqual({
      lat: 35.8989,
      lng: 14.5146,
    });
  });
  it("reads plain pairs and rejects garbage", () => {
    expect(parseCoordinates("36.0532, 14.1884")).toEqual({ lat: 36.0532, lng: 14.1884 });
    expect(parseCoordinates("hello")).toBeUndefined();
    expect(parseCoordinates("120, 10")).toBeUndefined();
  });
});

it("haversine is about right", () => {
  // Valletta -> Mdina is roughly 10 km in a straight line
  expect(haversineM({ lat: 35.8989, lng: 14.5146 }, { lat: 35.8858, lng: 14.4031 }) / 1000).toBeCloseTo(10.1, 0);
});

describe("focusItems", () => {
  const at = (id: string, lat: number, lng: number, flight = false): Item => ({
    id,
    type: flight ? "transport" : "stay",
    title: id,
    location: { lat, lng },
    transport: flight ? { kind: "flight" } : undefined,
  });
  const warsaw = at("waw", 52.165, 20.969, true);
  const doha = at("doh", 25.271, 51.601, true);
  const donMueang = at("dmk", 13.915, 100.605, true);
  const bangkokHotel = at("hotel", 13.718, 100.522);
  const kohTao = at("kohtao", 10.065, 99.822);

  it("leaves out far-away flights, keeps flights near the trip", () => {
    expect(focusItems([warsaw, doha, donMueang, bangkokHotel, kohTao])).toEqual([donMueang, bangkokHotel, kohTao]);
  });

  it("keeps everything when the trip has only flights", () => {
    expect(focusItems([warsaw, doha])).toHaveLength(2);
  });

  it("measures tall and wide areas", () => {
    expect(mercatorAspect([bangkokHotel.location!, { lat: 18.76, lng: 99.0 }])).toBeGreaterThan(2);
    expect(mercatorAspect([{ lat: 0, lng: 0 }, { lat: 1, lng: 10 }])).toBeLessThan(0.2);
  });
});
