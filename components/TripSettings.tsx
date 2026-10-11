"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { MODE_LABEL, ROUTABLE_MODES, type TravelMode, type Trip } from "@/lib/types";
import { Modal } from "./Modal";

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
            onClick={() => {
              updateTrip(trip.id, form);
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
          <input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
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
      <label>
        Interests (AI suggestions use these)
        <input value={form.interests} onChange={(e) => setForm({ ...form, interests: e.target.value })} />
      </label>
    </Modal>
  );
}
