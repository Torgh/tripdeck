"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { TripPrint } from "@/components/TripPrint";

function PrintPage() {
  const id = useSearchParams().get("id");
  return <TripPrint key={id} tripId={id} />;
}

export default function Page() {
  return (
    <Suspense fallback={<main className="home muted">Loading…</main>}>
      <PrintPage />
    </Suspense>
  );
}
