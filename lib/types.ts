export type ItemType = "place" | "food" | "activity" | "stay" | "rental" | "dive" | "transport";

/** Modes Google's Routes API can compute. */
export const ROUTABLE_MODES = ["DRIVE", "WALK", "BICYCLE", "TRANSIT", "TWO_WHEELER"] as const;
/** Modes where the user enters the duration by hand. */
export const MANUAL_MODES = ["FERRY", "BOAT", "FLIGHT"] as const;

export type RoutableMode = (typeof ROUTABLE_MODES)[number];
export type ManualMode = (typeof MANUAL_MODES)[number];
export type TravelMode = RoutableMode | ManualMode;

export function isRoutable(mode: TravelMode): mode is RoutableMode {
  return (ROUTABLE_MODES as readonly string[]).includes(mode);
}

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Location extends LatLng {
  address?: string;
  placeId?: string;
  /** Metres above sea level. `null` means the lookup was attempted and failed. */
  elevationM?: number | null;
  /** IANA time zone, e.g. "Asia/Bangkok" – looked up for flights, ferries and trains. `null`: lookup failed. */
  timeZone?: string | null;
}

/** Mirrors Google Places `regularOpeningHours.periods` (day: 0 = Sunday). */
export interface OpeningPoint {
  day: number;
  hour: number;
  minute: number;
}
export interface OpeningPeriod {
  open: OpeningPoint;
  close?: OpeningPoint;
}

export interface PlaceInfo {
  rating?: number;
  userRatingCount?: number;
  primaryType?: string;
  types?: string[];
  openingPeriods?: OpeningPeriod[];
  googleMapsUri?: string;
  websiteUri?: string;
  editorialSummary?: string;
}

export type Gas = "air" | "nitrox" | "trimix";

export interface DiveDetails {
  site?: string;
  center?: string;
  /** Number of dives in this outing (e.g. a two-tank boat trip = 2). */
  dives: number;
  maxDepthM?: number;
  gas: Gas;
}

export type TransportKind = "flight" | "ferry" | "train" | "bus" | "car_rental" | "boat" | "other";

export interface TransportDetails {
  kind: TransportKind;
  from?: string;
  to?: string;
  number?: string;
  /** Where it arrives (airport, port, station). The card's own location is the departure; travel to the next card starts here. */
  toLocation?: Location;
}

export interface StayDetails {
  nights: number;
  /** Earliest check-in "HH:MM" on the first day. */
  checkIn?: string;
  /** Latest check-out "HH:MM" on the morning after the last night. */
  checkOut?: string;
}

export type RentalVehicle = "car" | "scooter" | "motorbike" | "bicycle";

/** A car, scooter, motorbike or bicycle hire. The card sits on the pick-up day; `startTime` is the pick-up time. */
export interface RentalDetails {
  vehicle: RentalVehicle;
  /** Rental length in days: the vehicle goes back on the day `days` after pick-up. */
  days: number;
  /** Return "HH:MM" on the last day. */
  returnTime?: string;
  /** Where it goes back, when not where it was picked up (the card's location). */
  returnPlace?: string;
  returnLocation?: Location;
}

/** A place an organised tour visits. */
export interface TourStop {
  name: string;
  location?: Location;
}

/** An organised tour (type activity). The card's location is where it picks you up or where you meet the guide. */
export interface TourDetails {
  /** Places visited, in order. They show on the map but do not affect travel times. */
  stops: TourStop[];
}

export const RENTAL_VEHICLES: RentalVehicle[] = ["car", "scooter", "motorbike", "bicycle"];

export const RENTAL_VEHICLE_LABEL: Record<RentalVehicle, string> = {
  car: "Car",
  scooter: "Scooter",
  motorbike: "Motorbike",
  bicycle: "Bicycle",
};

export const RENTAL_VEHICLE_ICON: Record<RentalVehicle, string> = {
  car: "🚗",
  scooter: "🛵",
  motorbike: "🏍️",
  bicycle: "🚲",
};

/** Where a booking stands: done, paid but not confirmed yet, or still to be booked. */
export type BookingStatus = "confirmed" | "pending" | "todo";

export const BOOKING_STATUSES: BookingStatus[] = ["confirmed", "pending", "todo"];

export const BOOKING_STATUS_LABEL: Record<BookingStatus, string> = {
  confirmed: "Confirmed",
  pending: "Waiting for confirmation",
  todo: "To book",
};

export const BOOKING_STATUS_ICON: Record<BookingStatus, string> = {
  confirmed: "✅",
  pending: "⏳",
  todo: "📝",
};

export interface Booking {
  provider?: string;
  reference?: string;
  url?: string;
  price?: string;
  status?: BookingStatus;
}

export interface AiTips {
  summary: string;
  bestTime: string;
  suggestedDurationMin: number;
  tickets?: string;
  parking?: string;
  tips: string[];
  generatedAt: string;
}

export interface Item {
  id: string;
  type: ItemType;
  title: string;
  location?: Location;
  /** Fixed start time "HH:MM". Without it the planner flows the item after the previous one. */
  startTime?: string;
  durationMin?: number;
  notes?: string;
  place?: PlaceInfo;
  dive?: DiveDetails;
  transport?: TransportDetails;
  stay?: StayDetails;
  rental?: RentalDetails;
  tour?: TourDetails;
  booking?: Booking;
  tips?: AiTips;
  /** Set when the card came from an AI suggestion. */
  aiReason?: string;
}

