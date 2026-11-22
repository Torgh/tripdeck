import { useState } from "react";
import { LOCALE } from "@/lib/i18n";
import type { Reminder } from "@/lib/reminders";
import { useLang, useT } from "@/lib/useLang";
import { notifyPermission, setRemindersEnabled, useRemindersEnabled } from "./notify";

/** The trip's reminders still to come, and the switch that sets them as notifications on this phone. */
export function RemindersView({ reminders, onDay }: { reminders: Reminder[]; onDay: (dayIndex: number) => void }) {
  const t = useT();
  const lang = useLang();
  const enabled = useRemindersEnabled();
  const [denied, setDenied] = useState(false);

  const toggle = async (on: boolean) => {
    if (on && (await notifyPermission(true)) !== "granted") {
      setDenied(true);
      return;
    }
    setDenied(false);
    setRemindersEnabled(on);
  };
  const when = (at: Date) =>
    at.toLocaleString(LOCALE[lang], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <>
      <div className="day-head">
        <h2>{t("reminders.heading")}</h2>
      </div>
      <p className="muted small">{t("reminders.intro")}</p>
      <label className="switch-row">
        <input type="checkbox" checked={enabled} onChange={(e) => void toggle(e.target.checked)} />
        <span>{t("reminders.on")}</span>
      </label>
      {denied && <div className="issue warn">{t("reminders.denied")}</div>}
      {!enabled && !denied && <p className="muted small">{t("reminders.off")}</p>}
      {reminders.length === 0 ? (
        <p className="empty muted">{t("reminders.none")}</p>
      ) : (
        <ul className="reminder-list">
          {reminders.map((r) => (
            <li key={r.key}>
              <button className="reminder" onClick={() => r.dayIndex !== undefined && onDay(r.dayIndex)}>
                <span className="muted small">{when(r.at)}</span>
                <strong>{r.title}</strong>
                <span className="small reminder-body">{r.body}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">{t("reminders.howTo")}</p>
    </>
  );
}
