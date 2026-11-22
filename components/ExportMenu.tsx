"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/useLang";

/** "Export" button with a small menu: JSON backup, calendar, read-only copy or printable PDF itinerary. */
export function ExportMenu({
  tripId,
  dated,
  onJson,
  onCalendar,
  onShare,
}: {
  tripId: string;
  /** A calendar needs dates: an early plan with open dates has none. */
  dated: boolean;
  onJson: () => void;
  onCalendar: () => void;
  onShare: () => void;
}) {
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
          <button
            role="menuitem"
            disabled={!dated}
            title={dated ? undefined : t("exportMenu.icsNoDates")}
            onClick={() => {
              setOpen(false);
              onCalendar();
            }}
          >
            <span>📅</span>
            <span>
              <strong>{t("exportMenu.ics")}</strong>
              <small>{t(dated ? "exportMenu.icsHint" : "exportMenu.icsNoDates")}</small>
            </span>
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onShare();
            }}
          >
            <span>🔗</span>
            <span>
              <strong>{t("exportMenu.share")}</strong>
              <small>{t("exportMenu.shareHint")}</small>
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
