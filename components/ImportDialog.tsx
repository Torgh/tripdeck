"use client";

import Link from "next/link";
import { useState } from "react";
import type { ImportedBooking } from "@/app/api/ai/import/route";
import { fileToBase64, postJSON } from "@/lib/api";
import { itemFieldsFromPlace } from "@/lib/places";
import { newId, useStore } from "@/lib/store";
import { daysBetween } from "@/lib/time";
import { rich } from "@/lib/i18n/rich";
import { IDEAS, itemIcon, type ContainerId, type Item, type TransportKind, type Trip } from "@/lib/types";
import { useLang, useT } from "@/lib/useLang";
import { Modal, Spinner } from "./Modal";

const ACCEPT = "application/pdf,image/png,image/jpeg,image/webp";
const MAX_FILE_MB = 10;
const TRANSPORT_KINDS: TransportKind[] = ["flight", "ferry", "train", "bus", "car_rental", "boat", "other"];

/** Card + the column it should go to, derived from an extracted booking. */
function toCard(b: ImportedBooking, trip: Trip): { item: Item; container: ContainerId } {
  const item: Item = {
    id: newId(),
    type: b.type,
    title: b.title,
    startTime: b.start_time ?? undefined,
    durationMin: b.duration_min ?? undefined,
    notes: b.notes ?? undefined,
    booking: {
      provider: b.provider ?? undefined,
      reference: b.reference ?? undefined,
      url: b.url ?? undefined,
      price: b.price ?? undefined,
    },
    ...(b.place ? itemFieldsFromPlace(b.place) : {}),
  };
  if (b.type === "stay") item.stay = { nights: Math.max(1, b.nights ?? 1) };
  if (b.type === "dive") item.dive = { dives: 2, gas: "air" };
  if (b.type === "rental") {
    const days = b.date && b.return_date ? daysBetween(b.date, b.return_date) : 1;
    item.rental = {
      vehicle: b.vehicle ?? "car",
      days: Math.max(1, days),
      returnTime: b.return_time ?? undefined,
    };
  }
  if (b.type === "transport") {
    item.transport = {
      kind: TRANSPORT_KINDS.includes(b.transport_kind as TransportKind) ? (b.transport_kind as TransportKind) : "other",
      from: b.from ?? undefined,
      to: b.to ?? undefined,
      number: b.number ?? undefined,
    };
  }
  const index = b.date ? daysBetween(trip.startDate, b.date) : -1;
  const container = index >= 0 && index < trip.days.length ? trip.days[index].id : IDEAS;
  return { item, container };
}

export function ImportDialog({ trip, ai, onClose }: { trip: Trip; ai: boolean; onClose: () => void }) {
  const t = useT();
  const lang = useLang();
  const addItem = useStore((s) => s.addItem);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [cards, setCards] = useState<{ item: Item; container: ContainerId; selected: boolean; booking: ImportedBooking }[]>();

  if (!ai) return <ImportWithClaude trip={trip} onClose={onClose} />;

  const run = async () => {
    if (file && file.size > MAX_FILE_MB * 1024 * 1024) {
      setError(t("importDialog.tooBig", { mb: MAX_FILE_MB }));
      return;
    }
    setLoading(true);
    setError(undefined);
    try {
      const { bookings } = await postJSON<{ bookings: ImportedBooking[] }>("/api/ai/import", {
        text: text.trim() || undefined,
        file: file && { mediaType: file.type, data: await fileToBase64(file) },
        destination: trip.destination,
        tripStartDate: trip.startDate,
        lang,
      });
      if (!bookings.length) setError(t("importDialog.none"));
      setCards(bookings.map((b) => ({ ...toCard(b, trip), selected: true, booking: b })));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const addSelected = () => {
    for (const c of cards ?? []) if (c.selected) addItem(trip.id, c.item, c.container);
    onClose();
  };

  return (
    <Modal
      title={t("importDialog.title")}
      onClose={onClose}
      wide
      footer={
        cards?.length ? (
          <>
            <button className="btn" onClick={() => setCards(undefined)}>
              {t("common.back")}
            </button>
            <button className="btn primary" onClick={addSelected} disabled={!cards.some((c) => c.selected)}>
              {t("importDialog.addN", { n: cards.filter((c) => c.selected).length })}
            </button>
          </>
        ) : undefined
      }
    >
      {!cards?.length ? (
        <>
          <p className="muted" style={{ margin: 0 }}>
            {t("importDialog.intro")}
          </p>
          <label>
            {t("importDialog.text")}
            <textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={t("importDialog.textPlaceholder")} />
          </label>
          <label>
            {t("importDialog.file", { mb: MAX_FILE_MB })}
            <input type="file" accept={ACCEPT} onChange={(e) => setFile(e.target.files?.[0])} />
          </label>
          <div className="small muted">{t("importDialog.privacy")}</div>
          {error && <div className="error">{error}</div>}
          <div className="row">
            <span className="grow" />
            <button className="btn ai" onClick={run} disabled={loading || (!text.trim() && !file)}>
              {loading ? <Spinner /> : "✨"} {t("importDialog.extract")}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="muted" style={{ margin: 0 }}>
            {t("importDialog.check")}
          </p>
          {cards.map((c, i) => (
            <div key={c.item.id} className="suggestion">
              <div className="row">
                <input
                  type="checkbox"
                  style={{ width: "auto" }}
                  checked={c.selected}
                  onChange={(e) => setCards(cards.map((x, j) => (j === i ? { ...x, selected: e.target.checked } : x)))}
                />
                <strong className="grow">
                  {itemIcon(c.item)} {c.item.title}
                </strong>
                <select
                  style={{ width: 120 }}
                  value={c.container}
                  onChange={(e) => setCards(cards.map((x, j) => (j === i ? { ...x, container: e.target.value } : x)))}
                >
                  <option value={IDEAS}>{t("editor.ideas")}</option>
                  {trip.days.map((d, n) => (
                    <option key={d.id} value={d.id}>
                      {t("common.day", { day: n + 1 })}
                    </option>
                  ))}
                </select>
              </div>
              <div className="small muted">
                {[
                  c.booking.provider,
                  c.booking.reference && `#${c.booking.reference}`,
                  c.booking.date,
                  c.booking.start_time,
                  c.booking.nights && t("importDialog.nights", { n: c.booking.nights }),
                  c.booking.price,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
              <div className="small">
                {c.item.location ? `📍 ${c.item.location.address ?? t("importDialog.located")}` : t("importDialog.notFound")}
              </div>
              {c.booking.date && c.container === IDEAS && (
                <div className="issue info">{t("importDialog.outside", { date: c.booking.date })}</div>
              )}
            </div>
          ))}
        </>
      )}
    </Modal>
  );
}

/** Without an API key, bookings are imported by Claude / ChatGPT through the MCP server. */
function ImportWithClaude({ trip, onClose }: { trip: Trip; onClose: () => void }) {
  const t = useT();
  return (
    <Modal title={t("importDialog.claudeTitle")} onClose={onClose}>
      <p style={{ margin: 0 }}>{t("importDialog.claudeIntro")}</p>
      <div className="tips">{t("importDialog.claudePrompt", { name: trip.name })}</div>
      <p className="small muted" style={{ margin: 0 }}>
        {rich(t("importDialog.claudeNote"), { a: (s) => <Link href="/settings">{s}</Link> })}
      </p>
    </Modal>
  );
}
