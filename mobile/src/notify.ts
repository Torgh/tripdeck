import { LocalNotifications } from "@capacitor/local-notifications";
import { useSyncExternalStore } from "react";
import type { Lang } from "@/lib/i18n";
import { reminderNumber, tripReminders, type Reminder } from "@/lib/reminders";
import { computeTripTimeline } from "@/lib/timeline";
import type { Trip } from "@/lib/types";

/** Android keeps a limited number of alarms per app; the soonest ones are set, the rest when the app opens again. */
const MAX_SCHEDULED = 60;
const ENABLED_KEY = "tripdeck.reminders";

// ---------- The on/off choice, per phone ----------

const listeners = new Set<() => void>();

function readEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) === "on";
  } catch {
    return false;
  }
}

export function setRemindersEnabled(on: boolean) {
  try {
    localStorage.setItem(ENABLED_KEY, on ? "on" : "off");
  } catch {
    // private storage unavailable: the choice holds until the app closes
  }
  listeners.forEach((l) => l());
}

export function useRemindersEnabled(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    readEnabled,
  );
}

// ---------- Scheduling ----------

export type NotifyPermission = "granted" | "denied" | "prompt";

export async function notifyPermission(ask = false): Promise<NotifyPermission> {
  try {
    const current = (await LocalNotifications.checkPermissions()).display;
    if (current === "granted") return "granted";
    if (!ask) return current === "denied" ? "denied" : "prompt";
    return (await LocalNotifications.requestPermissions()).display === "granted" ? "granted" : "denied";
  } catch {
    return "denied";
  }
}

/** Each trip's reminders still to come, soonest first. */
export function remindersOf(trip: Trip, lang: Lang, now = new Date()): Reminder[] {
  return tripReminders(trip, computeTripTimeline(trip, lang), lang, now);
}

/**
 * Sets the phone's notifications to the reminders of every trip: the ones set before are cancelled (the
 * plan may have changed with a newer import), the soonest `MAX_SCHEDULED` set again. With reminders off,
 * it only cancels. Returns how many are set.
 */
export async function syncReminders(trips: Trip[], lang: Lang, enabled: boolean): Promise<number> {
  try {
    const { notifications } = await LocalNotifications.getPending();
    if (notifications.length) await LocalNotifications.cancel({ notifications: notifications.map((n) => ({ id: n.id })) });
    if (!enabled || (await notifyPermission()) !== "granted") return 0;
    const now = new Date();
    const all = trips
      .flatMap((trip) => remindersOf(trip, lang, now).map((r) => ({ trip, r })))
      .sort((a, b) => a.r.at.getTime() - b.r.at.getTime())
      .slice(0, MAX_SCHEDULED);
    if (!all.length) return 0;
    await LocalNotifications.schedule({
      notifications: all.map(({ trip, r }) => ({
        id: reminderNumber(trip.id, r.key),
        title: r.title,
        body: r.body,
        largeBody: r.body,
        schedule: { at: r.at },
        extra: { tripId: trip.id, dayIndex: r.dayIndex },
      })),
    });
    return all.length;
  } catch (err) {
    console.warn("Could not set the reminders:", err);
    return 0;
  }
}

/** Tapping a reminder opens its trip (on its day). */
export function onReminderTap(open: (tripId: string, dayIndex?: number) => void): () => void {
  const handle = LocalNotifications.addListener("localNotificationActionPerformed", (action) => {
    const extra = action.notification.extra as { tripId?: string; dayIndex?: number } | undefined;
    if (extra?.tripId) open(extra.tripId, extra.dayIndex);
  });
  return () => void handle.then((h) => h.remove());
}
