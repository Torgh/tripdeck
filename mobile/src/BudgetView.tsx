import { formatMoney, type Budget, type BudgetLine } from "@/lib/money";
import { tripDayTitle } from "@/lib/itinerary";
import { ITEM_TYPE_ICON, itemIcon, type ItemType, type Trip } from "@/lib/types";
import { useLang, useT } from "@/lib/useLang";

/** What the trip costs, as planned on the desktop: totals, paid and still to pay, per day and per kind. */
export function BudgetView({ trip, budget, onDay }: { trip: Trip; budget: Budget; onDay: (dayIndex: number) => void }) {
  const t = useT();
  const lang = useLang();
  const m = (n: number) => formatMoney(n, budget.currency);
  const { limit, total } = budget;
  const byType = (Object.entries(budget.byType) as [ItemType, number][]).sort((a, b) => b[1] - a[1]);
  const toPay = budget.lines.filter((l) => !l.paid);

  return (
    <>
      <div className="day-head">
        <h2>{t("phone.budget")}</h2>
        <span className="muted small">{t("phoneBudget.inCurrency", { currency: budget.currency })}</span>
      </div>

      <section className="budget-total">
        <div className="budget-amount">{m(total)}</div>
        <div className="muted small">
          {t("budgetDialog.paidToPay", { paid: m(budget.paid), toPay: m(total - budget.paid) })}
        </div>
        {limit ? (
          <>
            <div className={`budget-bar${total > limit ? " over" : ""}`}>
              <div style={{ width: `${Math.min(100, (total / limit) * 100)}%` }} />
            </div>
            <div className={`small${total > limit ? " warn-text" : ""}`}>
              {total <= limit
                ? t("budgetDialog.left", { amount: m(limit - total), limit: m(limit) })
                : t("budgetDialog.over", { amount: m(total - limit), limit: m(limit) })}
            </div>
          </>
        ) : null}
      </section>

      {budget.cash.length > 0 && (
        <section>
          <h3 className="budget-heading">{t("budgetDialog.cash")}</h3>
          <ul className="budget-list">
            {budget.cash.map((need) => (
              <li key={need.currency}>
                <span className="grow">
                  💵 {formatMoney(need.amount, need.currency)}
                  <span className="muted small">
                    {need.byDay
                      // phoneBudget.day starts with its own " · ".
                      .map((d) => `${t("phoneBudget.day", { day: d.dayIndex + 1 })}: ${formatMoney(d.amount, need.currency)}`)
                      .join("")}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {budget.unconverted.length > 0 && (
        <div className="issue warn">{t("phoneBudget.noRate", { currencies: budget.unconverted.join(", ") })}</div>
      )}
      {budget.noCurrency.length > 0 && (
        <div className="issue warn">
          {t("phoneBudget.noCurrency", {
            items: budget.noCurrency.map(({ item, text }) => `${item.title} (${text})`).join(", "),
          })}
        </div>
      )}

      {budget.lines.length === 0 ? (
        <p className="empty muted">{t("phoneBudget.noPrices")}</p>
      ) : (
        <>
          {toPay.length > 0 && (
            <>
              <h3 className="budget-heading">{t("phoneBudget.toPay")}</h3>
              <ul className="budget-list">
                {toPay.map((line) => (
                  <PriceRow key={`${line.item.id}${line.onSite ? "-site" : ""}`} line={line} currency={budget.currency} onTap={() => onDay(line.dayIndex!)} />
                ))}
              </ul>
            </>
          )}

          <h3 className="budget-heading">{t("budgetDialog.byDay")}</h3>
          <ul className="budget-list">
            {budget.byDay.map((amount, i) =>
              amount > 0 ? (
                <li key={trip.days[i].id}>
                  <button onClick={() => onDay(i)}>
                    <span className="grow">
                      {tripDayTitle(trip, i, lang)}
                    </span>
                    <span>{m(amount)}</span>
                  </button>
                </li>
              ) : null,
            )}
          </ul>

          <h3 className="budget-heading">{t("budgetDialog.byKind")}</h3>
          <ul className="budget-list">
            {byType.map(([type, amount]) => (
              <li key={type}>
                <div>
                  <span className="grow">
                    {ITEM_TYPE_ICON[type]} {t(`itemType.${type}`)}
                  </span>
                  <span>{m(amount)}</span>
                </div>
              </li>
            ))}
          </ul>

          {budget.lines.length > toPay.length && (
            <>
              <h3 className="budget-heading">{t("budgetDialog.paid")}</h3>
              <ul className="budget-list">
                {budget.lines
                  .filter((l) => l.paid)
                  .map((line) => (
                    <PriceRow key={`${line.item.id}${line.onSite ? "-site" : ""}`} line={line} currency={budget.currency} onTap={() => onDay(line.dayIndex!)} />
                  ))}
              </ul>
            </>
          )}
        </>
      )}

      <p className="muted small budget-note">
        {t("phoneBudget.note")}
        {budget.ratesDate && t("budgetDialog.ecb", { date: budget.ratesDate })}
      </p>
    </>
  );
}

function PriceRow({ line, currency, onTap }: { line: BudgetLine; currency: string; onTap: () => void }) {
  const t = useT();
  const { item, price, converted } = line;
  const foreign = price.currency && price.currency !== currency;
  return (
    <li>
      <button onClick={onTap}>
        <span className="grow">
          {itemIcon(item)} {item.title}
          <span className="muted small">
            {t("phoneBudget.day", { day: line.dayIndex! + 1 })}
            {line.onSite && ` · ${line.cash ? `💵 ${t("budgetDialog.onSiteCash")}` : t("budgetDialog.onSite")}`}
          </span>
        </span>
        <span className="budget-price">
          {price.currency ? formatMoney(price.amount, price.currency) : item.booking?.price}
          {foreign && (
            <span className="muted small">{converted === undefined ? t("phoneBudget.noRate2") : `≈ ${formatMoney(converted, currency)}`}</span>
          )}
        </span>
      </button>
    </li>
  );
}
