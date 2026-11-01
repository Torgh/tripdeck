"use client";

import { flag } from "@/lib/entry";
import { dayDate, formatDayLabel } from "@/lib/time";
import type { Todo } from "@/lib/todo";
import { BOOKING_STATUS_ICON, itemIcon, type Trip } from "@/lib/types";
import { useLang, useT } from "@/lib/useLang";
import { Modal } from "./Modal";

/** Visas and forms to apply for, bookings still to make or confirm, and nights without a bed – each one click from being sorted out. */
export function TodoDialog({
  trip,
  todos,
  onEdit,
  onAddStay,
  onEntry,
  onClose,
}: {
  trip: Trip;
  todos: Todo[];
  onEdit: (itemId: string) => void;
  onAddStay: (dayId: string) => void;
  onEntry: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const lang = useLang();
  const day = (i: number) => `${t("common.day", { day: i + 1 })} · ${formatDayLabel(dayDate(trip.startDate, i), lang)}`;
  return (
    <Modal title={t("todoDialog.title")} onClose={onClose}>
      {todos.length === 0 ? (
        <p className="muted">{t("todoDialog.empty")}</p>
      ) : (
        <ul className="todo-list">
          {todos.map((todo) =>
            todo.kind === "entry" ? (
              <li key={`entry-${todo.country.code}-${todo.requirement.title}`}>
                <span className="grow">
                  {flag(todo.country.code)} <strong>{todo.requirement.title}</strong>
                  <span className="muted"> · {todo.country.name}</span>
                  {todo.requirement.dueBy && (
                    <>
                      <br />
                      <span className="badge status-pending">
                        {t("todoDialog.by", { date: formatDayLabel(dayDate(todo.requirement.dueBy, 0), lang) })}
                      </span>
                    </>
                  )}
                </span>
                <button className="btn small" onClick={onEntry}>
                  {t("todoDialog.details")}
                </button>
              </li>
            ) : todo.kind === "night" ? (
              <li key={`night-${todo.dayIndex}`}>
                <span className="grow">
                  🌙 <strong>{t("todoDialog.nightAfter", { day: day(todo.dayIndex) })}</strong>
                  <span className="muted">{t("todoDialog.nowhere")}</span>
                </span>
                <button className="btn small" onClick={() => onAddStay(trip.days[todo.dayIndex].id)}>
                  {t("todoDialog.addStay")}
                </button>
              </li>
            ) : (
              <li key={todo.item.id}>
                <span className="grow">
                  {itemIcon(todo.item)} <strong>{todo.item.title}</strong>
                  <span className="muted"> · {todo.dayIndex === undefined ? t("common.ideas") : day(todo.dayIndex)}</span>
                  <br />
                  <span className={`badge status-${todo.status}`}>
                    {BOOKING_STATUS_ICON[todo.status]} {t(`bookingStatus.${todo.status}`)}
                  </span>
                  {todo.item.booking?.provider && <span className="muted"> · {todo.item.booking.provider}</span>}
                </span>
                <button className="btn small" onClick={() => onEdit(todo.item.id)}>
                  {t("common.edit")}
                </button>
              </li>
            ),
          )}
        </ul>
      )}
    </Modal>
  );
}
