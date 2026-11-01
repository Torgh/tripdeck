"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/useLang";

/** "Export" button with a small menu: JSON backup or printable PDF itinerary. */
export function ExportMenu({ tripId, onJson }: { tripId: string; onJson: () => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="menu" ref={ref}>
      <button className="btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        ⬇ <span className="label">{t("exportMenu.export")}</span> ▾
      </button>
      {open && (
        <div className="menu-list" role="menu">
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onJson();
            }}
          >
            <span>🧾</span>
            <span>
              <strong>JSON</strong>
              <small>{t("exportMenu.json")}</small>
            </span>
          </button>
          <Link role="menuitem" href={`/trip/print?id=${encodeURIComponent(tripId)}`} onClick={() => setOpen(false)}>
            <span>📄</span>
            <span>
              <strong>PDF</strong>
              <small>{t("exportMenu.pdf")}</small>
            </span>
          </Link>
        </div>
      )}
    </div>
  );
}
