"use client";

import { useEffect, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";

const STORAGE_KEY = "tripdeck.mapWidth";
const DEFAULT_PCT = 38;
const MIN_PCT = 20;
const MAX_PCT = 75;

const clamp = (pct: number) => Math.min(MAX_PCT, Math.max(MIN_PCT, pct));

/** Map pane width as a percentage of the workspace, remembered in this browser. */
export function useMapWidth() {
  const [pct, setPct] = useState(DEFAULT_PCT);

  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(STORAGE_KEY));
      if (saved) setPct(clamp(saved));
    } catch {}
  }, []);

  const save = (next: number) => {
    try {
      localStorage.setItem(STORAGE_KEY, String(Math.round(next * 10) / 10));
    } catch {}
  };

  return { pct, setPct: (next: number) => setPct(clamp(next)), save, style: { "--map-w": `${pct}%` } as CSSProperties };
}

/** Draggable divider between the board and the map. Double-click resets the default width. */
export function Splitter({ pct, setPct, save }: Pick<ReturnType<typeof useMapWidth>, "pct" | "setPct" | "save">) {
  const [dragging, setDragging] = useState(false);

  const pctAt = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.parentElement!.getBoundingClientRect();
    return clamp(((rect.right - e.clientX) / rect.width) * 100);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging) setPct(pctAt(e));
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDragging(false);
    save(pctAt(e));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 10 : 2;
    const next = e.key === "ArrowLeft" ? pct + step : e.key === "ArrowRight" ? pct - step : null;
    if (next === null) return;
    e.preventDefault();
    setPct(next);
    save(clamp(next));
  };
  const reset = () => {
    setPct(DEFAULT_PCT);
    save(DEFAULT_PCT);
  };

  return (
    <div
      className={`splitter${dragging ? " dragging" : ""}`}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize map"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={MIN_PCT}
      aria-valuemax={MAX_PCT}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={reset}
      onKeyDown={onKeyDown}
    />
  );
}
