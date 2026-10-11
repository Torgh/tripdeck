"use client";

import { useMemo, useState } from "react";
import { postJSON } from "@/lib/api";
import { guessType, itemFieldsFromPlace } from "@/lib/places";
import { newId, useStore } from "@/lib/store";
import { dayDate, formatDuration, isoDate } from "@/lib/time";
import { findBase } from "@/lib/timeline";
import { IDEAS, type ContainerId, type Item, type LatLng, type Trip } from "@/lib/types";
import type { PlaceResult } from "@/lib/server/google";
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

const CATEGORY_LABEL: Record<string, string> = {
  sights: "Sights",
  nature: "Nature",
  beaches: "Beaches",
  viewpoints: "Viewpoints",
  museums: "Museums",
  food: "Food & drink",
  diving: "Diving",
};

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
    if (center && !anchorItemId) list.push({ name: `${trip.destination} (trip centre)`, ...center });
    return list;
  }, [trip, anchorItemId, day, dayIndex]);

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
        setResult({ summary: `${suggestions.length} notable places around ${anchor.name}.`, suggestions });
        if (!suggestions.length) setError("Nothing found – try a larger radius or other categories.");
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
        excludePlaceIds: Object.values(trip.items)
          .map((i) => i.location?.placeId)
          .filter(Boolean),
      });
      setResult(res);
      if (!res.suggestions.length) setError("No suggestions came back – try a larger radius or different wishes.");
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
      notes: s.bestTime ? `Best time: ${s.bestTime}` : s.reason || undefined,
    };
    addItem(trip.id, item, target);
    setAdded((prev) => new Set(prev).add(s.place.placeId));
  };

  const icon = ai ? "✨" : "🔍";
  const title = anchorItemId
    ? `${icon} What's near ${trip.items[anchorItemId]?.title}?`
    : day
      ? `${icon} ${ai ? "Suggestions" : "Nearby places"} for day ${dayIndex + 1}`
      : `${icon} ${ai ? "Suggestions" : "Nearby places"}`;

  return (
    <Modal title={title} onClose={onClose} wide>
      <div className="grid2">
        <label>
          Search around
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
            Radius
            <select value={radiusKm} onChange={(e) => setRadiusKm(Number(e.target.value))}>
              {[1, 2, 5, 10, 15, 25, 50].map((r) => (
                <option key={r} value={r}>
                  {r} km
                </option>
              ))}
            </select>
          </label>
          <label hidden={!ai}>
            How many
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
          <span className="small muted">Pick a starting point:</span>
          <PlaceSearch
            onPick={(p) => setAnchor({ name: p.name, lat: p.lat, lng: p.lng })}
            onCoordinates={(p) => setAnchor({ name: "Pinned point", ...p })}
          />
          {anchor && <span className="small">📍 {anchor.name}</span>}
        </div>
      )}
      {ai ? (
        <label>
          Anything specific? (optional)
          <input
            value={note}
            placeholder={`e.g. "rainy day", "with kids", "best snorkeling", "cheap local lunch" – interests: ${trip.interests || "not set"}`}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run()}
          />
        </label>
      ) : (
        <div className="row wrap">
          {Object.entries(CATEGORY_LABEL).map(([key, label]) => (
            <label key={key} className="row" style={{ display: "flex", gap: 4, color: "var(--text)", fontSize: 13 }}>
              <input
                type="checkbox"
                style={{ width: "auto" }}
                checked={categories.includes(key)}
                onChange={(e) =>
                  setCategories(e.target.checked ? [...categories, key] : categories.filter((c) => c !== key))
                }
              />
              {label}
            </label>
          ))}
        </div>
      )}
      <div className="row">
        <span className="grow small muted">
          {ai
            ? "Claude searches places and picks what fits your trip."
            : "Most notable places first. For picks tailored to you, ask Claude via MCP (see Settings)."}
        </span>
        <button className="btn ai" onClick={run} disabled={loading || !anchor || (!ai && !categories.length)}>
          {loading ? <Spinner /> : icon} {result ? "Search again" : "Find places"}
        </button>
      </div>

      {loading && ai && <div className="muted small">Searching and comparing places… this can take up to a minute.</div>}
      {error && <div className="error">{error}</div>}

      {result && result.suggestions.length > 0 && (
        <>
          <div className="row">
            <p className="grow" style={{ margin: 0 }}>
              {result.summary}
            </p>
            <label style={{ width: 150 }}>
              Add to
              <select value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value={IDEAS}>💡 Ideas</option>
                {trip.days.map((d, i) => (
                  <option key={d.id} value={d.id}>
                    Day {i + 1}
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
                    ai && `⏱ ${formatDuration(s.suggestedDurationMin)}`,
                    s.bestTime && `🕐 ${s.bestTime}`,
                    s.place.address,
                    s.place.weekdayHours?.length === 1 && `hours: ${s.place.weekdayHours[0]}`,
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
                    {isAdded ? "Added ✓" : "+ Add"}
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
