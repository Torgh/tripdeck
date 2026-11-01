"use client";

import { useState } from "react";
import { postJSON } from "@/lib/api";
import { centroid } from "@/lib/geo";
import { formatMoney, parsePrice } from "@/lib/money";
import { rentalSummary } from "@/lib/rentals";
import { guessType, itemFieldsFromPlace } from "@/lib/places";
import { newId, useStore } from "@/lib/store";
import { dayDate, formatDayLabel, formatDuration, formatHm, isoDate, parseHm } from "@/lib/time";
import { durationOf } from "@/lib/timeline";
import {
  DEFAULT_DURATION_MIN,
  IDEAS,
  ITEM_TYPE_ICON,
  itemIcon,
  BOOKING_STATUS_ICON,
  BOOKING_STATUSES,
  DIVE_PREP_ICON,
  divePrepUrl,
  type AiTips,
  type Booking,
  type BookingStatus,
  type ContainerId,
  type Gas,
  type Item,
  type ItemType,
  RENTAL_VEHICLE_ICON,
  RENTAL_VEHICLES,
  type RentalDetails,
  type RentalVehicle,
  type TourStop,
  type TransportKind,
  type Trip,
} from "@/lib/types";
import { useLang, useT } from "@/lib/useLang";
import type { Lang } from "@/lib/i18n";
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
function stayRange(trip: Trip, dayIndex: number, nights: number, lang: Lang) {
  if (dayIndex < 0) return "";
  const day = (i: number) => formatDayLabel(dayDate(trip.startDate, i), lang);
  return `${day(dayIndex)} → ${day(dayIndex + nights)}. `;
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
  const t = useT();
  const lang = useLang();
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
  const stops = draft.tour?.stops ?? [];
  const setStops = (next: TourStop[]) => set({ tour: next.length ? { stops: next } : undefined });
  const moveStop = (from: number, to: number) => {
    const next = [...stops];
    next.splice(to, 0, ...next.splice(from, 1));
    setStops(next);
  };

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
        lang,
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
    const fallback =
      draft.type === "rental" ? t("editor.rentalTitle", { vehicle: t(`vehicle.${draft.rental?.vehicle ?? "car"}`) }) : t("editor.untitled");
    const item: Item = { ...draft, title: draft.title.trim() || fallback };
    if (existing) updateItem(trip.id, item.id, item);
    else addItem(trip.id, item, container);
    onClose();
  };

  return (
    <Modal
      title={existing ? `${itemIcon(draft)} ${existing.title}` : t("editor.addTitle")}
      onClose={onClose}
      footer={
        <>
          {existing && (
            <button
              className="btn danger"
              style={{ marginRight: "auto" }}
              onClick={() => {
                if (confirm(t("editor.deleteConfirm", { title: existing.title }))) {
                  removeItem(trip.id, existing.id);
                  onClose();
                }
              }}
            >
              {t("common.delete")}
            </button>
          )}
          <button className="btn" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button className="btn primary" onClick={save}>
            {t("common.save")}
          </button>
        </>
      }
    >
      {existing && ai && (
        <div className="row">
          <button className={`btn small${tab === "details" ? " primary" : ""}`} onClick={() => setTab("details")}>
            {t("editor.details")}
          </button>
          <button className={`btn small${tab === "tips" ? " primary" : ""}`} onClick={() => setTab("tips")}>
            {t("editor.aiTips")}
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
              {t("editor.type")}
              <select value={draft.type} onChange={(e) => changeType(e.target.value as ItemType)}>
                {(Object.keys(ITEM_TYPE_ICON) as ItemType[]).map((type) => (
                  <option key={type} value={type}>
                    {ITEM_TYPE_ICON[type]} {t(`itemType.${type}`)}
                  </option>
                ))}
              </select>
            </label>
            {!existing && (
              <label>
                {t("editor.addTo")}
                <select value={container} onChange={(e) => setContainer(e.target.value)}>
                  <option value={IDEAS}>{t("editor.ideas")}</option>
                  {trip.days.map((d, i) => (
                    <option key={d.id} value={d.id}>
                      {t("common.day", { day: i + 1 })}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <fieldset>
            <legend>
              {t(draft.type === "rental" ? "editor.pickUpPlace" : draft.type === "activity" ? "editor.placeOrPickUp" : "editor.place")}
            </legend>
            <PlaceSearch
              bias={draft.location ?? tripCenter(trip)}
              onPick={pickPlace}
              onCoordinates={(p) => set({ location: { lat: p.lat, lng: p.lng }, place: undefined })}
            />
            {draft.location ? (
              <div className="row small">
                <span className="grow">
                  📍 {draft.location.address ?? `${draft.location.lat.toFixed(5)}, ${draft.location.lng.toFixed(5)}`}
                  {draft.location.elevationM != null && t("editor.asl", { m: Math.round(draft.location.elevationM) })}
                </span>
                {draft.place?.googleMapsUri && (
                  <a href={draft.place.googleMapsUri} target="_blank" rel="noreferrer">
                    Google Maps ↗
                  </a>
                )}
                <button className="btn small ghost" onClick={() => set({ location: undefined, place: undefined })}>
                  {t("editor.clear")}
                </button>
              </div>
            ) : (
              <div className="small muted">{t("editor.noLocation")}</div>
            )}
            {draft.type === "activity" && <div className="small muted">{t("editor.tourHint")}</div>}
          </fieldset>

          {draft.type === "activity" && (
            <fieldset>
              <legend>{t("editor.tourStops")}</legend>
              <PlaceSearch
                bias={stops.at(-1)?.location ?? draft.location ?? tripCenter(trip)}
                placeholder={t("editor.addStop")}
                onPick={(p) =>
                  setStops([...stops, { name: p.name, location: { lat: p.lat, lng: p.lng, address: p.address, placeId: p.placeId } }])
                }
                onCoordinates={(p) =>
                  setStops([...stops, { name: `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`, location: { lat: p.lat, lng: p.lng } }])
                }
              />
              {stops.length ? (
                <div className="tour-stops">
                  {stops.map((s, i) => (
                    <div key={i} className="row small">
                      <span className="grow">
                        {i + 1}. <strong>{s.name}</strong>
                        {s.location?.address && <span className="muted"> · {s.location.address}</span>}
                      </span>
                      <button className="btn small ghost" title={t("editor.moveUp")} disabled={i === 0} onClick={() => moveStop(i, i - 1)}>
                        ↑
                      </button>
                      <button
                        className="btn small ghost"
                        title={t("editor.moveDown")}
                        disabled={i === stops.length - 1}
                        onClick={() => moveStop(i, i + 1)}
                      >
                        ↓
                      </button>
                      <button className="btn small ghost" onClick={() => setStops(stops.filter((_, k) => k !== i))}>
                        {t("common.remove")}
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="small muted">{t("editor.stopsHint")}</div>
              )}
            </fieldset>
          )}

          {draft.type === "rental" && (
            <fieldset>
              <legend>{t("editor.returnPlace")}</legend>
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
                    {t("editor.clear")}
                  </button>
                </div>
              ) : (
                <div className="small muted">{t("editor.samePlace")}</div>
              )}
            </fieldset>
          )}

          <label>
            {t("editor.title")}
            <input value={draft.title} onChange={(e) => set({ title: e.target.value })} placeholder={t("editor.titlePlaceholder")} />
          </label>

          {draft.type !== "stay" && <div className="grid2">
            <label>
              {t(draft.type === "rental" ? "editor.pickUpTime" : draft.type === "transport" ? "editor.departs" : "editor.fixedStart")}
              <input
                type="time"
                value={draft.startTime ?? ""}
                onChange={(e) => set({ startTime: e.target.value || undefined })}
              />
            </label>
            <label>
              {t("editor.duration", { duration: formatDuration(DEFAULT_DURATION_MIN[draft.type], lang) })}
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
              <legend>{t("editor.dive")}</legend>
              <div className="grid2">
                <label>
                  {t("editor.diveSite")}
                  <input
                    value={draft.dive?.site ?? ""}
                    onChange={(e) => set({ dive: { ...draft.dive!, site: e.target.value } })}
                  />
                </label>
                <label>
                  {t("editor.diveCentre")}
                  <input
                    value={draft.dive?.center ?? ""}
                    onChange={(e) => set({ dive: { ...draft.dive!, center: e.target.value } })}
                  />
                </label>
                <label>
                  {t("editor.dives")}
                  <input
                    type="number"
                    min={1}
                    max={5}
                    value={draft.dive?.dives ?? 1}
                    onChange={(e) => set({ dive: { ...draft.dive!, dives: Math.max(1, Number(e.target.value)) } })}
                  />
                </label>
                <label>
                  {t("editor.maxDepth")}
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
                  {t("editor.gas")}
                  <select
                    value={draft.dive?.gas ?? "air"}
                    onChange={(e) => set({ dive: { ...draft.dive!, gas: e.target.value as Gas } })}
                  >
                    <option value="air">{t("editor.air")}</option>
                    <option value="nitrox">Nitrox</option>
                    <option value="trimix">Trimix</option>
                  </select>
                </label>
                <label>
                  {t("editor.mix")}
                  <input
                    value={draft.dive?.mix ?? ""}
                    placeholder={draft.dive?.gas === "trimix" ? "Tx 18/45" : draft.dive?.gas === "nitrox" ? "EAN32" : ""}
                    onChange={(e) => set({ dive: { ...draft.dive!, mix: e.target.value || undefined } })}
                  />
                </label>
              </div>
              {draft.dive?.prep && (
                <div className={`small prep prep-${draft.dive.prep.status}`}>
                  {DIVE_PREP_ICON[draft.dive.prep.status]} <strong>{t(`divePrep.${draft.dive.prep.status}`)}:</strong> {draft.dive.prep.summary}{" "}
                  {divePrepUrl(draft.dive.prep) && (
                    <a href={divePrepUrl(draft.dive.prep)} target="_blank" rel="noopener noreferrer">
                      {t("editor.openDiveDeck")}
                    </a>
                  )}{" "}
                  <button type="button" className="linklike" onClick={() => set({ dive: { ...draft.dive!, prep: undefined } })}>
                    {t("common.remove")}
                  </button>
                </div>
              )}
              <div className="small muted">{t("editor.diveNote")}</div>
            </fieldset>
          )}

          {draft.type === "transport" && (
            <fieldset>
              <legend>{t("editor.transport")}</legend>
              <div className="grid2">
                <label>
                  {t("editor.kind")}
                  <select
                    value={draft.transport?.kind ?? "flight"}
                    onChange={(e) => set({ transport: { ...draft.transport, kind: e.target.value as TransportKind } })}
                  >
                    {TRANSPORT_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {t(`transportKind.${k}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t("editor.number")}
                  <input
                    value={draft.transport?.number ?? ""}
                    onChange={(e) => set({ transport: { kind: "other", ...draft.transport, number: e.target.value } })}
                  />
                </label>
                <label>
                  {t("editor.from")}
                  <input
                    value={draft.transport?.from ?? ""}
                    onChange={(e) => set({ transport: { kind: "other", ...draft.transport, from: e.target.value } })}
                  />
                </label>
                <label>
                  {t("editor.to")}
                  <input
                    value={draft.transport?.to ?? ""}
                    onChange={(e) => set({ transport: { kind: "other", ...draft.transport, to: e.target.value } })}
                  />
                </label>
                <ArrivalField draft={draft} onDuration={(durationMin) => set({ durationMin })} />
              </div>
              <div className="small">{t("editor.arrivesAt")}</div>
              <PlaceSearch
                bias={draft.transport?.toLocation ?? draft.location ?? tripCenter(trip)}
                onPick={(p) =>
                  set({
                    transport: {
                      kind: "other",
                      ...draft.transport,
                      to: draft.transport?.to || p.name,
                      toLocation: { lat: p.lat, lng: p.lng, address: p.address, placeId: p.placeId },
                    },
                  })
                }
                onCoordinates={(p) =>
                  set({ transport: { kind: "other", ...draft.transport, toLocation: { lat: p.lat, lng: p.lng } } })
                }
              />
              {draft.transport?.toLocation ? (
                <div className="row small">
                  <span className="grow">
                    📍{" "}
                    {draft.transport.toLocation.address ??
                      `${draft.transport.toLocation.lat.toFixed(5)}, ${draft.transport.toLocation.lng.toFixed(5)}`}
                  </span>
                  <button
                    className="btn small ghost"
                    onClick={() => set({ transport: { kind: "other", ...draft.transport, toLocation: undefined } })}
                  >
                    {t("editor.clear")}
                  </button>
                </div>
              ) : (
                <div className="small muted">{t("editor.arrivalHint")}</div>
              )}
            </fieldset>
          )}

          {draft.type === "rental" && (
            <fieldset>
              <legend>{t("editor.rental")}</legend>
              <div className="grid2">
                <label>
                  {t("editor.vehicle")}
                  <select value={draft.rental?.vehicle ?? "car"} onChange={(e) => setRental({ vehicle: e.target.value as RentalVehicle })}>
                    {RENTAL_VEHICLES.map((v) => (
                      <option key={v} value={v}>
                        {RENTAL_VEHICLE_ICON[v]} {t(`vehicle.${v}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t("editor.days")}
                  <input
                    type="number"
                    min={1}
                    max={90}
                    value={draft.rental?.days ?? 1}
                    onChange={(e) => setRental({ days: Math.max(1, Number(e.target.value)) })}
                  />
                </label>
                <label>
                  {t("editor.returnBy")}
                  <input
                    type="time"
                    value={draft.rental?.returnTime ?? ""}
                    onChange={(e) => setRental({ returnTime: e.target.value || undefined })}
                  />
                </label>
                <label>
                  {t("editor.company")}
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
                  {t("editor.reference")}
                  <input
                    value={draft.booking?.reference ?? ""}
                    onChange={(e) => set({ booking: { ...draft.booking, reference: e.target.value || undefined } })}
                  />
                </label>
                <PriceField booking={draft.booking} onChange={(booking) => set({ booking })} />
                <BookingStatusField
                  value={draft.booking?.status}
                  onChange={(status) => set({ booking: { ...draft.booking, status } })}
                />
              </div>
              <div className="small muted">
                {t("editor.rentalHint", {
                  summary: rentalSummary(trip, draft, dayIndex >= 0 ? dayIndex : trip.days.findIndex((d) => d.id === container), lang),
                })}
              </div>
            </fieldset>
          )}

          {draft.type === "stay" && (
            <fieldset>
              <legend>{t("editor.stay")}</legend>
              <div className="grid3">
                <label>
                  {t("editor.nights")}
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={draft.stay?.nights ?? 1}
                    onChange={(e) => set({ stay: { ...draft.stay, nights: Math.max(1, Number(e.target.value)) } })}
                  />
                </label>
                <label>
                  {t("editor.checkIn")}
                  <input
                    type="time"
                    value={draft.stay?.checkIn ?? ""}
                    onChange={(e) => set({ stay: { nights: 1, ...draft.stay, checkIn: e.target.value || undefined } })}
                  />
                </label>
                <label>
                  {t("editor.checkOut")}
                  <input
                    type="time"
                    value={draft.stay?.checkOut ?? ""}
                    onChange={(e) => set({ stay: { nights: 1, ...draft.stay, checkOut: e.target.value || undefined } })}
                  />
                </label>
              </div>
              <div className="small muted">
                {stayRange(trip, dayIndex >= 0 ? dayIndex : trip.days.findIndex((d) => d.id === container), draft.stay?.nights ?? 1, lang)}
                {t("editor.stayHint")}
              </div>
            </fieldset>
          )}

          {draft.type !== "rental" && <fieldset>
            <legend>{t("editor.booking")}</legend>
            <div className="grid2">
              <label>
                {t("editor.provider")}
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
                {t("editor.bookingRef")}
                <input
                  value={draft.booking?.reference ?? ""}
                  onChange={(e) => set({ booking: { ...draft.booking, reference: e.target.value || undefined } })}
                />
              </label>
              <label>
                {t("editor.link")}
                <input
                  type="url"
                  value={draft.booking?.url ?? ""}
                  onChange={(e) => set({ booking: { ...draft.booking, url: e.target.value || undefined } })}
                />
              </label>
              <PriceField booking={draft.booking} onChange={(booking) => set({ booking })} />
              <BookingStatusField
                value={draft.booking?.status}
                onChange={(status) => set({ booking: { ...draft.booking, status } })}
              />
            </div>
          </fieldset>}

          <label>
            {t("editor.notes")}
            <textarea rows={3} value={draft.notes ?? ""} onChange={(e) => set({ notes: e.target.value || undefined })} />
          </label>
        </>
      )}
    </Modal>
  );
}

/**
 * The local arrival time as printed on the ticket. It sets the card's length (local clock, departure to
 * arrival); with both time zones known the board works out the clock change and the real journey time.
 */
function ArrivalField({ draft, onDuration }: { draft: Item; onDuration: (min: number) => void }) {
  const t = useT();
  const leaves = parseHm(draft.startTime);
  if (leaves === undefined) {
    return <div className="small muted">{t("editor.setDeparture")}</div>;
  }
  const arrives = leaves + durationOf(draft);
  const nextDay = arrives >= 1440;
  return (
    <div className="grid2">
      <label>
        {t("editor.arrives")}
        <input
          type="time"
          value={formatHm(arrives % 1440)}
          onChange={(e) => {
            const at = parseHm(e.target.value);
            if (at === undefined) return;
            // Earlier than departure on the clock means it lands the next day.
            onDuration(at - leaves + (nextDay || at < leaves ? 1440 : 0));
          }}
        />
      </label>
      <label className="row">
        <input
          type="checkbox"
          checked={nextDay}
          onChange={(e) => onDuration(Math.max(0, arrives % 1440 - leaves + (e.target.checked ? 1440 : 0)))}
        />
        {t("editor.nextDay")}
      </label>
    </div>
  );
}

/** The price as written, how the budget reads it, and whether it is paid. */
function PriceField({ booking, onChange }: { booking?: Booking; onChange: (booking: Booking) => void }) {
  const t = useT();
  const price = parsePrice(booking?.price);
  const hint = !booking?.price
    ? t("editor.priceHint")
    : !price
      ? t("editor.noAmount")
      : price.currency
        ? t("editor.budget", { amount: formatMoney(price.amount, price.currency) })
        : price.amount
          ? t("editor.addCurrency")
          : t("editor.free");
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <label>
        {t("editor.price")}
        <input
          value={booking?.price ?? ""}
          placeholder="€189"
          onChange={(e) => onChange({ ...booking, price: e.target.value || undefined })}
        />
      </label>
      <div className="row small">
        <span className="grow muted" style={{ color: price && !price.currency && price.amount ? "var(--warn)" : undefined }}>
          {hint}
        </span>
        <label className="row" style={{ gap: 4 }}>
          <input
            type="checkbox"
            style={{ width: "auto" }}
            checked={!!booking?.paid}
            onChange={(e) => onChange({ ...booking, paid: e.target.checked || undefined })}
          />
          {t("editor.paid")}
        </label>
      </div>
    </div>
  );
}

/** Confirmed, waiting for confirmation, or still to book – the last two show up in the trip's to-do list. */
function BookingStatusField({
  value,
  onChange,
}: {
  value?: BookingStatus;
  onChange: (status: BookingStatus | undefined) => void;
}) {
  const t = useT();
  return (
    <label>
      {t("editor.status")}
      <select value={value ?? ""} onChange={(e) => onChange((e.target.value || undefined) as BookingStatus | undefined)}>
        <option value="">{t("editor.notSet")}</option>
        {BOOKING_STATUSES.map((s) => (
          <option key={s} value={s}>
            {BOOKING_STATUS_ICON[s]} {t(`bookingStatus.${s}`)}
          </option>
        ))}
      </select>
    </label>
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
  const t = useT();
  const lang = useLang();
  const tips = item.tips;
  return (
    <div className="stack">
      <div className="row">
        <span className="grow muted small">{t("editor.tipsIntro")}</span>
        <button className="btn ai" onClick={onFetch} disabled={state.loading || !item.title.trim()}>
          {state.loading ? <Spinner /> : "✨"} {t(tips ? "editor.refreshTips" : "editor.getTips")}
        </button>
      </div>
      {state.error && <div className="error">{state.error}</div>}
      {tips && (
        <div className="tips">
          <p style={{ margin: 0 }}>{tips.summary}</p>
          <div>
            <strong>{t("editor.bestTime")}</strong> {tips.bestTime}
          </div>
          <div className="row">
            <span>
              <strong>{t("editor.planFor")}</strong> {formatDuration(tips.suggestedDurationMin, lang)}
            </span>
            {tips.suggestedDurationMin !== durationOf(item) && (
              <button className="btn small" onClick={() => onUseDuration(tips.suggestedDurationMin)}>
                {t("editor.useDuration")}
              </button>
            )}
          </div>
          {tips.tickets && (
            <div>
              <strong>{t("editor.tickets")}</strong> {tips.tickets}
            </div>
          )}
          {tips.parking && (
            <div>
              <strong>{t("editor.gettingThere")}</strong> {tips.parking}
            </div>
          )}
          <ul>
            {tips.tips.map((tip, i) => (
              <li key={i}>{tip}</li>
            ))}
          </ul>
          <div className="small muted">{t("editor.aiNote")}</div>
        </div>
      )}
    </div>
  );
}
