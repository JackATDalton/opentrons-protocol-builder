/**
 * How downloaded protocols are named.
 *
 * Every protocol file name and every protocol title (the `protocolName` the
 * robot app shows) carries the date it was generated and the names of the
 * plate files it was generated from, so a .py found on a laptop months later
 * says which run and which plates it belongs to.
 */

/** Today as YYYY-MM-DD, in local time (the date on the bench, not UTC). */
export function todayStamp(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** An uploaded file's name without its extension: `plate 7.csv` → `plate 7`. */
export function uploadLabel(fileName: string): string {
  return fileName.trim().replace(/\.[^./\\]+$/, "");
}

/** Safe in a file name on every OS: letters, digits, `-` and `_` only. */
export function fileSlug(text: string): string {
  return text
    .trim()
    .replace(/[^A-Za-z0-9-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function present(sources: (string | undefined)[]): string[] {
  return sources.map((s) => s?.trim() ?? "").filter(Boolean);
}

/** `2026-11-17_plate_normalisation_30ngul_plate7` — no extension. */
export function protocolStem(base: string, sources: (string | undefined)[], date: string): string {
  return [date, base, ...present(sources)].map(fileSlug).filter(Boolean).join("_");
}

/** `Plate normalisation at 30 ng/uL — plate7 (2026-11-17)`. */
export function protocolTitle(base: string, sources: (string | undefined)[], date: string): string {
  const from = present(sources);
  return `${base}${from.length ? ` — ${from.join(", ")}` : ""} (${date})`;
}
