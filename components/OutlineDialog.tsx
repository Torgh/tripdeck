"use client";

import { useMemo, useState } from "react";
import { postJSON } from "@/lib/api";
import { ideasByStop, outlineDays, outlineStop, setOutline } from "@/lib/outline";
import type { PlaceResult } from "@/lib/server/google";
import { useStore } from "@/lib/store";
import type { OutlineStop, Trip } from "@/lib/types";
import { useT } from "@/lib/useLang";
import { Modal, Spinner } from "./Modal";

type Lookup = "locating" | "notFound";

/**
 * The trip's route in broad strokes – regions or towns in order, with the days in each – for an early
 * plan before its days are planned. Saving can also lay it over the days (adding them, labelled).
 */
export function OutlineDialog({ trip, onClose }: { trip: Trip; onClose: () => void }) {
  const t = useT();
  const saveTrip = useStore((s) => s.updateTrip);
  const [stops, setStops] = useState<OutlineStop[]>(() => trip.outline ?? [outlineStop("", 3)]);
  const [lookup, setLookup] = useState<Record<string, Lookup>>({});
  const ideas = useMemo(() => ideasByStop({ ...trip, outline: stops }), [trip, stops]);
  const total = outlineDays(stops);
  const named = stops.filter((s) => s.name.trim());

  const change = (id: string, patch: Partial<OutlineStop>) =>
    setStops((list) => list.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const move = (index: number, by: number) =>
    setStops((list) => {
      const out = [...list];
      const [stop] = out.splice(index, 1);
      out.splice(index + by, 0, stop);
      return out;
    });

  /** Finds a renamed stop on the map, near the rest of the trip. */
  const locate = async (stop: OutlineStop) => {
    const name = stop.name.trim();
    if (!name || stop.location) return;
    setLookup((l) => ({ ...l, [stop.id]: "locating" }));
    try {
      const bias = stops.find((s) => s.location && s.id !== stop.id)?.location;
      const { places } = await postJSON<{ places: PlaceResult[] }>("/api/places/search", {
        query: `${name}, ${trip.destination}`,
        bias,
      });
      const place = places[0];
      if (place) {
        setStops((list) => list.map((s) => (s.id === stop.id && s.name.trim() === name ? { ...s, location: { lat: place.lat, lng: place.lng } } : s)));
      }
      setLookup(({ [stop.id]: _done, ...l }) => (place ? l : { ...l, [stop.id]: "notFound" }));
    } catch {
      setLookup(({ [stop.id]: _done, ...l }) => ({ ...l, [stop.id]: "notFound" }));
    }
  };

  const save = (days: boolean) => {
    const clean = named.map((s) => ({ ...s, name: s.name.trim(), days: Math.max(1, Math.round(s.days) || 1) }));
    const next = setOutline(trip, clean, { days });
    saveTrip(trip.id, { outline: next.outline, days: next.days });
    onClose();
  };

  const fit =
    !total || total === trip.days.length
      ? total
        ? t("outline.fitMatch")
        : ""
      : total > trip.days.length
        ? t("outline.fitLong", { days: t("home.days", { n: trip.days.length }) })
        : t("outline.fitShort", { days: t("home.days", { n: trip.days.length }), outline: total });

  return (
    <Modal
      title={t("outline.title")}
      onClose={onClose}
      footer={
        <>
          <span className="small muted grow">{t("outline.makeDaysHint")}</span>
          <button className="btn" onClick={() => save(false)}>
            {t("outline.save")}
          </button>
          <button className="btn primary" disabled={!named.length} onClick={() => save(true)}>
            {t("outline.makeDays")}
          </button>
        </>
      }
    >
      <p className="muted small">{t("outline.intro")}</p>
      <ol className="outline-stops">
        {stops.map((stop, i) => {
          const near = ideas.get(stop.id)?.length ?? 0;
          return (
            <li key={stop.id}>
              <div className="row">
                <input
                  className="grow"
                  value={stop.name}
                  placeholder={t("outline.name")}
                  aria-label={t("outline.name")}
                  onChange={(e) => change(stop.id, { name: e.target.value, location: undefined })}
                  onBlur={() => locate(stop)}
                />
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={stop.days}
                  aria-label={t("outline.days")}
                  title={t("outline.days")}
                  style={{ width: 64 }}
                  onChange={(e) => change(stop.id, { days: Number(e.target.value) })}
                />
                <button className="btn small ghost" disabled={i === 0} title={t("outline.up")} aria-label={t("outline.up")} onClick={() => move(i, -1)}>
                  ↑
                </button>
                <button
                  className="btn small ghost"
                  disabled={i === stops.length - 1}
                  title={t("outline.down")}
                  aria-label={t("outline.down")}
                  onClick={() => move(i, 1)}
                >
                  ↓
                </button>
                <button
                  className="btn small ghost danger"
                  title={t("outline.remove")}
                  aria-label={t("outline.remove")}
                  onClick={() => setStops((list) => list.filter((s) => s.id !== stop.id))}
                >
                  ✕
                </button>
              </div>
              <div className="small muted">
                {lookup[stop.id] === "locating" ? (
                  <>
                    <Spinner /> {t("outline.locating")}
                  </>
                ) : lookup[stop.id] === "notFound" ? (
                  <span style={{ color: "var(--warn)" }}>{t("outline.notFound")}</span>
                ) : stop.location ? (
                  `📍 ${t("outline.located")}`
                ) : null}
                {near > 0 && ` · 💡 ${t("outline.ideas", { n: near })}`}
              </div>
            </li>
          );
        })}
      </ol>
      {!stops.length && <p className="muted">{t("outline.empty")}</p>}
      <div className="row">
        <button className="btn small" onClick={() => setStops((list) => [...list, outlineStop("", 2)])}>
          {t("outline.add")}
        </button>
        <span className="grow" />
        {total > 0 && (
          <span className="small">
            <b>{t("outline.total", { n: total })}</b> {fit && <span className="muted">· {fit}</span>}
          </span>
        )}
      </div>
    </Modal>
  );
}
