"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { TripPrint } from "@/components/TripPrint";
import { useT } from "@/lib/useLang";

function PrintPage() {
  const id = useSearchParams().get("id");
  return <TripPrint key={id} tripId={id} />;
}

function Loading() {
  const t = useT();
  return <main className="home muted">{t("common.loading")}</main>;
}

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <PrintPage />
    </Suspense>
  );
}
