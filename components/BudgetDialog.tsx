"use client";

import { useRates } from "@/lib/hooks";
import { useState } from "react";
import { formatMoney, parsePrice, RATE_CURRENCIES, tripSpending, type Budget, type BudgetLine, type Spending } from "@/lib/money";
import { useStore } from "@/lib/store";
import { tripDayTitle } from "@/lib/itinerary";
import { newId } from "@/lib/tripOps";
import { EXPENSE_ICON, EXPENSE_KINDS, ITEM_TYPE_ICON, itemIcon, type ExpenseKind, type ItemType, type Trip } from "@/lib/types";
import { useLang, useT } from "@/lib/useLang";
import { Modal } from "./Modal";

/** What the trip costs: totals in one currency, paid and still to pay, per kind of card and per day. */
export function BudgetDialog({
  trip,
  budget,
  onEdit,
  onClose,
}: {
  trip: Trip;
  budget: Budget;
  onEdit: (itemId: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const lang = useLang();
  const updateTrip = useStore((s) => s.updateTrip);
  const updateItem = useStore((s) => s.updateItem);
  // For converting the limit when the currency changes, even on a trip priced in one currency.
  const rates = useRates(budget.currency, true);
  const m = (n: number) => formatMoney(n, budget.currency);
  const day = (i: number) => tripDayTitle(trip, i, lang);
  const { limit, total } = budget;
  const byType = (Object.entries(budget.byType) as [ItemType, number][]).sort((a, b) => b[1] - a[1]);

  const setPaid = (line: BudgetLine, paid: boolean) =>
    updateItem(trip.id, line.item.id, { booking: { ...line.item.booking, paid: paid || undefined } });

  return (
    <Modal title={t("budgetDialog.title")} onClose={onClose}>
      <div className="budget">
        <div className="grid2">
          <label>
            {t("budgetDialog.currency")}
            <select
              value={budget.currency}
              onChange={(e) => {
                // The limit keeps its value: €1,500 becomes zł 6,390, not zł 1,500.
                const currency = e.target.value;
                const rate = rates?.rates[currency];
                const converted = limit && rate ? Math.round(limit * rate) : limit;
                updateTrip(trip.id, { budget: { ...trip.budget, currency, limit: converted } });
              }}
            >
              {RATE_CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("budgetDialog.limit")}
            <input
              type="number"
              min={0}
              step="any"
              value={limit ?? ""}
              placeholder={t("budgetDialog.noLimit")}
              onChange={(e) => {
                const n = Number(e.target.value);
                updateTrip(trip.id, { budget: { ...trip.budget, currency: budget.currency, limit: n > 0 ? n : undefined } });
              }}
            />
          </label>
        </div>

        <div className="budget-total">
          <div className="budget-amount">{m(total)}</div>
          <div className="muted small">
            {t("budgetDialog.paidToPay", { paid: m(budget.paid), toPay: m(total - budget.paid) })}
          </div>
          {limit ? (
            <>
              <div className={`budget-bar${total > limit ? " over" : ""}`}>
                <div style={{ width: `${Math.min(100, (total / limit) * 100)}%` }} />
              </div>
              <div className="small" style={{ color: total > limit ? "var(--warn)" : undefined }}>
                {total <= limit
                  ? t("budgetDialog.left", { amount: m(limit - total), limit: m(limit) })
                  : t("budgetDialog.over", { amount: m(total - limit), limit: m(limit) })}
              </div>
            </>
          ) : null}
        </div>

        {budget.unconverted.length > 0 && (
          <p className="issue warn">{t("budgetDialog.noRate", { currencies: budget.unconverted.join(", ") })}</p>
        )}
        {budget.noCurrency.length > 0 && (
          <p className="issue warn">
            {t("budgetDialog.noCurrency", { n: budget.noCurrency.length })}{" "}
            {budget.noCurrency.map(({ item, text }, i) => (
              <span key={`${item.id}-${i}`}>
                {i > 0 && ", "}
                <button className="linklike" onClick={() => onEdit(item.id)}>
                  {item.title} ({text})
                </button>
              </span>
            ))}
            {t("budgetDialog.writeIt")}
          </p>
        )}

        {budget.lines.length === 0 ? (
          <p className="muted">{t("budgetDialog.noPrices")}</p>
        ) : (
          <div className="grid2 budget-breakdown">
            <section>
              <h3>{t("budgetDialog.byKind")}</h3>
              <ul className="budget-list">
                {byType.map(([type, amount]) => (
                  <li key={type}>
                    <span className="grow">
                      {ITEM_TYPE_ICON[type]} {t(`itemType.${type}`)}
                    </span>
                    {m(amount)}
                  </li>
                ))}
              </ul>
            </section>
            <section>
              <h3>{t("budgetDialog.byDay")}</h3>
              <ul className="budget-list">
                {budget.byDay.map((amount, i) =>
                  amount > 0 ? (
                    <li key={trip.days[i].id}>
                      <span className="grow">{day(i)}</span>
                      {m(amount)}
                    </li>
                  ) : null,
                )}
              </ul>
            </section>
          </div>
        )}

        {budget.cash.length > 0 && (
          <section>
            <h3>{t("budgetDialog.cash")}</h3>
            <ul className="budget-list">
              {budget.cash.map((need) => (
                <li key={need.currency}>
                  <span className="grow">
                    💵 <strong>{formatMoney(need.amount, need.currency)}</strong>
                    <span className="muted small">
                      {" · "}
                      {need.byDay.map((d) => `${day(d.dayIndex)}: ${formatMoney(d.amount, need.currency)}`).join(" · ")}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="muted small">{t("budgetDialog.cashHint")}</p>
          </section>
        )}

        {budget.lines.length > 0 && (
          <section>
            <h3>{t("budgetDialog.prices")}</h3>
            <ul className="todo-list">
              {budget.lines.map((line) => (
                <PriceRow
                  key={`${line.item.id}${line.onSite ? "-site" : ""}`}
                  line={line}
                  where={day(line.dayIndex!)}
                  currency={budget.currency}
                  onPaid={line.onSite ? undefined : (paid) => setPaid(line, paid)}
                  onEdit={() => onEdit(line.item.id)}
                />
              ))}
            </ul>
          </section>
        )}

        {budget.ideas.length > 0 && (
          <section>
            <h3>{t("budgetDialog.inIdeas")}</h3>
            <ul className="todo-list">
              {budget.ideas.map((line) => (
                <PriceRow
                  key={`${line.item.id}${line.onSite ? "-site" : ""}`}
                  line={line}
                  where={t("common.ideas")}
                  currency={budget.currency}
                  onEdit={() => onEdit(line.item.id)}
                />
              ))}
            </ul>
          </section>
        )}

        <ExpensesSection trip={trip} spending={tripSpending(trip, budget, rates)} />

        <p className="muted small">
          {t("budgetDialog.startDay")}
          {budget.ratesDate && t("budgetDialog.ecb", { date: budget.ratesDate })}
        </p>
      </div>
    </Modal>
  );
}

/** Money spent during the trip beyond the bookings, and how it compares with the plan. */
function ExpensesSection({ trip, spending }: { trip: Trip; spending: Spending }) {
  const t = useT();
  const lang = useLang();
  const updateTrip = useStore((s) => s.updateTrip);
  const [draft, setDraft] = useState({ dayId: "", amount: "", kind: "food" as ExpenseKind, note: "" });
  const m = (n: number) => formatMoney(n, spending.currency);
  const money = parsePrice(draft.amount);
  const valid = !!money && (!!money.currency || money.amount === 0);
  const dayIndex = new Map(trip.days.map((d, i) => [d.id, i]));

  const add = () => {
    if (!valid) return;
    const id = newId();
    const expense = {
      id,
      dayId: draft.dayId || undefined,
      amount: draft.amount.trim(),
      kind: draft.kind,
      note: draft.note.trim() || undefined,
      createdAt: new Date().toISOString(),
    };
    updateTrip(trip.id, { expenses: { ...trip.expenses, [id]: expense } });
    setDraft({ ...draft, amount: "", note: "" });
  };
  const remove = (id: string) => {
    const { [id]: _removed, ...rest } = trip.expenses ?? {};
    updateTrip(trip.id, { expenses: rest });
  };

  return (
    <section>
      <h3>{t("budgetDialog.expenses")}</h3>
      <p className="small">
        {t("budgetDialog.spentOf", { spent: m(spending.spent), planned: m(spending.planned) })}
        <span className="muted"> · {t("budgetDialog.spentParts", { paid: m(spending.spent - spending.expenses), expenses: m(spending.expenses) })}</span>
      </p>
      {spending.unconverted.length > 0 && (
        <p className="issue warn">{t("budgetDialog.noRate", { currencies: spending.unconverted.join(", ") })}</p>
      )}
      {spending.noCurrency.length > 0 && (
        <p className="issue warn">
          {t("budgetDialog.expenseNoCurrency", { items: spending.noCurrency.map((e) => e.amount).join(", ") })}
        </p>
      )}
      <div className="expense-form">
        <select value={draft.dayId} onChange={(e) => setDraft({ ...draft, dayId: e.target.value })} aria-label={t("budgetDialog.expenseDay")}>
          <option value="">{t("budgetDialog.wholeTrip")}</option>
          {trip.days.map((d, i) => (
            <option key={d.id} value={d.id}>
              {tripDayTitle(trip, i, lang)}
            </option>
          ))}
        </select>
        <select
          value={draft.kind}
          onChange={(e) => setDraft({ ...draft, kind: e.target.value as ExpenseKind })}
          aria-label={t("budgetDialog.expenseKind")}
        >
          {EXPENSE_KINDS.map((k) => (
            <option key={k} value={k}>
              {EXPENSE_ICON[k]} {t(`expenseKind.${k}`)}
            </option>
          ))}
        </select>
        <input
          value={draft.amount}
          placeholder="350 THB"
          aria-label={t("budgetDialog.expenseAmount")}
          onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <input
          value={draft.note}
          placeholder={t("budgetDialog.expenseNote")}
          aria-label={t("budgetDialog.expenseNote")}
          onChange={(e) => setDraft({ ...draft, note: e.target.value })}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <button className="btn small primary" disabled={!valid} onClick={add}>
          {t("budgetDialog.addExpense")}
        </button>
      </div>
      {draft.amount && !valid && <p className="small" style={{ color: "var(--warn)" }}>{t("editor.addCurrency")}</p>}
      {spending.lines.length > 0 && (
        <ul className="todo-list">
          {spending.lines.map(({ expense, money: amount, converted, dayIndex: d }) => (
            <li key={expense.id}>
              <span className="grow">
                {EXPENSE_ICON[expense.kind]} <strong>{amount.currency ? formatMoney(amount.amount, amount.currency) : expense.amount}</strong>
                {amount.currency && amount.currency !== spending.currency && converted !== undefined && (
                  <span className="muted"> ≈ {m(converted)}</span>
                )}
                {expense.note && <> · {expense.note}</>}
                <span className="muted">
                  {" · "}
                  {d !== undefined ? tripDayTitle(trip, d, lang) : t(expense.dayId && !dayIndex.has(expense.dayId) ? "budgetDialog.removedDay" : "budgetDialog.wholeTrip")}
                </span>
              </span>
              <button className="btn small ghost danger" title={t("common.remove")} onClick={() => remove(expense.id)}>
                🗑
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PriceRow({
  line,
  where,
  currency,
  onPaid,
  onEdit,
}: {
  line: BudgetLine;
  where: string;
  currency: string;
  onPaid?: (paid: boolean) => void;
  onEdit: () => void;
}) {
  const t = useT();
  const { item, price, converted } = line;
  return (
    <li>
      <span className="grow">
        {itemIcon(item)} <strong>{item.title}</strong>
        <span className="muted"> · {where}</span>
        <br />
        {price.currency ? formatMoney(price.amount, price.currency) : item.booking?.price}
        {line.onSite && (
          <span className="badge" style={{ marginLeft: 6 }}>
            {line.cash ? `💵 ${t("budgetDialog.onSiteCash")}` : t("budgetDialog.onSite")}
          </span>
        )}
        {price.currency && price.currency !== currency && (
          <span className="muted"> · {converted === undefined ? t("budgetDialog.noRateYet") : `≈ ${formatMoney(converted, currency)}`}</span>
        )}
      </span>
      {onPaid && (
        <label className="row small" style={{ gap: 4 }}>
          <input type="checkbox" style={{ width: "auto" }} checked={line.paid} onChange={(e) => onPaid(e.target.checked)} />
          {t("budgetDialog.paid")}
        </label>
      )}
      <button className="btn small" onClick={onEdit}>
        {t("common.edit")}
      </button>
    </li>
  );
}
