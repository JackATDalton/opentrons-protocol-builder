import { describe, expect, it } from "vitest";
import { STEEL_LAB_FLEX, BARE_FLEX } from "../src/core/deck";
import {
  DEFAULT_MAX_WELL_UL,
  generateTubeNormalisation,
  planTube,
  type TubeSample,
} from "../src/generators/tube-normalisation";

const base = (overrides: Partial<Parameters<typeof generateTubeNormalisation>[0]> = {}) => ({
  deck: STEEL_LAB_FLEX,
  samples: [
    { name: "P1", concentration: 90, volumeUl: 50 },
    { name: "P2", concentration: 60, volumeUl: 50 },
    { name: "T1", concentration: 31, volumeUl: 100 },
  ] as TubeSample[],
  targetConcentration: 30,
  finalVolumeUl: 60,
  waterLabware: "jd_6_falconrack_50ml",
  waterWell: "A1",
  ...overrides,
});

describe("planTube", () => {
  it("dilutes a concentrated stock to target in the requested volume", () => {
    const r = planTube({ name: "x", concentration: 90, volumeUl: 50 }, 30, 60, 3);
    expect(r.partUl).toBe(20);
    expect(r.waterUl).toBe(40);
    expect(r.achieved).toBe(30);
    expect(r.massLimited).toBe(false);
  });

  it("scales the well down rather than landing under target when mass-limited", () => {
    // 10 uL usable at 90 ng/uL is 900 ng: enough for 30 uL at 30 ng/uL, not 60.
    const r = planTube({ name: "x", concentration: 90, volumeUl: 13 }, 30, 60, 3);
    expect(r.massLimited).toBe(true);
    expect(r.total).toBeLessThan(60);
    expect(r.achieved).toBe(30);
  });

  it("transfers neat and stays below target when the stock is too dilute", () => {
    const r = planTube({ name: "x", concentration: 18.3, volumeUl: 100 }, 30, 60, 3);
    expect(r.waterUl).toBe(0);
    expect(r.achieved).toBe(18.3);
    expect(r.belowTarget).toBe(true);
    expect(r.massLimited).toBe(false);
  });

  it("respects the tube dead volume", () => {
    const r = planTube({ name: "x", concentration: 1000, volumeUl: 5 }, 30, 60, 3);
    expect(r.partUl).toBeLessThanOrEqual(2);
  });
});

