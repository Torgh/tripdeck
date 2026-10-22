"use client";

import { useRates } from "@/lib/hooks";
import { formatMoney, RATE_CURRENCIES, type Budget, type BudgetLine } from "@/lib/money";
import { useStore } from "@/lib/store";
import { dayDate, formatDayLabel } from "@/lib/time";
import { ITEM_TYPE_ICON, ITEM_TYPE_LABEL, itemIcon, type ItemType, type Trip } from "@/lib/types";
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
  const updateTrip = useStore((s) => s.updateTrip);
  const updateItem = useStore((s) => s.updateItem);
  // For converting the limit when the currency changes, even on a trip priced in one currency.
  const rates = useRates(budget.currency, true);
  const m = (n: number) => formatMoney(n, budget.currency);
  const day = (i: number) => `Day ${i + 1} · ${formatDayLabel(dayDate(trip.startDate, i))}`;
  const { limit, total } = budget;
  const byType = (Object.entries(budget.byType) as [ItemType, number][]).sort((a, b) => b[1] - a[1]);

  const setPaid = (line: BudgetLine, paid: boolean) =>
    updateItem(trip.id, line.item.id, { booking: { ...line.item.booking, paid: paid || undefined } });

  return (
    <Modal title="💰 Budget" onClose={onClose}>
      <div className="budget">
        <div className="grid2">
          <label>
            Currency
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
            Spending limit (optional)
            <input
              type="number"
              min={0}
              step="any"
              value={limit ?? ""}
              placeholder="No limit"
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
            {m(budget.paid)} paid · {m(total - budget.paid)} to pay
          </div>
          {limit ? (
            <>
              <div className={`budget-bar${total > limit ? " over" : ""}`}>
                <div style={{ width: `${Math.min(100, (total / limit) * 100)}%` }} />
              </div>
              <div className="small" style={{ color: total > limit ? "var(--warn)" : undefined }}>
                {total <= limit ? `${m(limit - total)} left of ${m(limit)}` : `⚠️ ${m(total - limit)} over the ${m(limit)} limit`}
              </div>
            </>
          ) : null}
        </div>

        {budget.unconverted.length > 0 && (
          <p className="issue warn">
            No exchange rate yet for {budget.unconverted.join(", ")} – those prices aren&apos;t in the total. Connect to the
            internet once to fetch the rates.
          </p>
        )}
        {budget.noCurrency.length > 0 && (
          <p className="issue warn">
            {budget.noCurrency.length} {budget.noCurrency.length === 1 ? "price has" : "prices have"} no currency and{" "}
            {budget.noCurrency.length === 1 ? "isn't" : "aren't"} counted:{" "}
            {budget.noCurrency.map(({ item }, i) => (
              <span key={item.id}>
                {i > 0 && ", "}
                <button className="linklike" onClick={() => onEdit(item.id)}>
                  {item.title} ({item.booking?.price})
                </button>
              </span>
            ))}
            . Write it like “1 500 THB” or “€35”.
          </p>
        )}

        {budget.lines.length === 0 ? (
          <p className="muted">
            No prices yet. Add a price to a card&apos;s booking – “€189”, “1 500 THB” – and it shows up here.
          </p>
        ) : (
          <div className="grid2 budget-breakdown">
            <section>
              <h3>By kind</h3>
              <ul className="budget-list">
                {byType.map(([type, amount]) => (
                  <li key={type}>
                    <span className="grow">
                      {ITEM_TYPE_ICON[type]} {ITEM_TYPE_LABEL[type]}
                    </span>
                    {m(amount)}
                  </li>
                ))}
              </ul>
            </section>
            <section>
              <h3>By day</h3>
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
            <h3>Prices</h3>
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
            <h3>In Ideas (not counted)</h3>
            <ul className="todo-list">
              {budget.ideas.map((line) => (
                <PriceRow
                  key={line.item.id}
                  line={line}
                  where="Ideas"
                  currency={budget.currency}
                  onEdit={() => onEdit(line.item.id)}
                />
              ))}
            </ul>
          </section>
        )}

        <p className="muted small">
          Stays and rentals count on the day they start.
          {budget.ratesDate && ` Converted at the European Central Bank's rates of ${budget.ratesDate}.`}
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
  const { item, price, converted } = line;
  return (
    <li>
      <span className="grow">
        {itemIcon(item)} <strong>{item.title}</strong>
        <span className="muted"> · {where}</span>
        <br />
        {price.currency ? formatMoney(price.amount, price.currency) : item.booking?.price}
        {price.currency && price.currency !== currency && (
          <span className="muted"> · {converted === undefined ? "no rate yet" : `≈ ${formatMoney(converted, currency)}`}</span>
        )}
      </span>
      {onPaid && (
        <label className="row small" style={{ gap: 4 }}>
          <input type="checkbox" style={{ width: "auto" }} checked={line.paid} onChange={(e) => onPaid(e.target.checked)} />
          Paid
        </label>
      )}
      <button className="btn small" onClick={onEdit}>
        Edit
      </button>
    </li>
  );
}
