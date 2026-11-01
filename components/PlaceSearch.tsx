"use client";

import { useState } from "react";
import { postJSON } from "@/lib/api";
import { parseCoordinates } from "@/lib/geo";
import type { LatLng } from "@/lib/types";
import type { PlaceResult } from "@/lib/server/google";
import { useT } from "@/lib/useLang";
import { Spinner } from "./Modal";

/** Google Places text search, plus pasting a Google Maps link or "lat, lng". */
export function PlaceSearch({
  bias,
  onPick,
  onCoordinates,
  placeholder,
}: {
  bias?: LatLng;
  onPick: (place: PlaceResult) => void;
  onCoordinates: (point: LatLng) => void;
  placeholder?: string;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const coords = parseCoordinates(query);

  const search = async () => {
    if (query.trim().length < 2) return;
    setLoading(true);
    setError(undefined);
    try {
      const { places } = await postJSON<{ places: PlaceResult[] }>("/api/places/search", { query, bias });
      setResults(places);
      if (!places.length) setError(t("placeSearch.none"));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row">
        <input
          value={query}
          placeholder={placeholder ?? t("placeSearch.placeholder")}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              search();
            }
          }}
        />
        <button type="button" className="btn" onClick={search} disabled={loading}>
          {loading ? <Spinner /> : t("placeSearch.search")}
        </button>
      </div>
      {coords && (
        <button
          type="button"
          className="result"
          onClick={() => {
            onCoordinates(coords);
            setQuery("");
          }}
        >
          {t("placeSearch.useCoords", { lat: coords.lat.toFixed(5), lng: coords.lng.toFixed(5) })}
        </button>
      )}
      {error && <div className="small muted">{error}</div>}
      {results.length > 0 && (
        <div className="results">
          {results.map((p) => (
            <button
              type="button"
              key={p.placeId}
              className="result"
              onClick={() => {
                onPick(p);
                setResults([]);
                setQuery("");
              }}
            >
              <strong>{p.name}</strong>
              {p.rating ? ` · ★ ${p.rating.toFixed(1)} (${p.userRatingCount ?? 0})` : ""}
              <div className="small muted">{p.address}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
