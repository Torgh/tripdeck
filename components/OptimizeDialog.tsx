"use client";

import { useState } from "react";
import { postJSON } from "@/lib/api";
import type { OptMetrics } from "@/lib/optimize";
import { useStore } from "@/lib/store";
import { dayDate, formatDuration, formatHm, isoDate } from "@/lib/time";
import { durationOf, findBase } from "@/lib/timeline";
import { itemIcon, MANUAL_MODES, MODE_LABEL, ROUTABLE_MODES, type TravelMode, type Trip } from "@/lib/types";
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
  const setContainerOrder = useStore((s) => s.setContainerOrder);
  const dayIndex = trip.days.findIndex((d) => d.id === dayId);
  const day = trip.days[dayIndex];
  const base = findBase(trip, dayIndex);
  const items = day.itemIds.map((id) => trip.items[id]).filter(Boolean);
  const located = items.filter((i) => i.location);
  const unlocated = items.filter((i) => !i.location);

  const [mode, setMode] = useState<TravelMode>(trip.defaultMode);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<OptimizeResult>();

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
          base: base?.location && { lat: base.location.lat, lng: base.location.lng, title: base.title },
          items: located.map((i) => ({
            id: i.id,
            title: i.title,
            type: i.type,
            lat: i.location!.lat,
            lng: i.location!.lng,
            durationMin: durationOf(i),
            fixedStart: i.startTime,
            openingPeriods: i.place?.openingPeriods,
            notes: i.notes,
          })),
          note: note || undefined,
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
    <Modal title={`⚡ Optimize day ${dayIndex + 1}`} onClose={onClose} wide>
      <div className="grid2">
        <label>
          Mostly getting around by
          <select value={mode} onChange={(e) => setMode(e.target.value as TravelMode)}>
            {[...ROUTABLE_MODES, ...MANUAL_MODES].map((m) => (
              <option key={m} value={m}>
                {MODE_LABEL[m]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Wishes (optional)
          <input
            value={note}
            placeholder='e.g. "lunch around 13:00", "sunset at the cliffs"'
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
      </div>
      <div className="small muted">
        {base ? `Starts from ${base.title}. ` : ""}
        {located.length} stops will be ordered.
        {unlocated.length > 0 && ` ${unlocated.length} card(s) without a location stay at the end.`} Cards with a fixed
        start time keep it.
      </div>
      <div className="row">
        <span className="grow small muted">
          {ai ? "" : "Tip: ask Claude (MCP) to optimise this day – it also weighs meals, sunsets and heat."}
        </span>
        <button className="btn ai" onClick={run} disabled={loading}>
          {loading ? <Spinner /> : "⚡"} {result ? "Run again" : ai ? "Optimize with AI" : "Find the fastest order"}
        </button>
      </div>
      {error && <div className="error">{error}</div>}

      {result && (
        <>
          <div className="metrics" style={ai ? undefined : { gridTemplateColumns: "1fr 1fr" }}>
            <Metric label="Current order" m={result.metrics.current} />
            <Metric label="Fastest (algorithm)" m={result.metrics.baseline} />
            {ai && <Metric label="AI proposal" m={result.metrics.proposed} highlight />}
          </div>
          {result.estimated && (
            <div className="small muted">Travel times are straight-line estimates (no Google routing available).</div>
          )}
          <div className="tips">
            <strong>Proposed order</strong>
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
                {result.tips.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            )}
          </div>
          <div className="row wrap">
            <span className="grow" />
            {ai && (
              <button className="btn" onClick={() => apply(result.baselineOrder)}>
                Use fastest order
              </button>
            )}
            <button className="btn primary" onClick={() => apply(result.order)} disabled={unchanged}>
              {unchanged ? "Already optimal" : ai ? "Apply AI order" : "Apply this order"}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

function Metric({ label, m, highlight }: { label: string; m: OptMetrics; highlight?: boolean }) {
  return (
    <div className="metric" style={highlight ? { borderColor: "var(--ai)" } : undefined}>
      <span className="muted">{label}</span>
      <strong>{formatDuration(m.travelMin)} travel</strong>
      <span>
        ends ~{formatHm(m.endMin)}
        {m.lateMin > 0 && ` · ${Math.round(m.lateMin)} min late`}
        {m.closedCount > 0 && ` · ${m.closedCount} closed`}
      </span>
    </div>
  );
}
