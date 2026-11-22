import { useEffect, useMemo, useRef, useState } from "react";
import type { Item } from "@/lib/types";
import { itemIcon } from "@/lib/types";
import { useT } from "@/lib/useLang";
import { addAttachment, AttachmentError, removeAttachment, type Attachment } from "./attachments";

/**
 * One object URL per picture, made once and kept: a few vouchers per trip, so nothing worth freeing –
 * and revoking them on unmount broke pictures still on screen (React runs effects twice in development).
 */
const urlOf = new WeakMap<Blob, string>();
function useUrls(blobs: Blob[]): string[] {
  return useMemo(
    () =>
      blobs.map((b) => {
        let url = urlOf.get(b);
        if (!url) urlOf.set(b, (url = URL.createObjectURL(b)));
        return url;
      }),
    [blobs],
  );
}

/** Android back closes the sheet (or the picture) before leaving the trip. */
function useBack(onBack: () => void) {
  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      onBack();
    };
    window.addEventListener("app-back", handler);
    return () => window.removeEventListener("app-back", handler);
  }, [onBack]);
}

/** A card's vouchers, tickets and QR codes: add, open full screen, remove. Kept on this phone only. */
export function AttachmentSheet({
  tripId,
  item,
  attachments,
  onChanged,
  onClose,
}: {
  tripId: string;
  item: Item;
  attachments: Attachment[];
  onChanged: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [viewing, setViewing] = useState<Attachment>();
  useBack(viewing ? () => setViewing(undefined) : onClose);
  const firstPages = useMemo(() => attachments.map((a) => a.pages[0]), [attachments]);
  const thumbs = useUrls(firstPages);

  const add = async (files: File[]) => {
    setBusy(true);
    setError(undefined);
    try {
      for (const file of files) await addAttachment(tripId, item.id, file);
    } catch (err) {
      const reason = err instanceof AttachmentError ? err.reason : "unreadable";
      setError(t(`attachments.${reason}`));
    } finally {
      setBusy(false);
      onChanged();
    }
  };

  if (viewing) return <Viewer attachment={viewing} onClose={() => setViewing(undefined)} />;

  return (
    <div className="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <section className="sheet" role="dialog" aria-modal="true" aria-label={t("attachments.title", { title: item.title })}>
        <header className="sheet-head">
          <h2>
            📎 {itemIcon(item)} {item.title}
          </h2>
          <button className="icon-btn" aria-label={t("common.close")} onClick={onClose}>
            ✕
          </button>
        </header>
        {attachments.length === 0 && <p className="muted small">{t("attachments.empty")}</p>}
        <ul className="attachment-list">
          {attachments.map((a, i) => (
            <li key={a.id}>
              <button className="attachment" onClick={() => setViewing(a)}>
                <img src={thumbs[i]} alt="" />
                <span className="attachment-name">
                  {a.name}
                  {a.pages.length > 1 && <span className="muted small"> · {t("attachments.pages", { n: a.pages.length })}</span>}
                </span>
              </button>
              <button
                className="icon-btn danger"
                aria-label={t("attachments.remove", { name: a.name })}
                onClick={async () => {
                  if (!confirm(t("attachments.removeConfirm", { name: a.name }))) return;
                  await removeAttachment(a.id);
                  onChanged();
                }}
              >
                🗑
              </button>
            </li>
          ))}
        </ul>
        {error && <div className="issue warn">{error}</div>}
        <button className="btn primary wide" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? t("attachments.adding") : t("attachments.add")}
        </button>
        <p className="muted small">{t("attachments.privacy")}</p>
        {/* No `accept` filter beyond the kinds: cloud apps often hand over PDFs without a type. */}
        <input
          ref={input}
          type="file"
          accept="image/*,application/pdf,.pdf"
          multiple
          hidden
          onChange={(e) => {
            // Taken out of the input before it is cleared for the next pick.
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            if (files.length) void add(files);
          }}
        />
      </section>
    </div>
  );
}

/** One attachment full screen, its pages one under the other, on white so a QR code scans. */
function Viewer({ attachment, onClose }: { attachment: Attachment; onClose: () => void }) {
  const t = useT();
  const urls = useUrls(attachment.pages);
  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label={attachment.name}>
      <header className="viewer-head">
        <span className="grow">{attachment.name}</span>
        <button className="icon-btn" aria-label={t("common.close")} onClick={onClose}>
          ✕
        </button>
      </header>
      <div className="viewer-pages">
        {urls.map((u, i) => (
          <img key={i} src={u} alt={t("attachments.page", { n: i + 1 })} />
        ))}
      </div>
    </div>
  );
}
