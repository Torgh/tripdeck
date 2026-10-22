import { useEffect, useMemo, useState } from "react";
import { budgetCurrency, foreignCurrencies, tripBudget, type Budget, type Rates } from "./money";
import type { Trip } from "./types";

/** Budget hooks shared by the desktop app (rates through its server) and the phone (rates straight from frankfurter.dev). */

export type FetchRates = (base: string) => Promise<Rates>;

const ratesAsked = new Map<string, Promise<Rates | undefined>>();
const ratesKey = (base: string) => `tripdeck.rates.${base}`;

function savedRates(base: string): Rates | undefined {
  try {
    const saved = JSON.parse(localStorage.getItem(ratesKey(base)) ?? "null") as Rates | null;
    return saved?.base === base ? saved : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Exchange rates from `base`, fetched once per page load when `needed`. The last ones fetched are
 * kept in this browser, so the budget still converts offline.
 */
export function useRatesFrom(base: string, needed: boolean, fetchRates: FetchRates): Rates | undefined {
  const [fetched, setFetched] = useState<Rates>();
  // Read once per currency, so the budget isn't recomputed on every render.
  const saved = useMemo(() => (needed ? savedRates(base) : undefined), [base, needed]);
  useEffect(() => {
    if (!needed) return;
    let live = true;
    let ask = ratesAsked.get(base);
    if (!ask) {
      ask = fetchRates(base)
        .then((rates) => {
          try {
            localStorage.setItem(ratesKey(base), JSON.stringify(rates));
          } catch {
            // Only costs the offline fallback.
          }
          return rates;
        })
        .catch(() => {
          ratesAsked.delete(base);
          return undefined;
        });
      ratesAsked.set(base, ask);
    }
    ask.then((rates) => live && rates && setFetched(rates));
    return () => {
      live = false;
    };
  }, [base, needed, fetchRates]);
  return fetched?.base === base ? fetched : saved;
}

/** What the trip costs, in its budget currency, with today's rates (or the last ones fetched). */
export function useTripBudgetFrom(trip: Trip | undefined, fetchRates: FetchRates): Budget | undefined {
  const base = trip ? budgetCurrency(trip) : "EUR";
  const foreign = useMemo(() => (trip ? foreignCurrencies(trip, base).length > 0 : false), [trip, base]);
  const rates = useRatesFrom(base, foreign, fetchRates);
  return useMemo(() => (trip ? tripBudget(trip, rates) : undefined), [trip, rates]);
}
