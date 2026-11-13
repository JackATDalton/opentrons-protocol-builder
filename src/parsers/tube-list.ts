/**
 * Parsers for the tube-normalisation inputs: the tube list, and an optional
 * desired output-plate layout.
 *
 * Both report what they could not read, line by line, rather than guessing —
 * a tube read into the wrong position is pipetted into the wrong well, and
 * nothing at run time can notice.
 */
import type { TubeSample } from "../generators/tube-normalisation";
import { parseCsv } from "./plate-csv";

const MASTER_MIX = /^(mastermix|master mix|master_mix|mm|true|yes|y|1|premix)$/i;
// The 4x6 jd_24_tuberack_1.5ml, the only tube rack this tool loads.
const RACK_POSITION = /^([A-D])0*([1-6])$/;
const PLATE_WELL = /^([A-P])0*(\d{1,2})$/;

/* -------------------------------------------------------------- tube list */

// Matched loosely, most specific first, as the lab's sheets name them several
// ways ("Part", "Conc1 (ng/uL)", "Vol").
const NAME_KEYS = ["name", "part", "sample", "id", "label"];
const CONC_KEYS = ["concentration", "conc", "ng/ul", "ng_ul", "ngul"];
const VOL_KEYS = ["volume_ul", "volume", "vol"];
const RACK_KEYS = ["rack"];
// The destination well, matched before the tube column so "plate_well" is not
// read as the rack position.
const DEST_KEYS = ["plate_well", "dest_well", "destination_well", "output_well", "plate well", "destination"];
const TUBE_KEYS = ["tube", "position", "pos", "well", "location", "slot"];
const MM_KEYS = ["mastermix", "master_mix", "master mix", "mm", "premix"];
// "Conc1 (ng/uL)" contains "ul", so concentration and volume must exclude each
// other or the two columns swap.
const CONC_EXCLUDE = ["target", "achieved", "vol"];
const VOL_EXCLUDE = ["conc", "ng", "final", "dead", "transfer", "target", "achieved", "part_ul", "water"];

function pick(header: string[], keys: string[], exclude: string[] = [], skip: number[] = []): number {
  const lower = header.map((h) => h.toLowerCase().trim());
  const ok = (i: number) => !skip.includes(i) && !exclude.some((x) => lower[i].includes(x));
  for (const key of keys) {
    const i = lower.indexOf(key);
    if (i >= 0 && ok(i)) return i;
  }
  for (const key of keys) {
    const i = lower.findIndex((h, j) => h.includes(key) && ok(j));
    if (i >= 0) return i;
  }
  return -1;
}

function leadingNumber(value: string | undefined): number {
  const m = /^[-+]?\d*\.?\d+/.exec((value ?? "").trim().replace(/,/g, ""));
  return m ? Number(m[0]) : NaN;
}

function looksLikeHeader(cells: string[]): boolean {
  return pick(cells, NAME_KEYS) >= 0 && !Number.isFinite(leadingNumber(cells[1]));
}

/**
 * One tube per line. Two shapes:
 *
 * - positional, `name, ng/uL, uL[, mastermix]`, as typed into the box;
 * - a headed CSV whose columns are matched by name. It may also carry `rack`,
 *   `tube` and `plate_well`, and then it is the loading map and the plate
 *   layout too.
 *
 * Blank lines and `#` comments are skipped.
 */
export function parseSamples(text: string): { samples: TubeSample[]; errors: string[] } {
  const lines = text
    .split(/\r?\n/)
    .map((raw, i) => ({ raw: raw.trim(), lineNo: i + 1 }))
    .filter((l) => l.raw && !l.raw.startsWith("#"));
  const rows = lines.map((l) => ({ ...l, cells: (parseCsv(l.raw.replace(/\t/g, ","))[0] ?? []).map((c) => c.trim()) }));

  const samples: TubeSample[] = [];
  const errors: string[] = [];
  if (!rows.length) return { samples, errors };

  const headed = looksLikeHeader(rows[0].cells);
  const header = headed ? rows[0].cells : [];
  const col = headed
    ? (() => {
        const dest = pick(header, DEST_KEYS);
        return {
          name: pick(header, NAME_KEYS),
          conc: pick(header, CONC_KEYS, CONC_EXCLUDE),
          vol: pick(header, VOL_KEYS, VOL_EXCLUDE),
          rack: pick(header, RACK_KEYS),
          dest,
          tube: pick(header, TUBE_KEYS, [], dest >= 0 ? [dest] : []),
          mm: pick(header, MM_KEYS),
        };
      })()
    : { name: 0, conc: 1, vol: 2, rack: -1, dest: -1, tube: -1, mm: 3 };

  if (headed && (col.conc < 0 || col.vol < 0)) {
    errors.push(
      `Line ${rows[0].lineNo}: the header needs a concentration and a volume column — found "${header.join(", ")}".`,
    );
    return { samples, errors };
  }

  for (const { raw, lineNo, cells } of headed ? rows.slice(1) : rows) {
    const at = (i: number) => (i >= 0 ? (cells[i] ?? "").trim() : "");
    if (!headed && cells.length < 3) {
      errors.push(`Line ${lineNo}: expected "part, ng/uL, uL" — got "${raw}".`);
      continue;
    }
    const name = at(col.name);
    const concentration = leadingNumber(at(col.conc));
    const volumeUl = leadingNumber(at(col.vol));
    const masterMix = MASTER_MIX.test(at(col.mm));
    const problems: string[] = [];

    if (!name) {
      if (headed && cells.every((c) => !c)) continue;
      problems.push("no part name");
    }
    if (!Number.isFinite(concentration) || concentration <= 0) problems.push(`"${at(col.conc)}" is not a concentration`);
    if (!Number.isFinite(volumeUl) || volumeUl <= 0) problems.push(`"${at(col.vol)}" is not a volume`);

    const sample: TubeSample = { name, concentration, volumeUl, masterMix };

    if (!masterMix) {
      const tubeText = at(col.tube).toUpperCase();
      const rackText = at(col.rack);
      if (tubeText) {
        const m = RACK_POSITION.exec(tubeText);
        if (!m) problems.push(`"${at(col.tube)}" is not a position in a 4x6 rack (A1-D6)`);
        else sample.tube = `${m[1]}${Number(m[2])}`;
        const rack = rackText ? Number(rackText) : 1;
        if (!Number.isInteger(rack) || rack < 1) problems.push(`"${rackText}" is not a rack number`);
        else sample.rack = rack;
      } else if (rackText) {
        problems.push(`rack ${rackText} is given with no tube position`);
      }
      const wellText = at(col.dest).toUpperCase();
      if (wellText) {
        const m = PLATE_WELL.exec(wellText);
        if (!m) problems.push(`"${at(col.dest)}" is not a plate well`);
        else sample.well = `${m[1]}${Number(m[2])}`;
      }
    }

    if (problems.length) {
      errors.push(`Line ${lineNo}${name ? ` (${name})` : ""}: ${problems.join(", ")}.`);
      continue;
    }
    samples.push(sample);
  }

  const names = samples.map((s) => s.name);
  const dupes = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))];
  if (dupes.length) errors.push(`Duplicate tube name(s): ${dupes.join(", ")}.`);

  return { samples, errors };
}

