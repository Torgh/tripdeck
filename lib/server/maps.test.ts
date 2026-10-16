import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "./errors";

const config = vi.hoisted(() => ({ googleMapsServerKey: undefined as string | undefined }));
vi.mock("./config", () => ({ readConfig: () => config }));
vi.mock("./google", () => ({
  searchText: vi.fn(),
  searchNearby: vi.fn(),
  placeDetails: vi.fn(),
  computeRoute: vi.fn(),
  routeMatrix: vi.fn(),
  elevation: vi.fn(),
}));
vi.mock("./osm", () => ({
  OSM_CATEGORIES: [],
  osmSearch: vi.fn(async () => ["osm result"]),
  osmNearby: vi.fn(async () => ["osm nearby"]),
  osmRoute: vi.fn(async () => "osm route"),
  osmMatrix: vi.fn(async () => "osm matrix"),
  osmElevation: vi.fn(async () => 42),
}));

const google = await import("./google");
const osm = await import("./osm");
const maps = await import("./maps");

afterEach(() => {
  vi.clearAllMocks();
  config.googleMapsServerKey = undefined;
});

describe("maps facade", () => {
  it("uses OpenStreetMap without a Google key", async () => {
    expect(maps.mapsProvider()).toBe("osm");
    await expect(maps.searchPlaces("Valletta")).resolves.toEqual(["osm result"]);
    expect(google.searchText).not.toHaveBeenCalled();
  });

  it("uses Google when a key is configured", async () => {
    config.googleMapsServerKey = "key";
    vi.mocked(google.computeRoute).mockResolvedValue("google route" as never);
    await expect(maps.computeRoute({ lat: 0, lng: 0 }, { lat: 1, lng: 1 }, "DRIVE")).resolves.toBe("google route");
    expect(osm.osmRoute).not.toHaveBeenCalled();
  });

  it.each([502, 503])("falls back to OpenStreetMap when Google answers %i", async (status) => {
    config.googleMapsServerKey = "key";
    vi.mocked(google.elevation).mockRejectedValue(new HttpError(status, "API not enabled"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(maps.elevation({ lat: 35.9, lng: 14.5 })).resolves.toBe(42);
    expect(warn).toHaveBeenCalled();
  });

  it("does not hide request errors behind the fallback", async () => {
    config.googleMapsServerKey = "key";
    vi.mocked(google.searchText).mockRejectedValue(new HttpError(400, "Bad query"));
    await expect(maps.searchPlaces("")).rejects.toMatchObject({ status: 400 });
    expect(osm.osmSearch).not.toHaveBeenCalled();
  });

  it("asks for nearby sights and nature by default, mapped to Google place types", async () => {
    config.googleMapsServerKey = "key";
    vi.mocked(google.searchNearby).mockResolvedValue([] as never);
    await maps.nearbyPlaces({ center: { lat: 0, lng: 0 }, radiusM: 1000 });
    expect(vi.mocked(google.searchNearby).mock.calls[0][0].includedTypes).toEqual(
      expect.arrayContaining(["tourist_attraction", "museum", "park", "beach"]),
    );
  });

  it("has no details for OpenStreetMap places", () => {
    expect(() => maps.placeDetails("osm:node/1")).toThrow(/only available for Google/);
  });
});
