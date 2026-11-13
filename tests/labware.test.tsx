/**
 * The labware registry is the single source of well shapes and drawing
 * geometry. These tests keep it honest against the definition files, and
 * check that every generator only loads labware it knows.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { STEEL_LAB_FLEX } from "../src/core/deck";
import { geometryFor, isKnownLabware, LABWARE, LABWARE_GEOMETRY, labwareOptions } from "../src/core/labware";
import { layoutFor } from "../src/core/steps";
import { columnMajor, shapeFor } from "../src/core/wells";
import { generateGoldenGate } from "../src/generators/goldengate";
import { generateMiniprep } from "../src/generators/miniprep";
import { generateTransfer } from "../src/generators/transfer";
import { generateTubeNormalisation } from "../src/generators/tube-normalisation";
import { parseAssemblyLayout } from "../src/parsers/assembly-layout";
import { parsePlateCsv } from "../src/parsers/plate-csv";
import { ASSEMBLY_LAYOUT_CSV, REPOSITORY_PLATE_CSV } from "./sample-data";
import { PlateMap } from "../src/ui/PlateMap";

const DEFINITIONS = join(__dirname, "..", "labware", "definitions");

describe("labware registry", () => {
  it("has an entry for every load name the generators use", () => {
    for (const name of Object.values(LABWARE)) expect(isKnownLabware(name), name).toBe(true);
  });

  it("is the one source for both well shapes and drawing geometry", () => {
    for (const name of Object.keys(LABWARE_GEOMETRY)) {
      expect(shapeFor(name)).toBe(geometryFor(name).shape);
      expect(layoutFor(name)).toBe(geometryFor(name));
    }
  });

  it("accepts the tube rack with or without the dot", () => {
    expect(geometryFor("jd_24_tuberack_1_5ml")).toBe(geometryFor("jd_24_tuberack_1.5ml"));
  });

  // Our own definitions are on disk, so check the registry against them rather
  // than against numbers typed in twice.
  for (const file of readdirSync(DEFINITIONS).filter((f) => f.endsWith(".json"))) {
    const def = JSON.parse(readFileSync(join(DEFINITIONS, file), "utf8"));
    const loadName = def.parameters.loadName as string;
    if (!isKnownLabware(loadName)) continue; // e.g. the petri dish, not used by a generator
    it(`matches ${file}`, () => {
      const g = geometryFor(loadName);
      const order: string[][] = def.ordering;
      expect(g.shape.columns).toHaveLength(order.length);
      expect(g.shape.rows).toEqual(order[0].map((w) => w.replace(/\d+$/, "")));
      expect(columnMajor(g.shape)).toEqual(order.flat());
      const last = order.at(-1)!.at(-1)!;
      const w = def.wells[last];
      expect(g.origin.x + (g.shape.columns.length - 1) * g.spacing.x).toBeCloseTo(w.x, 1);
      expect(g.origin.y + (g.shape.rows.length - 1) * g.spacing.y).toBeCloseTo(def.dimensions.yDimension - w.y, 1);
      expect(g.wellDiameter).toBe(w.diameter);
    });
  }

  it("labels dropdown options from the registry", () => {
    expect(labwareOptions([LABWARE.pcrPlate])).toEqual([{ value: LABWARE.pcrPlate, label: "96-well PCR plate" }]);
  });
});

describe("generators load only known labware", () => {
  const decks = {
    miniprep: generateMiniprep({ deck: STEEL_LAB_FLEX, racks: [["A1"], ["A1"]] }).deckLayout,
    transfer: generateTransfer({
      deck: STEEL_LAB_FLEX,
      plates: [{ plateType: LABWARE.pcrPlate, selectedWells: ["A1", "B1"] }],
      transferVolumeUl: 20,
    }).deckLayout,
    goldengate: generateGoldenGate({
      deck: STEEL_LAB_FLEX,
      layout: parseAssemblyLayout(ASSEMBLY_LAYOUT_CSV),
      repoPlate: parsePlateCsv(REPOSITORY_PLATE_CSV),
      plateType: LABWARE.pcrPlate,
    }).deckLayout,
    tube: generateTubeNormalisation({
      deck: STEEL_LAB_FLEX,
      samples: [{ name: "P1", concentration: 90, volumeUl: 50 }],
      targetConcentration: 30,
      finalVolumeUl: 60,
      waterLabware: LABWARE.falconRack,
      waterWell: "A1",
    }).deckLayout,
  };
  for (const [name, layout] of Object.entries(decks)) {
    it(name, () => {
      const names = layout.map((a) => a.loadName).filter((n): n is string => !!n);
      expect(names.filter((n) => !isKnownLabware(n))).toEqual([]);
    });
  }
});

describe("PlateMap", () => {
  it("draws a 24-tube rack and a 96-well plate with the same markup", () => {
    const rack = renderToString(<PlateMap loadName={LABWARE.tubeRack} cells={{ A1: { label: "P1" } }} />);
    const plate = renderToString(<PlateMap loadName={LABWARE.pcrPlate} cells={{ A1: { label: "P1" } }} />);
    expect(rack.match(/class="well /g)).toHaveLength(24);
    expect(plate.match(/class="well /g)).toHaveLength(96);
    for (const html of [rack, plate]) expect(html).toContain('class="well filled"');
  });

  it("offers select all and a count in selection mode", () => {
    const html = renderToString(
      <PlateMap loadName={LABWARE.tubeRack} selection={new Set(["A1", "B1"])} onSelectionChange={() => {}} />,
    );
    expect(html).toContain("2<!-- --> of <!-- -->24");
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(2);
  });
});
