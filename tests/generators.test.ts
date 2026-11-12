import { describe, expect, it } from "vitest";

import { BARE_FLEX, STEEL_LAB_FLEX } from "../src/core/deck";
import { LYSIS_GROUP_SIZE, MANIFOLD_PREFERRED_SLOTS, generateMiniprep } from "../src/generators/miniprep";
import { generateTransfer } from "../src/generators/transfer";

const PCR = "opentrons_96_wellplate_200ul_pcr_full_skirt";

describe("transfer", () => {
  it("pairs source wells to tubes in row-major order on both sides", () => {
    const { plan } = generateTransfer({
      deck: STEEL_LAB_FLEX,
      // Deliberately out of order, and only 3 of 8 rows, which is the shape
      // that made the original index-paired version drift (invariant 3).
      plates: [{ plateType: PCR, selectedWells: ["C1", "A2", "A1", "B2", "B1", "C2"] }],
      transferVolumeUl: 100,
    });
    expect(plan.map((p) => p.sourceWell)).toEqual(["A1", "A2", "B1", "B2", "C1", "C2"]);
    expect(plan.map((p) => p.tube)).toEqual(["A1", "A2", "A3", "A4", "A5", "A6"]);
  });

  it("writes the pairing into the emitted protocol by name, not by index", () => {
    const { source } = generateTransfer({
      deck: STEEL_LAB_FLEX,
      plates: [{ plateType: PCR, selectedWells: ["A1", "B1"] }],
      transferVolumeUl: 100,
    });
    expect(source).toContain('"source_well": \'A1\'');
    expect(source).toContain('"tube": \'A1\'');
    expect(source).toContain('"tube": \'A2\'');
    // No zipping of two orderings at run time.
    expect(source).not.toMatch(/\bzip\(/);
  });

  it("spills onto a second rack past 24 tubes, numbering positions per rack", () => {
    const wells = Array.from({ length: 30 }, (_, i) => `${"ABCD"[Math.floor(i / 12)]}${(i % 12) + 1}`);
    const { plan, deckLayout } = generateTransfer({
      deck: STEEL_LAB_FLEX,
      plates: [{ plateType: PCR, selectedWells: wells }],
      transferVolumeUl: 100,
    });
    expect(plan[23].rack).toBe(1);
    expect(plan[24].rack).toBe(2);
    expect(plan[24].tube).toBe("A1");
    expect(deckLayout.filter((a) => a.id.startsWith("rack"))).toHaveLength(2);
  });

  it("uses one tip per well, since every well is a different sample", () => {
    const { tipsUsed, steps } = generateTransfer({
      deck: STEEL_LAB_FLEX,
      plates: [{ plateType: PCR, selectedWells: ["A1", "A2", "A3"] }],
      transferVolumeUl: 100,
    });
    expect(tipsUsed).toBe(3);
    expect(steps.filter((s) => s.kind === "pick_up_tip")).toHaveLength(3);
  });

  it("rejects a volume the p1000 cannot deliver", () => {
    expect(() =>
      generateTransfer({
        deck: STEEL_LAB_FLEX,
        plates: [{ plateType: PCR, selectedWells: ["A1"] }],
        transferVolumeUl: 1500,
      }),
    ).toThrow(/between 5 and 1000/);
  });

  it("rejects more than three source plates", () => {
    expect(() =>
      generateTransfer({
        deck: BARE_FLEX,
        plates: Array.from({ length: 4 }, () => ({ plateType: PCR, selectedWells: ["A1"] })),
        transferVolumeUl: 100,
      }),
    ).toThrow(/At most 3 source plates/);
  });
});

describe("miniprep", () => {
  it("pins manifolds to the chained-tubing slots, right edge first", () => {
    const { deckLayout } = generateMiniprep({
      deck: STEEL_LAB_FLEX,
      racks: [["A1"], ["A1"]],
    });
    const manifolds = deckLayout.filter((a) => a.id.startsWith("manifold")).map((a) => a.slot);
    expect(manifolds).toEqual(MANIFOLD_PREFERRED_SLOTS);
  });

  it("interleaves lysis and neutralisation in groups, never two passes", () => {
    const { steps } = generateMiniprep({
      deck: STEEL_LAB_FLEX,
      racks: [["A1", "B1", "C1", "D1", "A2", "B2"]],
      params: { neutralisationMix: false },
    });
    // Reduce the run to the order its lysis and neutralisation dispenses
    // happened in, then assert it alternates by group rather than lysing all.
    const kinds = steps
      .filter((s) => s.kind === "dispense" && /^(Lyse|Neutralise)/.test(s.label))
      .map((s) => (s.label.startsWith("Lyse") ? "L" : "N"));
    expect(kinds.join("")).toBe("LLLLNNNNLLNN");
    expect(LYSIS_GROUP_SIZE).toBe(4);
  });

  it("gives each tube its own tip for lysis", () => {
    const { steps } = generateMiniprep({
      deck: STEEL_LAB_FLEX,
      racks: [["A1", "B1", "C1"]],
    });
    expect(steps.filter((s) => s.label.startsWith("Pick up tip — lysis"))).toHaveLength(3);
  });

  it("shares one tip per group for non-mixing neutralisation", () => {
    const { steps, tipsUsed } = generateMiniprep({
      deck: STEEL_LAB_FLEX,
      racks: [["A1", "B1", "C1", "D1", "A2"]],
      params: { sampleSource: "culture", neutralisationMix: false },
    });
    // 5 tubes = 2 groups, so 2 neutralisation tips; 1 culture + 5 lysis + 2
    // neutralisation + 1 wash + 1 elution = 10.
    expect(steps.filter((s) => s.label.includes("neutralisation, shared"))).toHaveLength(2);
    expect(tipsUsed).toBe(10);
  });

  it("gives each tube its own tip when neutralisation mixes", () => {
    const { tipsUsed } = generateMiniprep({
      deck: STEEL_LAB_FLEX,
      racks: [["A1", "B1", "C1", "D1", "A2"]],
      params: { sampleSource: "culture", neutralisationMix: true },
    });
    // 1 culture + 5 lysis + 5 neutralisation + 1 wash + 1 elution.
    expect(tipsUsed).toBe(13);
  });

  it("totals buffer volumes across every batch and elution", () => {
    const { buffers, totalSamples } = generateMiniprep({
      deck: STEEL_LAB_FLEX,
      racks: [["A1", "B1"]],
      params: { nBatches: 3, nElutions: 2, elutionVolumeUl: 50, washVolumeUl: 250, washRounds: 4 },
    });
    expect(totalSamples).toBe(6);
    const by = (label: string) => buffers.find((b) => b.label === label)?.totalMl;
    expect(by("Wash buffer")).toBeCloseTo((250 * 4 * 6) / 1000);
    expect(by("Elution buffer")).toBeCloseTo((50 * 6 * 2) / 1000);
  });

  it("refuses a run needing more culture than one Falcon holds", () => {
    expect(() =>
      generateMiniprep({
        deck: STEEL_LAB_FLEX,
        racks: [Array.from({ length: 24 }, (_, i) => `${"ABCD"[i % 4]}${Math.floor(i / 4) + 1}`)],
        params: { sampleSource: "culture", nBatches: 10, cultureVolumeUl: 250 },
      }),
    ).toThrow(/more than one 50 mL Falcon/);
  });

  it("swaps the sample racks off deck and reloads the same slots for elution", () => {
    const { source, deckLayout } = generateMiniprep({
      deck: STEEL_LAB_FLEX,
      racks: [["A1", "B1"]],
    });
    const rackSlot = deckLayout.find((a) => a.id === "rack")?.slot;
    expect(source).toContain("move_labware(rack, OFF_DECK");
    expect(source).toContain("elution_racks = [protocol.load_labware");
    expect(source).toContain(`TUBE_RACK_SLOTS = ['${rackSlot}']`);
  });

  it("rejects more racks than the deck can pair with manifolds", () => {
    expect(() =>
      generateMiniprep({ deck: STEEL_LAB_FLEX, racks: [["A1"], ["A1"], ["A1"]] }),
    ).toThrow(/At most 2 tube racks/);
  });

  it("washes every column once before starting the next round", () => {
    const { steps } = generateMiniprep({
      deck: STEEL_LAB_FLEX,
      racks: [["A1", "B1", "C1", "D1", "A2"]],
      params: { washRounds: 2, washVolumeUl: 250 },
    });
    const washes = steps
      .filter((s) => s.kind === "dispense" && s.label.startsWith("Wash"))
      .map((s) => s.well);
    expect(washes).toEqual(["A1", "B1", "C1", "D1", "A2", "A1", "B1", "C1", "D1", "A2"]);
    // 1000 uL tip / 250 uL = 4 columns per aspirate, so 2 aspirates per round.
    expect(steps.filter((s) => s.kind === "aspirate" && s.label.includes("wash buffer"))).toHaveLength(4);
  });

  it("defaults to separate samples already in their tubes, with no culture pass", () => {
    const { steps, source, buffers, tipsUsed } = generateMiniprep({
      deck: STEEL_LAB_FLEX,
      racks: [["A1", "B1", "C1", "D1", "A2"]],
      params: { neutralisationMix: false },
    });
    expect(steps.some((s) => /culture/i.test(s.label))).toBe(false);
    expect(source).not.toContain("add_culture");
    expect(source).not.toContain("CULTURE_");
    expect(buffers.map((b) => b.label)).not.toContain("Resuspended culture");
    // 5 lysis + 2 neutralisation + 1 wash + 1 elution, and no culture tip.
    expect(tipsUsed).toBe(9);
  });

  it("names each pre-loaded tube, falling back to its position", () => {
    const { samplePositions, source } = generateMiniprep({
      deck: STEEL_LAB_FLEX,
      racks: [["B1", "A1"], ["A1"]],
      sampleNames: [{ a1: " pJD001 " }, { A1: "pJD009" }],
      params: { sampleSource: "tubes" },
    });
    expect(samplePositions.map((s) => s.name)).toEqual(["pJD001", "R1 B1", "pJD009"]);
    expect(source).toContain("SAMPLE_NAMES = [['pJD001', 'R1 B1'], ['pJD009']]");
  });

  it("keeps names with their rack when an empty rack is dropped", () => {
    const { samplePositions } = generateMiniprep({
      deck: STEEL_LAB_FLEX,
      racks: [[], ["A1"]],
      sampleNames: [{ A1: "wrong" }, { A1: "right" }],
      params: { sampleSource: "tubes" },
    });
    expect(samplePositions[0].name).toBe("right");
  });

  it("warns when two tubes share a name", () => {
    const { warnings } = generateMiniprep({
      deck: STEEL_LAB_FLEX,
      racks: [["A1", "B1"]],
      sampleNames: [{ A1: "pJD001", B1: "pJD001" }],
      params: { sampleSource: "tubes" },
    });
    expect(warnings.some((w) => w.includes("pJD001"))).toBe(true);
  });

  it("dispenses above tube tops throughout, so tips clear open lids", () => {
    const { steps, source } = generateMiniprep({
      deck: STEEL_LAB_FLEX,
      racks: [["A1", "B1"]],
    });
    expect(steps.filter((s) => s.kind === "dispense").every((s) => s.nonContact)).toBe(true);
    expect(source).toContain("DISPENSE_HEIGHT_MM = 35");
    expect(source).toContain("top(DISPENSE_HEIGHT_MM)");
  });
});
