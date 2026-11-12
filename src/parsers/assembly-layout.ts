/**
 * Assembly layout parsing and part-stock checking for combinatorial assembly.
 *
 * A layout CSV has reserved columns (Plate, Well, Combination_ID) and then one
 * column per part type — Promoter, UTR, CDS, Terminator, Vector, or whatever
 * else a given design uses. Part-type columns are discovered from the header
 * rather than hardcoded, so new designs work without code changes.
 */
import { parseWell } from "../core/wells";
import { parseCsv } from "./plate-csv";
import type { PlateMap } from "./plate-csv";

const RESERVED_COLUMNS = new Set(["plate", "well", "combination_id"]);

export interface LayoutRow {
  well: string;
  combinationId: string;
  /** Part-type column name → part name for this well. */
  parts: Record<string, string>;
}

export interface AssemblyLayout {
  /** Part-type columns, in the order they appear in the header. */
  partColumns: string[];
  rows: LayoutRow[];
}

export function parseAssemblyLayout(text: string): AssemblyLayout {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error("Layout CSV appears to be empty.");

  const header = rows[0];
  const lower = header.map((h) => h.trim().toLowerCase());
  const wellIdx = lower.indexOf("well");
  if (wellIdx === -1) {
    throw new Error(`Layout CSV needs a "Well" column. Found: ${header.join(", ")}`);
  }
  const comboIdx = lower.indexOf("combination_id");
  const partColumns = header.filter((h) => !RESERVED_COLUMNS.has(h.trim().toLowerCase()));
  if (!partColumns.length) {
    throw new Error(
      "Layout CSV has no part-type columns. Expected at least one column beyond Plate/Well/Combination_ID.",
    );
  }

  const out: LayoutRow[] = [];
  for (const row of rows.slice(1)) {
    const well = (row[wellIdx] ?? "").trim().toUpperCase();
    if (!well) continue;
    parseWell(well);

    const parts: Record<string, string> = {};
    for (const col of partColumns) {
      const idx = header.indexOf(col);
      parts[col] = (row[idx] ?? "").trim();
    }
    out.push({ well, combinationId: comboIdx === -1 ? "" : (row[comboIdx] ?? "").trim(), parts });
  }

  if (!out.length) throw new Error("Layout CSV has a header but no data rows.");
  return { partColumns, rows: out };
}

/**
 * Normalise a part name for matching: strip any descriptive suffix after a
 * colon and lowercase. "P8d: PLacI" and "p8d" refer to the same part.
 */
export function basePartName(name: string): string {
  return name.split(":")[0].trim().toLowerCase();
}

/** Build a lookup from normalised part name → well on the repository plate. */
export function buildPartIndex(repoPlate: PlateMap): Record<string, string> {
  const index: Record<string, string> = {};
  for (const [well, data] of Object.entries(repoPlate)) {
    if (data.name) index[basePartName(data.name)] = well;
  }
  return index;
}

export type PartStatus = "ok" | "short" | "missing_from_repo" | "no_volume_data";

export interface PartCheckRow {
  part: string;
  wellsNeeded: number;
  requiredUl: number;
  availableUl: number | null;
  repoWell: string | null;
  status: PartStatus;
}

export interface PartCheckOptions {
  layouts: AssemblyLayout[];
  repoPlate: PlateMap;
  volumes?: Record<string, { volumeUl: number | null }>;
  transferVolumeUl?: number;
  prewetVolumeUl?: number;
  /** Part-type columns pre-mixed into the master mix, so never pipetted. */
  masterMixParts?: string[];
}

/**
 * Check whether the repository plate holds enough of each part.
 *
 * Requirements are aggregated across *all* supplied layouts, because plates
 * run in one batch draw from the same physical tubes. Checking each plate
 * alone understates demand and can pass a batch that runs dry midway.
 */
export function checkPartVolumes(options: PartCheckOptions): PartCheckRow[] {
  const {
    layouts,
    repoPlate,
    volumes,
    transferVolumeUl = 1,
    prewetVolumeUl = 5,
    masterMixParts = [],
  } = options;

  const skip = new Set(masterMixParts);
  const wellsNeeded = new Map<string, number>();

  for (const layout of layouts) {
    for (const row of layout.rows) {
      for (const [column, part] of Object.entries(row.parts)) {
        if (!part || skip.has(column)) continue;
        wellsNeeded.set(part, (wellsNeeded.get(part) ?? 0) + 1);
      }
    }
  }

  const partIndex = buildPartIndex(repoPlate);
  const volumeIndex = new Map<string, number | null>();
  for (const [name, entry] of Object.entries(volumes ?? {})) {
    volumeIndex.set(basePartName(name), entry.volumeUl);
  }

  return [...wellsNeeded.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([part, count]) => {
      const requiredUl = count * transferVolumeUl + prewetVolumeUl;
      const repoWell = partIndex[basePartName(part)] ?? null;

      if (!repoWell) {
        return { part, wellsNeeded: count, requiredUl, availableUl: null, repoWell: null, status: "missing_from_repo" as const };
      }

      const availableUl = volumes ? (volumeIndex.get(basePartName(part)) ?? null) : null;
      const status: PartStatus =
        availableUl === null ? "no_volume_data" : availableUl < requiredUl ? "short" : "ok";

      return { part, wellsNeeded: count, requiredUl, availableUl, repoWell, status };
    });
}
