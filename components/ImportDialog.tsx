"use client";

import Link from "next/link";
import { useState } from "react";
import type { ImportedBooking } from "@/app/api/ai/import/route";
import { fileToBase64, postJSON } from "@/lib/api";
import { itemFieldsFromPlace } from "@/lib/places";
import { newId, useStore } from "@/lib/store";
import { daysBetween } from "@/lib/time";
import { IDEAS, itemIcon, type ContainerId, type Item, type TransportKind, type Trip } from "@/lib/types";
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
  const addItem = useStore((s) => s.addItem);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [cards, setCards] = useState<{ item: Item; container: ContainerId; selected: boolean; booking: ImportedBooking }[]>();

  if (!ai) return <ImportWithClaude trip={trip} onClose={onClose} />;

  const run = async () => {
    if (file && file.size > MAX_FILE_MB * 1024 * 1024) {
      setError(`Files up to ${MAX_FILE_MB} MB, please.`);
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
      });
      if (!bookings.length) setError("No bookings found in this document.");
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
      title="📥 Import a booking"
      onClose={onClose}
      wide
      footer={
        cards?.length ? (
          <>
            <button className="btn" onClick={() => setCards(undefined)}>
              Back
            </button>
            <button className="btn primary" onClick={addSelected} disabled={!cards.some((c) => c.selected)}>
              Add {cards.filter((c) => c.selected).length} to trip
            </button>
          </>
        ) : undefined
      }
    >
      {!cards?.length ? (
        <>
          <p className="muted" style={{ margin: 0 }}>
            Paste a confirmation email from Booking.com, GetYourGuide, Viator, Airbnb, an airline or a dive centre – or
            attach the PDF / a screenshot. Claude extracts dates, times, addresses and booking numbers, and each booking
            lands on the right day.
          </p>
          <label>
            Confirmation text
            <textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the email here…" />
          </label>
          <label>
            …or a file (PDF, PNG, JPG, WebP – max {MAX_FILE_MB} MB)
            <input type="file" accept={ACCEPT} onChange={(e) => setFile(e.target.files?.[0])} />
          </label>
          <div className="small muted">
            The text is sent to the Claude API for extraction. Remove anything you don&apos;t want to share (e.g. payment
            details) first.
          </div>
          {error && <div className="error">{error}</div>}
          <div className="row">
            <span className="grow" />
            <button className="btn ai" onClick={run} disabled={loading || (!text.trim() && !file)}>
              {loading ? <Spinner /> : "✨"} Extract bookings
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="muted" style={{ margin: 0 }}>
            Check what was found. You can edit each card after adding it.
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
                  <option value={IDEAS}>💡 Ideas</option>
                  {trip.days.map((d, n) => (
                    <option key={d.id} value={d.id}>
                      Day {n + 1}
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
                  c.booking.nights && `${c.booking.nights} nights`,
                  c.booking.price,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
              <div className="small">
                {c.item.location ? `📍 ${c.item.location.address ?? "Located"}` : "📍 Location not found – add it later"}
              </div>
              {c.booking.date && c.container === IDEAS && (
                <div className="issue info">ℹ️ {c.booking.date} is outside the trip dates – added to Ideas.</div>
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
  return (
    <Modal title="📥 Import bookings" onClose={onClose}>
      <p style={{ margin: 0 }}>
        Let Claude (Claude Code / Desktop) or ChatGPT (Codex) do it with your subscription – no API key needed. With the
        Gmail connector enabled, just ask:
      </p>
      <div className="tips">
        “Find my Booking.com, GetYourGuide and airline confirmations in Gmail and add them to my trip “{trip.name}” in
        TripDeck.”
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        Or paste a confirmation into the chat. Each booking lands on the right day within a few seconds. Set up the
        TripDeck MCP server in <Link href="/settings">Settings</Link>; for in-app import add an Anthropic API key there.
      </p>
    </Modal>
  );
}
