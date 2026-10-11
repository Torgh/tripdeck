"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { TripView } from "@/components/TripView";

// The trip id lives in the query string (not the path) so one cached page shell serves every trip offline.
function TripPage() {
  const id = useSearchParams().get("id");
  return <TripView key={id} tripId={id} />;
}

export default function Page() {
  return (
    <Suspense fallback={<main className="home muted">Loading…</main>}>
      <TripPage />
    </Suspense>
  );
}
