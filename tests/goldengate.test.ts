import { describe, expect, it } from "vitest";

import { STEEL_LAB_FLEX } from "../src/core/deck";
import { checkTipHygiene, checkTipSharing } from "../src/core/invariants";
import { generateGoldenGate } from "../src/generators/goldengate";
import { parseAssemblyLayout } from "../src/parsers/assembly-layout";
import { parsePlateCsv } from "../src/parsers/plate-csv";

const layout = parseAssemblyLayout(
  "Well,Combination_ID,Promoter,CDS,Vector\n" +
    "A1,1,P1,C1,V1\nA2,2,P1,C2,V1\nA3,3,P2,C1,V1\nB1,4,P2,C2,V1\n",
);
const repoPlate = parsePlateCsv("Well,Value\nA1,P1\nA2,P2\nA3,C1\nA4,C2\nA5,V1\n");
const generate = (transferVolumeUl = 1, masterMixParts: string[] = ["Vector"]) =>
  generateGoldenGate({ deck: STEEL_LAB_FLEX, layout, repoPlate, plateType: "opentrons_96_wellplate_200ul_pcr_full_skirt", transferVolumeUl, masterMixParts });

describe("generateGoldenGate", () => {
  it("groups by the accumulated active-part prefix and skips hand-mixed columns", () => {
    const result = generate();
    expect(result.plan.map((p) => [p.column, p.destinations])).toEqual([
      ["Promoter", ["A1", "A2"]], ["Promoter", ["A3", "B1"]],
      ["CDS", ["A1"]], ["CDS", ["A2"]], ["CDS", ["A3"]], ["CDS", ["B1"]],
    ]);
    expect(result.source).toContain("ACTIVE_COLUMNS = ['Promoter', 'CDS']");
    expect(result.source).toContain("protocol.load_module(\"thermocyclerModuleV2\", 'B1')");
  });

  it("shares tips for identical prefixes and uses exact singleton transfers", () => {
    const result = generate();
    expect(result.tipsUsed).toBe(7); // one master-mix tip, two promoter batches and four CDS singletons.
    expect(checkTipHygiene(result.steps)).toEqual([]);
    expect(checkTipSharing(result.steps.filter((s) => s.labwareId === "assembly"), () => "identical-before-each-fresh-tip")).toEqual([]);
    expect(result.steps.filter((s) => s.kind === "blow_out" && s.labwareId === "assembly")).toHaveLength(6);
  });

  it("bulk aspirates exact totals without returning a dirty tip to the repo plate", () => {
    const result = generate(5);
    expect(checkTipHygiene(result.steps)).toEqual([]);
    expect(result.steps.filter((s) => s.kind === "pick_up_tip").length).toBe(result.tipsUsed);
    expect(result.source).toContain("pipette.aspirate(dispensed, repo_plate[source_well].bottom(1))");
  });

  it.each([1, 2.5, 5, 50])("uses batch size rather than a volume threshold at %s uL", (volume) => {
    const result = generate(volume);
    expect(checkTipHygiene(result.steps)).toEqual([]);
    const repoAspirates = result.steps.filter((s) => s.kind === "aspirate" && s.labwareId === "repository" && !s.label.startsWith("Pre-wet"));
    expect(repoAspirates.map((s) => s.volumeUl)).toEqual(result.plan.map((b) => b.destinations.length * volume));
    expect(repoAspirates.every((s) => s.volumeUl! <= 50)).toBe(true);
    expect(result.steps.filter((s) => s.kind === "blow_out" && s.labwareId === "assembly").map((s) => s.well))
      .toEqual(result.plan.map((b) => b.destinations.at(-1)));
    expect(result.source).toContain("if len(batch) == 1:");
    expect(result.source).toContain("pipette.blow_out(assembly_plate[batch[-1]].bottom(1))");
  });

  it("keeps the lab's standard deck: repo at C1, master mix at B3, tips from A2", () => {
    const { deckLayout } = generate();
    const slotOf = (id: string) => deckLayout.find((a) => a.id === id)?.slot;
    expect(slotOf("repository")).toBe("C1");
    expect(slotOf("master-mix")).toBe("B3");
    expect(slotOf("tips")).toBe("A2");
  });

  it("shows the thermocycler spanning both its slots, with the plate on it", () => {
    const { deckLayout } = generate();
    const b1 = deckLayout.filter((a) => a.slot === "B1");
    // One entry at B1: the assembly plate standing in for the module's slot,
    // still grouped and coloured as the thermocycler.
    expect(b1).toHaveLength(1);
    expect(b1[0]).toMatchObject({ id: "assembly", kind: "module", group: "fixture:thermocycler" });
    expect(b1[0].label).toMatch(/thermocycler/i);
    expect(deckLayout.find((a) => a.slot === "A1")?.group).toBe("fixture:thermocycler");
  });

  it("serves the whole master-mix pass from one tip, as the reference run did", () => {
    // 8 wells at 7 uL is two reverse-pipetted batches of the 50 uL pipette.
    const bigLayout = parseAssemblyLayout(
      "Well,Combination_ID,Promoter,Vector\n" +
        ["A1", "A2", "A3", "A4", "B1", "B2", "B3", "B4"].map((w, i) => `${w},${i + 1},P1,V1`).join("\n"),
    );
    const result = generateGoldenGate({
      deck: STEEL_LAB_FLEX, layout: bigLayout, repoPlate, plateType: "opentrons_96_wellplate_200ul_pcr_full_skirt",
      masterMixParts: ["Vector"],
    });
    const mmTips = result.steps.filter((s) => s.kind === "pick_up_tip" && s.label.includes("master mix"));
    expect(mmTips).toHaveLength(1);
    // Two batches, each blowing its excess back into the tube before the next.
    expect(result.steps.filter((s) => s.kind === "blow_out" && s.labwareId === "master-mix")).toHaveLength(2);
    const mmDispenses = result.steps.filter((s) => s.kind === "dispense" && s.labwareId === "assembly" && s.label.includes("master mix"));
    expect(mmDispenses).toHaveLength(8);
    expect(mmDispenses.every((s) => s.intoEmpty)).toBe(true);
    expect(checkTipHygiene(result.steps)).toEqual([]);
    // One master-mix tip plus one shared promoter tip.
    expect(result.tipsUsed).toBe(2);
    const py = result.source;
    expect(py.match(/pipette\.pick_up_tip\(\)/g)!.length).toBeGreaterThan(0);
    // The MM loop neither picks up nor drops inside itself.
    const mmSection = py.slice(py.indexOf("master-mix pass"), py.indexOf("for col_idx"));
    expect(mmSection.match(/pick_up_tip/g)!.length).toBe(1);
    expect(mmSection.match(/drop_tip/g)!.length).toBe(1);
  });

  it("rejects missing parts and decks without a usable thermocycler", () => {
    expect(() => generateGoldenGate({ deck: STEEL_LAB_FLEX, layout, repoPlate: parsePlateCsv("Well,Value\nA1,P1\n"), plateType: "opentrons_96_wellplate_200ul_pcr_full_skirt" })).toThrow(/missing from repository/i);
    expect(() => generateGoldenGate({ deck: { ...STEEL_LAB_FLEX, fixtures: [] }, layout, repoPlate, plateType: "opentrons_96_wellplate_200ul_pcr_full_skirt" })).toThrow(/no thermocycler/i);
  });

  it("builds on a deck slot and skips the thermocycler when cycling elsewhere", () => {
    const result = generateGoldenGate({
      deck: STEEL_LAB_FLEX, layout, repoPlate, plateType: "opentrons_96_wellplate_200ul_pcr_full_skirt",
      masterMixParts: ["Vector"], thermocycler: "external",
    });
    const assembly = result.deckLayout.find((a) => a.id === "assembly")!;
    expect(assembly.group).toBeNull();
    expect(STEEL_LAB_FLEX.fixtures.flatMap((f) => f.slots)).not.toContain(assembly.slot);
    expect(result.source).not.toContain("tc_mod");
    expect(result.source).toContain(`assembly_plate = protocol.load_labware('opentrons_96_wellplate_200ul_pcr_full_skirt', '${assembly.slot}')`);
    expect(result.source).toContain("run it on your thermocycler");
    expect(checkTipHygiene(result.steps)).toEqual([]);
  });

  it("builds on the heater block when asked, holding it at the profile's hold temperature", () => {
    const result = generateGoldenGate({
      deck: STEEL_LAB_FLEX, layout, repoPlate, plateType: "opentrons_96_wellplate_200ul_pcr_full_skirt",
      masterMixParts: ["Vector"], thermocycler: "external", assemblyOn: "heater-block",
    });
    const d1 = result.deckLayout.filter((a) => a.slot === "D1");
    expect(d1).toHaveLength(1);
    expect(d1[0]).toMatchObject({ id: "assembly", kind: "module", group: "fixture:temperature_module" });
    expect(d1[0].label).toMatch(/heater block/i);
    expect(result.source).toContain('heat_mod = protocol.load_module(module_name="temperatureModuleV2", location=\'D1\')');
    expect(result.source).toContain("assembly_plate = heat_mod.load_labware(");
    expect(result.source).toContain("heat_mod.set_temperature(4)");
    expect(result.source).not.toContain("tc_mod");
    // Every assembly dispense lands on the heater block's slot.
    expect(result.steps.filter((s) => s.kind === "dispense" && s.labwareId === "assembly").every((s) => s.slot === "D1")).toBe(true);
    expect(checkTipHygiene(result.steps)).toEqual([]);
  });

  it("refuses the heater block when cycling onboard, or when the deck has none", () => {
    expect(() =>
      generateGoldenGate({ deck: STEEL_LAB_FLEX, layout, repoPlate, plateType: "opentrons_96_wellplate_200ul_pcr_full_skirt", assemblyOn: "heater-block" }),
    ).toThrow(/onboard/i);
    expect(() =>
      generateGoldenGate({
        deck: { ...STEEL_LAB_FLEX, fixtures: STEEL_LAB_FLEX.fixtures.filter((f) => f.kind !== "temperature_module") },
        layout, repoPlate, plateType: "opentrons_96_wellplate_200ul_pcr_full_skirt",
        thermocycler: "external", assemblyOn: "heater-block",
      }),
    ).toThrow(/no heater block/i);
  });

  it("works on a deck with no thermocycler at all when cycling elsewhere", () => {
    const result = generateGoldenGate({
      deck: { ...STEEL_LAB_FLEX, fixtures: [{ slots: ["A3"], kind: "trash", label: "Trash" }] },
      layout, repoPlate, plateType: "opentrons_96_wellplate_200ul_pcr_full_skirt", thermocycler: "external",
    });
    expect(result.deckLayout.some((a) => a.id === "assembly")).toBe(true);
  });
});
