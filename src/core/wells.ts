/**
 * Well naming, plate geometry, and traversal order.
 *
 * All well ordering lives here on purpose. A real bug in the predecessor to
 * this project came from a source list sorted column-major being zipped
 * against a destination list in a *different* column-major stride — the two
 * agreed for the first column and silently diverged from the second onward,
 * mislabelling every downstream tube. Simulation passed cleanly.
 *
 * The rule: any time two sets of wells are paired positionally, both sides
 * must be produced by the same function from this module. Prefer matching by
 * well *name* over matching by index wherever the labware shapes allow it.
 */

import { geometryFor, type PlateShape } from "./labware";

// Shapes live with the rest of the labware data; re-exported so existing
// imports keep working.
export { SHAPE_6, SHAPE_24, SHAPE_96, type PlateShape } from "./labware";

/** Well-grid shape per Opentrons loadName, from the labware registry. */
export function shapeFor(loadName: string): PlateShape {
  return geometryFor(loadName).shape;
}

export function wellCount(shape: PlateShape): number {
  return shape.rows.length * shape.columns.length;
}

export function parseWell(well: string): { row: string; column: number } {
  const match = /^([A-Z]+)(\d+)$/.exec(well.trim().toUpperCase());
  if (!match) throw new Error(`"${well}" is not a valid well name (expected e.g. "A1").`);
  return { row: match[1], column: Number(match[2]) };
}

/**
 * Reading order: left-to-right along each row, then down.
 * A1, A2, A3 ... B1, B2, B3 ...
 */
export function rowMajor(shape: PlateShape): string[] {
  const wells: string[] = [];
  for (const row of shape.rows) for (const col of shape.columns) wells.push(`${row}${col}`);
  return wells;
}

/**
 * Column order: down each column, then across. This is the order Opentrons'
 * own `labware.wells()` returns, so use it when interoperating with that API.
 * A1, B1, C1 ... A2, B2, C2 ...
 */
export function columnMajor(shape: PlateShape): string[] {
  const wells: string[] = [];
  for (const col of shape.columns) for (const row of shape.rows) wells.push(`${row}${col}`);
  return wells;
}

/** Sort a well selection into reading order. */
export function sortRowMajor(wells: Iterable<string>): string[] {
  return [...new Set(wells)].sort((a, b) => {
    const pa = parseWell(a);
    const pb = parseWell(b);
    return pa.row === pb.row ? pa.column - pb.column : pa.row.localeCompare(pb.row);
  });
}

/** Sort a well selection into column order. */
export function sortColumnMajor(wells: Iterable<string>): string[] {
  return [...new Set(wells)].sort((a, b) => {
    const pa = parseWell(a);
    const pb = parseWell(b);
    return pa.column === pb.column ? pa.row.localeCompare(pb.row) : pa.column - pb.column;
  });
}

/** Group wells by plate column, each group in row order. */
export function byColumn(wells: Iterable<string>): Map<number, string[]> {
  const grouped = new Map<number, string[]>();
  for (const well of sortRowMajor(wells)) {
    const { column } = parseWell(well);
    const existing = grouped.get(column);
    if (existing) existing.push(well);
    else grouped.set(column, [well]);
  }
  return new Map([...grouped.entries()].sort((a, b) => a[0] - b[0]));
}

/** Split a list into fixed-size chunks — used for bulk-aspirate batching. */
export function chunk<T>(items: T[], size: number): T[][] {
  if (size < 1) throw new Error("Chunk size must be at least 1.");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** How many wells one pipette load covers at a given per-well volume. */
export function batchSize(pipetteCapacityUl: number, perWellUl: number): number {
  if (perWellUl <= 0) throw new Error("Per-well volume must be greater than zero.");
  return Math.max(1, Math.floor(pipetteCapacityUl / perWellUl));
}

/** Validate that every selected well exists on the given labware. */
export function assertWellsExist(wells: Iterable<string>, shape: PlateShape, labwareLabel: string): void {
  const valid = new Set(rowMajor(shape));
  const bad = [...wells].filter((w) => !valid.has(w.trim().toUpperCase()));
  if (bad.length) {
    throw new Error(
      `${labwareLabel} has no well(s) ${bad.join(", ")}. ` +
        `Valid range is ${shape.rows[0]}1–${shape.rows[shape.rows.length - 1]}${shape.columns[shape.columns.length - 1]}.`,
    );
  }
}
