import { Preferences } from "@capacitor/preferences";
import type { Trip } from "@/lib/types";

// Android keeps these in the app's own SharedPreferences: they survive restarts and work offline.
// In a desktop browser (bun run dev:mobile) Preferences falls back to localStorage.
const KEY = "trips";

export async function loadTrips(): Promise<Record<string, Trip>> {
  const { value } = await Preferences.get({ key: KEY });
  if (!value) return {};
  try {
    return JSON.parse(value) as Record<string, Trip>;
  } catch {
    return {};
  }
}

export async function saveTrips(trips: Record<string, Trip>): Promise<void> {
  await Preferences.set({ key: KEY, value: JSON.stringify(trips) });
}
