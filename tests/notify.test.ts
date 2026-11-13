/**
 * Every lab protocol posts to the lab Slack, whichever way it was generated,
 * and none posts while it is being simulated.
 *
 * The same file ships in the public export, where LAB_SLACK_WEBHOOK_URL is
 * blank; there the lab-webhook assertions reduce to "no webhook unless given".
 */
import { describe, expect, it } from "vitest";

import { LAB_SLACK_WEBHOOK_URL } from "../src/config/lab";
import { STEEL_LAB_FLEX } from "../src/core/deck";
import { preamble, runFunction, webhookFor } from "../src/core/emit";
import { LABWARE } from "../src/core/labware";
import { generateGoldenGate } from "../src/generators/goldengate";
import { generateMiniprep } from "../src/generators/miniprep";
import { generateNormalisation } from "../src/generators/normalisation";
import { generateTransfer } from "../src/generators/transfer";
import { generateTubeNormalisation } from "../src/generators/tube-normalisation";
import { parseAssemblyLayout } from "../src/parsers/assembly-layout";
import { parsePlateCsv } from "../src/parsers/plate-csv";
import { ASSEMBLY_LAYOUT_EXAMPLE, REPOSITORY_PLATE_EXAMPLE } from "../src/ui/examples";

const LAB = LAB_SLACK_WEBHOOK_URL.trim();

// Generated with no notify settings at all — the path a script or an agent takes.
const sources: Record<string, string> = {
  "tube normalisation": generateTubeNormalisation({
    deck: STEEL_LAB_FLEX,
    samples: [{ name: "P1", concentration: 90, volumeUl: 50 }],
    targetConcentration: 30,
    finalVolumeUl: 60,
    waterLabware: LABWARE.falconRack,
    waterWell: "A1",
  }).source,
  "plate normalisation": generateNormalisation({
    deck: STEEL_LAB_FLEX,
    wells: [{ well: "A1", name: "P1", concentration: 90, targetConcentration: 30, sourceVolumeUl: 50 }],
    plateType: LABWARE.pcrPlate,
    waterLabware: LABWARE.falconRack,
    waterWell: "A1",
    finalVolumeUl: 50,
  }).source,
  miniprep: generateMiniprep({ deck: STEEL_LAB_FLEX, racks: [["A1"]] }).source,
  transfer: generateTransfer({
    deck: STEEL_LAB_FLEX,
    plates: [{ plateType: LABWARE.pcrPlate, selectedWells: ["A1"] }],
    transferVolumeUl: 20,
  }).source,
  "golden gate": generateGoldenGate({
    deck: STEEL_LAB_FLEX,
    layout: parseAssemblyLayout(ASSEMBLY_LAYOUT_EXAMPLE.content),
    repoPlate: parsePlateCsv(REPOSITORY_PLATE_EXAMPLE.content),
    plateType: LABWARE.pcrPlate,
  }).source,
};

describe("every generator", () => {
  for (const [name, source] of Object.entries(sources)) {
    it(`${name} carries the lab webhook without being given one`, () => {
      if (LAB) expect(source).toContain(`WEBHOOK_URL = '${LAB}'`);
      else expect(source).not.toContain("WEBHOOK_URL");
    });

    it(`${name} does not post while simulating`, () => {
      expect(source).toContain("SIMULATING = protocol.is_simulating()");
      if (LAB) expect(source).toMatch(/if SIMULATING:\n\s+return\n\s+try:\n\s+requests\.post/);
    });
  }
});

describe("webhook choice", () => {
  it("uses a webhook passed in over the lab one", () => {
    expect(webhookFor({ slackWebhookUrl: " https://example.org/hook " })).toBe("https://example.org/hook");
  });

  it("treats a blank webhook as the lab one, never as off", () => {
    expect(webhookFor({ slackWebhookUrl: "  " })).toBe(LAB || undefined);
    expect(webhookFor({})).toBe(LAB || undefined);
  });

  it("sets the simulation flag before anything can notify", () => {
    const run = runFunction("notify('hi')", "Test");
    expect(run.indexOf("SIMULATING = protocol.is_simulating()")).toBeLessThan(run.indexOf("try:"));
    expect(preamble({ protocolName: "x", description: "", author: "" })).toContain("SIMULATING = True");
  });
});