/* ---------------------------------------------------- desired plate layout */

export interface PlateLayout {
  /** Part name -> well. */
  wells: Record<string, string>;
  errors: string[];
}

/**
 * A desired output-plate layout. Accepted shapes:
 *
 * - a grid: a header row of column numbers, then one row per plate row
 *   (`A, P1d, P2d, ...`), blanks for empty wells;
 * - a headed list with a well column and a name column — including the layout
 *   CSV this tool downloads, so a previous run's plate can be reused;
 * - headerless `well, name` pairs, as in a briefly.bio export (rows whose value
 *   is a number are concentrations and are ignored).
 */
export function parsePlateLayout(text: string): PlateLayout {
  const rows = parseCsv(text.replace(/\t/g, ",")).filter((r) => !r[0]?.startsWith("#"));
  const wells: Record<string, string> = {};
  const errors: string[] = [];
  const byWell = new Map<string, string>();

  const add = (wellText: string, name: string, where: string) => {
    name = name.trim();
    if (!name) return;
    const m = PLATE_WELL.exec(wellText.trim().toUpperCase());
    if (!m) {
      errors.push(`${where}: "${wellText}" is not a plate well.`);
      return;
    }
    const well = `${m[1]}${Number(m[2])}`;
    if (wells[name] && wells[name] !== well) {
      errors.push(`${where}: ${name} is in both ${wells[name]} and ${well}. Each part fills one well.`);
      return;
    }
    const other = byWell.get(well);
    if (other && other !== name) {
      errors.push(`${where}: well ${well} holds both ${other} and ${name}.`);
      return;
    }
    wells[name] = well;
    byWell.set(well, name);
  };

  if (!rows.length) return { wells, errors };
  const first = rows[0];

  // Grid: the first row is column numbers.
  const numbered = first.slice(1).filter(Boolean);
  if (numbered.length > 1 && numbered.every((c) => /^\d+$/.test(c))) {
    const columns = first.slice(1).map((c) => c.trim());
    for (const row of rows.slice(1)) {
      const letter = row[0]?.trim().toUpperCase();
      if (!letter) continue;
      row.slice(1).forEach((name, i) => {
        if (columns[i]) add(`${letter}${columns[i]}`, name, `Row ${letter}, column ${columns[i]}`);
      });
    }
    return { wells, errors };
  }

  const lower = first.map((c) => c.toLowerCase());
  const wellCol = lower.findIndex((c) => c === "well" || c === "plate_well" || c === "destination");
  if (wellCol >= 0) {
    const nameCol = pick(first, NAME_KEYS.concat("value"), [], [wellCol]);
    if (nameCol < 0) {
      errors.push(`The header has a well column but no name column — found "${first.join(", ")}".`);
      return { wells, errors };
    }
    rows.slice(1).forEach((row, i) => {
      const wellText = row[wellCol] ?? "";
      const name = row[nameCol] ?? "";
      if (!wellText.trim()) return; // master-mix rows in our own export
      if (Number.isFinite(Number(name)) && name.trim()) return;
      add(wellText, name, `Line ${i + 2}`);
    });
    return { wells, errors };
  }

  rows.forEach((row, i) => {
    const [wellText = "", name = ""] = row;
    if (Number.isFinite(Number(name)) || !name.trim()) return;
    add(wellText, name, `Line ${i + 1}`);
  });
  if (!Object.keys(wells).length && !errors.length) {
    errors.push("No wells found. Expected a plate grid, or rows of well and part name.");
  }
  return { wells, errors };
}