export interface Day {
  id: string;
  itemIds: string[];
  /** When the day starts, "HH:MM". */
  startTime: string;
}

/** One ride on a public-transport route (the walks between rides are only counted in `walkMin`). */
export interface TransitStep {
  /** Google's vehicle type, e.g. SUBWAY, HEAVY_RAIL, BUS, FERRY. */
  vehicle: string;
  line: string;
  /** Line colours as "#rrggbb", when the operator publishes them. */
  color?: string;
  textColor?: string;
  from: string;
  to: string;
  stops?: number;
  /** Local "HH:MM" at the stops. */
  departs?: string;
  arrives?: string;
  headsign?: string;
  polyline?: string;
}

/** When a public-transport route is planned for: leave at, or (arriveBy) be there by, a local date and time. */
export interface RouteTime {
  date: string;
  time: string;
  arriveBy?: boolean;
}

export interface RouteResult {
  /** Cache key: mode + both endpoints. A changed location invalidates the result. */
  key: string;
  durationSec: number;
  distanceM: number;
  polyline?: string;
  /** Public transport: the rides, in order. */
  transit?: TransitStep[];
  /** Public transport: minutes on foot, to, between and from the stops. */
  walkMin?: number;
  /** Public transport: the time it was planned for (`routeTimeKey`); a new time in the plan fetches it again. */
  at?: string;
  /**
   * Public transport: the trip's timetable isn't published yet, so this is the same weekday and time
   * on this date ("YYYY-MM-DD") – a typical week rather than the actual day.
   */
  sampledOn?: string;
}

export interface Leg {
  mode: TravelMode;
  /**
   * The mode follows the default (`defaultModeTo`) rather than being picked for this leg, so it changes
   * when the default does – e.g. a scooter rental moved to another day. Stored only to cache the route.
   * Legs saved before this existed count as following the default when they use the trip's default mode.
   */
  auto?: boolean;
  /** Duration for manual modes (ferry, boat, flight). */
  manualMin?: number;
  result?: RouteResult;
  error?: { key: string; message: string };
}

export interface Trip {
  id: string;
  name: string;
  destination: string;
  /** "YYYY-MM-DD" – date of the first day. */
  startDate: string;
  /** Free text the AI uses to tailor suggestions, e.g. "snorkeling, viewpoints, local food". */
  interests: string;
  defaultMode: TravelMode;
  days: Day[];
  ideas: string[];
  items: Record<string, Item>;
  /** Keyed by `legKey(fromId, toId)`. */
  legs: Record<string, Leg>;
  updatedAt: string;
}

export const IDEAS = "ideas";
export type ContainerId = string; // IDEAS or a day id

export function routeTimeKey(t: RouteTime): string {
  return `${t.arriveBy ? "by " : ""}${t.date} ${t.time}`;
}

export function legKey(fromId: string, toId: string): string {
  return `${fromId}>${toId}`;
}

export const ITEM_TYPE_LABEL: Record<ItemType, string> = {
  place: "Place",
  food: "Food & drink",
  activity: "Activity / tour",
  stay: "Stay",
  rental: "Rental (car, scooter, bike)",
  dive: "Dive",
  transport: "Transport",
};

export const ITEM_TYPE_ICON: Record<ItemType, string> = {
  place: "📍",
  food: "🍽️",
  activity: "🎟️",
  stay: "🏨",
  rental: "🔑",
  dive: "🤿",
  transport: "✈️",
};

export const MODE_LABEL: Record<TravelMode, string> = {
  DRIVE: "🚗 Car",
  WALK: "🚶 Walk",
  BICYCLE: "🚲 Bike",
  TRANSIT: "🚌 Transit",
  TWO_WHEELER: "🛵 Scooter",
  FERRY: "⛴️ Ferry",
  BOAT: "🚤 Boat",
  FLIGHT: "✈️ Flight",
};

export const DEFAULT_DURATION_MIN: Record<ItemType, number> = {
  place: 60,
  food: 75,
  activity: 120,
  stay: 15,
  rental: 20,
  dive: 240,
  transport: 60,
};

const TRANSPORT_ICON: Record<TransportKind, string> = {
  flight: "✈️",
  ferry: "⛴️",
  train: "🚆",
  bus: "🚌",
  car_rental: "🚗",
  boat: "🚤",
  other: "🧭",
};

/** Where you set off from after a card: the arrival point of a flight, ferry or train, otherwise the card's place. */
export function leavesFrom(item: Pick<Item, "location" | "transport">): Location | undefined {
  return item.transport?.toLocation ?? item.location;
}

export function itemIcon(item: Pick<Item, "type" | "transport" | "rental">): string {
  if (item.type === "transport" && item.transport) return TRANSPORT_ICON[item.transport.kind];
  if (item.type === "rental" && item.rental) return RENTAL_VEHICLE_ICON[item.rental.vehicle];
  return ITEM_TYPE_ICON[item.type];
}
