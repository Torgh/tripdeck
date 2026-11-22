"use client";

import { useState } from "react";
import { download, fileBase } from "@/lib/download";
import { tripShareHtml } from "@/lib/shareHtml";
import type { DayTimeline } from "@/lib/timeline";
import type { Trip } from "@/lib/types";
import { useLang, useT } from "@/lib/useLang";
import { Modal } from "./Modal";

/** A read-only web page of the plan for travel companions, with a choice of what it shows. */
export function ShareDialog({ trip, timelines, onClose }: { trip: Trip; timelines: DayTimeline[]; onClose: () => void }) {
  const t = useT();
  const lang = useLang();
  const [prices, setPrices] = useState(false);
  const [references, setReferences] = useState(true);
  const [notes, setNotes] = useState(true);

  const save = () => {
    const html = tripShareHtml(trip, timelines, { lang, prices, references, notes });
    download(new Blob([html], { type: "text/html;charset=utf-8" }), `${fileBase(trip.name)}.html`);
    onClose();
  };

  const box = (label: string, checked: boolean, set: (v: boolean) => void) => (
    <label className="row" style={{ fontSize: 14 }}>
      <input type="checkbox" style={{ width: "auto" }} checked={checked} onChange={(e) => set(e.target.checked)} />
      {label}
    </label>
  );

  return (
    <Modal
      title={t("share.title")}
      onClose={onClose}
      footer={
        <button className="btn primary" onClick={save}>
          {t("share.download")}
        </button>
      }
    >
      <p className="muted small">{t("share.intro")}</p>
      <fieldset>
        <legend>{t("share.include")}</legend>
        {box(t("share.references"), references, setReferences)}
        {box(t("share.notes"), notes, setNotes)}
        {box(t("share.prices"), prices, setPrices)}
      </fieldset>
    </Modal>
  );
}
