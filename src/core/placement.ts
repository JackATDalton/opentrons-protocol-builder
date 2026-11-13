/**
 * Where things go: tubes into rack positions, parts into plate wells.
 *
 * Any protocol that moves between tubes and a plate needs the same rules, so
 * they live here rather than in each generator:
 *
 * - a position the user set is honoured; two things on one position is an
 *   error, never resolved silently (the emitted script would overwrite one);
 * - anything unset takes the first free position, in a stated order;
 * - the result is a map by name, to be written into the protocol by name
 *   (invariant 3) rather than re-derived from two orderings.
 */
import { columnMajor, type PlateShape } from "./wells";

/** Four 24-tube racks hold a full 96-well plate's worth of tubes. */
export const MAX_TUBE_RACKS = 4;

/** Anything with a name and, optionally, a chosen rack position and/or well. */
export interface Placeable {
  name: string;
  rack?: number;
  tube?: string;
  well?: string;
}

/** "a01" -> "A1". */
export function cleanPosition(value: string): string {
  return value.trim().toUpperCase().replace(/^([A-Z]+)0+(\d)/, "$1$2");
}

/**
 * Where every tube sits, by name. Explicit positions are honoured and
 * clashes rejected; the rest fill the first free position, rack by rack, in
 * the order the tubes were listed.
 */
export function assignTubePositions(
  items: Placeable[],
  rackShape: PlateShape,
  maxRacks = MAX_TUBE_RACKS,
): Map<string, { rack: number; tube: string; set: boolean }> {
  const order = columnMajor(rackShape);
  const valid = new Set(order);
  const placed = new Map<string, { rack: number; tube: string; set: boolean }>();
  const taken = new Map<string, string>();

  for (const s of items) {
    if (s.rack == null && !s.tube) continue;
    if (s.rack == null || !s.tube) {
      throw new Error(`${s.name}: give both a rack and a tube position, or neither.`);
    }
    const tube = cleanPosition(s.tube);
    if (!valid.has(tube)) {
      throw new Error(`${s.name}: "${s.tube}" is not a position in a ${rackShape.rows.length}x${rackShape.columns.length} rack.`);
    }
    if (!Number.isInteger(s.rack) || s.rack < 1 || s.rack > maxRacks) {
      throw new Error(`${s.name}: rack ${s.rack} does not exist — use rack 1 to ${maxRacks}.`);
    }
    const key = `${s.rack}:${tube}`;
    const other = taken.get(key);
    if (other) {
      throw new Error(`Rack ${s.rack} ${tube} is claimed by both ${other} and ${s.name}. Each tube needs its own position.`);
    }
    taken.set(key, s.name);
    placed.set(s.name, { rack: s.rack, tube, set: true });
  }

  const free: { rack: number; tube: string }[] = [];
  for (let rack = 1; rack <= maxRacks; rack++) {
    for (const tube of order) if (!taken.has(`${rack}:${tube}`)) free.push({ rack, tube });
  }
  let cursor = 0;
  for (const s of items) {
    if (placed.has(s.name)) continue;
    const spot = free[cursor++];
    if (!spot) throw new Error(`No free rack position left for ${s.name}: ${maxRacks} racks are full.`);
    placed.set(s.name, { ...spot, set: false });
  }
  return placed;
}

/**
 * Which well every part fills, by name. Explicit wells are honoured and
 * clashes rejected; the rest take the next free well in plate order, handed
 * out in the order `inOrder` lists them.
 */
export function assignPlateWells(
  inOrder: Placeable[],
  destShape: PlateShape,
): Map<string, { well: string; set: boolean }> {
  const order = columnMajor(destShape);
  const valid = new Set(order);
  const wells = new Map<string, { well: string; set: boolean }>();
  const taken = new Map<string, string>();

  for (const s of inOrder) {
    if (!s.well) continue;
    const well = cleanPosition(s.well);
    if (!valid.has(well)) throw new Error(`${s.name}: "${s.well}" is not a well on the output plate.`);
    const other = taken.get(well);
    if (other) {
      throw new Error(`Plate well ${well} is assigned to both ${other} and ${s.name}. Each part needs its own well.`);
    }
    taken.set(well, s.name);
    wells.set(s.name, { well, set: true });
  }

  const free = order.filter((w) => !taken.has(w));
  let cursor = 0;
  for (const s of inOrder) {
    if (wells.has(s.name)) continue;
    const well = free[cursor++];
    if (!well) throw new Error(`No free plate well left for ${s.name}.`);
    wells.set(s.name, { well, set: false });
  }
  return wells;
}

/** Quote a CSV field only when it needs it. */
export function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** A plate drawn as a grid of names, as Python comment lines for a protocol header. */
export function plateMapComment(byWell: Map<string, string>, destShape: PlateShape): string {
  const width = Math.max(3, ...[...byWell.values()].map((n) => n.length));
  const pad = (t: string) => t.padEnd(width);
  const head = `#     ${destShape.columns.map((c) => pad(String(c))).join(" ")}`.trimEnd();
  const rows = destShape.rows.map(
    (r) => `#  ${r}  ${destShape.columns.map((c) => pad(byWell.get(`${r}${c}`) ?? ".")).join(" ")}`.trimEnd(),
  );
  return [head, ...rows].join("\n");
}