describe("generateTubeNormalisation", () => {
  it("excludes master-mix parts from the plate but reports them", () => {
    const r = generateTubeNormalisation(
      base({
        samples: [
          { name: "P1", concentration: 90, volumeUl: 50 },
          { name: "C4J", concentration: 60, volumeUl: 3600, masterMix: true },
          { name: "V35m", concentration: 120, volumeUl: 800, masterMix: true },
        ],
      }),
    );
    expect(r.plan.map((p) => p.name)).toEqual(["P1"]);
    expect(r.excluded.map((s) => s.name)).toEqual(["C4J", "V35m"]);
    expect(r.source).not.toMatch(/'C4J'/);
    // Still named in the header so the exclusion is visible on the bench.
    expect(r.source).toMatch(/master mix/i);
  });

  it("spills onto a second tube rack past 24 tubes and keeps tube names in range", () => {
    const samples = Array.from({ length: 30 }, (_, i) => ({
      name: `S${i + 1}`,
      concentration: 90,
      volumeUl: 50,
    }));
    const r = generateTubeNormalisation(base({ samples }));
    expect(new Set(r.plan.map((p) => p.rack))).toEqual(new Set([1, 2]));
    expect(r.plan.filter((p) => p.rack === 1)).toHaveLength(24);
    for (const p of r.plan) expect(p.tube).toMatch(/^[A-D][1-6]$/);
  });

  it("gives every part a distinct destination well", () => {
    const samples = Array.from({ length: 30 }, (_, i) => ({
      name: `S${i + 1}`,
      concentration: 90,
      volumeUl: 50,
    }));
    const r = generateTubeNormalisation(base({ samples }));
    expect(new Set(r.plan.map((p) => p.well)).size).toBe(30);
  });

  it("writes the tube-to-well mapping into the emitted protocol by name", () => {
    // Invariant 3: the pairing must be data, not two orderings zipped at run time.
    const r = generateTubeNormalisation(base());
    for (const p of r.plan) {
      expect(r.source).toContain(`"rack": ${p.rack}, "tube": '${p.tube}'`);
      expect(r.source).toMatch(new RegExp(`'${p.well}': \\{"name": '${p.name}'`));
    }
    expect(r.source).not.toMatch(/zip\(/);
  });

  it("refuses a final volume over the well's working capacity", () => {
    // Invariant 4.
    expect(() => generateTubeNormalisation(base({ finalVolumeUl: DEFAULT_MAX_WELL_UL + 1 }))).toThrow(
      /working capacity/,
    );
  });

  it("rejects duplicate tube names", () => {
    expect(() =>
      generateTubeNormalisation(
        base({
          samples: [
            { name: "P1", concentration: 90, volumeUl: 50 },
            { name: "P1", concentration: 50, volumeUl: 50 },
          ],
        }),
      ),
    ).toThrow(/Duplicate/);
  });

  it("never returns a tip to a source once it has contacted a destination", () => {
    // Invariant 1. A tip that has only dispensed non-contact is still clean and
    // may go back to a source; one that has entered a well may not. The water
    // pass depends on that distinction, so it is asserted rather than assumed.
    const r = generateTubeNormalisation(base());
    let dirty = false;
    for (const s of r.steps) {
      if (s.kind === "pick_up_tip") {
        dirty = false;
        continue;
      }
      if (s.kind === "dispense" && s.labwareId === "dest" && s.nonContact !== true) dirty = true;
      if (s.kind === "aspirate" && s.labwareId !== "dest") {
        expect(dirty, `step ${s.index} (${s.label}) re-enters a source with a dirty tip`).toBe(false);
      }
    }
  });

  it("marks every shared-tip dispense as non-contact", () => {
    // If a dispense in the shared water pass ever loses its non-contact flag,
    // the pass stops being safe. Pin it: between one pick-up and the next, a
    // tip that serves more than one destination well must dispense above it.
    const r = generateTubeNormalisation(base());
    let wellsThisTip = new Set<string>();
    let contactDispenses = 0;
    const check = () => {
      if (wellsThisTip.size > 1) expect(contactDispenses).toBe(0);
    };
    for (const s of r.steps) {
      if (s.kind === "pick_up_tip") {
        check();
        wellsThisTip = new Set();
        contactDispenses = 0;
        continue;
      }
      if (s.kind === "dispense" && s.labwareId === "dest") {
        wellsThisTip.add(s.well ?? "");
        if (s.nonContact !== true) contactDispenses += 1;
      }
    }
    check();
  });

  it("uses one pipette per transfer rather than splitting a large one", () => {
    // Splitting would need a second aspirate from the tube with a dirty tip.
    const r = generateTubeNormalisation(
      base({
        samples: [{ name: "Big", concentration: 31, volumeUl: 200 }],
        finalVolumeUl: 120,
      }),
    );
    const aspirates = r.steps.filter((s) => s.kind === "aspirate" && s.labwareId !== "water");
    expect(aspirates).toHaveLength(1);
    expect(aspirates[0].volumeUl).toBeGreaterThan(50);
  });

  it("adds water before the part so one shared tip never contacts a well", () => {
    const r = generateTubeNormalisation(base());
    const firstPart = r.steps.findIndex((s) => s.kind === "aspirate" && s.labwareId?.startsWith("rack"));
    const lastWater = r.steps.map((s) => s.labwareId).lastIndexOf("water");
    expect(lastWater).toBeLessThan(firstPart);
  });

  it("emits steps whose volumes match the plan exactly", () => {
    const r = generateTubeNormalisation(base());
    for (const p of r.plan) {
      const partStep = r.steps.find(
        (s) => s.kind === "aspirate" && s.sample === p.name && s.labwareId?.startsWith("rack"),
      );
      expect(partStep?.volumeUl).toBe(p.partUl);
    }
  });

  it("allocates a deck that never collides with fixtures", () => {
    const r = generateTubeNormalisation(base());
    const slots = r.deckLayout.map((a) => a.slot);
    expect(new Set(slots).size).toBe(slots.length);
  });

  it("works on a bare Flex with no modules", () => {
    const r = generateTubeNormalisation(base({ deck: BARE_FLEX }));
    expect(r.source).toContain("load_trash_bin('A3')");
  });

  it("warns when a part volume falls below the small pipette's minimum", () => {
    const r = generateTubeNormalisation(
      base({ samples: [{ name: "Hot", concentration: 5000, volumeUl: 50 }], finalVolumeUl: 60 }),
    );
    expect(r.warnings.join(" ")).toMatch(/below the 1 uL minimum/);
  });

  it("contains no webhook when none is configured", () => {
    const r = generateTubeNormalisation(base());
    expect(r.source).not.toContain("hooks.slack.com");
    expect(r.source).toContain("def notify(message)");
  });
});

describe("tube positions and plate layout", () => {
  const samples: TubeSample[] = [
    { name: "P1", concentration: 90, volumeUl: 50 },
    { name: "P2", concentration: 60, volumeUl: 50 },
    { name: "T1", concentration: 31, volumeUl: 100 },
  ];

  it("keeps a tube where it was put, and fills the rest into the free positions", () => {
    const r = generateTubeNormalisation(
      base({ samples: [{ ...samples[0], rack: 1, tube: "A1" }, samples[1], { ...samples[2], rack: 2, tube: "C4" }] }),
    );
    const at = Object.fromEntries(r.plan.map((p) => [p.name, `${p.rack}:${p.tube}`]));
    expect(at).toEqual({ P1: "1:A1", P2: "1:B1", T1: "2:C4" });
    expect(r.rackCount).toBe(2);
    expect(r.plan.find((p) => p.name === "P2")?.positionSet).toBe(false);
    expect(r.plan.find((p) => p.name === "T1")?.positionSet).toBe(true);
    // The emitted protocol reads tubes from where they actually are.
    expect(r.source).toContain(`"name": 'T1', "rack": 2, "tube": 'C4'`);
    expect(r.source).toContain("racks[2] = protocol.load_labware");
  });

  it("rejects two tubes in one rack position", () => {
    expect(() =>
      generateTubeNormalisation(
        base({ samples: [{ ...samples[0], rack: 1, tube: "A1" }, { ...samples[1], rack: 1, tube: "a01" }] }),
      ),
    ).toThrow(/claimed by both P1 and P2/);
  });

  it("rejects a position that is not in the rack", () => {
    expect(() => generateTubeNormalisation(base({ samples: [{ ...samples[0], rack: 1, tube: "E1" }] }))).toThrow(
      /not a position/,
    );
  });

  it("puts a part in the well asked for and fills the rest in rack order", () => {
    const r = generateTubeNormalisation(base({ samples: [samples[0], { ...samples[1], well: "A1" }, samples[2]] }));
    const well = Object.fromEntries(r.plan.map((p) => [p.name, p.well]));
    expect(well).toEqual({ P2: "A1", P1: "B1", T1: "C1" });
    expect(r.plan.map((p) => p.name)).toEqual(["P2", "P1", "T1"]);
    expect(r.source).toMatch(/'A1': \{"name": 'P2', "rack": 1, "tube": 'B1'/);
  });

  it("rejects two parts in one well", () => {
    expect(() =>
      generateTubeNormalisation(base({ samples: [{ ...samples[0], well: "H12" }, { ...samples[1], well: "H12" }] })),
    ).toThrow(/assigned to both/);
  });

  it("fills the plate column by column whatever order the wells were given in", () => {
    const r = generateTubeNormalisation(
      base({ samples: [{ ...samples[0], well: "A2" }, { ...samples[1], well: "H1" }, { ...samples[2], well: "A1" }] }),
    );
    const parts = r.steps.filter((s) => s.kind === "dispense" && s.labwareId === "dest" && !s.nonContact);
    expect(parts.map((s) => s.well)).toEqual(["A1", "H1", "A2"]);
  });

  it("writes the plate layout CSV, and the full version lists every well", () => {
    const r = generateTubeNormalisation(
      base({ samples: [...samples, { name: "C4J", concentration: 60, volumeUl: 3600, masterMix: true }] }),
    );
    const lines = r.layoutCsv.trim().split("\n");
    expect(lines[0]).toMatch(/^well,name,/);
    expect(lines.slice(1, 4).map((l) => l.split(",").slice(0, 5).join(","))).toEqual([
      "A1,P1,30,1,A1",
      "B1,P2,30,1,B1",
      "C1,T1,30,1,C1",
    ]);
    expect(lines.at(-1)).toMatch(/^,C4J,.*master_mix$/);
    expect(r.layoutCsvFull.trim().split("\n")).toHaveLength(1 + 96 + 1);
    expect(r.source).toContain("# Output plate layout");
  });
});
