"use client";

import { useMemo, useState } from "react";
import { postJSON } from "@/lib/api";
import { guessType, itemFieldsFromPlace } from "@/lib/places";
import { newId, useStore } from "@/lib/store";
import { dayDate, formatDuration, isoDate } from "@/lib/time";
import { findBase } from "@/lib/timeline";
import { IDEAS, type ContainerId, type Item, type LatLng, type Trip } from "@/lib/types";
import type { PlaceResult } from "@/lib/server/google";
import { useLang, useT } from "@/lib/useLang";
import { tripCenter } from "./ItemEditor";
import { Modal, Spinner } from "./Modal";
import { PlaceSearch } from "./PlaceSearch";

interface Suggestion {
  place: PlaceResult;
  reason: string;
  suggestedDurationMin: number;
  bestTime: string;
  category: string;
}

type Anchor = LatLng & { name: string };

const CATEGORIES = ["sights", "nature", "beaches", "viewpoints", "museums", "food", "diving"] as const;

export function SuggestDialog({
  trip,
  container,
  anchorItemId,
  ai,
  onClose,
}: {
  trip: Trip;
  container: ContainerId;
  anchorItemId?: string;
  /** With in-app AI Claude picks and explains; without it, notable nearby places are listed. */
  ai: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const lang = useLang();
  const addItem = useStore((s) => s.addItem);
  const dayIndex = trip.days.findIndex((d) => d.id === container);
  const day = dayIndex >= 0 ? trip.days[dayIndex] : undefined;

  /** Candidate anchor points: the chosen card, the day's places, the morning's stay. */
  const anchors = useMemo(() => {
    const list: Anchor[] = [];
    const push = (item?: Item) => {
      if (item?.location && !list.some((a) => a.name === item.title)) {
        list.push({ name: item.title, lat: item.location.lat, lng: item.location.lng });
      }
    };
    if (anchorItemId) push(trip.items[anchorItemId]);
    if (day) {
      [...day.itemIds].reverse().forEach((id) => push(trip.items[id]));
      push(findBase(trip, dayIndex));
    }
    const center = tripCenter(trip);
    if (center && !anchorItemId) list.push({ name: t("suggest.tripCentre", { destination: trip.destination }), ...center });
    return list;
  }, [trip, anchorItemId, day, dayIndex, t]);

  const [anchor, setAnchor] = useState<Anchor | undefined>(anchors[0]);
  const [radiusKm, setRadiusKm] = useState(anchorItemId ? 5 : 15);
  const [count, setCount] = useState(5);
  const [note, setNote] = useState("");
  const [categories, setCategories] = useState<string[]>(["sights", "nature"]);
  const [target, setTarget] = useState<ContainerId>(container);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<{ summary: string; suggestions: Suggestion[] }>();
  const [added, setAdded] = useState<Set<string>>(new Set());

  const run = async () => {
    if (!anchor) return;
    setLoading(true);
    setError(undefined);
    try {
      if (!ai) {
        const existing = new Set(Object.values(trip.items).map((i) => i.location?.placeId));
        const { places } = await postJSON<{ places: PlaceResult[] }>("/api/places/nearby", {
          center: { lat: anchor.lat, lng: anchor.lng },
          radiusKm: Math.min(radiusKm, 30),
          categories,
        });
        const suggestions = places
          .filter((p) => !existing.has(p.placeId))
          .map((p) => ({
            place: p,
            reason: p.editorialSummary ?? "",
            suggestedDurationMin: 60,
            bestTime: "",
            category: (p.primaryType ?? "place").replace(/_/g, " "),
          }));
        setResult({ summary: t("suggest.notable", { n: suggestions.length, place: anchor.name }), suggestions });
        if (!suggestions.length) setError(t("suggest.nothing"));
        return;
      }
      const res = await postJSON<{ summary: string; suggestions: Suggestion[] }>("/api/ai/suggest", {
        destination: trip.destination,
        interests: trip.interests,
        date: dayIndex >= 0 ? isoDate(dayDate(trip.startDate, dayIndex)) : undefined,
        dayItems: (day?.itemIds ?? [])
          .map((id) => trip.items[id])
          .filter(Boolean)
          .map((i) => ({ title: i.title, type: i.type, time: i.startTime })),
        anchor,
        radiusKm,
        count,
        note: note || undefined,
        lang,
        excludePlaceIds: Object.values(trip.items)
          .map((i) => i.location?.placeId)
          .filter(Boolean),
      });
      setResult(res);
      if (!res.suggestions.length) setError(t("suggest.noSuggestions"));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const add = (s: Suggestion) => {
    const item: Item = {
      id: newId(),
      type: guessType(s.place),
      title: s.place.name,
      ...itemFieldsFromPlace(s.place),
      durationMin: s.suggestedDurationMin,
      aiReason: ai ? s.reason : undefined,
      notes: s.bestTime ? t("suggest.bestTime", { time: s.bestTime }) : s.reason || undefined,
    };
    addItem(trip.id, item, target);
    setAdded((prev) => new Set(prev).add(s.place.placeId));
  };

  const icon = ai ? "✨" : "🔍";
  const title = `${icon} ${
    anchorItemId
      ? t("suggest.nearTitle", { place: trip.items[anchorItemId]?.title ?? "" })
      : day
        ? t(ai ? "suggest.suggestionsDay" : "suggest.nearbyDay", { day: dayIndex + 1 })
        : t(ai ? "suggest.suggestions" : "suggest.nearby")
  }`;

  return (
    <Modal title={title} onClose={onClose} wide>
      <div className="grid2">
        <label>
          {t("suggest.searchAround")}
          <select
            value={anchor ? anchors.findIndex((a) => a.name === anchor.name) : -1}
            onChange={(e) => setAnchor(anchors[Number(e.target.value)])}
          >
            {anchors.map((a, i) => (
              <option key={a.name} value={i}>
                {a.name}
              </option>
            ))}
            {anchor && !anchors.some((a) => a.name === anchor.name) && <option value={-1}>{anchor.name}</option>}
          </select>
        </label>
        <div className="grid2">
          <label>
            {t("suggest.radius")}
            <select value={radiusKm} onChange={(e) => setRadiusKm(Number(e.target.value))}>
              {[1, 2, 5, 10, 15, 25, 50].map((r) => (
                <option key={r} value={r}>
                  {r} km
                </option>
              ))}
            </select>
          </label>
          <label hidden={!ai}>
            {t("suggest.howMany")}
            <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
              {[3, 5, 8].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      {anchors.length === 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <span className="small muted">{t("suggest.pickStart")}</span>
          <PlaceSearch
            onPick={(p) => setAnchor({ name: p.name, lat: p.lat, lng: p.lng })}
            onCoordinates={(p) => setAnchor({ name: t("suggest.pinned"), ...p })}
          />
          {anchor && <span className="small">📍 {anchor.name}</span>}
        </div>
      )}
      {ai ? (
        <label>
          {t("suggest.specific")}
          <input
            value={note}
            placeholder={t("suggest.specificPlaceholder", { interests: trip.interests || t("suggest.notSet") })}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run()}
          />
        </label>
      ) : (
        <div className="row wrap">
          {CATEGORIES.map((key) => (
            <label key={key} className="row" style={{ display: "flex", gap: 4, color: "var(--text)", fontSize: 13 }}>
              <input
                type="checkbox"
                style={{ width: "auto" }}
                checked={categories.includes(key)}
                onChange={(e) =>
                  setCategories(e.target.checked ? [...categories, key] : categories.filter((c) => c !== key))
                }
              />
              {t(`suggest.category.${key}`)}
            </label>
          ))}
        </div>
      )}
      <div className="row">
        <span className="grow small muted">
          {t(ai ? "suggest.aiHint" : "suggest.osmHint")}
        </span>
        <button className="btn ai" onClick={run} disabled={loading || !anchor || (!ai && !categories.length)}>
          {loading ? <Spinner /> : icon} {t(result ? "suggest.searchAgain" : "suggest.find")}
        </button>
      </div>

      {loading && ai && <div className="muted small">{t("suggest.searching")}</div>}
      {error && <div className="error">{error}</div>}

      {result && result.suggestions.length > 0 && (
        <>
          <div className="row">
            <p className="grow" style={{ margin: 0 }}>
              {result.summary}
            </p>
            <label style={{ width: 150 }}>
              {t("suggest.addTo")}
              <select value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value={IDEAS}>{t("editor.ideas")}</option>
                {trip.days.map((d, i) => (
                  <option key={d.id} value={d.id}>
                    {t("common.day", { day: i + 1 })}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {result.suggestions.map((s) => {
            const isAdded = added.has(s.place.placeId);
            return (
              <div key={s.place.placeId} className={`suggestion${isAdded ? " added" : ""}`}>
                <div className="row">
                  <strong className="grow">{s.place.name}</strong>
                  <span className="badge">{s.category}</span>
                  {s.place.rating && (
                    <span className="small muted">
                      ★ {s.place.rating.toFixed(1)} ({s.place.userRatingCount ?? 0})
                    </span>
                  )}
                </div>
                {s.reason && <div>{s.reason}</div>}
                <div className="small muted">
                  {[
                    ai && `⏱ ${formatDuration(s.suggestedDurationMin, lang)}`,
                    s.bestTime && `🕐 ${s.bestTime}`,
                    s.place.address,
                    s.place.weekdayHours?.length === 1 && t("suggest.hours", { hours: s.place.weekdayHours[0] }),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
                <div className="row">
                  {s.place.googleMapsUri && (
                    <a className="small" href={s.place.googleMapsUri} target="_blank" rel="noreferrer">
                      Google Maps ↗
                    </a>
                  )}
                  <span className="grow" />
                  <button className="btn small primary" disabled={isAdded} onClick={() => add(s)}>
                    {t(isAdded ? "suggest.added" : "suggest.add")}
                  </button>
                </div>
              </div>
            );
          })}
        </>
      )}
    </Modal>
  );
}
