import { describe, expect, it } from "vitest";

import { STEEL_LAB_FLEX } from "../src/core/deck";
import { checkTipHygiene, checkTipSharing, checkWellCapacity } from "../src/core/invariants";
import { PCR_WELL_WORKING_MAX_UL } from "../src/core/pipetting";
import type { ProtocolStep } from "../src/core/steps";
import { generateMiniprep } from "../src/generators/miniprep";
import { generateTransfer } from "../src/generators/transfer";
import { generateTubeNormalisation } from "../src/generators/tube-normalisation";

/** Build a step list without hand-counting indices. */
function steps(...parts: Omit<ProtocolStep, "index">[]): ProtocolStep[] {
  return parts.map((p, i) => ({ ...p, index: i + 1 }));
}

describe("checkTipHygiene", () => {
  it("flags a tip returning to a source after a contacting dispense", () => {
    const found = checkTipHygiene(
      steps(
        { kind: "pick_up_tip", label: "tip" },
        { kind: "aspirate", labwareId: "repo", well: "A1", volumeUl: 1, label: "a" },
        { kind: "dispense", labwareId: "dest", well: "B2", volumeUl: 1, label: "d" },
        { kind: "aspirate", labwareId: "repo", well: "A1", volumeUl: 1, label: "a again" },
      ),
    );
    expect(found).toHaveLength(1);
    expect(found[0].invariant).toBe(1);
    expect(found[0].step).toBe(4);
  });

  it("lets a tip return to a source after dispensing the first liquid into an empty well", () => {
    expect(
      checkTipHygiene(
        steps(
          { kind: "pick_up_tip", label: "tip" },
          { kind: "aspirate", labwareId: "mm", well: "B2", volumeUl: 48, label: "a" },
          { kind: "dispense", labwareId: "dest", well: "A1", volumeUl: 7, intoEmpty: true, label: "d" },
          { kind: "aspirate", labwareId: "mm", well: "B2", volumeUl: 48, label: "a again" },
        ),
      ),
    ).toEqual([]);
  });

  it("rejects an intoEmpty claim on a well that already received liquid", () => {
    const found = checkTipHygiene(
      steps(
        { kind: "pick_up_tip", label: "tip" },
        { kind: "aspirate", labwareId: "mm", well: "B2", volumeUl: 14, label: "a" },
        { kind: "dispense", labwareId: "dest", well: "A1", volumeUl: 7, intoEmpty: true, label: "d" },
        { kind: "dispense", labwareId: "dest", well: "A1", volumeUl: 7, intoEmpty: true, label: "d again" },
      ),
    );
    expect(found).toHaveLength(1);
    expect(found[0].invariant).toBe(1);
    expect(found[0].step).toBe(4);
    expect(found[0].message).toMatch(/claims/);
  });

  it("allows a tip to return to a source when every dispense was non-contact", () => {
    expect(
      checkTipHygiene(
        steps(
          { kind: "pick_up_tip", label: "tip" },
          { kind: "aspirate", labwareId: "water", well: "A1", volumeUl: 50, label: "a" },
          { kind: "dispense", labwareId: "dest", well: "B2", volumeUl: 50, nonContact: true, label: "d" },
          { kind: "aspirate", labwareId: "water", well: "A1", volumeUl: 50, label: "a again" },
        ),
      ),
    ).toEqual([]);
  });

  it("allows re-aspirating the well just dispensed into, which is a mix", () => {
    expect(
      checkTipHygiene(
        steps(
          { kind: "pick_up_tip", label: "tip" },
          { kind: "aspirate", labwareId: "rack", well: "A1", volumeUl: 10, label: "a" },
          { kind: "dispense", labwareId: "dest", well: "B2", volumeUl: 10, label: "d" },
          { kind: "aspirate", labwareId: "dest", well: "B2", volumeUl: 5, label: "mix up" },
        ),
      ),
    ).toEqual([]);
  });

  it("clears the tip's history on drop_tip", () => {
    expect(
      checkTipHygiene(
        steps(
          { kind: "pick_up_tip", label: "tip 1" },
          { kind: "aspirate", labwareId: "repo", well: "A1", volumeUl: 1, label: "a" },
          { kind: "dispense", labwareId: "dest", well: "B2", volumeUl: 1, label: "d" },
          { kind: "drop_tip", label: "drop" },
          { kind: "pick_up_tip", label: "tip 2" },
          { kind: "aspirate", labwareId: "repo", well: "A1", volumeUl: 1, label: "a" },
        ),
      ),
    ).toEqual([]);
  });
});

