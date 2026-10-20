import { createTrip, newId } from "./tripOps";
import { isoDate } from "./time";
import { routeKey } from "./geo";
import { legKey, type Item, type Leg, type OpeningPeriod, type RouteResult, type Trip } from "./types";

type Draft = Omit<Item, "id"> & { key: string };

/** Google's public-transport route from the St Julian's hotel to Valletta on a Sunday morning. */
const BUS_TO_VALLETTA: Omit<RouteResult, "key"> = {
  durationSec: 1726,
  distanceM: 7072,
  walkMin: 13,
  polyline:
    "mjfzEi`mwAGWMOUCSHGFw@BGCBOCNFBx@CNMVARLFX?LpAz@pAf@dAf@tAfAn@l@v@|@VFb@`@p@bAd@hAXnAL`AJ`@NRpCMnOeAfD_@dA[z@i@f@e@h@w@j@cAvAoDhAyCVkBLQDEl@Ed@D^Oh@IhAAZBhAb@n@h@d@j@\\l@r@xA|@xAxAfBv@n@rAv@fCfAtJhDHC|Ab@bEzAb@X`@`@XPRFp@BPGE@\\?j@Tl@@VEr@]n@o@^o@j@qAr@qBtBuEb@k@f@_@h@Oh@CfAN\\JH?HEd@sBO{AMw@@]JUVS`Bc@\\QVSP]Pi@?EHg@FkBCa@gBeIsB_HmAaDM{@Cw@BeEBQFQLQXM^?rC^zALpG~@nAFPCRSLUBg@XWPIZBz@V`Ar@h@Lj@?b@KZWXc@\\wAhBwJ@c@d@mCBo@Gm@cAmC]m@Mk@IgBUuEK{@Uq@W_@i@RY^_@n@W~@KNMJMHm@GWW_@y@wBsDmHiLo@cAuAkCC@BAGY@Wa@B?]MWWKU@MFs@kAyBcEi@mAuAkCeEeIsBuDmAsBfAgAMU",
  transit: [
    {
      vehicle: "BUS",
      line: "TD13",
      color: "#1515f2",
      textColor: "#ffffff",
      from: "Spinola",
      to: "Valletta",
      stops: 5,
      departs: "09:07",
      arrives: "09:23",
      headsign: "Valletta",
      polyline:
        "qnfzEsamwACNFBx@CNMVARLFX?LpAz@pAf@dAf@tAfAn@l@v@|@VFb@`@p@bAd@hAXnAL`AJ`@NRpCMnOeAfD_@dA[z@i@f@e@h@w@j@cAvAoDhAyCVkBLQDEl@Ed@D^Oh@IhAAZBhAb@n@h@d@j@\\l@r@xA|@xAxAfBv@n@rAv@fCfAtJhDHC|Ab@bEzAb@X`@`@XPRFp@BPGE@\\?j@Tl@@VEr@]n@o@^o@j@qAr@qBtBuEb@k@f@_@h@Oh@CfAN\\JH?HEd@sBO{AMw@@]JUVS`Bc@\\QVSP]Pi@?EHg@FkBCa@gBeIsB_HmAaDM{@Cw@BeEBQFQLQXM^?rC^zALpG~@nAFPCRSLUBg@XWPIZBz@V`Ar@h@Lj@?b@KZWXc@\\wAhBwJ@c@d@mCBo@Gm@cAmC]m@Mk@IgBUuEK{@Uq@W_@i@RY^_@n@W~@KNMJMHm@GWW_@y@wBsDmHiLo@cAuAkCC@",
    },
  ],
};

