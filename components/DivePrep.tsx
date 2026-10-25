import { DIVE_PREP_ICON, DIVE_PREP_LABEL, divePrepUrl, type DivePrep } from "@/lib/types";

/** "✅ Prepared" / "⚠️ Check prep" on a dive card, opening the preparation in AI Diving Monitor. */
export function DivePrepBadge({ prep }: { prep: DivePrep }) {
  const url = divePrepUrl(prep);
  const label = (
    <>
      {DIVE_PREP_ICON[prep.status]} {DIVE_PREP_LABEL[prep.status]}
    </>
  );
  const className = `badge prep-${prep.status}`;
  return url ? (
    <a
      className={className}
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={`${prep.summary}\nOpen the preparation in AI Diving Monitor`}
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
