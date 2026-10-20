import { decodePolyline, haversineM, routeKey } from "./geo";
import { findBase, getLeg } from "./timeline";
import { isRoutable, leavesFrom, type Item, type LatLng, type Trip } from "./types";

/** What the trip maps draw – shared by the desktop board and the phone app. */

export const DAY_COLORS = ["#0e7490", "#c2410c", "#7c3aed", "#15803d", "#be185d", "#1d4ed8", "#a16207", "#475569"];
export const dayColor = (index: number) => DAY_COLORS[index % DAY_COLORS.length];
/** Pins closer than this draw on top of each other. */
const SAME_SPOT_M = 50;

export interface Marker {
  key: string;
  item: Item;
  position: LatLng;
  label: string;
  color: string;
  title: string;
  /** A place an organised tour visits, drawn smaller than the card's own pin. */
  stop?: boolean;
  /** That place's name (the card is its tour). */
  stopName?: string;
}

export interface Line {
  key: string;
  path: LatLng[];
  color: string;
  dashed: boolean;
}

export function pinClass(m: Marker, highlightId?: string): string {
  return `pin${m.stop ? " stop" : ""}${highlightId === m.item.id ? " active" : ""}`;
}

export type MapLayers = ReturnType<typeof buildLayers>;

function cardMarker(item: Item, position: LatLng, label: string, color: string): Marker {
  return { key: item.id, item, position, label, color, title: `${label}. ${item.title}` };
}

/** A pin where a flight, ferry or train arrives, joined to its departure by a dashed line. */
function arrivalLayers(item: Item, label: string, color: string): { markers: Marker[]; lines: Line[] } {
  const to = item.transport?.toLocation;
  if (!to || !item.location) return { markers: [], lines: [] };
  return {
    markers: [
      {
        key: `${item.id}#to`,
        item,
        position: to,
        label: `${label}→`,
        color,
        title: `${item.transport?.to ?? to.address ?? "Arrival"} · ${item.title}`,
        stop: true,
        stopName: item.transport?.to ?? to.address,
      },
    ],
    lines: [{ key: `${item.id}-to`, path: [item.location, to], color, dashed: true }],
  };
}

/** Small pins for the places an organised tour visits, and a dashed line from its pick-up point through them. */
function tourLayers(item: Item, pickUp: LatLng, label: string, color: string): { markers: Marker[]; lines: Line[] } {
  const stops = (item.tour?.stops ?? []).flatMap((s, k) => (s.location ? [{ ...s, k, location: s.location }] : []));
  if (!stops.length) return { markers: [], lines: [] };
  return {
    markers: stops.map((s) => ({
      key: `${item.id}#${s.k}`,
      item,
      position: s.location,
      label: `${label}.${s.k + 1}`,
      color,
      title: `${s.name} · ${item.title}`,
      stop: true,
      stopName: s.name,
    })),
    lines: [{ key: `${item.id}-tour`, path: [pickUp, ...stops.map((s) => s.location)], color, dashed: true }],
  };
}

export function buildLayers(trip: Trip, selectedDayId: string | null, onlyItemIds?: Set<string>) {
  const visible = (id: string) => !onlyItemIds || onlyItemIds.has(id);
  const markers: Marker[] = [];
  const lines: Line[] = [];
  const shown = new Set<string>();

  trip.days.forEach((day, d) => {
    if (selectedDayId && selectedDayId !== day.id) return;
    const color = dayColor(d);
    let prev: Item | undefined = findBase(trip, d);
    let n = 0;
    for (const id of day.itemIds) {
      const item = trip.items[id];
      if (!item?.location) continue;
      n++;
      if (!visible(id)) {
        prev = item;
        continue;
      }
      if (!shown.has(id)) {
        const label = item.type === "stay" ? "🏨" : String(n);
        const tour = tourLayers(item, item.location, label, color);
        const arrival = arrivalLayers(item, label, color);
        markers.push(cardMarker(item, item.location, label, color), ...tour.markers, ...arrival.markers);
        lines.push(...tour.lines, ...arrival.lines);
        shown.add(id);
      }
      const origin = prev && leavesFrom(prev);
      if (prev && origin && prev.id !== item.id && visible(prev.id)) {
        const leg = getLeg(trip, prev.id, item.id);
        const fresh =
          isRoutable(leg.mode) && leg.result?.key === routeKey(leg.mode, origin, item.location) && leg.result.polyline;
        lines.push({
          key: `${d}-${prev.id}-${item.id}`,
          path: fresh ? decodePolyline(fresh) : [origin, item.location],
          color,
          dashed: !fresh,
        });
      }
      prev = item;
    }
  });

  if (!selectedDayId) {
    for (const id of trip.ideas) {
      const item = trip.items[id];
      if (item?.location && !shown.has(id)) {
        markers.push(cardMarker(item, item.location, "💡", "#64748b"));
      }
    }
  } else {
    // Show the morning's stay as context for a single day – unless a card already sits there (a tour
    // picking you up at the hotel), whose numbered pin it would hide.
    const index = trip.days.findIndex((d) => d.id === selectedDayId);
    const base = index >= 0 ? findBase(trip, index) : undefined;
    const covered = (at: LatLng) => markers.some((m) => !m.stop && haversineM(m.position, at) < SAME_SPOT_M);
    if (base?.location && !shown.has(base.id) && !covered(base.location)) {
      markers.push(cardMarker(base, base.location, "🏨", dayColor(index)));
    }
  }

  return { markers, lines };
}

