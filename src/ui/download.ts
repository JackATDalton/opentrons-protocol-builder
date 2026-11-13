/**
 * Saving files from the browser. Every download in the app goes through here.
 */
import { makeZip, type ZipEntry } from "./zip";

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadText(content: string, filename: string, type = "text/plain"): void {
  downloadBlob(new Blob([content], { type }), filename);
}

/** Several text files as one stored zip — e.g. a protocol and its layout CSVs. */
export function downloadZip(entries: ZipEntry[], filename: string): void {
  downloadBlob(new Blob([makeZip(entries) as BlobPart], { type: "application/zip" }), filename);
}
