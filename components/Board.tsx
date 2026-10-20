"use client";

import {
  closestCenter,
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { routeKey } from "@/lib/geo";
import { dayColor } from "@/lib/mapLayers";
import { rentalsOf, type RentalDay } from "@/lib/rentals";
import { nightsOf, stayColorIndex, type Night } from "@/lib/stays";
import { containersOf, useStore } from "@/lib/store";
import { formatDayLabel, formatDistance, formatDuration, formatHm } from "@/lib/time";
import { getLeg, type DayTimeline, type Issue, type TimelineEntry } from "@/lib/timeline";
import {
  IDEAS,
  isRoutable,
  itemIcon,
  leavesFrom,
  legKey,
  MANUAL_MODES,
  MODE_LABEL,
  ROUTABLE_MODES,
  type ContainerId,
  type Item,
  type TravelMode,
  type Trip,
} from "@/lib/types";

/** Hues kept apart from DAY_COLORS so a stay never looks like a day. */
export const STAY_COLORS = ["#0d9488", "#d97706", "#db2777", "#4f46e5", "#65a30d", "#dc2626", "#0891b2", "#9333ea"];
/** Rentals get their own, earthier hues so they do not read as a hotel. */
export const RENTAL_COLORS = ["#b45309", "#57534e", "#0f766e", "#9f1239"];

const COL = "col:";

export interface BoardHandlers {
  onSelectDay: (dayId: string | null) => void;
  onHighlight: (itemId: string) => void;
  onEdit: (itemId: string, tab?: "details" | "tips") => void;
  onAdd: (container: ContainerId, type?: Item["type"]) => void;
  onSuggest: (container: ContainerId, anchorItemId?: string) => void;
  onOptimize: (dayId: string) => void;
}

interface BoardProps extends BoardHandlers {
  trip: Trip;
  /** In-app AI configured (API key). Without it Suggest/Optimize use maps data and the algorithm only. */
  ai: boolean;
  timelines: DayTimeline[];
  warnings: Map<string, Issue[]>;
  highlightId?: string;
  selectedDayId: string | null;
}

type Containers = Record<ContainerId, string[]>;

function findIn(containers: Containers, id: string): ContainerId | undefined {
  if (id.startsWith(COL)) return id.slice(COL.length);
  return Object.keys(containers).find((k) => containers[k].includes(id));
}

export function Board(props: BoardProps) {
  const { trip } = props;
  const setContainers = useStore((s) => s.setContainers);
  const moveDay = useStore((s) => s.moveDay);
  const [drag, setDrag] = useState<Containers | null>(null);
  const dragRef = useRef<Containers | null>(null);
  const [active, setActive] = useState<{ type: "item" | "column"; id: string } | null>(null);
  const containers = drag ?? containersOf(trip);
  const nights = useMemo(() => nightsOf(trip), [trip]);
  const staySlots = useMemo(() => stayColorIndex(nights), [nights]);
  const rentals = useMemo(() => rentalsOf(trip), [trip]);
  const rentalColors = useMemo(() => {
    const ids = [...new Set(rentals.flat().map((r) => r.rental.id))];
    return new Map(ids.map((id, i) => [id, RENTAL_COLORS[i % RENTAL_COLORS.length]]));
  }, [rentals]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const updateDrag = (next: Containers | null) => {
    dragRef.current = next;
    setDrag(next);
  };

  const collision: CollisionDetection = (args) => {
    if (active?.type === "column") {
      return closestCenter({
        ...args,
        droppableContainers: args.droppableContainers.filter(
          (c) => String(c.id).startsWith(COL) && c.id !== COL + IDEAS,
        ),
      });
    }
    const within = pointerWithin(args);
    const overItems = within.filter((c) => !String(c.id).startsWith(COL));
    if (overItems.length) return overItems;
    const column = within.find((c) => String(c.id).startsWith(COL));
    if (column) {
      // In a column gap: snap to the nearest card of that column, or the column itself if empty.
      const ids = new Set((dragRef.current ?? containers)[String(column.id).slice(COL.length)] ?? []);
      const cards = args.droppableContainers.filter((c) => ids.has(String(c.id)));
      return cards.length ? closestCenter({ ...args, droppableContainers: cards }) : [column];
    }
    return closestCorners(args);
  };

  const onDragStart = ({ active: a }: DragStartEvent) => {
    const type = a.data.current?.type === "column" ? "column" : "item";
    setActive({ type, id: String(a.id) });
    if (type === "item") updateDrag(containersOf(trip));
  };

  const onDragOver = ({ active: a, over }: DragOverEvent) => {
    const current = dragRef.current;
    if (!over || !current || a.data.current?.type === "column") return;
    const activeId = String(a.id);
    const overId = String(over.id);
    const from = findIn(current, activeId);
    const to = findIn(current, overId);
    if (!from || !to || from === to) return;
    const toList = current[to].filter((id) => id !== activeId);
    let index = overId.startsWith(COL) ? toList.length : toList.indexOf(overId);
    const translated = a.rect.current.translated;
    if (!overId.startsWith(COL) && translated && translated.top > over.rect.top + over.rect.height / 2) index += 1;
    if (index < 0) index = toList.length;
    toList.splice(index, 0, activeId);
    updateDrag({ ...current, [from]: current[from].filter((id) => id !== activeId), [to]: toList });
  };

  const onDragEnd = ({ active: a, over }: DragEndEvent) => {
    if (a.data.current?.type === "column") {
      const from = trip.days.findIndex((d) => COL + d.id === a.id);
      const to = trip.days.findIndex((d) => COL + d.id === over?.id);
      if (from >= 0 && to >= 0 && from !== to) moveDay(trip.id, from, to);
    } else if (dragRef.current) {
      let next = dragRef.current;
      const activeId = String(a.id);
      const container = findIn(next, activeId);
      if (over && container && findIn(next, String(over.id)) === container && !String(over.id).startsWith(COL)) {
        const list = next[container];
        const oldIndex = list.indexOf(activeId);
        const newIndex = list.indexOf(String(over.id));
        if (oldIndex !== newIndex) next = { ...next, [container]: arrayMove(list, oldIndex, newIndex) };
      }
      setContainers(trip.id, next);
    }
    updateDrag(null);
    setActive(null);
  };

  const onDragCancel = () => {
    updateDrag(null);
    setActive(null);
  };

  const activeItem = active?.type === "item" ? trip.items[active.id] : undefined;
  const activeDayIndex = active?.type === "column" ? trip.days.findIndex((d) => COL + d.id === active.id) : -1;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      <div className="board">
        <IdeasColumn {...props} itemIds={containers[IDEAS]} dragging={!!drag} />
        <SortableContext items={trip.days.map((d) => COL + d.id)} strategy={rectSortingStrategy}>
          {trip.days.map((day, i) => (
            <DayColumn
              key={day.id}
              {...props}
              dayIndex={i}
              itemIds={containers[day.id] ?? []}
              dragging={!!drag}
              night={nights[i]}
              rentals={rentals[i]}
              rentalColors={rentalColors}
              nightColor={nights[i]?.kind === "stay" ? STAY_COLORS[staySlots.get(nights[i].colorKey)! % STAY_COLORS.length] : undefined}
            />
          ))}
        </SortableContext>
        <AddDayButton tripId={trip.id} />
      </div>
      <DragOverlay>
        {activeItem ? (
          <div className="item overlay">
            <div className="head">
              <span>{itemIcon(activeItem)}</span>
              <span className="title">{activeItem.title}</span>
            </div>
          </div>
        ) : activeDayIndex >= 0 ? (
          <div className="column" style={{ opacity: 0.9 }}>
            <div className="column-head">
              <strong>
                Day {activeDayIndex + 1} · {trip.days[activeDayIndex].itemIds.length} items
              </strong>
            </div>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function AddDayButton({ tripId }: { tripId: string }) {
  const addDay = useStore((s) => s.addDay);
  return (
    <button className="btn" style={{ flex: "none" }} onClick={() => addDay(tripId)}>
      + Day
    </button>
  );
}

function IdeasColumn(props: BoardProps & { itemIds: string[]; dragging: boolean }) {
  const { setNodeRef } = useDroppable({ id: COL + IDEAS, data: { type: "column" } });
  return (
    <section ref={setNodeRef} className="column">
      <div className="column-head">
        <div className="title">
          <h2 className="grow">💡 Ideas & unscheduled</h2>
        </div>
        <div className="row">
          <button className="btn small" onClick={() => props.onAdd(IDEAS)}>
            + Add
          </button>
          <button className="btn small ai" onClick={() => props.onSuggest(IDEAS)}>
            {props.ai ? "✨ Suggest" : "🔍 Nearby"}
          </button>
        </div>
      </div>
      <ColumnBody {...props} empty="Drop places here to keep them for later.">
        <SortableContext items={props.itemIds} strategy={verticalListSortingStrategy}>
          {props.itemIds.map((id) =>
            props.trip.items[id] ? <SortableItem key={id} item={props.trip.items[id]} {...props} /> : null,
          )}
        </SortableContext>
      </ColumnBody>
    </section>
  );
}

function DayColumn(
  props: BoardProps & {
    dayIndex: number;
    itemIds: string[];
    dragging: boolean;
    night?: Night;
    nightColor?: string;
    rentals?: RentalDay[];
    rentalColors: Map<string, string>;
  },
) {
  const { trip, dayIndex, timelines, selectedDayId } = props;
  const day = trip.days[dayIndex];
  const tl = timelines[dayIndex];
  const updateDay = useStore((s) => s.updateDay);
  const removeDay = useStore((s) => s.removeDay);
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: COL + day.id,
    data: { type: "column" },
  });
  const entries = new Map(tl?.entries.map((e) => [e.itemId, e]));
  const located = day.itemIds.filter((id) => trip.items[id]?.location).length;

  return (
    <section
      ref={setNodeRef}
      className={`column${selectedDayId === day.id ? " selected" : ""}${isDragging ? " dragging" : ""}`}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      <div className="column-head">
        <div className="title">
          <button className="handle" {...attributes} {...listeners} aria-label="Drag to move this day" title="Drag to move this day">
            ⠿
          </button>
          <span className="day-dot" style={{ background: dayColor(dayIndex) }} />
          <h2
            className="grow"
            onClick={() => props.onSelectDay(selectedDayId === day.id ? null : day.id)}
            title="Show this day on the map"
          >
            Day {dayIndex + 1} · {tl ? formatDayLabel(tl.date) : ""}
          </h2>
          <input
            type="time"
            value={day.startTime}
            onChange={(e) => updateDay(trip.id, day.id, { startTime: e.target.value || "09:00" })}
            style={{ width: 84, padding: "2px 4px", fontSize: 12 }}
            title="Day starts at"
          />
        </div>
        <div className="row wrap">
          <button className="btn small" onClick={() => props.onAdd(day.id)}>
            + Add
          </button>
          <button className="btn small ai" onClick={() => props.onSuggest(day.id)}>
            {props.ai ? "✨ Suggest" : "🔍 Nearby"}
          </button>
          <button
            className="btn small ai"
            disabled={located < 2}
            title={located < 2 ? "Needs at least two places with a location" : "Find the best order for this day"}
            onClick={() => props.onOptimize(day.id)}
          >
            ⚡ Optimize
          </button>
          {trip.days.length > 1 && (
            <button
              className="btn small ghost danger"
              title="Remove day (its cards move to Ideas)"
              onClick={() => confirm(`Remove day ${dayIndex + 1}? Its cards move to Ideas.`) && removeDay(trip.id, day.id)}
            >
              🗑
            </button>
          )}
        </div>
      </div>
      {props.rentals?.map((r) => (
        <RentalStrip key={r.rental.id} rental={r} color={props.rentalColors.get(r.rental.id)} onHighlight={props.onHighlight} />
      ))}
      <ColumnBody {...props} empty="Drag places here">
        {!props.dragging && tl?.base && props.itemIds.length > 0 && (
          <div className="start-from">From {tl.base.title}</div>
        )}
        <SortableContext items={props.itemIds} strategy={verticalListSortingStrategy}>
          {props.itemIds.map((id) => {
            const item = trip.items[id];
            if (!item) return null;
            const entry = entries.get(id);
            return (
              <div key={id}>
                {!props.dragging && entry?.fromId && <LegRow trip={trip} entry={entry} />}
                <SortableItem item={item} entry={props.dragging ? undefined : entry} {...props} />
              </div>
            );
          })}
        </SortableContext>
      </ColumnBody>
      {tl && tl.entries.length > 0 && (
        <div className="column-foot">
          {Math.round(tl.travelMin) > 0 && <>Travel {formatDuration(tl.travelMin)} · </>}
          ends ~{formatHm(tl.endMin)}
        </div>
      )}
      {props.night && <NightStrip night={props.night} color={props.nightColor} dayId={day.id} {...props} />}
    </section>
  );
}

/** Where the night after this day is spent: the stay (coloured per hotel), an overnight trip, or a gap. */
function NightStrip({
  night,
  color,
  dayId,
  onHighlight,
  onAdd,
}: BoardHandlers & { night: Night; color?: string; dayId: string }) {
  if (night.kind === "end") return null;
  if (night.kind === "transport") {
    return (
      <div className="night-strip muted">
        <span>{itemIcon(night.item)}</span>
        <span className="grow">Overnight · {night.item.title}</span>
      </div>
    );
  }
  if (night.kind === "none") {
    return (
      <div className="night-strip gap">
        <span>🌙</span>
        <span className="grow">No accommodation</span>
        <button className="btn small" onClick={() => onAdd(dayId, "stay")}>
          + Add stay
        </button>
      </div>
    );
  }
  const { stay, night: n, nights } = night;
  const checkIn = `check-in${stay.stay?.checkIn ? ` from ${stay.stay.checkIn}` : ""}`;
  const checkOut = `check-out tomorrow${stay.stay?.checkOut ? ` by ${stay.stay.checkOut}` : ""}`;
  const detail = [nights === 1 ? "1 night" : `Night ${n} of ${nights}`, n === 1 && checkIn, n === nights && checkOut]
    .filter(Boolean)
    .join(" · ");
  return (
    <button
      className="night-strip stay"
      style={{ "--stay-color": color } as CSSProperties}
      title="Show this stay"
      onClick={() => {
        onHighlight(stay.id);
        document.getElementById(`item-${stay.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      }}
    >
      <span>{itemIcon(stay)}</span>
      <span className="grow">
        <strong>{stay.title}</strong>
        <small>{detail}</small>
      </span>
    </button>
  );
}

/** A car, scooter or bike you have on this day: picked up, in use, or going back. */
function RentalStrip({ rental: r, color, onHighlight }: { rental: RentalDay; color?: string; onHighlight: (id: string) => void }) {
  const { rental, phase, days, returnLabel } = r;
  const by = rental.rental?.returnTime ? ` by ${rental.rental.returnTime}` : "";
  const where = rental.rental?.returnPlace ? ` at ${rental.rental.returnPlace}` : "";
  const detail =
    phase === "pickup"
      ? `Pick-up${rental.startTime ? ` ${rental.startTime}` : ""} · ${days} day${days > 1 ? "s" : ""}, back ${returnLabel}${by}`
      : phase === "return"
        ? `Return today${by}${where}`
        : `Rented · back ${returnLabel}${by}`;
  return (
    <button
      className={`rental-strip ${phase}`}
      style={{ "--rental-color": color } as CSSProperties}
      title="Show this rental"
      onClick={() => {
        onHighlight(rental.id);
        document.getElementById(`item-${rental.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      }}
    >
      <span>{itemIcon(rental)}</span>
      <span className="grow">
        <strong>{rental.title}</strong>
        <small>{detail}</small>
      </span>
    </button>
  );
}

function ColumnBody({ itemIds, empty, children }: { itemIds: string[]; empty: string; children: ReactNode }) {
  return <div className="column-body">{itemIds.length ? children : <div className="empty-drop">{empty}</div>}</div>;
}

function SortableItem(
  props: BoardHandlers & {
    item: Item;
    entry?: TimelineEntry;
    warnings: Map<string, Issue[]>;
    highlightId?: string;
    ai: boolean;
  },
) {
  const { item } = props;
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: item.id,
    data: { type: "item" },
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition, padding: "3px 0" }}
      {...attributes}
      {...listeners}
    >
      <ItemCard {...props} ghost={isDragging} />
    </div>
  );
}

function ItemCard({
  item,
  entry,
  warnings,
  highlightId,
  ghost,
  ai,
  onHighlight,
  onEdit,
  onSuggest,
}: BoardHandlers & {
  item: Item;
  entry?: TimelineEntry;
  warnings: Map<string, Issue[]>;
  highlightId?: string;
  ghost?: boolean;
  ai: boolean;
}) {
  const issues = [...(entry?.issues ?? []), ...(warnings.get(item.id) ?? [])];
  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
  };

  return (
    <article
      className={`item${highlightId === item.id ? " highlight" : ""}${ghost ? " ghost" : ""}${item.aiReason ? " ai-suggested" : ""}`}
      onClick={() => onHighlight(item.id)}
      id={`item-${item.id}`}
      onDoubleClick={() => onEdit(item.id)}
    >
      <div className="head">
        <span aria-hidden>{itemIcon(item)}</span>
        <span className="title">{item.title}</span>
        <span className="tools">
          <button className="btn ghost small" title="Edit" onClick={stop(() => onEdit(item.id))}>
            ✏️
          </button>
          {ai && (
            <button className="btn ghost small" title="AI visiting tips" onClick={stop(() => onEdit(item.id, "tips"))}>
              💡
            </button>
          )}
          {item.location && (
            <button className="btn ghost small" title="What's nearby?" onClick={stop(() => onSuggest(IDEAS, item.id))}>
              🔍
            </button>
          )}
        </span>
      </div>
      <div className="meta">
        {entry && (
          <span title={entry.fixed ? "Fixed start time" : "Estimated time"}>
            {entry.fixed ? "🔒 " : "~"}
            {formatHm(entry.start)}–{formatHm(entry.end)}
          </span>
        )}
        {!entry && item.startTime && <span>🔒 {item.startTime}</span>}
        {item.dive && (
          <span>
            {item.dive.dives} dive{item.dive.dives > 1 ? "s" : ""}
            {item.dive.maxDepthM ? ` · ${item.dive.maxDepthM} m` : ""} · {item.dive.gas}
          </span>
        )}
        {item.stay && <span>{item.stay.nights} night{item.stay.nights > 1 ? "s" : ""}</span>}
        {item.stay?.checkIn && <span>in {item.stay.checkIn}</span>}
        {item.stay?.checkOut && <span>out {item.stay.checkOut}</span>}
        {item.rental && (
          <span>
            {item.rental.days} day{item.rental.days > 1 ? "s" : ""}
            {item.rental.returnTime ? ` · back ${item.rental.returnTime}` : ""}
          </span>
        )}
        {item.tour?.stops.length ? (
          <span title={`Pick-up: ${item.location?.address ?? item.title}`}>
            🗺️ {item.tour.stops.map((s) => s.name).join(" → ")}
          </span>
        ) : null}
        {item.transport && (item.transport.from || item.transport.to) && (
          <span title={item.transport.toLocation?.address && `Arrives at ${item.transport.toLocation.address}`}>
            {item.transport.from ?? "?"} → {item.transport.to ?? "?"}
          </span>
        )}
        {item.place?.rating && (
          <span>
            ★ {item.place.rating.toFixed(1)}
            {item.place.userRatingCount ? ` (${item.place.userRatingCount})` : ""}
          </span>
        )}
        {item.booking?.provider && <span className="badge">{item.booking.provider}</span>}
        {!item.location && <span title="No location – add one to get routes">📍?</span>}
      </div>
      {item.aiReason && <div className="small muted">✨ {item.aiReason}</div>}
      {issues.map((i, n) => (
        <div key={n} className={`issue ${i.level}`}>
          {i.level === "warn" ? "⚠️" : "ℹ️"} {i.message}
        </div>
      ))}
    </article>
  );
}

const GMAPS_MODE: Partial<Record<TravelMode, string>> = {
  DRIVE: "driving",
  TWO_WHEELER: "driving",
  WALK: "walking",
  BICYCLE: "bicycling",
  TRANSIT: "transit",
};

function LegRow({ trip, entry }: { trip: Trip; entry: TimelineEntry }) {
  const setLeg = useStore((s) => s.setLeg);
  const from = trip.items[entry.fromId!];
  const to = trip.items[entry.itemId];
  if (!from || !to) return null;
  const key = legKey(from.id, to.id);
  const leg = getLeg(trip, from.id, to.id);
  const routed = isRoutable(leg.mode);
  const origin = leavesFrom(from);
  const fresh =
    routed && origin && to.location && leg.result?.key === routeKey(leg.mode, origin, to.location) ? leg.result : undefined;
  const failed = routed && origin && to.location && leg.error?.key === routeKey(leg.mode, origin, to.location);

  const directions =
    origin && to.location && GMAPS_MODE[leg.mode]
      ? `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lng}&destination=${to.location.lat},${to.location.lng}&travelmode=${GMAPS_MODE[leg.mode]}`
      : undefined;

  return (
    <div className="leg" onPointerDown={(e) => e.stopPropagation()}>
      <select
        value={leg.mode}
        onChange={(e) => setLeg(trip.id, key, { mode: e.target.value as TravelMode })}
        aria-label="How you get there"
      >
        {[...ROUTABLE_MODES, ...MANUAL_MODES].map((m) => (
          <option key={m} value={m}>
            {MODE_LABEL[m]}
          </option>
        ))}
      </select>
      {!routed ? (
        <>
          <input
            type="number"
            min={0}
            placeholder="min"
            value={leg.manualMin ?? ""}
            onChange={(e) => setLeg(trip.id, key, { manualMin: e.target.value === "" ? undefined : Number(e.target.value) })}
            aria-label="Duration in minutes"
          />
          <span>min</span>
        </>
      ) : fresh ? (
        <span>
          {formatDuration(fresh.durationSec / 60)} · {formatDistance(fresh.distanceM)}
        </span>
      ) : failed ? (
        <span title={leg.error?.message}>
          no route{entry.legMin != null ? ` · ~${formatDuration(entry.legMin)}` : ""}
        </span>
      ) : entry.legMin != null ? (
        <span title="Straight-line estimate">~{formatDuration(entry.legMin)}</span>
      ) : (
        <span>add locations for routing</span>
      )}
      {directions && (
        <a href={directions} target="_blank" rel="noreferrer" title="Open directions in Google Maps" style={{ marginLeft: "auto" }}>
          ↗
        </a>
      )}
    </div>
  );
}
