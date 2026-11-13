/**
 * Emit one representative protocol per generator into tests/fixtures/.
 *
 * CI runs `opentrons_simulate` over everything this writes. That is the only
 * check that catches a generator emitting invalid Python — typechecking and
 * unit tests cannot see inside a template literal.
 *
 * Simulation passing does NOT mean a protocol is scientifically correct. Every
 * invariant in docs/protocol-invariants.md was violated by code that simulated
 * cleanly. Read the emitted logic too.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { STEEL_LAB_FLEX } from "../src/core/deck";
import { generateMiniprep } from "../src/generators/miniprep";
import { generateGoldenGate } from "../src/generators/goldengate";
import { generateNormalisation } from "../src/generators/normalisation";
import { generateTransfer } from "../src/generators/transfer";
import { generateTubeNormalisation } from "../src/generators/tube-normalisation";
import { parseAssemblyLayout } from "../src/parsers/assembly-layout";
import { parsePlateCsv } from "../src/parsers/plate-csv";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "tests", "fixtures");
mkdirSync(outDir, { recursive: true });

/** Fixtures carry no webhook, so nothing posts to Slack from CI. */
const notify = {};

function write(name: string, source: string): void {
  const path = join(outDir, name);
  writeFileSync(path, source, "utf8");
  console.log(`wrote ${name} (${source.split("\n").length} lines)`);
}

const rows = ["A", "B", "C", "D", "E", "F", "G", "H"];

/* ------------------------------------------------- plate normalisation */

write(
  "normalisation.py",
  generateNormalisation({
    deck: STEEL_LAB_FLEX,
    wells: rows.flatMap((row) =>
      [1, 2, 3].map((col) => ({
        well: `${row}${col}`,
        name: `part_${row}${col}`,
        concentration: 20 + ((row.charCodeAt(0) + col) % 7) * 15,
        targetConcentration: 30,
        sourceVolumeUl: 45,
      })),
    ),
    plateType: "opentrons_96_wellplate_200ul_pcr_full_skirt",
    waterLabware: "jd_6_falconrack_50ml",
    waterWell: "A1",
    finalVolumeUl: 100,
    notify,
    author: "fixture",
  }).source,
);

/* -------------------------------------------------- tube normalisation */

write(
  "tube-normalisation.py",
  generateTubeNormalisation({
    deck: STEEL_LAB_FLEX,
    samples: [
      // Explicit rack positions and plate wells, as set in the app's maps or
      // the CSV, alongside tubes left for the generator to place.
      { name: "P10d", concentration: 49.6, volumeUl: 50, rack: 2, tube: "D6", well: "H12" },
      { name: "P18m", concentration: 45, volumeUl: 50, well: "A1" },
      { name: "P1d", concentration: 37.2, volumeUl: 50, rack: 1, tube: "A1" },
      { name: "T1m", concentration: 18.3, volumeUl: 100 },
      { name: "U4d", concentration: 30.8, volumeUl: 100 },
      { name: "U17m", concentration: 39, volumeUl: 200 },
      { name: "C4J", concentration: 60, volumeUl: 3600, masterMix: true },
    ],
    targetConcentration: 30,
    finalVolumeUl: 100,
    waterLabware: "jd_6_falconrack_50ml",
    waterWell: "A1",
    notify,
    author: "fixture",
  }).source,
);

/* ------------------------------------------------------------- miniprep */

// The default: separate samples already in their tubes, so no culture pass and
// a sample map. One tube left unnamed to exercise the fallback.
write(
  "miniprep.py",
  generateMiniprep({
    deck: STEEL_LAB_FLEX,
    racks: [["A1", "B1", "C1", "D1", "A2"]],
    sampleNames: [{ A1: "pJD001", B1: "pJD002", C1: "pJD003 clone 2", D1: "O'Brien test" }],
    notify,
    author: "fixture",
  }).source,
);

