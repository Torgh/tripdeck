"use client";

import { dayDate, formatDayLabel } from "@/lib/time";
import type { Todo } from "@/lib/todo";
import { BOOKING_STATUS_ICON, BOOKING_STATUS_LABEL, itemIcon, type Trip } from "@/lib/types";
import { Modal } from "./Modal";

/** Bookings still to make or confirm, and nights without a bed – each one click from being sorted out. */
export function TodoDialog({
  trip,
  todos,
  onEdit,
  onAddStay,
  onClose,
}: {
  trip: Trip;
  todos: Todo[];
  onEdit: (itemId: string) => void;
  onAddStay: (dayId: string) => void;
  onClose: () => void;
}) {
  const day = (i: number) => `Day ${i + 1} · ${formatDayLabel(dayDate(trip.startDate, i))}`;
  return (
    <Modal title="📝 To sort out" onClose={onClose}>
      {todos.length === 0 ? (
        <p className="muted">Nothing left: every booking is confirmed and every night has a bed.</p>
      ) : (
        <ul className="todo-list">
          {todos.map((t) =>
            t.kind === "night" ? (
              <li key={`night-${t.dayIndex}`}>
                <span className="grow">
                  🌙 <strong>Night after {day(t.dayIndex)}</strong>
                  <span className="muted"> · nowhere to sleep yet</span>
                </span>
                <button className="btn small" onClick={() => onAddStay(trip.days[t.dayIndex].id)}>
                  + Add stay
                </button>
              </li>
            ) : (
              <li key={t.item.id}>
                <span className="grow">
                  {itemIcon(t.item)} <strong>{t.item.title}</strong>
                  <span className="muted"> · {t.dayIndex === undefined ? "Ideas" : day(t.dayIndex)}</span>
                  <br />
                  <span className={`badge status-${t.status}`}>
                    {BOOKING_STATUS_ICON[t.status]} {BOOKING_STATUS_LABEL[t.status]}
                  </span>
                  {t.item.booking?.provider && <span className="muted"> · {t.item.booking.provider}</span>}
                </span>
                <button className="btn small" onClick={() => onEdit(t.item.id)}>
                  Edit
                </button>
              </li>
            ),
          )}
        </ul>
      )}
    </Modal>
  );
}
