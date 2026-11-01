import { DIVE_PREP_ICON, divePrepUrl, type DivePrep } from "@/lib/types";
import { useT } from "@/lib/useLang";

/** "✅ Prepared" / "⚠️ Check prep" on a dive card, opening the preparation in DiveDeck. */
export function DivePrepBadge({ prep }: { prep: DivePrep }) {
  const t = useT();
  const url = divePrepUrl(prep);
  const label = (
    <>
      {DIVE_PREP_ICON[prep.status]} {t(`divePrep.${prep.status}`)}
    </>
  );
  const className = `badge prep-${prep.status}`;
  return url ? (
    <a
      className={className}
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={`${prep.summary}\n${t("divePrepBadge.open")}`}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {label}
    </a>
  ) : (
    <span className={className} title={prep.summary}>
      {label}
    </span>
  );
}
