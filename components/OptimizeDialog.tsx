"use client";

import { useState } from "react";
import { postJSON } from "@/lib/api";
import type { OptMetrics } from "@/lib/optimize";
import { useStore } from "@/lib/store";
import { dayDate, formatDuration, formatHm, isoDate } from "@/lib/time";
import { defaultModeTo } from "@/lib/rentals";
import { durationOf, findBase, manualLegMinutes } from "@/lib/timeline";
import { itemIcon, legKey, MANUAL_MODES, ROUTABLE_MODES, type TravelMode, type Trip } from "@/lib/types";
import { useLang, useT } from "@/lib/useLang";
import { Modal, Spinner } from "./Modal";

interface OptimizeResult {
  order: string[];
  baselineOrder: string[];
  reasoning: string;
  tips: string[];
  metrics: Record<"current" | "baseline" | "proposed", OptMetrics>;
  estimated: boolean;
}

export function OptimizeDialog({
  trip,
  dayId,
  ai,
  onClose,
}: {
  trip: Trip;
  dayId: string;
  ai: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const lang = useLang();
  const setContainerOrder = useStore((s) => s.setContainerOrder);
  const dayIndex = trip.days.findIndex((d) => d.id === dayId);
  const day = trip.days[dayIndex];
  const base = findBase(trip, dayIndex);
  const items = day.itemIds.map((id) => trip.items[id]).filter(Boolean);
  const located = items.filter((i) => i.location);
  const unlocated = items.filter((i) => !i.location);

  // How this day gets around by default (by scooter only once it is picked up).
  const [mode, setMode] = useState<TravelMode>(() => defaultModeTo(trip, day.itemIds.at(-1) ?? ""));
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<OptimizeResult>();

  /** Ferry, boat and flight legs entered between any two of the day's points – the router can't know them. */
  const manualLegs = () => {
    const ids = [...(base?.location ? [base.id] : []), ...located.map((i) => i.id)];
    const legs: Record<string, number> = {};
    for (const from of ids) {
      for (const to of ids) {
        const min = from === to ? undefined : manualLegMinutes(trip, from, to);
        if (min != null) legs[legKey(from, to)] = min;
      }
    }
    return legs;
  };

  const run = async () => {
    setLoading(true);
    setError(undefined);
    try {
      setResult(
        await postJSON<OptimizeResult>("/api/ai/optimize", {
          destination: trip.destination,
          interests: trip.interests,
          date: isoDate(dayDate(trip.startDate, dayIndex)),
          dayStartTime: day.startTime,
          mode,
          base: base?.location && { id: base.id, lat: base.location.lat, lng: base.location.lng, title: base.title },
          items: located.map((i) => ({
            id: i.id,
            title: i.title,
            type: i.type,
            lat: i.location!.lat,
            lng: i.location!.lng,
            durationMin: durationOf(i),
            // A stay's time is the earliest check-in, not an appointment to be on time for.
            fixedStart: i.type === "stay" ? undefined : i.startTime,
            openingPeriods: i.place?.openingPeriods,
            notes: i.notes,
            leavesFrom: i.transport?.toLocation && { lat: i.transport.toLocation.lat, lng: i.transport.toLocation.lng },
          })),
          manualLegs: manualLegs(),
          note: note || undefined,
          lang,
        }),
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const apply = (order: string[]) => {
    setContainerOrder(trip.id, day.id, [...order, ...unlocated.map((i) => i.id)]);
    onClose();
  };

  const unchanged = result && result.order.every((id, i) => id === located[i]?.id);

  return (
    <Modal title={t("optimize.title", { day: dayIndex + 1 })} onClose={onClose} wide>
      <div className="grid2">
        <label>
          {t("optimize.mode")}
          <select value={mode} onChange={(e) => setMode(e.target.value as TravelMode)}>
            {[...ROUTABLE_MODES, ...MANUAL_MODES].map((m) => (
              <option key={m} value={m}>
                {t(`mode.${m}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("optimize.wishes")}
          <input
            value={note}
            placeholder={t("optimize.wishesPlaceholder")}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
      </div>
      <div className="small muted">
        {base ? t("optimize.startsFrom", { place: base.title }) : ""}
        {t("optimize.stops", { n: located.length })}
        {unlocated.length > 0 && t("optimize.unlocated", { n: unlocated.length })}
        {t("optimize.fixed")}
      </div>
      <div className="row">
        <span className="grow small muted">
          {ai ? "" : t("optimize.tip")}
        </span>
        <button className="btn ai" onClick={run} disabled={loading}>
          {loading ? <Spinner /> : "⚡"} {t(result ? "optimize.runAgain" : ai ? "optimize.withAi" : "optimize.fastest")}
        </button>
      </div>
      {error && <div className="error">{error}</div>}

      {result && (
        <>
          <div className="metrics" style={ai ? undefined : { gridTemplateColumns: "1fr 1fr" }}>
            <Metric label={t("optimize.current")} m={result.metrics.current} />
            <Metric label={t("optimize.algorithm")} m={result.metrics.baseline} />
            {ai && <Metric label={t("optimize.proposal")} m={result.metrics.proposed} highlight />}
          </div>
          {result.estimated && (
            <div className="small muted">{t("optimize.estimated")}</div>
          )}
          <div className="tips">
            <strong>{t("optimize.proposed")}</strong>
            <ol className="order-list">
              {result.order.map((id) => {
                const it = trip.items[id];
                return (
                  <li key={id}>
                    {itemIcon(it)} {it.title}
                    {it.startTime ? ` · 🔒 ${it.startTime}` : ""}
                  </li>
                );
              })}
            </ol>
            <p style={{ margin: 0 }}>{result.reasoning}</p>
            {result.tips.length > 0 && (
              <ul>
                {result.tips.map((tip, i) => (
                  <li key={i}>{tip}</li>
                ))}
              </ul>
            )}
          </div>
          <div className="row wrap">
            <span className="grow" />
            {ai && (
              <button className="btn" onClick={() => apply(result.baselineOrder)}>
                {t("optimize.useFastest")}
              </button>
            )}
            <button className="btn primary" onClick={() => apply(result.order)} disabled={unchanged}>
              {t(unchanged ? "optimize.optimal" : ai ? "optimize.applyAi" : "optimize.apply")}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

function Metric({ label, m, highlight }: { label: string; m: OptMetrics; highlight?: boolean }) {
  const t = useT();
  const lang = useLang();
  return (
    <div className="metric" style={highlight ? { borderColor: "var(--ai)" } : undefined}>
      <span className="muted">{label}</span>
      <strong>{t("optimize.travel", { duration: formatDuration(m.travelMin, lang) })}</strong>
      <span>
        {t("optimize.ends", { time: formatHm(m.endMin) })}
        {m.lateMin > 0 && t("optimize.late", { n: Math.round(m.lateMin) })}
        {m.closedCount > 0 && t("optimize.closed", { n: m.closedCount })}
      </span>
    </div>
  );
}
