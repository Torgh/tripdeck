import { App as NativeApp } from "@capacitor/app";
import { useCallback, useEffect, useRef, useState } from "react";
import { demoTrip } from "@/lib/demo";
import { parseTripFile } from "@/lib/tripOps";
import type { Trip } from "@/lib/types";
import { loadTrips, saveTrips } from "./storage";
import { TripList } from "./TripList";
import { TripScreen } from "./TripScreen";

export function App() {
  const [trips, setTrips] = useState<Record<string, Trip> | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Re-read on resume so "today" moves on when the app was left open overnight.
  const [now, setNow] = useState(() => new Date());
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadTrips().then(setTrips);
  }, []);

  const update = useCallback((next: Record<string, Trip>) => {
    setTrips(next);
    void saveTrips(next);
  }, []);

  // Android back button: from a trip back to the list, from the list out of the app.
  const openRef = useRef(openId);
  useEffect(() => {
    openRef.current = openId;
  }, [openId]);
  useEffect(() => {
    const back = NativeApp.addListener("backButton", () => {
      // Screens can take the back press first (the full-screen map closes itself).
      if (!window.dispatchEvent(new Event("app-back", { cancelable: true }))) return;
      if (openRef.current) setOpenId(null);
      else void NativeApp.exitApp();
    });
    const resume = NativeApp.addListener("resume", () => setNow(new Date()));
    return () => {
      void back.then((h) => h.remove());
      void resume.then((h) => h.remove());
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 3500);
    return () => clearTimeout(t);
  }, [notice]);

  const addTrip = (trip: Trip) => {
    const replaced = trips?.[trip.id];
    update({ ...trips, [trip.id]: trip });
    setNotice(replaced ? `Updated “${trip.name}”` : `Imported “${trip.name}”`);
    setOpenId(trip.id);
  };

  const importFile = async (file: File) => {
    try {
      addTrip(parseTripFile(JSON.parse(await file.text()), { keepId: true }));
    } catch (e) {
      setNotice(e instanceof SyntaxError ? "This file is not valid JSON." : (e as Error).message);
    }
  };

  const deleteTrip = (id: string) => {
    if (!trips) return;
    const { [id]: _removed, ...rest } = trips;
    update(rest);
  };

  if (!trips) return <div className="splash" />;
  const open = openId ? trips[openId] : undefined;

  return (
    <>
      {open ? (
        <TripScreen trip={open} now={now} onBack={() => setOpenId(null)} />
      ) : (
        <TripList
          trips={Object.values(trips)}
          now={now}
          onOpen={setOpenId}
          onImport={() => fileInput.current?.click()}
          onDemo={() => addTrip(demoTrip())}
          onDelete={deleteTrip}
        />
      )}
      {/* No `accept`: cloud apps often hand over .tripdeck.json files without a JSON type. */}
      <input
        ref={fileInput}
        type="file"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void importFile(file);
        }}
      />
      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
    </>
  );
}
