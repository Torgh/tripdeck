import { translator, type Lang, LOCALE } from "./i18n";
import { tripDates, tripDayTitle } from "./itinerary";
import { nightsOf } from "./stays";
import { formatHm } from "./time";
import type { DayTimeline } from "./timeline";
import { itemIcon, type Item, type Trip } from "./types";

/**
 * A read-only copy of the plan as one self-contained web page, for travel companions: no app, no
 * account and no internet needed – open it in any browser, or send it in a chat. What it shows of the
 * bookings is chosen when it is made.
 */
export interface ShareOptions {
  lang?: Lang;
  /** Prices, paid and what is paid on site. */
  prices: boolean;
  /** Booking providers and references (needed at check-in, but private to some). */
  references: boolean;
  /** The cards' notes. */
  notes: boolean;
  now?: Date;
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const STYLE = `
:root{color-scheme:light dark;--bg:#f8fafc;--card:#fff;--text:#0f172a;--muted:#64748b;--line:#e2e8f0;--accent:#0e7490;--sun:#c2410c}
@media (prefers-color-scheme:dark){:root{--bg:#160f24;--card:#1f1631;--text:#ede9fe;--muted:#a79bc2;--line:#2f2447;--accent:#67e8f9;--sun:#fdba74}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
header{padding:20px 16px 12px;border-bottom:3px solid;border-image:linear-gradient(90deg,#fb923c,#f43f5e 60%,#be185d) 1}
h1{margin:0;font-size:1.5rem}h2{margin:0 0 8px;font-size:1.05rem}
main{max-width:760px;margin:0 auto;padding:12px 16px 32px}
section{margin:18px 0}ol{list-style:none;margin:0;padding:0;display:grid;gap:8px}
li{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px 12px;display:grid;grid-template-columns:4.2em 1fr;gap:2px 10px}
time{grid-row:span 4;font-variant-numeric:tabular-nums;color:var(--muted);font-size:.9em}time b{color:var(--text)}
.t{font-weight:600}.s,.muted{color:var(--muted);font-size:.9em}.b{font-size:.9em;color:var(--accent)}.n{white-space:pre-line;font-size:.9em;margin:2px 0 0}
.night{margin:8px 0 0;padding:6px 12px;border-radius:10px;background:var(--card);border:1px dashed var(--line);font-size:.9em}
.ideas li{grid-template-columns:1fr}footer{color:var(--muted);font-size:.85em;margin-top:28px}
@media print{body{background:#fff}li,.night{break-inside:avoid}}
`;

function subtitle(item: Item): string | undefined {
  if (item.type === "transport") {
    const tr = item.transport;
    return [[tr?.from, tr?.to].filter(Boolean).join(" → "), tr?.number].filter(Boolean).join(" · ") || item.location?.address;
  }
  if (item.tour?.stops.length) return `${item.location?.address ? `${item.location.address} · ` : ""}${item.tour.stops.map((s) => s.name).join(" → ")}`;
  return item.location?.address;
}

/** The page's HTML. */
export function tripShareHtml(trip: Trip, timelines: DayTimeline[], options: ShareOptions): string {
  const { lang = "en", now = new Date() } = options;
  const t = translator(lang);
  const e = escapeHtml;
  const nights = nightsOf(trip);

  const card = (item: Item, times?: { start: number; end: number; fixed: boolean }) => {
    const b = item.booking;
    const booking = [
      b?.status && t(`bookingStatus.${b.status}`),
      options.references && b?.provider,
      options.references && b?.reference && `#${b.reference}`,
      options.prices && b?.price && `${b.price}${b.paid ? ` ✓ ${t("share.paid")}` : ""}`,
      options.prices && b?.onSite && `${t("ics.onSite")}: ${b.onSite}${b.cash ? ` (${t("ics.cash")})` : ""}`,
    ].filter(Boolean) as string[];
    const sub = subtitle(item);
    return [
      "<li>",
      times ? `<time><b>${times.fixed ? "" : "~"}${formatHm(times.start)}</b><br>${formatHm(times.end)}</time>` : "",
      `<div class="t">${itemIcon(item)} ${e(item.title)}</div>`,
      sub ? `<div class="s">${e(sub)}</div>` : "",
      booking.length ? `<div class="b">${e(booking.join(" · "))}</div>` : "",
      options.notes && item.notes ? `<p class="n">${e(item.notes)}</p>` : "",
      "</li>",
    ].join("");
  };

  const days = timelines.map((tl, d) => {
    const night = nights[d];
    const nightLine =
      night?.kind === "stay"
        ? `🌙 ${e(night.stay.title)}${night.nights > 1 ? ` · ${e(t("share.nightOf", { n: night.night, nights: night.nights }))}` : ""}`
        : night?.kind === "transport"
          ? `🌙 ${e(t("share.overnight", { title: night.item.title }))}`
          : "";
    const items = tl.entries
      .map((en) => trip.items[en.itemId] && card(trip.items[en.itemId], en))
      .filter(Boolean)
      .join("");
    return `<section><h2>${e(tripDayTitle(trip, d, lang))}</h2>${items ? `<ol>${items}</ol>` : `<p class="muted">${e(t("share.free"))}</p>`}${nightLine ? `<p class="night">${nightLine}</p>` : ""}</section>`;
  });

  const ideas = trip.ideas.map((id) => trip.items[id]).filter(Boolean);
  const made = now.toLocaleDateString(LOCALE[lang], { day: "numeric", month: "long", year: "numeric" });

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${e(trip.name)}</title>
<style>${STYLE}</style>
</head>
<body>
<header><h1>${e(trip.name)}</h1><div class="muted">${e([trip.destination, tripDates(trip, lang)].filter(Boolean).join(" · "))}</div></header>
<main>
${days.join("\n")}
${ideas.length ? `<section class="ideas"><h2>💡 ${e(t("common.ideas"))}</h2><ol>${ideas.map((i) => card(i)).join("")}</ol></section>` : ""}
<footer>${e(t("share.footer", { date: made }))}</footer>
</main>
</body>
</html>
`;
}
