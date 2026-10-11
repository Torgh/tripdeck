import { createTrip, newId } from "./store";
import { isoDate } from "./time";
import { legKey, type Item, type Leg, type Trip } from "./types";

type Draft = Omit<Item, "id"> & { key: string };

/** A sample Malta & Gozo dive week that shows off every card type and a no-fly warning. */
export function demoTrip(): Trip {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() + 30);
  const trip = createTrip({
    name: "Malta & Gozo dive week (demo)",
    destination: "Malta",
    startDate: isoDate(start),
    days: 6,
    interests: "scuba diving, snorkeling, history, viewpoints, local food",
    defaultMode: "DRIVE",
  });

  const days: Draft[][] = [
    [
      {
        key: "arrive",
        type: "transport",
        title: "Arrive at Malta Airport",
        startTime: "11:30",
        durationMin: 45,
        transport: { kind: "flight", from: "KRK", to: "MLA" },
        location: { lat: 35.8575, lng: 14.4775, address: "Malta International Airport" },
      },
      {
        key: "hotel",
        type: "stay",
        title: "Hotel in St Julian's",
        stay: { nights: 5 },
        booking: { provider: "Booking.com", reference: "DEMO-1234" },
        location: { lat: 35.9187, lng: 14.4898, address: "St Julian's, Malta" },
      },
      {
        key: "valletta",
        type: "place",
        title: "Valletta old town",
        durationMin: 180,
        location: { lat: 35.8989, lng: 14.5146, address: "Valletta, Malta" },
      },
      {
        key: "dinner1",
        type: "food",
        title: "Dinner at Spinola Bay",
        startTime: "19:30",
        location: { lat: 35.9199, lng: 14.4893, address: "Spinola Bay, St Julian's" },
      },
    ],
    [
      {
        key: "cirkewwa",
        type: "dive",
        title: "Cirkewwa – Rozi & P29 wrecks",
        startTime: "08:30",
        durationMin: 240,
        dive: { dives: 2, maxDepthM: 30, gas: "nitrox", center: "Local dive centre", site: "Cirkewwa" },
        location: { lat: 35.9886, lng: 14.3289, address: "Cirkewwa, Malta" },
      },
      {
        key: "popeye",
        type: "place",
        title: "Popeye Village viewpoint",
        durationMin: 45,
        location: { lat: 35.9576, lng: 14.3433, address: "Anchor Bay, Mellieħa" },
      },
      {
        key: "golden",
        type: "place",
        title: "Golden Bay sunset",
        durationMin: 90,
        location: { lat: 35.9339, lng: 14.3437, address: "Golden Bay, Malta" },
      },
    ],
    [
      {
        key: "ferry",
        type: "transport",
        title: "Gozo Channel ferry",
        startTime: "08:15",
        durationMin: 15,
        transport: { kind: "ferry", from: "Ċirkewwa", to: "Mġarr (Gozo)" },
        location: { lat: 35.9889, lng: 14.3286, address: "Ċirkewwa ferry terminal" },
      },
      {
        key: "bluehole",
        type: "dive",
        title: "Blue Hole & Coral Cave, Dwejra",
        durationMin: 240,
        dive: { dives: 2, maxDepthM: 25, gas: "air", site: "Blue Hole" },
        location: { lat: 36.0532, lng: 14.1884, address: "Dwejra, Gozo" },
      },
      {
        key: "victoria",
        type: "place",
        title: "Citadel, Victoria",
        durationMin: 90,
        location: { lat: 36.0464, lng: 14.2397, address: "Victoria, Gozo" },
      },
    ],
    [
      {
        key: "comino",
        type: "activity",
        title: "Comino Blue Lagoon boat trip",
        startTime: "10:00",
        durationMin: 300,
        booking: { provider: "GetYourGuide", reference: "GYG-DEMO" },
        location: { lat: 36.013, lng: 14.3227, address: "Blue Lagoon, Comino" },
      },
    ],
    [
      {
        key: "zurrieq",
        type: "dive",
        title: "Wied iż-Żurrieq shore dives",
        startTime: "09:00",
        durationMin: 240,
        dive: { dives: 2, maxDepthM: 20, gas: "nitrox", site: "Um El Faroud" },
        location: { lat: 35.8195, lng: 14.4567, address: "Wied iż-Żurrieq" },
      },
      {
        key: "mdina",
        type: "place",
        title: "Mdina – the silent city",
        durationMin: 120,
        location: { lat: 35.8858, lng: 14.4031, address: "Mdina, Malta" },
      },
      {
        key: "dingli",
        type: "place",
        title: "Dingli Cliffs at sunset",
        durationMin: 60,
        location: { lat: 35.8603, lng: 14.382, address: "Dingli Cliffs" },
      },
    ],
    [
      {
        key: "depart",
        type: "transport",
        title: "Flight home",
        startTime: "06:00",
        durationMin: 180,
        transport: { kind: "flight", from: "MLA", to: "KRK" },
        location: { lat: 35.8575, lng: 14.4775, address: "Malta International Airport" },
      },
    ],
  ];

  const ids = new Map<string, string>();
  days.forEach((drafts, d) => {
    for (const { key, ...rest } of drafts) {
      const id = newId();
      ids.set(key, id);
      trip.items[id] = { id, ...rest };
      trip.days[d].itemIds.push(id);
    }
  });
  trip.days[5].startTime = "04:30";

  const manual: [string, string, Leg][] = [
    ["ferry", "bluehole", { mode: "FERRY", manualMin: 55 }],
    ["hotel", "comino", { mode: "BOAT", manualMin: 60 }],
  ];
  for (const [a, b, leg] of manual) trip.legs[legKey(ids.get(a)!, ids.get(b)!)] = leg;

  const idea: Item = {
    id: newId(),
    type: "place",
    title: "Blue Grotto boat ride",
    durationMin: 60,
    notes: "Best in the morning light.",
    location: { lat: 35.8197, lng: 14.4566, address: "Blue Grotto, Malta" },
  };
  trip.items[idea.id] = idea;
  trip.ideas.push(idea.id);

  return trip;
}