describe("checkTipSharing", () => {
  const contents: Record<string, string> = { A1: "P1", A2: "P1", A3: "P2" };
  const lookup = (_: string, well: string) => contents[well] ?? null;

  it("allows one tip across wells holding identical liquid", () => {
    expect(
      checkTipSharing(
        steps(
          { kind: "pick_up_tip", label: "tip" },
          { kind: "dispense", labwareId: "dest", well: "A1", volumeUl: 1, label: "d" },
          { kind: "dispense", labwareId: "dest", well: "A2", volumeUl: 1, label: "d" },
        ),
        lookup,
      ),
    ).toEqual([]);
  });

  it("flags one tip spanning wells whose contents differ", () => {
    const found = checkTipSharing(
      steps(
        { kind: "pick_up_tip", label: "tip" },
        { kind: "dispense", labwareId: "dest", well: "A1", volumeUl: 1, label: "d" },
        { kind: "dispense", labwareId: "dest", well: "A3", volumeUl: 1, label: "d" },
      ),
      lookup,
    );
    expect(found).toHaveLength(1);
    expect(found[0].invariant).toBe(2);
  });
});

describe("checkWellCapacity", () => {
  it("flags a well taken over its working capacity", () => {
    const found = checkWellCapacity(
      steps(
        { kind: "dispense", labwareId: "dest", well: "A1", volumeUl: 100, label: "d" },
        { kind: "dispense", labwareId: "dest", well: "A1", volumeUl: 80, label: "d" },
      ),
      { dest: PCR_WELL_WORKING_MAX_UL },
    );
    expect(found).toHaveLength(1);
    expect(found[0].invariant).toBe(4);
    expect(found[0].message).toContain("180.0 uL");
  });

  it("reports a given well only once", () => {
    const found = checkWellCapacity(
      steps(
        { kind: "dispense", labwareId: "dest", well: "A1", volumeUl: 200, label: "d" },
        { kind: "dispense", labwareId: "dest", well: "A1", volumeUl: 200, label: "d" },
      ),
      { dest: PCR_WELL_WORKING_MAX_UL },
    );
    expect(found).toHaveLength(1);
  });

  it("counts an aspirate back off the running total", () => {
    expect(
      checkWellCapacity(
        steps(
          { kind: "dispense", labwareId: "dest", well: "A1", volumeUl: 140, label: "d" },
          { kind: "aspirate", labwareId: "dest", well: "A1", volumeUl: 100, label: "a" },
          { kind: "dispense", labwareId: "dest", well: "A1", volumeUl: 100, label: "d" },
        ),
        { dest: PCR_WELL_WORKING_MAX_UL },
      ),
    ).toEqual([]);
  });
});

/* ------------------------------- every generator obeys the invariants ----- */

describe("generated protocols obey the invariants", () => {
  it("tube normalisation", () => {
    const result = generateTubeNormalisation({
      deck: STEEL_LAB_FLEX,
      samples: [
        { name: "P1d", concentration: 60, volumeUl: 50 },
        { name: "T1m", concentration: 18.3, volumeUl: 100 },
        { name: "U4d", concentration: 30.8, volumeUl: 100 },
      ],
      targetConcentration: 30,
      finalVolumeUl: 100,
      waterLabware: "jd_6_falconrack_50ml",
      waterWell: "A1",
    });
    expect(checkTipHygiene(result.steps)).toEqual([]);
    expect(checkWellCapacity(result.steps, { dest: PCR_WELL_WORKING_MAX_UL })).toEqual([]);
  });

  it("miniprep, batched and mixing", () => {
    const result = generateMiniprep({
      deck: STEEL_LAB_FLEX,
      racks: [
        ["A1", "B1", "C1", "D1", "A2"],
        ["A1", "B1"],
      ],
      params: { nBatches: 2, nElutions: 2, neutralisationMix: true },
    });
    expect(checkTipHygiene(result.steps)).toEqual([]);
  });

  it("miniprep, shared-tip neutralisation", () => {
    const result = generateMiniprep({
      deck: STEEL_LAB_FLEX,
      racks: [["A1", "B1", "C1", "D1", "A2", "B2"]],
      params: { neutralisationMix: false },
    });
    expect(checkTipHygiene(result.steps)).toEqual([]);
  });

  it("miniprep, pre-loaded tubes", () => {
    const result = generateMiniprep({
      deck: STEEL_LAB_FLEX,
      racks: [["A1", "B1", "C1", "D1", "A2", "B2"]],
      params: { sampleSource: "tubes", nBatches: 2 },
    });
    expect(checkTipHygiene(result.steps)).toEqual([]);
  });

  it("plate to tube transfer", () => {
    const result = generateTransfer({
      deck: STEEL_LAB_FLEX,
      plates: [
        {
          plateType: "opentrons_96_wellplate_200ul_pcr_full_skirt",
          selectedWells: ["A1", "A2", "B1"],
        },
      ],
      transferVolumeUl: 200,
    });
    expect(checkTipHygiene(result.steps)).toEqual([]);
  });
});
