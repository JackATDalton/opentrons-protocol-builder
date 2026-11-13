/**
 * Every piece of labware this repo knows, in one place.
 *
 * Before this file there were two registries — well shapes in `wells.ts` and
 * drawing geometry in `steps.ts` — each with its own copy of the
 * `jd_24_tuberack_1.5ml` alias and its own idea of which labware existed. A
 * plate added to one and not the other drew as a 96-well PCR plate in the
 * simulator. Add labware here and the generators, the well maps and the
 * simulator all pick it up.
 *
 * Geometry is copied from the labware definitions: Opentrons' published ones
 * (opentrons_shared_data, labware schema 2) and ours in `labware/definitions/`.
 * `origin` is A1's centre measured from the labware's back-left corner, y
 * counting toward the front (row H), which is how the UI draws it.
 */

/** Row letters and column numbers of a well grid. */
export interface PlateShape {
  rows: string[];
  columns: number[];
}

const columns = (n: number): number[] => Array.from({ length: n }, (_, i) => i + 1);

export const SHAPE_96: PlateShape = { rows: ["A", "B", "C", "D", "E", "F", "G", "H"], columns: columns(12) };
export const SHAPE_24: PlateShape = { rows: ["A", "B", "C", "D"], columns: columns(6) };
export const SHAPE_6: PlateShape = { rows: ["A", "B"], columns: columns(3) };

export interface Point {
  x: number;
  y: number;
}

export type LabwareClass = "plate" | "tuberack" | "tips" | "reservoir";

export interface LabwareGeometry {
  loadName: string;
  /** Short name for the UI, e.g. "PCR plate". */
  label: string;
  kind: LabwareClass;
  shape: PlateShape;
  /** Centre of the A1 well. */
  origin: Point;
  /** Centre-to-centre spacing. `y` counts downward from A toward H. */
  spacing: Point;
  /** Footprint, for drawing the labware outline. */
  size: Point;
  /** Well or tube diameter (side length for square wells), mm. */
  wellDiameter: number;
}

/* ------------------------------------------------------------- load names */

/** Load names used by the generators. Import these; don't retype the strings. */
export const LABWARE = {
  pcrPlate: "opentrons_96_wellplate_200ul_pcr_full_skirt",
  corningFlat96: "corning_96_wellplate_360ul_flat",
  nestFlat96: "nest_96_wellplate_200ul_flat",
  nestDeep24: "nest_24_wellplate_10.4ml",
  tips50: "opentrons_flex_96_tiprack_50ul",
  tips1000: "opentrons_flex_96_tiprack_1000ul",
  /** 4x6 rack of 1.5 mL Eppendorfs. Opentrons spells it with a dot. */
  tubeRack: "jd_24_tuberack_1.5ml",
  /** GeneJET spin columns on the vacuum manifold. */
  vacuumRack: "jdvacuum_24_tuberack_500ul",
  falconRack: "jd_6_falconrack_50ml",
} as const;

const SBS: Point = { x: 127.76, y: 85.48 };
const JD_FOOTPRINT: Point = { x: 127, y: 85 };

const DEFINITIONS: LabwareGeometry[] = [
  {
    loadName: LABWARE.pcrPlate,
    label: "96-well PCR plate",
    kind: "plate",
    shape: SHAPE_96,
    origin: { x: 14.38, y: 11.24 },
    spacing: { x: 9, y: 9 },
    size: SBS,
    wellDiameter: 5.5,
  },
  {
    loadName: LABWARE.corningFlat96,
    label: "Corning 96-well flat",
    kind: "plate",
    shape: SHAPE_96,
    origin: { x: 14.38, y: 11.23 },
    spacing: { x: 9, y: 9 },
    size: { x: 127.76, y: 85.47 },
    wellDiameter: 6.86,
  },
  {
    loadName: LABWARE.nestFlat96,
    label: "NEST 96-well flat",
    kind: "plate",
    shape: SHAPE_96,
    origin: { x: 14.28, y: 11.18 },
    spacing: { x: 9, y: 9 },
    size: { x: 127.56, y: 85.36 },
    wellDiameter: 6.85,
  },
  {
    loadName: LABWARE.nestDeep24,
    label: "NEST 24-well 10.4 mL",
    kind: "plate",
    shape: SHAPE_24,
    origin: { x: 18.6, y: 13.87 },
    spacing: { x: 18, y: 18 },
    size: { x: 127.2, y: 84.9 },
    wellDiameter: 17,
  },
  {
    loadName: LABWARE.tips50,
    label: "50 µL tips",
    kind: "tips",
    shape: SHAPE_96,
    origin: { x: 14.38, y: 11.37 },
    spacing: { x: 9, y: 9 },
    size: { x: 127.75, y: 85.75 },
    wellDiameter: 5.58,
  },
  {
    loadName: LABWARE.tips1000,
    label: "1000 µL tips",
    kind: "tips",
    shape: SHAPE_96,
    origin: { x: 14.38, y: 11.37 },
    spacing: { x: 9, y: 9 },
    size: { x: 127.75, y: 85.75 },
    wellDiameter: 5.47,
  },
  {
    loadName: LABWARE.tubeRack,
    label: "1.5 mL tube rack",
    kind: "tuberack",
    shape: SHAPE_24,
    origin: { x: 9, y: 9 },
    spacing: { x: 21.8, y: 22.33 },
    size: JD_FOOTPRINT,
    wellDiameter: 9.8,
  },
  {
    loadName: LABWARE.vacuumRack,
    label: "Vacuum manifold",
    kind: "tuberack",
    shape: SHAPE_24,
    origin: { x: 10, y: 10 },
    spacing: { x: 21.4, y: 21.67 },
    size: JD_FOOTPRINT,
    wellDiameter: 8,
  },
  {
    loadName: LABWARE.falconRack,
    label: "50 mL Falcon rack",
    kind: "tuberack",
    shape: SHAPE_6,
    origin: { x: 25, y: 25 },
    spacing: { x: 38.5, y: 35 },
    size: JD_FOOTPRINT,
    wellDiameter: 27.5,
  },
];

export const LABWARE_GEOMETRY: Record<string, LabwareGeometry> = Object.fromEntries(
  DEFINITIONS.map((d) => [d.loadName, d]),
);

/**
 * TypeScript keys can't hold a dot unquoted, and some older code wrote the
 * tube rack as `jd_24_tuberack_1_5ml`. Accept it, once, here.
 */
LABWARE_GEOMETRY.jd_24_tuberack_1_5ml = LABWARE_GEOMETRY[LABWARE.tubeRack];

/** Whether this repo has geometry for a load name. */
export function isKnownLabware(loadName: string): boolean {
  return loadName in LABWARE_GEOMETRY;
}

/**
 * Geometry for a load name. Unknown labware falls back to the PCR plate so a
 * render degrades to a plausible grid instead of throwing; generators that
 * must not guess should check `isKnownLabware` first.
 */
export function geometryFor(loadName: string | null | undefined): LabwareGeometry {
  return (loadName && LABWARE_GEOMETRY[loadName]) || LABWARE_GEOMETRY[LABWARE.pcrPlate];
}

/** Dropdown options for a set of labware, labelled the same everywhere. */
export function labwareOptions(loadNames: readonly string[]): { value: string; label: string }[] {
  return loadNames.map((value) => ({ value, label: geometryFor(value).label }));
}
