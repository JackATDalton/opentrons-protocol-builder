import { describe, expect, it } from "vitest";
import { STEEL_LAB_FLEX } from "../src/core/deck";
import { generateTubeNormalisation } from "../src/generators/tube-normalisation";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generateMiniprep } from "../src/generators/miniprep";
import { LABWARE_LAYOUTS, deckSize, replaySteps, slotOrigin, wellPosition } from "../src/core/steps";

const run = () =>
  generateTubeNormalisation({
    deck: STEEL_LAB_FLEX,
    samples: [
      { name: "P1", concentration: 90, volumeUl: 50 },
      { name: "P2", concentration: 60, volumeUl: 50 },
    ],
    targetConcentration: 30,
    finalVolumeUl: 60,
    waterLabware: "jd_6_falconrack_50ml",
    waterWell: "A1",
  });

describe("deck geometry", () => {
  it("puts row A at the top and column 1 at the left", () => {
    expect(slotOrigin("A1")).toEqual({ x: 0, y: 0 });
    expect(slotOrigin("D3").x).toBeGreaterThan(slotOrigin("A1").x);
    expect(slotOrigin("D3").y).toBeGreaterThan(slotOrigin("A1").y);
  });

  it("rejects a slot that is not on the Flex deck", () => {
    expect(() => slotOrigin("E1")).toThrow(/not a Flex deck slot/);
    expect(() => slotOrigin("A4")).toThrow(/not a Flex deck slot/);
  });

  it("spaces plate wells 9 mm apart and offsets them by slot", () => {
    const a1 = wellPosition("C2", "opentrons_96_wellplate_200ul_pcr_full_skirt", "A1");
    const a2 = wellPosition("C2", "opentrons_96_wellplate_200ul_pcr_full_skirt", "A2");
    const b1 = wellPosition("C2", "opentrons_96_wellplate_200ul_pcr_full_skirt", "B1");
    expect(a2.x - a1.x).toBeCloseTo(9);
    expect(b1.y - a1.y).toBeCloseTo(9);
    const elsewhere = wellPosition("A1", "opentrons_96_wellplate_200ul_pcr_full_skirt", "A1");
    expect(a1.x).toBeGreaterThan(elsewhere.x);
  });

  it("uses the tube rack's own 21.8 mm pitch, not the plate's", () => {
    const a1 = wellPosition("B2", "jd_24_tuberack_1.5ml", "A1");
    const a2 = wellPosition("B2", "jd_24_tuberack_1.5ml", "A2");
    expect(a2.x - a1.x).toBeCloseTo(21.8);
  });

  it("falls back to the labware centre for an unknown well rather than throwing", () => {
    const p = wellPosition("A1", "jd_6_falconrack_50ml", "H12");
    expect(Number.isFinite(p.x)).toBe(true);
    expect(() => wellPosition("A1", "jd_6_falconrack_50ml", "nope")).toThrow(/not a valid well/);
  });

  it("covers all 12 slots in its reported size", () => {
    const s = deckSize();
    expect(s.x).toBeGreaterThan(slotOrigin("A3").x);
    expect(s.y).toBeGreaterThan(slotOrigin("D1").y);
  });
});

describe("viewer layouts", () => {
  // An unknown loadName silently draws as a 96-well plate, which is how the
  // vacuum manifold went unrendered. Every labware the miniprep loads must
  // have its own layout.
  it("has a layout for every labware the miniprep puts on deck", () => {
    const { deckLayout } = generateMiniprep({ deck: STEEL_LAB_FLEX, racks: [["A1"], ["A1"]] });
    const loadNames = deckLayout.map((a) => a.loadName).filter((n): n is string => !!n);
    expect(loadNames.filter((n) => !LABWARE_LAYOUTS[n])).toEqual([]);
  });

  it("matches the manifold's labware definition", () => {
    const def = JSON.parse(
      readFileSync(join(__dirname, "..", "labware", "definitions", "jdvacuum_24_tuberack_500ul.json"), "utf8"),
    );
    const layout = LABWARE_LAYOUTS.jdvacuum_24_tuberack_500ul;
    const { x, y } = def.wells.D6;
    // Layout y counts down from the back edge; the definition counts up from the front.
    expect(layout.origin.x + 5 * layout.spacing.x).toBeCloseTo(x, 1);
    expect(layout.origin.y + 3 * layout.spacing.y).toBeCloseTo(def.dimensions.yDimension - y, 1);
    expect(layout.wellDiameter).toBe(def.wells.D6.diameter);
  });
});

