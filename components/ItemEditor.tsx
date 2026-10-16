"use client";

import { useState } from "react";
import { postJSON } from "@/lib/api";
import { centroid } from "@/lib/geo";
import { rentalSummary } from "@/lib/rentals";
import { guessType, itemFieldsFromPlace } from "@/lib/places";
import { newId, useStore } from "@/lib/store";
import { dayDate, formatDayLabel, formatDuration, isoDate } from "@/lib/time";
import { durationOf } from "@/lib/timeline";
import {
  DEFAULT_DURATION_MIN,
  IDEAS,
  ITEM_TYPE_ICON,
  itemIcon,
  ITEM_TYPE_LABEL,
  type AiTips,
  type ContainerId,
  type Gas,
  type Item,
  type ItemType,
  RENTAL_VEHICLE_ICON,
  RENTAL_VEHICLE_LABEL,
  RENTAL_VEHICLES,
  type RentalDetails,
  type RentalVehicle,
  type TransportKind,
  type Trip,
} from "@/lib/types";
import type { PlaceResult } from "@/lib/server/google";
import { Modal, Spinner } from "./Modal";
import { PlaceSearch } from "./PlaceSearch";

export type EditorTarget =
  | { kind: "new"; container: ContainerId; type?: ItemType }
  | { kind: "edit"; itemId: string; tab?: "details" | "tips" };

const RENTAL_COMPANIES = ["Rentalcars.com", "DiscoverCars", "Sixt", "Hertz", "Avis", "Europcar"];
const PROVIDERS = ["Booking.com", "GetYourGuide", "Viator", "Airbnb", "Klook", "Dive centre"];
const NEW_RENTAL: RentalDetails = { vehicle: "car", days: 1 };
const TRANSPORT_KINDS: TransportKind[] = ["flight", "ferry", "train", "bus", "car_rental", "boat", "other"];

/** "Mon 12 Jan → Thu 15 Jan. " for a stay checked in on day `dayIndex`; empty in Ideas. */
function stayRange(trip: Trip, dayIndex: number, nights: number) {
  if (dayIndex < 0) return "";
  return `${formatDayLabel(dayDate(trip.startDate, dayIndex))} → ${formatDayLabel(dayDate(trip.startDate, dayIndex + nights))}. `;
}

export function tripCenter(trip: Trip) {
  return centroid(
    Object.values(trip.items)
      .map((i) => i.location)
      .filter((l): l is NonNullable<typeof l> => !!l),
  );
}

