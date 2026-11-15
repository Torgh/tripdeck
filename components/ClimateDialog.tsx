"use client";

import { useEffect, useMemo, useState } from "react";
import { postJSON } from "@/lib/api";
import { regionLabel, regionsOf, tripMonths, type MonthClimate } from "@/lib/climate";
import { LOCALE } from "@/lib/i18n";
import type { LatLng, Trip } from "@/lib/types";
import { useLang, useT } from "@/lib/useLang";
import { Modal, Spinner } from "./Modal";

/**
 * The typical weather month by month in each region of the trip (Open-Meteo, the last ten years), to
 * pick when to go – or, for a dated trip, to see what its months are like (they are highlighted).
 */
export function ClimateDialog({ trip, onClose }: { trip: Trip; onClose: () => void }) {
  const t = useT();
  const lang = useLang();
  const regions = useMemo(() => regionsOf(trip), [trip]);
  const months = useMemo(() => new Set(tripMonths(trip)), [trip]);
  const centers = JSON.stringify(regions.map((r) => r.center));
  const [result, setResult] = useState<{ key: string; climates?: MonthClimate[][]; error?: string }>();

  useEffect(() => {
    const points = JSON.parse(centers) as LatLng[];
    if (!points.length) return;
    const controller = new AbortController();
    postJSON<{ climates: MonthClimate[][] }>("/api/climate", { points }, controller.signal)
      .then(({ climates }) => setResult({ key: centers, climates }))
      .catch((err: Error) => {
        if (!controller.signal.aborted) setResult({ key: centers, error: err.message });
      });
    return () => controller.abort();
  }, [centers]);

  const current = result?.key === centers ? result : undefined;
  const monthName = (m: number) =>
    new Date(Date.UTC(2001, m - 1, 1)).toLocaleDateString(LOCALE[lang], { month: "short", timeZone: "UTC" });

  return (
    <Modal title={t("climate.title")} onClose={onClose} wide>
      {!regions.length ? (
        <p className="muted">{t("climate.noPlaces")}</p>
      ) : current?.error ? (
        <p className="error">{current.error}</p>
      ) : !current?.climates ? (
        <p className="muted">
          <Spinner /> {t("climate.loading")}
        </p>
      ) : (
        <div className="climate">
          <table>
            <thead>
              <tr>
                <th />
                {regions.map((r, i) => (
                  <th key={i} title={r.items.map((item) => item.title).join(", ")}>
                    {regionLabel(r)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 12 }, (_, m) => (
                <tr key={m} className={months.has(m + 1) ? "trip-month" : undefined}>
                  <th>{monthName(m + 1)}</th>
                  {current.climates!.map((c, i) => {
                    const month = c[m];
                    return (
                      <td key={i} className={rainClass(month.rainDays)}>
                        <b>{month.highC}°</b>
                        <span className="muted">/{month.lowC}°</span>
                        <div className="small">💧 {t("climate.rainDays", { n: month.rainDays })}</div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">
        {months.size ? t("climate.tripMonths") : trip.timing ? t("climate.timing", { timing: trip.timing }) : ""}{" "}
        {t("climate.source")}
      </p>
    </Modal>
  );
}

/** Dry, some rain, or the rainy season, for the cell's background. */
function rainClass(rainDays: number): string {
  return rainDays >= 15 ? "wet" : rainDays >= 8 ? "damp" : "dry";
}
