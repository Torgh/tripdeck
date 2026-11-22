/** Saves a file from the page: a backup, a calendar or a read-only copy of the trip. */
export function download(blob: Blob, fileName: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  // Some browsers start the download only after the click returns.
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** "Thailand 2027" → "thailand-2027", for file names. */
export function fileBase(name: string): string {
  return name.replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-+|-+$/g, "").toLowerCase() || "trip";
}
