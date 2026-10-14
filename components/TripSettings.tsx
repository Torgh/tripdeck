"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { dayDate, daysBetween, isoDate } from "@/lib/time";
import * as ops from "@/lib/tripOps";
import { MODE_LABEL, ROUTABLE_MODES, type TravelMode, type Trip } from "@/lib/types";
import { Modal } from "./Modal";

const MAX_DAYS = 60;

export function TripSettings({ trip, onClose }: { trip: Trip; onClose: () => void }) {
  const updateTrip = useStore((s) => s.updateTrip);
  const deleteTrip = useStore((s) => s.deleteTrip);
  const router = useRouter();
  const [form, setForm] = useState({
    name: trip.name,
    destination: trip.destination,
    startDate: trip.startDate,
    interests: trip.interests,
    defaultMode: trip.defaultMode,
  });
  const [endDate, setEndDate] = useState(isoDate(dayDate(trip.startDate, trip.days.length - 1)));
  const dayCount = form.startDate && endDate ? daysBetween(form.startDate, endDate) + 1 : NaN;
  const maxDays = Math.max(MAX_DAYS, trip.days.length);
  const validRange = dayCount >= 1 && dayCount <= maxDays;
  const movedCards = validRange
    ? trip.days.slice(dayCount).reduce((n, d) => n + d.itemIds.length, 0)
    : 0;

  // Moving the first day keeps the trip length, so the last day moves with it.
  const changeStart = (startDate: string) => {
    if (startDate && form.startDate && endDate) {
      setEndDate(isoDate(dayDate(endDate, daysBetween(form.startDate, startDate))));
    }
    setForm({ ...form, startDate });
  };

  return (
    <Modal
      title="Trip settings"
      onClose={onClose}
      footer={
        <>
          <button
            className="btn danger"
            style={{ marginRight: "auto" }}
            onClick={() => {
              if (confirm(`Delete "${trip.name}" permanently?`)) {
                deleteTrip(trip.id);
                router.push("/");
              }
            }}
          >
            Delete trip
          </button>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={!validRange}
            onClick={() => {
              const { days, ideas } = ops.setDayCount(trip, dayCount);
              updateTrip(trip.id, { ...form, days, ideas });
              onClose();
            }}
          >
            Save
          </button>
        </>
      }
    >
      <div className="grid2">
        <label>
          Trip name
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label>
          Destination
          <input value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value })} />
        </label>
        <label>
          First day
          <input type="date" value={form.startDate} onChange={(e) => changeStart(e.target.value)} />
        </label>
        <label>
          Last day
          <input type="date" min={form.startDate} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </label>
        <label>
          Default way of getting around
          <select
            value={form.defaultMode}
            onChange={(e) => setForm({ ...form, defaultMode: e.target.value as TravelMode })}
          >
            {ROUTABLE_MODES.map((m) => (
              <option key={m} value={m}>
                {MODE_LABEL[m]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="muted" style={{ fontSize: 13 }}>
        {!validRange
          ? `The last day must be on or after the first day, and a trip can have at most ${maxDays} days.`
          : `${dayCount} ${dayCount === 1 ? "day" : "days"}` +
            (dayCount > trip.days.length ? ` · ${dayCount - trip.days.length} empty days added at the end` : "") +
            (dayCount < trip.days.length
              ? ` · the last ${trip.days.length - dayCount} days are removed` +
                (movedCards ? `; their ${movedCards} ${movedCards === 1 ? "card moves" : "cards move"} to Ideas` : "")
              : "")}
      </p>
      <label>
        Interests (AI suggestions use these)
        <input value={form.interests} onChange={(e) => setForm({ ...form, interests: e.target.value })} />
      </label>
    </Modal>
  );
}