// One shared culture dispensed by the robot: the lab's original protocol.
write(
  "miniprep-culture.py",
  generateMiniprep({
    deck: STEEL_LAB_FLEX,
    racks: [["A1", "B1", "C1", "D1", "A2", "B2"]],
    params: { sampleSource: "culture" },
    notify,
    author: "fixture",
  }).source,
);

// Two racks, two batches, two elutions: exercises the manifold pinning, the
// off-deck rack swap and the batch pauses all at once.
write(
  "miniprep-batched.py",
  generateMiniprep({
    deck: STEEL_LAB_FLEX,
    racks: [
      ["A1", "B1", "C1", "D1"],
      ["A1", "B1"],
    ],
    params: { nBatches: 2, nElutions: 2, neutralisationMix: true },
    notify,
    author: "fixture",
  }).source,
);

// Cycled elsewhere with the plate built on the heater block, which stands in
// for the thermocycler's cold block. Exercises the temperature module path.
write(
  "golden-gate-heater-block.py",
  generateGoldenGate({
    deck: STEEL_LAB_FLEX,
    layout: parseAssemblyLayout(
      "Well,Combination_ID,Promoter,CDS,Vector\n" +
        "A1,1,P1,C1,V1\nA2,2,P1,C2,V1\nA3,3,P2,C1,V1\nB1,4,P2,C2,V1\n",
    ),
    repoPlate: parsePlateCsv("Well,Value\nA1,P1\nA2,P2\nA3,C1\nA4,C2\nA5,V1\n"),
    plateType: "opentrons_96_wellplate_200ul_pcr_full_skirt",
    masterMixParts: ["Vector"],
    thermocycler: "external",
    assemblyOn: "heater-block",
    notify,
    author: "fixture",
  }).source,
);

/* ------------------------------------------------------------- transfer */

write(
  "transfer.py",
  generateTransfer({
    deck: STEEL_LAB_FLEX,
    plates: [
      { plateType: "opentrons_96_wellplate_200ul_pcr_full_skirt", selectedWells: ["A1", "A2", "B1", "B2", "C1"] },
      { plateType: "corning_96_wellplate_360ul_flat", selectedWells: ["H11", "H12"] },
    ],
    transferVolumeUl: 200,
    notify,
    author: "fixture",
  }).source,
);

/* ---------------------------------------------------------- Golden Gate */

write(
  "golden-gate.py",
  generateGoldenGate({
    deck: STEEL_LAB_FLEX,
    layout: parseAssemblyLayout(
      "Well,Combination_ID,Promoter,CDS,Vector\n" +
        "A1,1,P1,C1,V1\nA2,2,P1,C2,V1\nA3,3,P2,C1,V1\nB1,4,P2,C2,V1\n",
    ),
    repoPlate: parsePlateCsv("Well,Value\nA1,P1\nA2,P2\nA3,C1\nA4,C2\nA5,V1\n"),
    plateType: "opentrons_96_wellplate_200ul_pcr_full_skirt",
    masterMixParts: ["Vector"],
    notify,
    author: "fixture",
  }).source,
);

// Cycled on another machine: plate on a deck slot, no thermocycler module, and
// a user-dragged layout so the placement path reaches the emitted Python.
write(
  "golden-gate-external.py",
  generateGoldenGate({
    deck: { ...STEEL_LAB_FLEX, placements: { assembly: "D3", repository: "C1" } },
    layout: parseAssemblyLayout(
      "Well,Combination_ID,Promoter,CDS,Vector\n" +
        "A1,1,P1,C1,V1\nA2,2,P1,C2,V1\nA3,3,P2,C1,V1\nB1,4,P2,C2,V1\n",
    ),
    repoPlate: parsePlateCsv("Well,Value\nA1,P1\nA2,P2\nA3,C1\nA4,C2\nA5,V1\n"),
    plateType: "opentrons_96_wellplate_200ul_pcr_full_skirt",
    masterMixParts: ["Vector"],
    thermocycler: "external",
    notify,
    author: "fixture",
  }).source,
);

console.log(`\nfixtures in ${outDir}`);
