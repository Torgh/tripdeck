import { createContext, useCallback, useContext, useEffect, useState } from "react";

/**
 * Vouchers, tickets, boarding passes and QR codes kept with a card, on this phone only: they are in
 * the app's own storage (IndexedDB), work offline and never leave the phone – not even in an export.
 * A PDF is turned into one picture per page when it is added, so it opens without a PDF viewer.
 */
export interface Attachment {
  id: string;
  tripId: string;
  itemId: string;
  name: string;
  addedAt: string;
  /** The pictures to show: the image itself, or the PDF's pages. */
  pages: Blob[];
}

/** A PDF with more pages than this keeps only the first ones (vouchers are one or two). */
export const MAX_PDF_PAGES = 8;
/** Bigger files are refused – a photo of a ticket is a few MB at most. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

const DB = "tripdeck-attachments";
const STORE = "attachments";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore(STORE, { keyPath: "id" });
      store.createIndex("trip", "tripId");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export function tripAttachments(tripId: string): Promise<Attachment[]> {
  return run("readonly", (s) => s.index("trip").getAll(tripId) as IDBRequest<Attachment[]>);
}

export function removeAttachment(id: string): Promise<undefined> {
  return run("readwrite", (s) => s.delete(id) as IDBRequest<undefined>);
}

/** Everything kept for a trip that was removed from the phone. */
export async function removeTripAttachments(tripId: string): Promise<void> {
  for (const a of await tripAttachments(tripId)) await removeAttachment(a.id);
}

/** Whether a file is a PDF, by its type or – cloud apps often send none – its name. */
export function isPdf(file: { type: string; name: string }): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

/** Renders a PDF's pages to PNG pictures, sharp enough for a QR code or a barcode. */
async function pdfPages(file: Blob): Promise<Blob[]> {
  // Built by Vite as a plain .js worker: the phone's WebView may not serve .mjs files as scripts.
  const [pdfjs, { default: PdfWorker }] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?worker"),
  ]);
  pdfjs.GlobalWorkerOptions.workerPort ??= new PdfWorker();
  // pdf.js 6.2.108+ only: older versions could run code from a crafted PDF (CVE-2026-16633).
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  try {
    const pages: Blob[] = [];
    for (let n = 1; n <= Math.min(doc.numPages, MAX_PDF_PAGES); n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: 2.5 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext("2d")!;
      // White under the page: transparent PDFs would show the dark theme through.
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      pages.push(await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("render"))), "image/png")));
    }
    return pages;
  } finally {
    void task.destroy();
  }
}

export class AttachmentError extends Error {
  constructor(readonly reason: "tooBig" | "notSupported" | "unreadable") {
    super(reason);
  }
}

/** Keeps a picture or PDF with a card. */
export async function addAttachment(tripId: string, itemId: string, file: File): Promise<Attachment> {
  if (file.size > MAX_FILE_BYTES) throw new AttachmentError("tooBig");
  let pages: Blob[];
  if (isPdf(file)) {
    try {
      pages = await pdfPages(file);
    } catch (err) {
      console.warn("Could not read the PDF:", err);
      throw new AttachmentError("unreadable");
    }
  } else if (file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|heic)$/i.test(file.name)) {
    pages = [file];
  } else {
    throw new AttachmentError("notSupported");
  }
  const attachment: Attachment = {
    id: crypto.randomUUID(),
    tripId,
    itemId,
    name: file.name,
    addedAt: new Date().toISOString(),
    pages,
  };
  await run("readwrite", (s) => s.put(attachment));
  return attachment;
}

/** For the cards: how many attachments each has, and opening a card's sheet. */
export const AttachContext = createContext<{ count: (itemId: string) => number; open: (itemId: string) => void } | null>(null);

export function useAttach() {
  return useContext(AttachContext);
}

/** The trip's attachments by card, re-read after a change (`reload`). */
export function useAttachments(tripId: string) {
  const [byItem, setByItem] = useState<Map<string, Attachment[]>>(new Map());
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    tripAttachments(tripId)
      .then((all) => {
        const map = new Map<string, Attachment[]>();
        for (const a of all.sort((x, y) => x.addedAt.localeCompare(y.addedAt))) map.set(a.itemId, [...(map.get(a.itemId) ?? []), a]);
        if (live) setByItem(map);
      })
      .catch((err) => console.warn("Could not read the attachments:", err));
    return () => {
      live = false;
    };
  }, [tripId, version]);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { byItem, reload };
}