const mapsSearch = (q: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;

/** Open Monday–Saturday (day 1–6) between the given times; closed on Sundays. */
const monToSat = (open: [number, number], close: [number, number]): OpeningPeriod[] =>
  [1, 2, 3, 4, 5, 6].map((day) => ({
    open: { day, hour: open[0], minute: open[1] },
    close: { day, hour: close[0], minute: close[1] },
  }));

/**
 * A sample Malta & Gozo dive week that shows off every card type, three stays with check-in/out
 * times, every travel mode (with a real bus line), flights and ferries that know where they land,
 * bookings with prices, opening hours, AI tips and suggestions – plus a few deliberate problems:
 * a no-fly warning, a place closed on Sunday and a late arrival.
 */
export function demoTrip(): Trip {
  // Start on a Saturday about a month from now, so day 2 is always a Sunday.
  const start = new Date();
  start.setUTCDate(start.getUTCDate() + 30);
  start.setUTCDate(start.getUTCDate() + ((6 - start.getUTCDay() + 7) % 7));
  const trip = createTrip({
    name: "Malta & Gozo dive week (demo)",
    destination: "Malta",
    startDate: isoDate(start),
    days: 7,
    interests: "scuba diving, snorkeling, history, viewpoints, local food",
    defaultMode: "DRIVE",
  });

  const days: Draft[][] = [
    // Day 1 (Saturday): fly in from Kraków, pick up the car, reach the hotel before check-in.
    [
      {
        key: "arrive",
        type: "transport",
        title: "Flight to Malta",
        startTime: "09:00",
        durationMin: 155,
        transport: {
          kind: "flight",
          from: "KRK",
          to: "MLA",
          number: "TD 101",
          toLocation: { lat: 35.8575, lng: 14.4775, address: "Malta International Airport" },
        },
        booking: { reference: "DEMO-FL1", price: "€189" },
        location: { lat: 50.0777, lng: 19.7848, address: "Kraków Airport" },
      },
      {
        key: "car",
        type: "rental",
        title: "Rental car",
        durationMin: 30,
        rental: { vehicle: "car", days: 5, returnTime: "18:00" },
        booking: { provider: "Rentalcars.com", reference: "DEMO-CAR", price: "€168" },
        location: { lat: 35.8562, lng: 14.4789, address: "Malta International Airport, car rental desks" },
      },
      {
        key: "hotel",
        type: "stay",
        title: "Hotel in St Julian's",
        stay: { nights: 3, checkIn: "15:00", checkOut: "11:00" },
        booking: { provider: "Booking.com", reference: "DEMO-1234", price: "€420" },
        location: { lat: 35.9187, lng: 14.4898, address: "St Julian's, Malta" },
      },
      {
        key: "dinner1",
        type: "food",
        title: "Dinner at Spinola Bay",
        startTime: "19:30",
        notes: "Ask for a table on the water.",
        location: { lat: 35.9199, lng: 14.4893, address: "Spinola Bay, St Julian's" },
      },
    ],
    // Day 2 (Sunday): bus to Valletta – the cathedral is closed on Sundays and the noon gun is missed.
    [
      {
        key: "valletta",
        type: "place",
        title: "Valletta old town",
        durationMin: 120,
        place: {
          rating: 4.8,
          primaryType: "historical_landmark",
          googleMapsUri: mapsSearch("Valletta, Malta"),
          editorialSummary: "Fortified 16th-century capital built by the Knights of St John.",
        },
        tips: {
          summary: "Walk Republic Street end to end, then drop down to the harbour-side bastions.",
          bestTime: "Early morning, before the cruise-ship crowds arrive.",
          suggestedDurationMin: 150,
          parking: "Park & ride at the Floriana car park, then walk in through City Gate.",
          tips: ["Wear shoes with grip – the limestone streets are steep and polished.", "Most shops close early on Sundays."],
          generatedAt: "2026-10-01T09:00:00.000Z",
        },
        location: { lat: 35.8989, lng: 14.5146, address: "Valletta, Malta" },
      },
      {
        key: "cathedral",
        type: "place",
        title: "St John's Co-Cathedral",
        durationMin: 75,
        place: {
          rating: 4.8,
          primaryType: "church",
          openingPeriods: monToSat([9, 0], [16, 45]),
          googleMapsUri: mapsSearch("St John's Co-Cathedral, Valletta"),
          websiteUri: "https://www.stjohnscocathedral.com",
        },
        location: { lat: 35.8977, lng: 14.5125, address: "St John's Co-Cathedral, Valletta" },
      },
      {
        key: "noongun",
        type: "activity",
        title: "Saluting Battery noon gun",
        startTime: "12:00",
        durationMin: 30,
        location: { lat: 35.8946, lng: 14.5127, address: "Upper Barrakka Gardens, Valletta" },
      },
      {
        key: "lunch",
        type: "food",
        title: "Pastizzi & ftira lunch",
        durationMin: 45,
        location: { lat: 35.8961, lng: 14.5138, address: "Valletta, Malta" },
      },
    ],
    // Day 3 (Monday): first dive day in the north.
    [
      {
        key: "cirkewwa",
        type: "dive",
        title: "Cirkewwa – Rozi & P29 wrecks",
        startTime: "08:30",
        durationMin: 240,
        dive: { dives: 2, maxDepthM: 30, gas: "nitrox", center: "Local dive centre", site: "Cirkewwa" },
        booking: { provider: "Dive centre", reference: "DEMO-DIVE1", price: "€110" },
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
    // Day 4 (Tuesday): ferry to Gozo and move to a farmhouse.
    [
      {
        key: "ferry",
        type: "transport",
        title: "Gozo Channel ferry",
        startTime: "08:15",
        durationMin: 25,
        transport: {
          kind: "ferry",
          from: "Ċirkewwa",
          to: "Mġarr (Gozo)",
          toLocation: { lat: 36.0247, lng: 14.2995, address: "Mġarr harbour, Gozo" },
        },
        location: { lat: 35.9889, lng: 14.3286, address: "Ċirkewwa ferry terminal" },
      },
      {
        key: "scooter",
        type: "rental",
        title: "Scooter for Gozo",
        startTime: "08:40",
        durationMin: 15,
        rental: {
          vehicle: "scooter",
          days: 1,
          returnTime: "17:00",
          returnPlace: "Gozo farmhouse",
          returnLocation: { lat: 36.0601, lng: 14.2353, address: "Għarb road, Gozo" },
        },
        booking: { provider: "Gozo scooter hire", reference: "DEMO-SC7", price: "€30" },
        location: { lat: 36.0247, lng: 14.2995, address: "Mġarr harbour, Gozo" },
        notes: "Picked up at the harbour, collected from the farmhouse the next afternoon.",
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
        key: "farmhouse",
        type: "stay",
        title: "Gozo farmhouse",
        stay: { nights: 2, checkIn: "14:00", checkOut: "10:00" },
        booking: { provider: "Airbnb", reference: "DEMO-HM42", price: "€260" },
        location: { lat: 36.0601, lng: 14.2353, address: "Għarb road, Gozo" },
      },
      {
        key: "victoria",
        type: "place",
        title: "Citadel, Victoria",
        durationMin: 90,
        location: { lat: 36.0464, lng: 14.2397, address: "Victoria, Gozo" },
      },
    ],
    // Day 5 (Wednesday): surface day.
    [
      {
        key: "comino",
        type: "activity",
        title: "Comino Blue Lagoon boat trip",
        startTime: "10:00",
        durationMin: 300,
        booking: { provider: "GetYourGuide", reference: "GYG-DEMO", price: "€35" },
        location: { lat: 36.013, lng: 14.3227, address: "Blue Lagoon, Comino" },
      },
    ],
    // Day 6 (Thursday): back to Malta, last dives, a night by the airport.
    [
      {
        key: "ferryback",
        type: "transport",
        title: "Ferry back to Malta",
        startTime: "08:00",
        durationMin: 25,
        transport: {
          kind: "ferry",
          from: "Mġarr (Gozo)",
          to: "Ċirkewwa",
          toLocation: { lat: 35.9889, lng: 14.3286, address: "Ċirkewwa ferry terminal" },
        },
        location: { lat: 36.0247, lng: 14.2995, address: "Mġarr ferry terminal, Gozo" },
      },
      {
        key: "zurrieq",
        type: "dive",
        title: "Wied iż-Żurrieq shore dives",
        startTime: "09:30",
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
      {
        key: "airporthotel",
        type: "stay",
        title: "Airport hotel, Luqa",
        stay: { nights: 1, checkIn: "14:00", checkOut: "04:00" },
        booking: { provider: "Booking.com", reference: "DEMO-5678", price: "€95" },
        location: { lat: 35.8594, lng: 14.4866, address: "Luqa, Malta" },
      },
    ],
    // Day 7 (Friday): early flight home – too soon after the last dives.
    [
      {
        key: "depart",
        type: "transport",
        title: "Flight home",
        startTime: "06:00",
        durationMin: 180,
        transport: {
          kind: "flight",
          from: "MLA",
          to: "KRK",
          number: "TD 102",
          toLocation: { lat: 50.0777, lng: 19.7848, address: "Kraków Airport" },
        },
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
  trip.days[6].startTime = "04:30";

  const hotel = trip.items[ids.get("hotel")!].location!;
  const valletta = trip.items[ids.get("valletta")!].location!;
  const legs: [string, string, Leg][] = [
    ["hotel", "dinner1", { mode: "WALK" }],
    // A real Google answer, kept so the bus line shows without a Google key; with one, the board
    // asks again for the trip's own date.
    ["hotel", "valletta", { mode: "TRANSIT", result: { key: routeKey("TRANSIT", hotel, valletta), ...BUS_TO_VALLETTA } }],
    ["valletta", "cathedral", { mode: "WALK" }],
    ["cathedral", "noongun", { mode: "WALK" }],
    ["noongun", "lunch", { mode: "WALK" }],
    ["ferry", "scooter", { mode: "WALK" }],
    ["scooter", "bluehole", { mode: "TWO_WHEELER" }],
    ["farmhouse", "victoria", { mode: "TWO_WHEELER" }],
    ["farmhouse", "comino", { mode: "BOAT", manualMin: 30 }],
    ["mdina", "dingli", { mode: "BICYCLE" }],
  ];
  for (const [a, b, leg] of legs) trip.legs[legKey(ids.get(a)!, ids.get(b)!)] = leg;

  const ideas: Omit<Item, "id">[] = [
    {
      type: "place",
      title: "Blue Grotto boat ride",
      durationMin: 60,
      notes: "Best in the morning light.",
      location: { lat: 35.8197, lng: 14.4566, address: "Blue Grotto, Malta" },
    },
    {
      type: "dive",
      title: "HMS Maori wreck",
      durationMin: 120,
      dive: { dives: 1, maxDepthM: 14, gas: "air", site: "HMS Maori" },
      aiReason: "Easy shore dive on a WWII destroyer right below Valletta – fits a short morning.",
      location: { lat: 35.9013, lng: 14.5075, address: "Marsamxett Harbour, Valletta" },
    },
  ];
  for (const draft of ideas) {
    const item: Item = { id: newId(), ...draft };
    trip.items[item.id] = item;
    trip.ideas.push(item.id);
  }

  return trip;
}
