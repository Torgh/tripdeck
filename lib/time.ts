/** "HH:MM" -> minutes after midnight. Returns undefined for malformed input. */
export function parseHm(hm: string | undefined): number | undefined {
  if (!hm) return undefined;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm.trim());
  if (!m) return undefined;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return undefined;
  return h * 60 + min;
}

/** Minutes after midnight -> "HH:MM". Values past midnight wrap and get a "+1" suffix. */
export function formatHm(minutes: number): string {
  const total = Math.round(minutes);
  const dayOffset = Math.floor(total / 1440);
  const inDay = ((total % 1440) + 1440) % 1440;
  const h = String(Math.floor(inDay / 60)).padStart(2, "0");
  const m = String(inDay % 60).padStart(2, "0");
  return `${h}:${m}${dayOffset > 0 ? ` +${dayOffset}` : ""}`;
}

export function formatDuration(minutes: number): string {
  const total = Math.round(minutes);
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function formatDistance(meters: number): string {
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(meters < 10000 ? 1 : 0)} km`;
}

/** Date of day `index` of a trip starting on `startDate` ("YYYY-MM-DD"), as a UTC-midnight Date. */
export function dayDate(startDate: string, index: number): Date {
  const [y, m, d] = startDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + index));
}

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Whole days from `startDate` to `date` (both "YYYY-MM-DD"). */
export function daysBetween(startDate: string, date: string): number {
  return Math.round((dayDate(date, 0).getTime() - dayDate(startDate, 0).getTime()) / 86_400_000);
}

export function formatDayLabel(date: Date): string {
  return date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}
