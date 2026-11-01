"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { TripView } from "@/components/TripView";
import { useT } from "@/lib/useLang";

// The trip id lives in the query string (not the path) so one cached page shell serves every trip offline.
function TripPage() {
  const id = useSearchParams().get("id");
  return <TripView key={id} tripId={id} />;
}

function Loading() {
  const t = useT();
  return <main className="home muted">{t("common.loading")}</main>;
}

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <TripPage />
    </Suspense>
  );
}
