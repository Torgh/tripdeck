"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { VEHICLE_MODE } from "@/lib/rentals";
import { useStore } from "@/lib/store";
import { dayDate, daysBetween, isoDate } from "@/lib/time";
import * as ops from "@/lib/tripOps";
import { ROUTABLE_MODES, type TravelMode, type Trip } from "@/lib/types";
import { useT } from "@/lib/useLang";
import { Modal } from "./Modal";

const MAX_DAYS = 60;

export function TripSettings({ trip, onClose }: { trip: Trip; onClose: () => void }) {
  const t = useT();
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
      title={t("tripSettings.title")}
      onClose={onClose}
      footer={
        <>
          <button
            className="btn danger"
            style={{ marginRight: "auto" }}
            onClick={() => {
              if (confirm(t("tripSettings.deleteConfirm", { name: trip.name }))) {
                deleteTrip(trip.id);
                router.push("/");
              }
            }}
          >
            {t("tripSettings.deleteTrip")}
          </button>
          <button className="btn" onClick={onClose}>
            {t("common.cancel")}
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
            {t("common.save")}
          </button>
        </>
      }
    >
      <div className="grid2">
        <label>
          {t("home.tripName")}
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label>
          {t("home.destination")}
          <input value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value })} />
        </label>
        <label>
          {t("home.firstDay")}
          <input type="date" value={form.startDate} onChange={(e) => changeStart(e.target.value)} />
        </label>
        <label>
          {t("home.lastDay")}
          <input type="date" min={form.startDate} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </label>
        <label>
          {t("tripSettings.defaultMode")}
          <select
            value={form.defaultMode}
            onChange={(e) => setForm({ ...form, defaultMode: e.target.value as TravelMode })}
          >
            {ROUTABLE_MODES.map((m) => (
              <option key={m} value={m}>
                {t(`mode.${m}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {Object.values(trip.items).some((i) => i.rental && VEHICLE_MODE[i.rental.vehicle] === form.defaultMode) && (
        <p className="muted" style={{ fontSize: 13 }}>
          {t("tripSettings.rentedMode")}
        </p>
      )}
      <p className="muted" style={{ fontSize: 13 }}>
        {!validRange
          ? t("tripSettings.invalidRange", { max: maxDays })
          : t("tripSettings.days", { n: dayCount }) +
            (dayCount > trip.days.length ? t("tripSettings.added", { n: dayCount - trip.days.length }) : "") +
            (dayCount < trip.days.length
              ? t("tripSettings.removed", { n: trip.days.length - dayCount }) +
                (movedCards ? t("tripSettings.cardsMove", { n: movedCards }) : "")
              : "")}
      </p>
      <label>
        {t("tripSettings.interests")}
        <input value={form.interests} onChange={(e) => setForm({ ...form, interests: e.target.value })} />
      </label>
    </Modal>
  );
}
