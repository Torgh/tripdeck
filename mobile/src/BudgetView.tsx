import { formatMoney, type Budget, type BudgetLine } from "@/lib/money";
import { dayDate, formatDayLabel } from "@/lib/time";
import { ITEM_TYPE_ICON, ITEM_TYPE_LABEL, itemIcon, type ItemType, type Trip } from "@/lib/types";

/** What the trip costs, as planned on the desktop: totals, paid and still to pay, per day and per kind. */
export function BudgetView({ trip, budget, onDay }: { trip: Trip; budget: Budget; onDay: (dayIndex: number) => void }) {
  const m = (n: number) => formatMoney(n, budget.currency);
  const { limit, total } = budget;
  const byType = (Object.entries(budget.byType) as [ItemType, number][]).sort((a, b) => b[1] - a[1]);
  const toPay = budget.lines.filter((l) => !l.paid);

  return (
    <>
      <div className="day-head">
        <h2>Budget</h2>
        <span className="muted small">in {budget.currency}</span>
      </div>

      <section className="budget-total">
        <div className="budget-amount">{m(total)}</div>
        <div className="muted small">
          {m(budget.paid)} paid · {m(total - budget.paid)} to pay
        </div>
        {limit ? (
          <>
            <div className={`budget-bar${total > limit ? " over" : ""}`}>
              <div style={{ width: `${Math.min(100, (total / limit) * 100)}%` }} />
            </div>
            <div className={`small${total > limit ? " warn-text" : ""}`}>
              {total <= limit ? `${m(limit - total)} left of ${m(limit)}` : `⚠️ ${m(total - limit)} over the ${m(limit)} limit`}
            </div>
          </>
        ) : null}
      </section>

      {budget.unconverted.length > 0 && (
        <div className="issue warn">
          ⚠️ No exchange rate yet for {budget.unconverted.join(", ")} – those prices aren&apos;t in the total. Open the app
          once with internet to fetch the rates.
        </div>
      )}
      {budget.noCurrency.length > 0 && (
        <div className="issue warn">
          ⚠️ Not counted, no currency: {budget.noCurrency.map(({ item }) => `${item.title} (${item.booking?.price})`).join(", ")}
        </div>
      )}

      {budget.lines.length === 0 ? (
        <p className="empty muted">No prices in this trip yet. Add them to the bookings on the desktop.</p>
      ) : (
        <>
          {toPay.length > 0 && (
            <>
              <h3 className="budget-heading">Still to pay</h3>
              <ul className="budget-list">
                {toPay.map((line) => (
                  <PriceRow key={line.item.id} line={line} currency={budget.currency} onTap={() => onDay(line.dayIndex!)} />
                ))}
              </ul>
            </>
          )}

          <h3 className="budget-heading">By day</h3>
          <ul className="budget-list">
            {budget.byDay.map((amount, i) =>
              amount > 0 ? (
                <li key={trip.days[i].id}>
                  <button onClick={() => onDay(i)}>
                    <span className="grow">
                      Day {i + 1} · {formatDayLabel(dayDate(trip.startDate, i))}
                    </span>
                    <span>{m(amount)}</span>
                  </button>
                </li>
              ) : null,
            )}
          </ul>

          <h3 className="budget-heading">By kind</h3>
          <ul className="budget-list">
            {byType.map(([type, amount]) => (
              <li key={type}>
                <div>
                  <span className="grow">
                    {ITEM_TYPE_ICON[type]} {ITEM_TYPE_LABEL[type]}
                  </span>
                  <span>{m(amount)}</span>
                </div>
              </li>
            ))}
          </ul>

          {budget.lines.length > toPay.length && (
            <>
              <h3 className="budget-heading">Paid</h3>
              <ul className="budget-list">
                {budget.lines
                  .filter((l) => l.paid)
                  .map((line) => (
                    <PriceRow key={line.item.id} line={line} currency={budget.currency} onTap={() => onDay(line.dayIndex!)} />
                  ))}
              </ul>
            </>
          )}
        </>
      )}

      <p className="muted small budget-note">
        Stays and rentals count on the day they start; ideas aren&apos;t counted.
        {budget.ratesDate && ` Converted at the European Central Bank's rates of ${budget.ratesDate}.`}
      </p>
    </>
  );
}

function PriceRow({ line, currency, onTap }: { line: BudgetLine; currency: string; onTap: () => void }) {
  const { item, price, converted } = line;
  const foreign = price.currency && price.currency !== currency;
  return (
    <li>
      <button onClick={onTap}>
        <span className="grow">
          {itemIcon(item)} {item.title}
          <span className="muted small"> · day {line.dayIndex! + 1}</span>
        </span>
        <span className="budget-price">
          {price.currency ? formatMoney(price.amount, price.currency) : item.booking?.price}
          {foreign && (
            <span className="muted small">{converted === undefined ? "no rate" : `≈ ${formatMoney(converted, currency)}`}</span>
          )}
        </span>
      </button>
    </li>
  );
}
