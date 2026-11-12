/**
 * Parsers for the CSV formats this tool consumes.
 *
 * These are deliberately forgiving about layout but strict about reporting
 * what they could not understand — a silently mis-parsed plate map produces a
 * protocol that pipettes the wrong sample into the wrong well, which is far
 * worse than a rejected file.
 */
import { parseWell } from "../core/wells";

export interface PlateWell {
  name: string | null;
  concentration: number | null;
}

export type PlateMap = Record<string, PlateWell>;

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else quoted = false;
      } else current += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      cells.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells.map((c) => c.trim());
}

export function parseCsv(text: string): string[][] {
  return text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map(splitCsvLine);
}

/**
 * Parse a briefly.bio-style plate export.
 *
 * The format is two stacked blocks under a single header: well→name rows
 * first, then well→concentration rows, with no second header. A row is
 * classified by whether its value parses as a number, so the two blocks don't
 * need to be separated explicitly. Wells absent from the file are empty.
 *
 * Repeated entries for the same well and the same field are allowed — the
 * last one wins — which lets a file define names and concentrations for a
 * well in either order.
 */
export function parsePlateCsv(text: string): PlateMap {
  const rows = parseCsv(text);
  if (rows.length < 2) {
    throw new Error("Plate CSV appears to be empty — expected a header row followed by well data.");
  }

  const plate: PlateMap = {};
  const malformed: string[] = [];

  for (const row of rows.slice(1)) {
    if (row.length < 2) continue;
    const [rawWell, rawValue] = row;
    if (!rawWell || !rawValue) continue;

    const well = rawWell.toUpperCase();
    try {
      parseWell(well);
    } catch {
      malformed.push(rawWell);
      continue;
    }

    plate[well] ??= { name: null, concentration: null };
    const numeric = Number(rawValue);
    if (rawValue !== "" && Number.isFinite(numeric)) {
      plate[well].concentration = numeric;
    } else {
      plate[well].name = rawValue;
    }
  }

  if (!Object.keys(plate).length) {
    throw new Error(
      "No usable wells found in the plate CSV. Expected rows of 'Well,Value' — " +
        "for example 'A1,MySample' and 'A1,89.5'.",
    );
  }
  if (malformed.length) {
    throw new Error(
      `Could not read well name(s): ${[...new Set(malformed)].slice(0, 5).join(", ")}. ` +
        `Expected names like "A1" or "H12".`,
    );
  }

  return plate;
}

/** Wells that have a concentration — i.e. wells actually holding sample. */
export function occupiedWells(plate: PlateMap): string[] {
  return Object.keys(plate).filter((w) => plate[w].concentration !== null);
}

export interface VolumeEntry {
  concentration: number | null;
  volumeUl: number | null;
}

/**
 * Parse a run-summary CSV (the format this tool emits) back in, so a previous
 * run's output can drive the next run.
 *
 * Columns are matched by name rather than position, since the summary format
 * has gained columns over time.
 */
export function parseVolumesCsv(text: string): Record<string, VolumeEntry> {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error("Volumes CSV appears to be empty.");

  const header = rows[0].map((h) => h.toLowerCase());
  const nameIdx = header.findIndex((h) => h === "name");
  if (nameIdx === -1) {
    throw new Error(`Volumes CSV needs a "name" column. Found: ${rows[0].join(", ")}`);
  }
  const volIdx = header.findIndex((h) => h.includes("volume"));
  const concIdx = header.findIndex((h) => h.includes("conc") && !h.includes("target"));

  const out: Record<string, VolumeEntry> = {};
  for (const row of rows.slice(1)) {
    const name = row[nameIdx];
    if (!name) continue;
    const num = (i: number): number | null => {
      if (i === -1 || i >= row.length) return null;
      const v = Number(row[i]);
      return row[i] !== "" && Number.isFinite(v) ? v : null;
    };
    out[name] = { concentration: num(concIdx), volumeUl: num(volIdx) };
  }
  return out;
}
