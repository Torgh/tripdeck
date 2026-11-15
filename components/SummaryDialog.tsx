"use client";

import { useMemo } from "react";
import { useRates } from "@/lib/hooks";
import { formatMoney, tripSpending, type Budget } from "@/lib/money";
import { tripSummary } from "@/lib/summary";
import type { DayTimeline } from "@/lib/timeline";
import { EXPENSE_ICON, type ExpenseKind, type Trip } from "@/lib/types";
import { useT } from "@/lib/useLang";
import { Modal } from "./Modal";

/** The trip in numbers: how long, how far, where, what was done and what it cost against the plan. */
export function SummaryDialog({
  trip,
  timelines,
  budget,
  onClose,
}: {
  trip: Trip;
  timelines: DayTimeline[];
  budget?: Budget;
  onClose: () => void;
}) {
  const t = useT();
  const s = useMemo(() => tripSummary(trip, timelines), [trip, timelines]);
  const rates = useRates(budget?.currency ?? "EUR", !!budget && Object.keys(trip.expenses ?? {}).length > 0);
  const spending = budget && tripSpending(trip, budget, rates);
  const km = (n: number) => `${n.toLocaleString()} km`;
  const ways = (
    [
      ["✈️", s.km.flown],
      ["🚗", s.km.road],
      ["⛴️", s.km.sea],
      ["🚆", s.km.rail],
    ] as const
  ).filter(([, n]) => n > 0);
  const total = ways.reduce((sum, [, n]) => sum + n, 0);

  const tiles: [string, string, string?][] = [
    ["📅", t("summary.days", { n: s.days }), s.nights ? t("summary.nights", { n: s.nights, stays: s.stays }) : undefined],
    ["📍", t("summary.places", { n: s.places })],
    ...(s.dives ? [["🤿", t("summary.dives", { n: s.dives }), t("summary.diveDays", { n: s.diveDays })] as [string, string, string]] : []),
    ...(total
      ? [["🧭", km(total), `${ways.map(([icon, n]) => `${icon} ${km(n)}`).join(" · ")}${s.roadEstimated ? ` · ${t("summary.estimated")}` : ""}`] as [
          string,
          string,
          string,
        ]]
      : []),
    ...(s.flights || s.ferries || s.trains
      ? [["🎫", [s.flights && t("summary.flights", { n: s.flights }), s.ferries && t("summary.ferries", { n: s.ferries }), s.trains && t("summary.trains", { n: s.trains })].filter(Boolean).join(" · ")] as [string, string]]
      : []),
    ...(s.countries.length ? [["🌍", s.countries.join(", ")] as [string, string]] : []),
    ...(s.highest ? [["⛰️", `${s.highest.m.toLocaleString()} m`, s.highest.title] as [string, string, string]] : []),
  ];

  return (
    <Modal title={t("summary.title")} onClose={onClose}>
      <div className="summary-tiles">
        {tiles.map(([icon, value, sub], i) => (
          <div key={i} className="summary-tile">
            <span className="summary-icon" aria-hidden>
              {icon}
            </span>
            <div>
              <strong>{value}</strong>
              {sub && <div className="muted small">{sub}</div>}
            </div>
          </div>
        ))}
      </div>
      {spending && (spending.planned > 0 || spending.spent > 0) && (
        <section>
          <h3>{t("summary.money")}</h3>
          <p>
            {t("budgetDialog.spentOf", {
              spent: formatMoney(spending.spent, spending.currency),
              planned: formatMoney(spending.planned, spending.currency),
            })}
          </p>
          {spending.expenses > 0 && (
            <p className="muted small">
              {(Object.entries(spending.byKind) as [ExpenseKind, number][])
                .sort((a, b) => b[1] - a[1])
                .map(([kind, n]) => `${EXPENSE_ICON[kind]} ${t(`expenseKind.${kind}`)} ${formatMoney(n, spending.currency)}`)
                .join(" · ")}
            </p>
          )}
        </section>
      )}
    </Modal>
  );
}
