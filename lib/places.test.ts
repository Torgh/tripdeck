import { describe, expect, it } from "vitest";
import { guessType, itemFieldsFromPlace } from "./places";
import type { PlaceResult } from "./server/google";

const place = (p: Partial<PlaceResult>) => ({ name: "x", lat: 35.9, lng: 14.5, ...p }) as PlaceResult;

describe("guessType", () => {
  it.each([
    [{ primaryType: "lodging" }, "stay"],
    [{ types: ["point_of_interest", "resort_hotel"] }, "stay"],
    [{ primaryType: "italian_restaurant" }, "food"],
    [{ types: ["coffee_shop", "cafe"] }, "food"],
    [{ primaryType: "scuba_diving_center" }, "dive"],
    [{ primaryType: "museum" }, "place"],
    [{}, "place"],
  ] as [Partial<PlaceResult>, string][])("%j → %s", (p, type) => expect(guessType(place(p))).toBe(type));
});

describe("itemFieldsFromPlace", () => {
  it("fills the card's location and place info", () => {
    const fields = itemFieldsFromPlace(
      place({ address: "Valletta", placeId: "g1", rating: 4.8, googleMapsUri: "https://maps.google.com/?cid=1" }),
    );
    expect(fields.location).toEqual({ lat: 35.9, lng: 14.5, address: "Valletta", placeId: "g1" });
    expect(fields.place).toMatchObject({ rating: 4.8, googleMapsUri: "https://maps.google.com/?cid=1" });
  });
});
