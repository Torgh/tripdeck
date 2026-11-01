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
import { memo, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { DivePrepBadge } from "@/components/DivePrep";
import { routeKey } from "@/lib/geo";
import { todayIndex } from "@/lib/itinerary";
import { dayColor } from "@/lib/mapLayers";
import { rentalsOf, type RentalDay } from "@/lib/rentals";
import { nightsOf, stayColorIndex, type Night } from "@/lib/stays";
import { containersOf, useStore } from "@/lib/store";
import { formatDayLabel, formatDistance, formatDuration, formatHm } from "@/lib/time";
import { freshRoute, getLeg, type DayTimeline, type Issue, type TimelineEntry } from "@/lib/timeline";
import { transitStepLine, vehicleIcon } from "@/lib/transit";
import {
  BOOKING_STATUS_ICON,
  diveGas,
  IDEAS,
  isRoutable,
  itemIcon,
  leavesFrom,
  legKey,
  MANUAL_MODES,
  ROUTABLE_MODES,
  type ContainerId,
  type Item,
  type Leg,
  type RouteResult,
  type TravelMode,
  type Trip,
} from "@/lib/types";
import { useLang, useT } from "@/lib/useLang";

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
  const t = useT();
  const lang = useLang();
  const setContainers = useStore((s) => s.setContainers);
  const moveDay = useStore((s) => s.moveDay);
  const [drag, setDrag] = useState<Containers | null>(null);
  const dragRef = useRef<Containers | null>(null);
  const [active, setActive] = useState<{ type: "item" | "column"; id: string } | null>(null);
  const containers = drag ?? containersOf(trip);
  const nights = useMemo(() => nightsOf(trip), [trip]);
  const staySlots = useMemo(() => stayColorIndex(nights), [nights]);
  const rentals = useMemo(() => rentalsOf(trip, lang), [trip, lang]);
  const today = todayIndex(trip, new Date());
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
              isToday={i === today}
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
                {t("board.dayItems", { day: activeDayIndex + 1, n: trip.days[activeDayIndex].itemIds.length })}
              </strong>
            </div>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function AddDayButton({ tripId }: { tripId: string }) {
  const t = useT();
  const addDay = useStore((s) => s.addDay);
  return (
    <button className="btn" style={{ flex: "none" }} onClick={() => addDay(tripId)}>
      {t("board.addDay")}
    </button>
  );
}

function IdeasColumn(props: BoardProps & { itemIds: string[]; dragging: boolean }) {
  const t = useT();
  const { setNodeRef } = useDroppable({ id: COL + IDEAS, data: { type: "column" } });
  return (
    <section ref={setNodeRef} className="column">
      <div className="column-head">
        <div className="title">
          <h2 className="grow">{t("board.ideasTitle")}</h2>
        </div>
        <div className="row">
          <button className="btn small" onClick={() => props.onAdd(IDEAS)}>
            {t("board.add")}
          </button>
          <button className="btn small ai" onClick={() => props.onSuggest(IDEAS)}>
            {t(props.ai ? "board.suggest" : "board.nearby")}
          </button>
        </div>
      </div>
      <ColumnBody {...props} empty={t("board.ideasEmpty")}>
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
    isToday: boolean;
    itemIds: string[];
    dragging: boolean;
    night?: Night;
    nightColor?: string;
    rentals?: RentalDay[];
    rentalColors: Map<string, string>;
  },
) {
  const { trip, dayIndex, timelines, selectedDayId } = props;
  const t = useT();
  const lang = useLang();
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
      className={`column${props.isToday ? " today" : ""}${selectedDayId === day.id ? " selected" : ""}${isDragging ? " dragging" : ""}`}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      <div className="column-head">
        <div className="title">
          <button className="handle" {...attributes} {...listeners} aria-label={t("board.dragDay")} title={t("board.dragDay")}>
            ⠿
          </button>
          <span className="day-dot" style={{ background: dayColor(dayIndex) }} />
          <h2
            className="grow"
            onClick={() => props.onSelectDay(selectedDayId === day.id ? null : day.id)}
            title={t("board.showDay")}
          >
            {t("common.day", { day: dayIndex + 1 })} · {tl ? formatDayLabel(tl.date, lang) : ""}
          </h2>
          <input
            type="time"
            value={day.startTime}
            onChange={(e) => updateDay(trip.id, day.id, { startTime: e.target.value || "09:00" })}
            style={{ width: 84, padding: "2px 4px", fontSize: 12 }}
            title={t("board.dayStarts")}
          />
        </div>
        <div className="row wrap">
          <button className="btn small" onClick={() => props.onAdd(day.id)}>
            {t("board.add")}
          </button>
          <button className="btn small ai" onClick={() => props.onSuggest(day.id)}>
            {t(props.ai ? "board.suggest" : "board.nearby")}
          </button>
          <button
            className="btn small ai"
            disabled={located < 2}
            title={t(located < 2 ? "board.needsTwo" : "board.bestOrder")}
            onClick={() => props.onOptimize(day.id)}
          >
            {t("board.optimize")}
          </button>
          {trip.days.length > 1 && (
            <button
              className="btn small ghost danger"
              title={t("board.removeDayTitle")}
              onClick={() => confirm(t("board.removeDayConfirm", { day: dayIndex + 1 })) && removeDay(trip.id, day.id)}
            >
              🗑
            </button>
          )}
          {props.isToday && <span className="today-badge">{t("board.today")}</span>}
        </div>
      </div>
      {props.rentals?.map((r) => (
        <RentalStrip key={r.rental.id} rental={r} color={props.rentalColors.get(r.rental.id)} onHighlight={props.onHighlight} />
      ))}
      <ColumnBody {...props} empty={t("board.dayEmpty")}>
        {!props.dragging && tl?.base && props.itemIds.length > 0 && (
          <div className="start-from">{t("board.from", { place: tl.base.title })}</div>
        )}
        <SortableContext items={props.itemIds} strategy={verticalListSortingStrategy}>
          {props.itemIds.map((id) => {
            const item = trip.items[id];
            if (!item) return null;
            const entry = entries.get(id);
            return (
              <div key={id}>
                {!props.dragging && entry?.fromId && <LegRow {...legView(trip, entry)} />}
                <SortableItem item={item} entry={props.dragging ? undefined : entry} {...props} />
              </div>
            );
          })}
        </SortableContext>
      </ColumnBody>
      {tl && tl.entries.length > 0 && (
        <div className="column-foot">
          {Math.round(tl.travelMin) > 0 && t("board.travel", { duration: formatDuration(tl.travelMin, lang) })}
          {t("board.ends", { time: formatHm(tl.endMin) })}
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
  const t = useT();
  if (night.kind === "end") return null;
  if (night.kind === "transport") {
    return (
      <div className="night-strip muted">
        <span>{itemIcon(night.item)}</span>
        <span className="grow">{t("board.overnight", { title: night.item.title })}</span>
      </div>
    );
  }
  if (night.kind === "none") {
    return (
      <div className="night-strip gap">
        <span>🌙</span>
        <span className="grow">{t("board.noStay")}</span>
        <button className="btn small" onClick={() => onAdd(dayId, "stay")}>
          {t("board.addStay")}
        </button>
      </div>
    );
  }
  const { stay, night: n, nights } = night;
  const checkIn = stay.stay?.checkIn ? t("board.checkInFrom", { time: stay.stay.checkIn }) : t("board.checkIn");
  const checkOut = stay.stay?.checkOut ? t("board.checkOutBy", { time: stay.stay.checkOut }) : t("board.checkOut");
  const detail = [nights === 1 ? t("board.oneNight") : t("board.nightOf", { n, nights }), n === 1 && checkIn, n === nights && checkOut]
    .filter(Boolean)
    .join(" · ");
  return (
    <button
      className="night-strip stay"
      style={{ "--stay-color": color } as CSSProperties}
      title={t("board.showStay")}
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
  const t = useT();
  const { rental, phase, days, returnLabel } = r;
  const by = rental.rental?.returnTime ? t("board.by", { time: rental.rental.returnTime }) : "";
  const where = rental.rental?.returnPlace ? t("board.at", { place: rental.rental.returnPlace }) : "";
  const detail =
    phase === "pickup"
      ? t("board.pickUp", {
          time: rental.startTime ? ` ${rental.startTime}` : "",
          days: t("board.days", { n: days }),
          date: returnLabel,
          by,
        })
      : phase === "return"
        ? t("board.returnToday", { by, where })
        : t("board.rented", { date: returnLabel, by });
  return (
    <button
      className={`rental-strip ${phase}`}
      style={{ "--rental-color": color } as CSSProperties}
      title={t("board.showRental")}
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
  const { item, entry, warnings } = props;
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
      <ItemCard
        item={item}
        entry={entry}
        issues={[...(entry?.issues ?? []), ...(warnings.get(item.id) ?? [])]}
        highlighted={props.highlightId === item.id}
        ghost={isDragging}
        ai={props.ai}
        onHighlight={props.onHighlight}
        onEdit={props.onEdit}
        onSuggest={props.onSuggest}
      />
    </div>
  );
}

interface CardProps extends Pick<BoardHandlers, "onHighlight" | "onEdit" | "onSuggest"> {
  item: Item;
  entry?: TimelineEntry;
  issues: Issue[];
  highlighted: boolean;
  ghost: boolean;
  ai: boolean;
}

const sameIssues = (a: Issue[], b: Issue[]) =>
  a.length === b.length && a.every((x, i) => x.level === b[i].level && x.message === b[i].message);

/**
 * The timeline and warnings are rebuilt on every edit, so a card compares what it shows from them:
 * editing, highlighting or routing one card re-renders that card, not the whole board.
 */
function sameCard(a: CardProps, b: CardProps) {
  return (
    a.item === b.item &&
    a.highlighted === b.highlighted &&
    a.ghost === b.ghost &&
    a.ai === b.ai &&
    a.onHighlight === b.onHighlight &&
    a.onEdit === b.onEdit &&
    a.onSuggest === b.onSuggest &&
    a.entry?.start === b.entry?.start &&
    a.entry?.end === b.entry?.end &&
    a.entry?.fixed === b.entry?.fixed &&
    sameIssues(a.issues, b.issues)
  );
}

const ItemCard = memo(function ItemCard({
  item,
  entry,
  issues,
  highlighted,
  ghost,
  ai,
  onHighlight,
  onEdit,
  onSuggest,
}: CardProps) {
  const t = useT();
  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
  };

  return (
    <article
      className={`item${highlighted ? " highlight" : ""}${ghost ? " ghost" : ""}${item.aiReason ? " ai-suggested" : ""}`}
      onClick={() => onHighlight(item.id)}
      id={`item-${item.id}`}
      onDoubleClick={() => onEdit(item.id)}
    >
      <div className="head">
        <span aria-hidden>{itemIcon(item)}</span>
        <span className="title">{item.title}</span>
        <span className="tools">
          <button className="btn ghost small" title={t("common.edit")} onClick={stop(() => onEdit(item.id))}>
            ✏️
          </button>
          {ai && (
            <button className="btn ghost small" title={t("board.tips")} onClick={stop(() => onEdit(item.id, "tips"))}>
              💡
            </button>
          )}
          {item.location && (
            <button className="btn ghost small" title={t("board.whatsNearby")} onClick={stop(() => onSuggest(IDEAS, item.id))}>
              🔍
            </button>
          )}
        </span>
      </div>
      <div className="meta">
        {entry && (
          <span title={t(entry.fixed ? "board.fixedStart" : "board.estimated")}>
            {entry.fixed ? "🔒 " : "~"}
            {formatHm(entry.start)}–{formatHm(entry.end)}
          </span>
        )}
        {!entry && item.startTime && <span>🔒 {item.startTime}</span>}
        {item.dive && (
          <span>
            {t("board.dives", { n: item.dive.dives })}
            {item.dive.maxDepthM ? ` · ${item.dive.maxDepthM} m` : ""} · {diveGas(item.dive)}
          </span>
        )}
        {item.dive?.prep && <DivePrepBadge prep={item.dive.prep} />}
        {item.stay && <span>{t("board.nights", { n: item.stay.nights })}</span>}
        {item.stay?.checkIn && <span>{t("board.in", { time: item.stay.checkIn })}</span>}
        {item.stay?.checkOut && <span>{t("board.out", { time: item.stay.checkOut })}</span>}
        {item.rental && (
          <span>
            {t("board.days", { n: item.rental.days })}
            {item.rental.returnTime ? t("board.backAt", { time: item.rental.returnTime }) : ""}
          </span>
        )}
        {item.tour?.stops.length ? (
          <span title={t("board.pickUpAt", { place: item.location?.address ?? item.title })}>
            🗺️ {item.tour.stops.map((s) => s.name).join(" → ")}
          </span>
        ) : null}
        {item.transport && (item.transport.from || item.transport.to) && (
          <span title={item.transport.toLocation?.address && t("board.arrivesAt", { place: item.transport.toLocation.address })}>
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
        {item.booking?.status && (
          <span className={`badge status-${item.booking.status}`} title={t(`bookingStatus.${item.booking.status}`)}>
            {BOOKING_STATUS_ICON[item.booking.status]}
            {item.booking.status !== "confirmed" && ` ${t(`bookingStatus.${item.booking.status}`)}`}
          </span>
        )}
        {!item.location && <span title={t("board.noLocation")}>📍?</span>}
      </div>
      {item.aiReason && <div className="small muted">✨ {item.aiReason}</div>}
      {issues.map((i, n) => (
        <div key={n} className={`issue ${i.level}`}>
          {i.level === "warn" ? "⚠️" : "ℹ️"} {i.message}
        </div>
      ))}
    </article>
  );
}, sameCard);

const GMAPS_MODE: Partial<Record<TravelMode, string>> = {
  DRIVE: "driving",
  TWO_WHEELER: "driving",
  WALK: "walking",
  BICYCLE: "bicycling",
  TRANSIT: "transit",
};

/**
 * What a leg row shows, as plain values: the row is memoised on them, so it re-renders only when its
 * own leg changes, not on every edit of the trip.
 */
function legView(trip: Trip, entry: TimelineEntry) {
  const from = trip.items[entry.fromId!];
  const to = trip.items[entry.itemId];
  if (!from || !to) return { tripId: trip.id };
  const leg = getLeg(trip, from.id, to.id);
  const origin = leavesFrom(from);
  const failed =
    isRoutable(leg.mode) && !!origin && !!to.location && leg.error?.key === routeKey(leg.mode, origin, to.location);
  return {
    tripId: trip.id,
    legKey: legKey(from.id, to.id),
    mode: leg.mode,
    manualMin: leg.manualMin,
    fresh: freshRoute(trip, from, to),
    error: failed ? leg.error?.message : undefined,
    failed,
    legMin: entry.legMin,
    directions:
      origin && to.location && GMAPS_MODE[leg.mode]
        ? `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lng}&destination=${to.location.lat},${to.location.lng}&travelmode=${GMAPS_MODE[leg.mode]}`
        : undefined,
  };
}

const LegRow = memo(function LegRow({
  tripId,
  legKey: key,
  mode,
  manualMin,
  fresh,
  error,
  failed,
  legMin,
  directions,
}: {
  tripId: string;
  legKey?: string;
  mode?: Leg["mode"];
  manualMin?: number;
  fresh?: RouteResult;
  error?: string;
  failed?: boolean;
  legMin?: number;
  directions?: string;
}) {
  const t = useT();
  const lang = useLang();
  const setLeg = useStore((s) => s.setLeg);
  if (!key || !mode) return null;
  const routed = isRoutable(mode);

  return (
    <div className="leg" onPointerDown={(e) => e.stopPropagation()}>
      <select
        value={mode}
        onChange={(e) => setLeg(tripId, key, { mode: e.target.value as TravelMode, auto: false })}
        aria-label={t("board.howThere")}
      >
        {[...ROUTABLE_MODES, ...MANUAL_MODES].map((m) => (
          <option key={m} value={m}>
            {t(`mode.${m}`)}
          </option>
        ))}
      </select>
      {!routed ? (
        <>
          <input
            type="number"
            min={0}
            placeholder={t("common.min")}
            value={manualMin ?? ""}
            onChange={(e) => setLeg(tripId, key, { manualMin: e.target.value === "" ? undefined : Number(e.target.value) })}
            aria-label={t("board.durationMin")}
          />
          <span>{t("common.min")}</span>
        </>
      ) : fresh ? (
        <span>
          {formatDuration(fresh.durationSec / 60, lang)} · {formatDistance(fresh.distanceM)}
        </span>
      ) : failed ? (
        <span title={error}>
          {t("board.noRoute")}
          {legMin != null ? ` · ~${formatDuration(legMin, lang)}` : ""}
        </span>
      ) : legMin != null ? (
        <span title={t("board.straightLine")}>~{formatDuration(legMin, lang)}</span>
      ) : (
        <span>{t("board.addLocations")}</span>
      )}
      {directions && (
        <a href={directions} target="_blank" rel="noreferrer" title={t("board.directions")} style={{ marginLeft: "auto" }}>
          ↗
        </a>
      )}
      {fresh?.transit?.length ? <TransitRoute route={fresh} /> : null}
    </div>
  );
});

/** The lines of a public-transport leg as coloured chips; opens to the rides with their stops and times. */
function TransitRoute({ route }: { route: RouteResult }) {
  const t = useT();
  const lang = useLang();
  return (
    <details className="transit">
      <summary>
        {route.transit!.map((s, i) => (
          <span
            key={i}
            className="transit-line"
            style={s.color ? { background: s.color, color: s.textColor ?? "#fff" } : undefined}
            title={`${s.from} → ${s.to}`}
          >
            {vehicleIcon(s.vehicle)} {s.line}
          </span>
        ))}
        {route.walkMin ? <span>🚶 {t("time.min", { n: route.walkMin })}</span> : null}
      </summary>
      <ol>
        {route.transit!.map((s, i) => (
          <li key={i}>
            {transitStepLine(s, lang)}
            {s.headsign ? t("board.towards", { stop: s.headsign }) : ""}
          </li>
        ))}
      </ol>
      {route.at && (
        <div className="muted">
          {route.at.startsWith("by ")
            ? t("board.timetableBy", { at: route.at.slice(3) })
            : t("board.timetableFor", { at: route.at })}
          {route.sampledOn && t("board.sampled", { date: route.sampledOn })}
        </div>
      )}
    </details>
  );
}
