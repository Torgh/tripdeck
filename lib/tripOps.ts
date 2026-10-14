import { nanoid } from "nanoid";
import { IDEAS, type ContainerId, type Day, type Item, type TravelMode, type Trip } from "./types";

/** Pure trip operations shared by the browser store and the MCP server. */

export const newId = () => nanoid(10);

export function newDay(): Day {
  return { id: newId(), itemIds: [], startTime: "09:00" };
}

export function createTrip(init: {
  name: string;
  destination: string;
  startDate: string;
  days: number;
  interests?: string;
  defaultMode?: TravelMode;
}): Trip {
  return {
    id: newId(),
    name: init.name,
    destination: init.destination,
    startDate: init.startDate,
    interests: init.interests ?? "",
    defaultMode: init.defaultMode ?? "DRIVE",
    days: Array.from({ length: Math.max(1, init.days) }, newDay),
    ideas: [],
    items: {},
    legs: {},
    updatedAt: new Date().toISOString(),
  };
}

/** Grow or shrink the trip to `count` days; cards from removed days move to Ideas. */
export function setDayCount(trip: Trip, count: number): Trip {
  const n = Math.max(1, Math.floor(count));
  if (n >= trip.days.length) {
    return { ...trip, days: [...trip.days, ...Array.from({ length: n - trip.days.length }, newDay)] };
  }
  const removed = trip.days.slice(n);
  return { ...trip, days: trip.days.slice(0, n), ideas: [...trip.ideas, ...removed.flatMap((d) => d.itemIds)] };
}

export function touch(trip: Trip): Trip {
  return { ...trip, updatedAt: new Date().toISOString() };
}

/** Container id -> ordered item ids. */
export function containersOf(trip: Trip): Record<ContainerId, string[]> {
  const out: Record<ContainerId, string[]> = { [IDEAS]: trip.ideas };
  for (const d of trip.days) out[d.id] = d.itemIds;
  return out;
}

export function withContainers(trip: Trip, containers: Record<ContainerId, string[]>): Trip {
  return {
    ...trip,
    ideas: containers[IDEAS] ?? trip.ideas,
    days: trip.days.map((d) => (containers[d.id] ? { ...d, itemIds: containers[d.id] } : d)),
  };
}

export function containerOfItem(trip: Trip, itemId: string): ContainerId | undefined {
  if (trip.ideas.includes(itemId)) return IDEAS;
  return trip.days.find((d) => d.itemIds.includes(itemId))?.id;
}

function detach(trip: Trip, itemId: string): Trip {
  return {
    ...trip,
    ideas: trip.ideas.filter((id) => id !== itemId),
    days: trip.days.map((d) => ({ ...d, itemIds: d.itemIds.filter((id) => id !== itemId) })),
  };
}

function insertAt(list: string[], id: string, index?: number): string[] {
  const out = [...list];
  out.splice(index == null ? out.length : Math.max(0, Math.min(index, out.length)), 0, id);
  return out;
}

export function addItem(trip: Trip, item: Item, container: ContainerId, index?: number): Trip {
  const containers = containersOf(trip);
  const target = containers[container] ? container : IDEAS;
  return withContainers(
    { ...trip, items: { ...trip.items, [item.id]: item } },
    { [target]: insertAt(containers[target], item.id, index) },
  );
}

export function moveItem(trip: Trip, itemId: string, container: ContainerId, index?: number): Trip {
  const detached = detach(trip, itemId);
  const containers = containersOf(detached);
  const target = containers[container] ? container : IDEAS;
  return withContainers(detached, { [target]: insertAt(containers[target], itemId, index) });
}

export function removeItem(trip: Trip, itemId: string): Trip {
  const { [itemId]: _removed, ...items } = trip.items;
  const legs = Object.fromEntries(Object.entries(trip.legs).filter(([k]) => !k.split(">").includes(itemId)));
  return { ...detach(trip, itemId), items, legs };
}

export function moveDay(trip: Trip, from: number, to: number): Trip {
  const days = [...trip.days];
  const [moved] = days.splice(from, 1);
  days.splice(to, 0, moved);
  return { ...trip, days };
}

/** Sets a day's order. `itemIds` must be a permutation of the day's current cards. */
export function reorderDay(trip: Trip, dayId: string, itemIds: string[]): Trip {
  const day = trip.days.find((d) => d.id === dayId);
  if (!day) throw new Error("Unknown day.");
  const current = new Set(day.itemIds);
  if (itemIds.length !== current.size || new Set(itemIds).size !== current.size || !itemIds.every((id) => current.has(id))) {
    throw new Error("item_ids must list every card of that day exactly once.");
  }
  return withContainers(trip, { [dayId]: itemIds });
}
