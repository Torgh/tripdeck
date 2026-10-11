import type { PlaceResult } from "./server/google";
import type { Item, ItemType } from "./types";

/** Maps a Google place to the card fields it fills in. */
export function itemFieldsFromPlace(p: PlaceResult): Pick<Item, "location" | "place"> {
  return {
    location: { lat: p.lat, lng: p.lng, address: p.address, placeId: p.placeId },
    place: {
      rating: p.rating,
      userRatingCount: p.userRatingCount,
      primaryType: p.primaryType,
      types: p.types,
      openingPeriods: p.openingPeriods,
      googleMapsUri: p.googleMapsUri,
      websiteUri: p.websiteUri,
      editorialSummary: p.editorialSummary,
    },
  };
}

const FOOD = ["restaurant", "cafe", "bar", "bakery", "food", "meal_takeaway"];
const STAY = ["lodging", "hotel", "hostel", "campground", "resort_hotel"];

/** Best-guess card type for a Google place. */
export function guessType(p: PlaceResult): ItemType {
  const types = [p.primaryType, ...(p.types ?? [])].filter(Boolean) as string[];
  if (types.some((t) => STAY.includes(t))) return "stay";
  if (types.some((t) => FOOD.some((f) => t.includes(f)))) return "food";
  if (types.some((t) => t.includes("dive") || t.includes("scuba"))) return "dive";
  return "place";
}
