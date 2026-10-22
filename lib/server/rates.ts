import { RATE_CURRENCIES, ratesUrl, toRates, type Rates } from "../money";
import { DAY_MS, DiskCache } from "./cache";
import { HttpError } from "./errors";

// The ECB publishes once a working day, so half a day old is fresh enough.
const ratesCache = new DiskCache<Rates>("rates", DAY_MS / 2);

/** Today's ECB reference rates from 1 `base` (frankfurter.dev: free, no key). */
export function exchangeRates(base: string): Promise<Rates> {
  if (!(RATE_CURRENCIES as readonly string[]).includes(base)) {
    return Promise.reject(new HttpError(400, `No exchange rates for ${base}.`));
  }
  return ratesCache.getOrFetch(base, async () => {
    let res: Response;
    try {
      res = await fetch(ratesUrl(base), { signal: AbortSignal.timeout(15_000) });
    } catch {
      throw new HttpError(503, "Exchange rates are unavailable (offline?).");
    }
    if (!res.ok) throw new HttpError(502, `Exchange rates are unavailable (${res.status}).`);
    return toRates((await res.json()) as Rates);
  });
}
