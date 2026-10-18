"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import * as ops from "./tripOps";
import type { ContainerId, Day, Item, Leg, Trip } from "./types";

export { containersOf, createTrip, newDay, newId, parseTripFile } from "./tripOps";

interface State {
  trips: Record<string, Trip>;
  /** updatedAt of each trip as last confirmed by the server (Drive or ~/.tripdeck). */
  synced: Record<string, string>;
  /** Each trip as last agreed with the server: the common ancestor when both sides edited it. */
  bases: Record<string, Trip>;
  /** Trips deleted here that still have to be deleted on the server. */
  deleted: string[];

  saveTrip: (trip: Trip) => void;
  deleteTrip: (tripId: string) => void;
  updateTrip: (tripId: string, patch: Partial<Omit<Trip, "id">>) => void;
  addItem: (tripId: string, item: Item, container: ContainerId, index?: number) => void;
  updateItem: (tripId: string, itemId: string, patch: Partial<Item>) => void;
  removeItem: (tripId: string, itemId: string) => void;
  setContainers: (tripId: string, containers: Record<ContainerId, string[]>) => void;
  /** Reorders one container (used by "apply optimised order"). */
  setContainerOrder: (tripId: string, container: ContainerId, itemIds: string[]) => void;
  moveDay: (tripId: string, from: number, to: number) => void;
  addDay: (tripId: string) => void;
  /** Removes a day; its items go to Ideas so nothing is lost. */
  removeDay: (tripId: string, dayId: string) => void;
  updateDay: (tripId: string, dayId: string, patch: Partial<Omit<Day, "id" | "itemIds">>) => void;
  setLeg: (tripId: string, key: string, patch: Partial<Leg>) => void;

  // Sync bookkeeping (no updatedAt bump)
  receiveTrip: (trip: Trip) => void;
  /** The server now holds exactly `trip`. */
  markSynced: (trip: Trip) => void;
  /** Removes a trip that was deleted elsewhere. */
  dropTrip: (tripId: string) => void;
  clearDeleted: (tripId: string) => void;
}

export const useStore = create<State>()(
  persist(
    (set) => {
      const mutate = (tripId: string, fn: (trip: Trip) => Trip) =>
        set((s) => {
          const trip = s.trips[tripId];
          if (!trip) return s;
          return { trips: { ...s.trips, [tripId]: ops.touch(fn(trip)) } };
        });

      return {
        trips: {},
        synced: {},
        bases: {},
        deleted: [],
        saveTrip: (trip) => set((s) => ({ trips: { ...s.trips, [trip.id]: trip } })),
        deleteTrip: (tripId) =>
          set((s) => {
            const { [tripId]: _removed, ...rest } = s.trips;
            return { trips: rest, deleted: s.synced[tripId] ? [...s.deleted, tripId] : s.deleted };
          }),
        updateTrip: (tripId, patch) => mutate(tripId, (t) => ({ ...t, ...patch })),
        addItem: (tripId, item, container, index) => mutate(tripId, (t) => ops.addItem(t, item, container, index)),
        updateItem: (tripId, itemId, patch) =>
          mutate(tripId, (t) =>
            t.items[itemId] ? { ...t, items: { ...t.items, [itemId]: { ...t.items[itemId], ...patch } } } : t,
          ),
        removeItem: (tripId, itemId) => mutate(tripId, (t) => ops.removeItem(t, itemId)),
        setContainers: (tripId, containers) => mutate(tripId, (t) => ops.withContainers(t, containers)),
        setContainerOrder: (tripId, container, itemIds) =>
          mutate(tripId, (t) => ops.withContainers(t, { [container]: itemIds })),
        moveDay: (tripId, from, to) => mutate(tripId, (t) => ops.moveDay(t, from, to)),
        addDay: (tripId) => mutate(tripId, (t) => ({ ...t, days: [...t.days, ops.newDay()] })),
        removeDay: (tripId, dayId) =>
          mutate(tripId, (t) => {
            const day = t.days.find((d) => d.id === dayId);
            if (!day || t.days.length <= 1) return t;
            return { ...t, days: t.days.filter((d) => d.id !== dayId), ideas: [...t.ideas, ...day.itemIds] };
          }),
        updateDay: (tripId, dayId, patch) =>
          mutate(tripId, (t) => ({ ...t, days: t.days.map((d) => (d.id === dayId ? { ...d, ...patch } : d)) })),
        setLeg: (tripId, key, patch) =>
          mutate(tripId, (t) => {
            const current = t.legs[key] ?? { mode: t.defaultMode };
            return { ...t, legs: { ...t.legs, [key]: { ...current, ...patch } } };
          }),

        receiveTrip: (trip) =>
          set((s) => ({
            trips: { ...s.trips, [trip.id]: trip },
            synced: { ...s.synced, [trip.id]: trip.updatedAt },
            bases: { ...s.bases, [trip.id]: trip },
          })),
        markSynced: (trip) =>
          set((s) => ({ synced: { ...s.synced, [trip.id]: trip.updatedAt }, bases: { ...s.bases, [trip.id]: trip } })),
        dropTrip: (tripId) =>
          set((s) => {
            const { [tripId]: _t, ...trips } = s.trips;
            const { [tripId]: _s, ...synced } = s.synced;
            const { [tripId]: _b, ...bases } = s.bases;
            return { trips, synced, bases };
          }),
        clearDeleted: (tripId) => set((s) => ({ deleted: s.deleted.filter((id) => id !== tripId) })),
      };
    },
    {
      name: "tripdeck",
      version: 2,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ trips: s.trips, synced: s.synced, bases: s.bases, deleted: s.deleted }),
      migrate: (persisted) => ({ synced: {}, bases: {}, deleted: [], ...(persisted as object) }) as unknown as State,
      // Rehydrated manually (useHydrated) so the server and first client render match.
      skipHydration: true,
    },
  ),
);

export function useTrip(tripId: string | null | undefined): Trip | undefined {
  return useStore((s) => (tripId ? s.trips[tripId] : undefined));
}
