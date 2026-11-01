"use client";

import { useRates } from "@/lib/hooks";
import { formatMoney, RATE_CURRENCIES, type Budget, type BudgetLine } from "@/lib/money";
import { useStore } from "@/lib/store";
import { dayDate, formatDayLabel } from "@/lib/time";
import { ITEM_TYPE_ICON, itemIcon, type ItemType, type Trip } from "@/lib/types";
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
  const day = (i: number) => `${t("common.day", { day: i + 1 })} · ${formatDayLabel(dayDate(trip.startDate, i), lang)}`;
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
            {budget.noCurrency.map(({ item }, i) => (
              <span key={item.id}>
                {i > 0 && ", "}
                <button className="linklike" onClick={() => onEdit(item.id)}>
                  {item.title} ({item.booking?.price})
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

        {budget.lines.length > 0 && (
          <section>
            <h3>{t("budgetDialog.prices")}</h3>
            <ul className="todo-list">
              {budget.lines.map((line) => (
                <PriceRow
                  key={line.item.id}
                  line={line}
                  where={day(line.dayIndex!)}
                  currency={budget.currency}
                  onPaid={(paid) => setPaid(line, paid)}
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
                  key={line.item.id}
                  line={line}
                  where={t("common.ideas")}
                  currency={budget.currency}
                  onEdit={() => onEdit(line.item.id)}
                />
              ))}
            </ul>
          </section>
        )}

        <p className="muted small">
          {t("budgetDialog.startDay")}
          {budget.ratesDate && t("budgetDialog.ecb", { date: budget.ratesDate })}
        </p>
      </div>
    </Modal>
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