export function ItemEditor({
  trip,
  target,
  ai,
  onClose,
}: {
  trip: Trip;
  target: EditorTarget;
  ai: boolean;
  onClose: () => void;
}) {
  const addItem = useStore((s) => s.addItem);
  const updateItem = useStore((s) => s.updateItem);
  const removeItem = useStore((s) => s.removeItem);
  const existing = target.kind === "edit" ? trip.items[target.itemId] : undefined;
  const preset = target.kind === "new" ? target.type : undefined;
  const [draft, setDraft] = useState<Item>(() => {
    if (!existing) {
      return {
        id: newId(),
        type: preset ?? "place",
        title: "",
        stay: preset === "stay" ? { nights: 1 } : undefined,
        rental: preset === "rental" ? NEW_RENTAL : undefined,
      };
    }
    // Older stays kept the check-in as a fixed start time; it is now a stay field.
    if (existing.type === "stay" && existing.startTime && !existing.stay?.checkIn) {
      return { ...existing, startTime: undefined, stay: { nights: 1, ...existing.stay, checkIn: existing.startTime } };
    }
    return existing;
  });
  const [container, setContainer] = useState<ContainerId>(target.kind === "new" ? target.container : IDEAS);
  const [tab, setTab] = useState<"details" | "tips">(target.kind === "edit" && ai ? (target.tab ?? "details") : "details");
  const [tipsState, setTipsState] = useState<{ loading: boolean; error?: string }>({ loading: false });

  const set = (patch: Partial<Item>) => setDraft((d) => ({ ...d, ...patch }));
  const dayIndex = trip.days.findIndex((d) => d.itemIds.includes(draft.id));

  const pickPlace = (p: PlaceResult) =>
    setDraft((d) => {
      const type = d.title || preset || d.type !== "place" ? d.type : guessType(p);
      return {
        ...d,
        ...itemFieldsFromPlace(p),
        // A rental is named after the vehicle, not the shop it is picked up from.
        title: d.title || (type === "rental" ? "" : p.name),
        type,
        stay: type === "stay" ? (d.stay ?? { nights: 1 }) : d.stay,
        dive: type === "dive" ? (d.dive ?? { dives: 2, gas: "air" }) : d.dive,
      };
    });

  const changeType = (type: ItemType) =>
    setDraft((d) => ({
      ...d,
      type,
      dive: type === "dive" ? (d.dive ?? { dives: 2, gas: "air" }) : d.dive,
      stay: type === "stay" ? (d.stay ?? { nights: 1 }) : d.stay,
      transport: type === "transport" ? (d.transport ?? { kind: "flight" }) : d.transport,
      rental: type === "rental" ? (d.rental ?? NEW_RENTAL) : d.rental,
    }));
  const setRental = (patch: Partial<RentalDetails>) => set({ rental: { ...NEW_RENTAL, ...draft.rental, ...patch } });

  const fetchTips = async () => {
    setTipsState({ loading: true });
    try {
      const { tips, place } = await postJSON<{ tips: AiTips; place?: PlaceResult }>("/api/ai/tips", {
        title: draft.title,
        type: draft.type,
        destination: trip.destination,
        date: dayIndex >= 0 ? isoDate(dayDate(trip.startDate, dayIndex)) : undefined,
        location: draft.location && { lat: draft.location.lat, lng: draft.location.lng, address: draft.location.address },
        placeId: draft.location?.placeId,
        notes: draft.notes,
      });
      const patch = { tips, ...(place ? { place: itemFieldsFromPlace(place).place } : {}) };
      setDraft((d) => ({ ...d, ...patch }));
      // Keep paid-for tips even if the dialog is cancelled.
      if (existing) updateItem(trip.id, existing.id, patch);
      setTipsState({ loading: false });
    } catch (err) {
      setTipsState({ loading: false, error: (err as Error).message });
    }
  };

  const save = () => {
    const fallback = draft.type === "rental" ? `${RENTAL_VEHICLE_LABEL[draft.rental?.vehicle ?? "car"]} rental` : "Untitled";
    const item: Item = { ...draft, title: draft.title.trim() || fallback };
    if (existing) updateItem(trip.id, item.id, item);
    else addItem(trip.id, item, container);
    onClose();
  };

  return (
    <Modal
      title={existing ? `${itemIcon(draft)} ${existing.title}` : "Add to trip"}
      onClose={onClose}
      footer={
        <>
          {existing && (
            <button
              className="btn danger"
              style={{ marginRight: "auto" }}
              onClick={() => {
                if (confirm(`Delete "${existing.title}"?`)) {
                  removeItem(trip.id, existing.id);
                  onClose();
                }
              }}
            >
              Delete
            </button>
          )}
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={save}>
            Save
          </button>
        </>
      }
    >
      {existing && ai && (
        <div className="row">
          <button className={`btn small${tab === "details" ? " primary" : ""}`} onClick={() => setTab("details")}>
            Details
          </button>
          <button className={`btn small${tab === "tips" ? " primary" : ""}`} onClick={() => setTab("tips")}>
            💡 AI tips
          </button>
        </div>
      )}

      {tab === "tips" ? (
        <TipsPanel
          item={draft}
          state={tipsState}
          onFetch={fetchTips}
          onUseDuration={(min) => set({ durationMin: min })}
        />
      ) : (
        <>
          <div className="grid2">
            <label>
              Type
              <select value={draft.type} onChange={(e) => changeType(e.target.value as ItemType)}>
                {(Object.keys(ITEM_TYPE_LABEL) as ItemType[]).map((t) => (
                  <option key={t} value={t}>
                    {ITEM_TYPE_ICON[t]} {ITEM_TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
            </label>
            {!existing && (
              <label>
                Add to
                <select value={container} onChange={(e) => setContainer(e.target.value)}>
                  <option value={IDEAS}>💡 Ideas</option>
                  {trip.days.map((d, i) => (
                    <option key={d.id} value={d.id}>
                      Day {i + 1}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <fieldset>
            <legend>{draft.type === "rental" ? "Pick-up place" : "Place"}</legend>
            <PlaceSearch
              bias={draft.location ?? tripCenter(trip)}
              onPick={pickPlace}
              onCoordinates={(p) => set({ location: { lat: p.lat, lng: p.lng }, place: undefined })}
            />
            {draft.location ? (
              <div className="row small">
                <span className="grow">
                  📍 {draft.location.address ?? `${draft.location.lat.toFixed(5)}, ${draft.location.lng.toFixed(5)}`}
                  {draft.location.elevationM != null && ` · ${Math.round(draft.location.elevationM)} m a.s.l.`}
                </span>
                {draft.place?.googleMapsUri && (
                  <a href={draft.place.googleMapsUri} target="_blank" rel="noreferrer">
                    Google Maps ↗
                  </a>
                )}
                <button className="btn small ghost" onClick={() => set({ location: undefined, place: undefined })}>
                  Clear
                </button>
              </div>
            ) : (
              <div className="small muted">No location yet – routes and the map need one.</div>
            )}
          </fieldset>

          {draft.type === "rental" && (
            <fieldset>
              <legend>Return place</legend>
              <PlaceSearch
                bias={draft.rental?.returnLocation ?? draft.location ?? tripCenter(trip)}
                onPick={(p) =>
                  setRental({
                    returnPlace: p.name,
                    returnLocation: { lat: p.lat, lng: p.lng, address: p.address, placeId: p.placeId },
                  })
                }
                onCoordinates={(p) => setRental({ returnPlace: undefined, returnLocation: { lat: p.lat, lng: p.lng } })}
              />
              {draft.rental?.returnLocation || draft.rental?.returnPlace ? (
                <div className="row small">
                  <span className="grow">
                    📍 {[draft.rental.returnPlace, draft.rental.returnLocation?.address].filter(Boolean).join(", ") ||
                      `${draft.rental.returnLocation!.lat.toFixed(5)}, ${draft.rental.returnLocation!.lng.toFixed(5)}`}
                  </span>
                  <button
                    className="btn small ghost"
                    onClick={() => setRental({ returnPlace: undefined, returnLocation: undefined })}
                  >
                    Clear
                  </button>
                </div>
              ) : (
                <div className="small muted">Same as the pick-up place.</div>
              )}
            </fieldset>
          )}

          <label>
            Title
            <input value={draft.title} onChange={(e) => set({ title: e.target.value })} placeholder="What is it?" />
          </label>

          {draft.type !== "stay" && <div className="grid2">
            <label>
              {draft.type === "rental" ? "Pick-up time" : "Fixed start time (optional)"}
              <input
                type="time"
                value={draft.startTime ?? ""}
                onChange={(e) => set({ startTime: e.target.value || undefined })}
              />
            </label>
            <label>
              Duration (min) – default {formatDuration(DEFAULT_DURATION_MIN[draft.type])}
              <input
                type="number"
                min={0}
                step={15}
                value={draft.durationMin ?? ""}
                placeholder={String(durationOf(draft))}
                onChange={(e) => set({ durationMin: e.target.value === "" ? undefined : Number(e.target.value) })}
              />
            </label>
          </div>}

          {draft.type === "dive" && (
            <fieldset>
              <legend>🤿 Dive</legend>
              <div className="grid2">
                <label>
                  Dive site
                  <input
                    value={draft.dive?.site ?? ""}
                    onChange={(e) => set({ dive: { ...draft.dive!, site: e.target.value } })}
                  />
                </label>
                <label>
                  Dive centre / operator
                  <input
                    value={draft.dive?.center ?? ""}
                    onChange={(e) => set({ dive: { ...draft.dive!, center: e.target.value } })}
                  />
                </label>
                <label>
                  Number of dives
                  <input
                    type="number"
                    min={1}
                    max={5}
                    value={draft.dive?.dives ?? 1}
                    onChange={(e) => set({ dive: { ...draft.dive!, dives: Math.max(1, Number(e.target.value)) } })}
                  />
                </label>
                <label>
                  Planned max depth (m)
                  <input
                    type="number"
                    min={0}
                    max={150}
                    value={draft.dive?.maxDepthM ?? ""}
                    onChange={(e) =>
                      set({ dive: { ...draft.dive!, maxDepthM: e.target.value === "" ? undefined : Number(e.target.value) } })
                    }
                  />
                </label>
                <label>
                  Gas
                  <select
                    value={draft.dive?.gas ?? "air"}
                    onChange={(e) => set({ dive: { ...draft.dive!, gas: e.target.value as Gas } })}
                  >
                    <option value="air">Air</option>
                    <option value="nitrox">Nitrox</option>
                    <option value="trimix">Trimix</option>
                  </select>
                </label>
              </div>
              <div className="small muted">
                TripDeck warns about flights and altitude after diving using DAN&apos;s published guidance. Always follow
                your dive computer and training.
              </div>
            </fieldset>
          )}

          {draft.type === "transport" && (
            <fieldset>
              <legend>✈️ Transport</legend>
              <div className="grid2">
                <label>
                  Kind
                  <select
                    value={draft.transport?.kind ?? "flight"}
                    onChange={(e) => set({ transport: { ...draft.transport, kind: e.target.value as TransportKind } })}
                  >
                    {TRANSPORT_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {k.replace("_", " ")}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Number (flight, train…)
                  <input
                    value={draft.transport?.number ?? ""}
                    onChange={(e) => set({ transport: { kind: "other", ...draft.transport, number: e.target.value } })}
                  />
                </label>
                <label>
                  From
                  <input
                    value={draft.transport?.from ?? ""}
                    onChange={(e) => set({ transport: { kind: "other", ...draft.transport, from: e.target.value } })}
                  />
                </label>
                <label>
                  To
                  <input
                    value={draft.transport?.to ?? ""}
                    onChange={(e) => set({ transport: { kind: "other", ...draft.transport, to: e.target.value } })}
                  />
                </label>
              </div>
            </fieldset>
          )}

          {draft.type === "rental" && (
            <fieldset>
              <legend>🔑 Rental</legend>
              <div className="grid2">
                <label>
                  Vehicle
                  <select value={draft.rental?.vehicle ?? "car"} onChange={(e) => setRental({ vehicle: e.target.value as RentalVehicle })}>
                    {RENTAL_VEHICLES.map((v) => (
                      <option key={v} value={v}>
                        {RENTAL_VEHICLE_ICON[v]} {RENTAL_VEHICLE_LABEL[v]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Days
                  <input
                    type="number"
                    min={1}
                    max={90}
                    value={draft.rental?.days ?? 1}
                    onChange={(e) => setRental({ days: Math.max(1, Number(e.target.value)) })}
                  />
                </label>
                <label>
                  Return by
                  <input
                    type="time"
                    value={draft.rental?.returnTime ?? ""}
                    onChange={(e) => setRental({ returnTime: e.target.value || undefined })}
                  />
                </label>
                <label>
                  Rental company
                  <input
                    list="rental-companies"
                    value={draft.booking?.provider ?? ""}
                    onChange={(e) => set({ booking: { ...draft.booking, provider: e.target.value || undefined } })}
                  />
                  <datalist id="rental-companies">
                    {RENTAL_COMPANIES.map((p) => (
                      <option key={p} value={p} />
                    ))}
                  </datalist>
                </label>
                <label>
                  Order / reference
                  <input
                    value={draft.booking?.reference ?? ""}
                    onChange={(e) => set({ booking: { ...draft.booking, reference: e.target.value || undefined } })}
                  />
                </label>
                <label>
                  Price
                  <input
                    value={draft.booking?.price ?? ""}
                    onChange={(e) => set({ booking: { ...draft.booking, price: e.target.value || undefined } })}
                  />
                </label>
              </div>
              <div className="small muted">
                {rentalSummary(trip, draft, dayIndex >= 0 ? dayIndex : trip.days.findIndex((d) => d.id === container))}. Put the
                card on the pick-up day; every day until the return shows it.
              </div>
            </fieldset>
          )}

          {draft.type === "stay" && (
            <fieldset>
              <legend>🏨 Stay</legend>
              <div className="grid3">
                <label>
                  Nights
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={draft.stay?.nights ?? 1}
                    onChange={(e) => set({ stay: { ...draft.stay, nights: Math.max(1, Number(e.target.value)) } })}
                  />
                </label>
                <label>
                  Check-in from
                  <input
                    type="time"
                    value={draft.stay?.checkIn ?? ""}
                    onChange={(e) => set({ stay: { nights: 1, ...draft.stay, checkIn: e.target.value || undefined } })}
                  />
                </label>
                <label>
                  Check-out by
                  <input
                    type="time"
                    value={draft.stay?.checkOut ?? ""}
                    onChange={(e) => set({ stay: { nights: 1, ...draft.stay, checkOut: e.target.value || undefined } })}
                  />
                </label>
              </div>
              <div className="small muted">
                {stayRange(trip, dayIndex >= 0 ? dayIndex : trip.days.findIndex((d) => d.id === container), draft.stay?.nights ?? 1)}
                The following days start from here.
              </div>
            </fieldset>
          )}

          {draft.type !== "rental" && <fieldset>
            <legend>Booking</legend>
            <div className="grid2">
              <label>
                Provider
                <input
                  list="providers"
                  value={draft.booking?.provider ?? ""}
                  onChange={(e) => set({ booking: { ...draft.booking, provider: e.target.value || undefined } })}
                />
                <datalist id="providers">
                  {PROVIDERS.map((p) => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
              </label>
              <label>
                Reference
                <input
                  value={draft.booking?.reference ?? ""}
                  onChange={(e) => set({ booking: { ...draft.booking, reference: e.target.value || undefined } })}
                />
              </label>
              <label>
                Link
                <input
                  type="url"
                  value={draft.booking?.url ?? ""}
                  onChange={(e) => set({ booking: { ...draft.booking, url: e.target.value || undefined } })}
                />
              </label>
              <label>
                Price
                <input
                  value={draft.booking?.price ?? ""}
                  onChange={(e) => set({ booking: { ...draft.booking, price: e.target.value || undefined } })}
                />
              </label>
            </div>
          </fieldset>}

          <label>
            Notes
            <textarea rows={3} value={draft.notes ?? ""} onChange={(e) => set({ notes: e.target.value || undefined })} />
          </label>
        </>
      )}
    </Modal>
  );
}

function TipsPanel({
  item,
  state,
  onFetch,
  onUseDuration,
}: {
  item: Item;
  state: { loading: boolean; error?: string };
  onFetch: () => void;
  onUseDuration: (min: number) => void;
}) {
  const tips = item.tips;
  return (
    <div className="stack">
      <div className="row">
        <span className="grow muted small">
          Claude writes practical tips using Google&apos;s data for this place. Saved with the card.
        </span>
        <button className="btn ai" onClick={onFetch} disabled={state.loading || !item.title.trim()}>
          {state.loading ? <Spinner /> : "✨"} {tips ? "Refresh tips" : "Get tips"}
        </button>
      </div>
      {state.error && <div className="error">{state.error}</div>}
      {tips && (
        <div className="tips">
          <p style={{ margin: 0 }}>{tips.summary}</p>
          <div>
            <strong>Best time:</strong> {tips.bestTime}
          </div>
          <div className="row">
            <span>
              <strong>Plan for:</strong> {formatDuration(tips.suggestedDurationMin)}
            </span>
            {tips.suggestedDurationMin !== durationOf(item) && (
              <button className="btn small" onClick={() => onUseDuration(tips.suggestedDurationMin)}>
                Use this duration
              </button>
            )}
          </div>
          {tips.tickets && (
            <div>
              <strong>Tickets:</strong> {tips.tickets}
            </div>
          )}
          {tips.parking && (
            <div>
              <strong>Getting there:</strong> {tips.parking}
            </div>
          )}
          <ul>
            {tips.tips.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
          <div className="small muted">AI-generated – double-check prices and hours before you go.</div>
        </div>
      )}
    </div>
  );
}
