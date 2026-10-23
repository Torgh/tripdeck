import { IDEAS, type ContainerId, type Day, type Trip } from "./types";

/**
 * Three-way merge of a trip edited in two places since they last agreed (`base`): here in the browser
 * (`local`) and on the server, e.g. by Claude through MCP (`remote`). Each card, leg and day setting
 * takes whichever side changed it; when both changed the same field, this browser wins.
 */
export function mergeTrips(base: Trip, local: Trip, remote: Trip): Trip {
  const items = mergeRecords(base.items, local.items, remote.items);
  const days = mergeDays(base.days, local.days, remote.days);
  const merged: Trip = {
    ...remote,
    name: pick(base.name, local.name, remote.name),
    destination: pick(base.destination, local.destination, remote.destination),
    startDate: pick(base.startDate, local.startDate, remote.startDate),
    interests: pick(base.interests, local.interests, remote.interests),
    defaultMode: pick(base.defaultMode, local.defaultMode, remote.defaultMode),
    budget: pick(base.budget, local.budget, remote.budget),
    passports: pick(base.passports, local.passports, remote.passports),
    entry: pick(base.entry, local.entry, remote.entry),
    items,
    legs: mergeRecords(base.legs, local.legs, remote.legs),
    days,
    updatedAt: local.updatedAt > remote.updatedAt ? local.updatedAt : remote.updatedAt,
  };
  return placeItems(merged, base, local, remote);
}

/** The side that changed `base` – this browser when both did. */
function pick<T>(base: T, local: T, remote: T): T {
  return equal(local, base) ? remote : local;
}

/** Per key: added, removed or changed on either side. Objects changed on both sides merge field by field. */
function mergeRecords<T>(base: Record<string, T>, local: Record<string, T>, remote: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const key of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
    const b = base[key];
    const l = local[key];
    const r = remote[key];
    let value: T | undefined;
    if (equal(l, b)) value = r;
    else if (equal(r, b)) value = l;
    // Changed on one side, deleted on the other: keep the edit rather than lose it.
    else if (l === undefined || r === undefined) value = l ?? r;
    else if (isObject(b) && isObject(l) && isObject(r)) value = mergeRecords(b, l, r) as T;
    else value = l;
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function mergeDays(base: Day[], local: Day[], remote: Day[]): Day[] {
  const ids = (days: Day[]) => days.map((d) => d.id);
  const byId = (days: Day[]) => new Map(days.map((d) => [d.id, d]));
  const b = byId(base);
  const l = byId(local);
  const r = byId(remote);
  // Days added on either side, minus days the other side removed; order from whoever reordered.
  const order = pick(ids(base), ids(local), ids(remote));
  const all = [...order, ...ids(local), ...ids(remote)].filter((id, i, list) => list.indexOf(id) === i);
  const kept = all.filter((id) => {
    const removedHere = b.has(id) && !l.has(id);
    const removedThere = b.has(id) && !r.has(id);
    return !removedHere && !removedThere;
  });
  return kept.map((id) => {
    const day = r.get(id) ?? l.get(id)!;
    const startTime = pick(b.get(id)?.startTime, l.get(id)?.startTime, r.get(id)?.startTime) ?? day.startTime;
    return { ...day, startTime };
  });
}

/** Which container each card is in, and the order of every container. */
function containers(trip: Trip): Map<ContainerId, string[]> {
  return new Map<ContainerId, string[]>([[IDEAS, trip.ideas], ...trip.days.map((d) => [d.id, d.itemIds] as const)]);
}

function containerOf(lists: Map<ContainerId, string[]>, itemId: string): ContainerId | undefined {
  for (const [id, list] of lists) if (list.includes(itemId)) return id;
  return undefined;
}

/** Interleaves two edits of one list: `remote`'s order, plus what only `local` has after its predecessor there. */
function mergeOrder(base: string[], local: string[], remote: string[]): string[] {
  if (equal(local, base)) return remote;
  if (equal(remote, base)) return local;
  const out = [...remote];
  local.forEach((id, i) => {
    if (out.includes(id)) return;
    const before = local.slice(0, i).reverse().find((p) => out.includes(p));
    out.splice(before ? out.indexOf(before) + 1 : 0, 0, id);
  });
  return out;
}

function placeItems(merged: Trip, base: Trip, local: Trip, remote: Trip): Trip {
  const [b, l, r] = [containers(base), containers(local), containers(remote)];
  const ids = [IDEAS, ...merged.days.map((d) => d.id)];
  const lists = new Map(ids.map((id) => [id, mergeOrder(b.get(id) ?? [], l.get(id) ?? [], r.get(id) ?? [])]));

  // Each card ends up exactly once: in the container whichever side moved it to.
  const home = (itemId: string) => {
    const [inBase, inLocal, inRemote] = [containerOf(b, itemId), containerOf(l, itemId), containerOf(r, itemId)];
    // A card only one side still has (kept because the other side edited it) stays where that side has it.
    const target = inLocal && inRemote ? pick(inBase, inLocal, inRemote) : (inLocal ?? inRemote);
    return target && lists.has(target) ? target : IDEAS;
  };
  for (const [id, list] of lists) lists.set(id, list.filter((itemId) => merged.items[itemId] && home(itemId) === id));
  for (const itemId of Object.keys(merged.items)) {
    const target = home(itemId);
    if (!lists.get(target)!.includes(itemId)) lists.get(target)!.push(itemId);
  }

  return {
    ...merged,
    ideas: lists.get(IDEAS)!,
    days: merged.days.map((d) => ({ ...d, itemIds: lists.get(d.id)! })),
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Structural equality for JSON data; key order does not matter. */
export function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => equal(v, b[i]));
  }
  if (!isObject(a) || !isObject(b)) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if (!equal(a[k], b[k])) return false;
  return true;
}