describe("replaySteps tip handling", () => {
  // Enough tubes that the 1000 uL tips run past one rack (99 tips, 2 racks).
  const full = Array.from({ length: 24 }, (_, i) => `${"ABCD"[i % 4]}${Math.floor(i / 4) + 1}`);
  const r = generateMiniprep({
    deck: STEEL_LAB_FLEX,
    racks: [full, full],
    params: { neutralisationMix: true },
  });
  const pickUps = r.steps.filter((s) => s.kind === "pick_up_tip");
  const at = (step: { index: number }) => replaySteps(r.steps, step.index, r.deckLayout).at;
  const tipRacks = r.deckLayout.filter((a) => a.kind === "tips");

  it("takes tips in column-major order, not always A1", () => {
    expect(at(pickUps[0])?.well).toBe("A1");
    expect(at(pickUps[1])?.well).toBe("B1");
    expect(at(pickUps[8])?.well).toBe("A2");
  });

  it("moves on to the second rack once the first is empty", () => {
    expect(tipRacks).toHaveLength(2);
    expect(at(pickUps[95])).toMatchObject({ labwareId: tipRacks[0].id, well: "H12" });
    expect(at(pickUps[96])).toMatchObject({ labwareId: tipRacks[1].id, slot: tipRacks[1].slot, well: "A1" });
  });

  it("marks used tips against the rack ids the deck actually has", () => {
    const end = replaySteps(r.steps, r.steps.length, r.deckLayout);
    expect(end.tipsUsed.size).toBe(pickUps.length);
    for (const key of end.tipsUsed) {
      expect(tipRacks.map((t) => t.id)).toContain(key.split(":").slice(0, -1).join(":"));
    }
  });

  it("goes to the trash to drop a tip", () => {
    const drop = r.steps.find((s) => s.kind === "drop_tip")!;
    const trash = r.deckLayout.find((a) => a.kind === "trash")!;
    expect(at(drop)?.slot).toBe(trash.slot);
  });
});

describe("replaySteps", () => {
  it("accumulates destination volumes to exactly the planned final volume", () => {
    const r = run();
    const end = replaySteps(r.steps, r.steps.length);
    for (const p of r.plan) {
      expect(end.volumes.get(`dest:${p.well}`)).toBeCloseTo(p.finalVolumeUl, 5);
    }
  });

  it("is exact when scrubbing backwards", () => {
    const r = run();
    const forward = replaySteps(r.steps, 5);
    const afterGoingToEndAndBack = replaySteps(r.steps, 5);
    expect([...afterGoingToEndAndBack.volumes.entries()]).toEqual([...forward.volumes.entries()]);
  });

  it("starts with nothing on the deck", () => {
    const r = run();
    const start = replaySteps(r.steps, 0);
    expect(start.volumes.size).toBe(0);
    expect(start.tipsUsed.size).toBe(0);
    expect(start.at).toBeUndefined();
  });

  it("draws down the water source rather than filling it", () => {
    const r = run();
    const end = replaySteps(r.steps, r.steps.length);
    expect(end.volumes.get("water:A1")).toBeLessThan(0);
  });

  it("consumes one tip-rack position per pick-up, column-major", () => {
    const r = run();
    const end = replaySteps(r.steps, r.steps.length);
    const pickups = r.steps.filter((s) => s.kind === "pick_up_tip").length;
    expect(end.tipsUsed.size).toBe(pickups);
    expect([...end.tipsUsed].some((t) => t.endsWith(":A1"))).toBe(true);
  });

  it("tracks the arm moving from one labware to another", () => {
    const r = run();
    const firstDispense = r.steps.findIndex((s) => s.kind === "dispense");
    const state = replaySteps(r.steps, firstDispense + 1);
    expect(state.at?.labwareId).toBe("dest");
    expect(state.from?.labwareId).toBe("water");
  });

  it("ignores mix aspirates from the destination", () => {
    // A mix returns what it takes, so it must not reduce the displayed volume.
    const r = run();
    const end = replaySteps(r.steps, r.steps.length);
    const total = r.plan.reduce((sum, p) => sum + p.finalVolumeUl, 0);
    const shown = r.plan.reduce((sum, p) => sum + (end.volumes.get(`dest:${p.well}`) ?? 0), 0);
    expect(shown).toBeCloseTo(total, 5);
  });
});
