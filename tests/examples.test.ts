/**
 * Every downloadable example must parse with the parser it demonstrates, and
 * drive its generator, so an example can never teach a format the app rejects.
 */
import { describe, expect, it } from "vitest";

import { STEEL_LAB_FLEX } from "../src/core/deck";
import { generateGoldenGate } from "../src/generators/goldengate";
import { generateTubeNormalisation } from "../src/generators/tube-normalisation";

import { checkPartVolumes, parseAssemblyLayout } from "../src/parsers/assembly-layout";
import { occupiedWells, parsePlateCsv, parseVolumesCsv } from "../src/parsers/plate-csv";
import {
  ASSEMBLY_LAYOUT_EXAMPLE,
  PLATE_CONTENTS_EXAMPLE,
  REPO_VOLUMES_EXAMPLE,
  REPOSITORY_PLATE_EXAMPLE,
  TUBE_LIST_EXAMPLE,
  type CsvExample,
} from "../src/ui/examples";
import * as exampleModule from "../src/ui/examples";
import { parseSamples } from "../src/ui/views/TubeNormalisationView";

// The public edition ships each example as its header row only, so the data
// checks below run only where an example carries rows; the header check always runs.
const hasRows = (...examples: CsvExample[]) =>
  examples.every((e) => e.content.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("#")).length > 1);

describe("downloadable CSV examples", () => {
  const all = Object.entries(exampleModule).filter(
    (entry): entry is [string, CsvExample] => typeof entry[1] === "object" && entry[1] !== null && "content" in entry[1],
  );

  it("each starts with a header naming its columns", () => {
    expect(all.length).toBeGreaterThan(0);
    for (const [name, example] of all) {
      const header = example.content.split(/\r?\n/)[0];
      expect(header.split(",").length, name).toBeGreaterThan(1);
      expect(example.filename, name).toMatch(/\.csv$/);
    }
  });

  it.skipIf(!hasRows(TUBE_LIST_EXAMPLE))("tube list parses cleanly and normalises", () => {
    const { samples, errors } = parseSamples(TUBE_LIST_EXAMPLE.content);
    expect(errors).toEqual([]);
    expect(samples.some((s) => s.masterMix)).toBe(true);
    expect(() =>
      generateTubeNormalisation({ deck: STEEL_LAB_FLEX, samples, targetConcentration: 30, finalVolumeUl: 100, waterLabware: "jd_6_falconrack_50ml", waterWell: "A1" }),
    ).not.toThrow();
  });

  it.skipIf(!hasRows(PLATE_CONTENTS_EXAMPLE))("plate contents gives every well a name and a concentration", () => {
    const plate = parsePlateCsv(PLATE_CONTENTS_EXAMPLE.content);
    expect(occupiedWells(plate)).toHaveLength(6);
    expect(Object.values(plate).every((w) => w.name && w.concentration !== null)).toBe(true);
  });

  it.skipIf(!hasRows(REPO_VOLUMES_EXAMPLE, ASSEMBLY_LAYOUT_EXAMPLE, REPOSITORY_PLATE_EXAMPLE))("volumes example parses and covers the assembly layout example", () => {
    const volumes = parseVolumesCsv(REPO_VOLUMES_EXAMPLE.content);
    expect(Object.keys(volumes)).toHaveLength(6);
    expect(volumes.P1d.volumeUl).toBe(100);
    const report = checkPartVolumes({
      layouts: [parseAssemblyLayout(ASSEMBLY_LAYOUT_EXAMPLE.content)],
      repoPlate: parsePlateCsv(REPOSITORY_PLATE_EXAMPLE.content),
      volumes,
    });
    expect(report.length).toBeGreaterThan(0);
    expect(report.every((r) => r.status === "ok")).toBe(true);
  });

  it.skipIf(!hasRows(ASSEMBLY_LAYOUT_EXAMPLE, REPOSITORY_PLATE_EXAMPLE))("assembly layout and repository plate assemble together, on or off the robot", () => {
    for (const thermocycler of ["onboard", "external"] as const) {
      const result = generateGoldenGate({
        deck: STEEL_LAB_FLEX,
        layout: parseAssemblyLayout(ASSEMBLY_LAYOUT_EXAMPLE.content),
        repoPlate: parsePlateCsv(REPOSITORY_PLATE_EXAMPLE.content),
        plateType: "opentrons_96_wellplate_200ul_pcr_full_skirt",
        thermocycler,
      });
      expect(result.plan.length).toBeGreaterThan(0);
    }
  });
});
