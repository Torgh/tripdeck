import { monthlyClimate, type DailyWeather, type MonthClimate } from "../climate";
import type { LatLng } from "../types";
import { DAY_MS, DiskCache } from "./cache";
import { HttpError } from "./errors";

/** Ten full years of observations: enough for typical months, small enough to fetch quickly. */
const YEARS = 10;

// Averages over ten years hardly change: keep them for half a year.
const climateCache = new DiskCache<MonthClimate[]>("climate", 180 * DAY_MS);

/** Open-Meteo's historical weather (ERA5 reanalysis): free, no key. Only the coordinates are sent. */
export function climateUrl(at: LatLng, lastYear = new Date().getUTCFullYear() - 1): string {
  const params = new URLSearchParams({
    latitude: at.lat.toFixed(2),
    longitude: at.lng.toFixed(2),
    start_date: `${lastYear - YEARS + 1}-01-01`,
    end_date: `${lastYear}-12-31`,
    daily: "temperature_2m_max,temperature_2m_min,precipitation_sum",
    timezone: "GMT",
  });
  return `https://archive-api.open-meteo.com/v1/archive?${params}`;
}

/** The typical weather month by month at `at`, from the last ten years. */
export function climateAt(at: LatLng): Promise<MonthClimate[]> {
  const url = climateUrl(at);
  return climateCache.getOrFetch(url, async () => {
    let res: Response;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    } catch {
      throw new HttpError(503, "Climate data is unavailable (offline?).");
    }
    if (!res.ok) throw new HttpError(502, `Climate data is unavailable (${res.status}).`);
    const { daily } = (await res.json()) as { daily?: DailyWeather };
    if (!daily?.time?.length) throw new HttpError(502, "Climate data came back empty.");
    return monthlyClimate(daily);
  });
}
