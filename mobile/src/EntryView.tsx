import { entryActions, entryState, flag, hostOf } from "@/lib/entry";
import { dayDate, formatDayLabel } from "@/lib/time";
import type { EntryCheck, EntryLevel, Trip } from "@/lib/types";
import { useLang, useT } from "@/lib/useLang";

const LEVEL_ICON: Record<EntryLevel, string> = { ok: "✅", action: "📝", warn: "⚠️", info: "ℹ️" };

/** Visas, passport rules and arrival forms as checked on the desktop (Claude via MCP); read-only here. */
export function EntryView({ trip, entry }: { trip: Trip; entry?: EntryCheck }) {
  const t = useT();
  const lang = useLang();
  const day = (iso: string) => formatDayLabel(dayDate(iso, 0), lang);
  if (!entry) {
    return (
      <>
        <div className="day-head">
          <h2>{t("phone.entry")}</h2>
        </div>
        <p className="empty muted">{t("phoneEntry.notChecked", { name: trip.name })}</p>
      </>
    );
  }
  const state = entryState(trip, lang);
  const todo = entryActions(trip);

  return (
    <>
      <div className="day-head">
        <h2>{t("phone.entry")}</h2>
        <span className="muted small">
          {t("phoneEntry.checked", { flags: entry.passports.map(flag).join(" "), date: day(entry.checkedAt.slice(0, 10)) })}
        </span>
      </div>

      {state.kind === "stale" && (
        <div className="issue warn">{t("phoneEntry.stale", { reasons: state.reasons.join(t("entry.and")) })}</div>
      )}

      {todo.length > 0 && (
        <>
          <h3 className="budget-heading">{t("phoneEntry.todo")}</h3>
          <ul className="budget-list">
            {todo.map(({ country, requirement: r }) => (
              <li key={`${country.code}-${r.title}`}>
                <div>
                  <span className="grow">
                    {flag(country.code)} {r.title}
                  </span>
                  {r.dueBy && <span className="warn-text small entry-due">{t("phoneEntry.by", { date: day(r.dueBy) })}</span>}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {entry.countries.map((c) => (
        <section key={c.code}>
          <h3 className="budget-heading">
            {flag(c.code)} {c.name}
            {c.transit ? t("phoneEntry.transit") : ""}
            {c.from ? ` · ${day(c.from)}${c.to && c.to !== c.from ? ` – ${day(c.to)}` : ""}` : ""}
          </h3>
          <ul className="budget-list entry-list">
            <li>
              <div>
                <span className="grow">{c.summary}</span>
              </div>
            </li>
            {c.requirements.map((r, i) => (
              <li key={i} className={r.done ? "done" : undefined}>
                <div>
                  <span aria-hidden>{r.done ? "☑️" : LEVEL_ICON[r.level]}</span>
                  <span className="grow">
                    <span>
                      <strong>{r.title}</strong>
                      <span className="muted small"> · {t(`entryKind.${r.kind}`)}</span>
                      {r.dueBy && !r.done && <span className="warn-text small">{t("phoneEntry.byDot", { date: day(r.dueBy) })}</span>}
                    </span>
                    {r.details && <span className="small">{r.details}</span>}
                    {r.url && (
                      <a className="small" href={r.url} target="_blank" rel="noreferrer">
                        {hostOf(r.url)} ↗
                      </a>
                    )}
                  </span>
                </div>
              </li>
            ))}
          </ul>
          {c.sources.length > 0 && (
            <p className="muted small entry-sources">
              {t("entry.sources")}{" "}
              {c.sources.map((s, i) => (
                <span key={s.url}>
                  {i > 0 && " · "}
                  <a href={s.url} target="_blank" rel="noreferrer">
                    {hostOf(s.url)}
                  </a>
                </span>
              ))}
            </p>
          )}
        </section>
      ))}

      <p className="muted small budget-note">
        {t("phoneEntry.note")}
      </p>
    </>
  );
}
