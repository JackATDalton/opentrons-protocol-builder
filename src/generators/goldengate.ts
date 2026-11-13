/** Combinatorial Golden Gate assembly with prefix-safe tip sharing. */
import {
  allocateDeck,
  findFixture,
  slotFor,
  slotsFor,
  trashSlot,
  type DeckConfig,
  type DeckSlotAssignment,
  type LabwareRequest,
} from "../core/deck";
import { finalise, preamble, py, runFunction, type NotifyConfig } from "../core/emit";
import {
  DISPENSE_X_OFFSET_MM,
  P50,
  RETURN_BLOWOUT_BOTTOM_MM,
  SMALL_BLOWOUT_BOTTOM_MM,
  SLOW_DISPENSE_RATE,
  tipRacksFor,
  ASPIRATE_BOTTOM_MM,
  reverseBatchSize,
  reverseExcessUl,
} from "../core/pipetting";
import { StepRecorder, type ProtocolStep } from "../core/steps";
import { assertWellsExist, shapeFor, sortRowMajor } from "../core/wells";
import { basePartName, buildPartIndex, type AssemblyLayout } from "../parsers/assembly-layout";
import type { PlateMap } from "../parsers/plate-csv";
import { LABWARE } from "../core/labware";

const MM_RACK = LABWARE.tubeRack;
const SMALL_TIPRACK = LABWARE.tips50;

/**
 * The lab's standard Golden Gate deck, as the original builder laid it out:
 * repository plate at C1 beside the thermocycler, master mix at B3 by the
 * trash, tips filling the middle. Preferred, not required — on a deck where
 * one of these is taken the allocator falls back, and the user can still
 * drag labware elsewhere.
 */
export const GOLDENGATE_DEFAULT_SLOTS = {
  repository: ["C1"],
  masterMix: ["B3"],
  tips: ["A2", "B2", "C2", "C3", "D2", "D3"],
};

export interface ThermocyclerProfile {
  cutTemp: number;
  cutTimeMin: number;
  ligTemp: number;
  ligTimeMin: number;
  cycles: number;
  lidTemp: number;
  inactivationTemp: number;
  inactivationTimeMin: number;
  holdTemp: number;
}

export const DEFAULT_GOLDENGATE_PROFILE: ThermocyclerProfile = {
  cutTemp: 37, cutTimeMin: 1, ligTemp: 16, ligTimeMin: 1, cycles: 50,
  lidTemp: 105, inactivationTemp: 60, inactivationTimeMin: 5, holdTemp: 4,
};

export interface GoldenGateOptions {
  deck: DeckConfig;
  layout: AssemblyLayout;
  repoPlate: PlateMap;
  plateType: string;
  enzymeVolumePerWellUl?: number;
  mmTubeWell?: string;
  transferVolumeUl?: number;
  prewetVolumeUl?: number;
  masterMixParts?: string[];
  profile?: ThermocyclerProfile;
  /**
   * Where the plate is cycled. `onboard` (default) builds the assembly on the
   * Flex thermocycler and runs the profile there. `external` builds it on an
   * ordinary deck slot and stops, so the plate can go to another machine.
   */
  thermocycler?: "onboard" | "external";
  /**
   * With `thermocycler: "external"`, where the plate is built: an ordinary
   * deck slot at room temperature, or the deck's temperature module
   * ("heater-block"), which holds the plate at the profile's hold
   * temperature while the robot pipettes — the thermocycler's cold block
   * stood in for this in the onboard mode.
   */
  assemblyOn?: "deck" | "heater-block";
  protocolName?: string;
  description?: string;
  author?: string;
  notify?: NotifyConfig;
}

export interface GoldenGatePartBatch {
  column: string;
  part: string;
  sourceWell: string;
  destinations: string[];
}

export interface GoldenGateResult {
  source: string;
  /** The profile to run, whichever machine runs it. */
  profile: ThermocyclerProfile;
  thermocycler: "onboard" | "external";
  assemblyOn: "deck" | "heater-block";
  plan: GoldenGatePartBatch[];
  deckLayout: DeckSlotAssignment[];
  steps: ProtocolStep[];
  warnings: string[];
  tipsUsed: number;
}

function finitePositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be a positive number.`);
}

export function generateGoldenGate(options: GoldenGateOptions): GoldenGateResult {
  const {
    deck, layout, repoPlate, plateType,
    enzymeVolumePerWellUl = 7, mmTubeWell = "B2", transferVolumeUl = 1,
    prewetVolumeUl = 5, masterMixParts = [], profile = DEFAULT_GOLDENGATE_PROFILE, thermocycler = "onboard", assemblyOn = "deck",
    protocolName = "Golden Gate Assembly", description = "Combinatorial Golden Gate assembly",
    author = "", notify = {},
  } = options;
  if (!layout.rows.length) throw new Error("Assembly layout has no wells.");
  if (layout.partColumns.length === 0) throw new Error("Assembly layout has no part columns.");
  finitePositive(enzymeVolumePerWellUl, "Enzyme master mix volume");
  finitePositive(transferVolumeUl, "Part transfer volume");
  finitePositive(prewetVolumeUl, "Pre-wet volume");
  assertWellsExist([mmTubeWell], shapeFor(MM_RACK), "Master mix tube rack");
  if (enzymeVolumePerWellUl > P50.maxUl) throw new Error(`Enzyme master mix volume must not exceed ${P50.maxUl} uL.`);
  if (transferVolumeUl > P50.maxUl) throw new Error(`Part transfer volume must not exceed ${P50.maxUl} uL.`);
  if (prewetVolumeUl > P50.maxUl) throw new Error(`Pre-wet volume must not exceed ${P50.maxUl} uL.`);
  if (!Number.isInteger(profile.cycles) || profile.cycles < 1) throw new Error("Thermocycler cycles must be a positive whole number.");
  for (const key of ["cutTemp", "ligTemp", "lidTemp", "inactivationTemp", "holdTemp"] as const) {
    if (!Number.isFinite(profile[key])) throw new Error(`Thermocycler ${key} must be a finite temperature.`);
  }
  for (const key of ["cutTimeMin", "ligTimeMin", "inactivationTimeMin"] as const) {
    finitePositive(profile[key], `Thermocycler ${key}`);
  }
  const onboard = thermocycler === "onboard";
  if (onboard && !findFixture(deck, "thermocycler")?.usableByProtocol) {
    throw new Error(
      `Deck "${deck.name}" has no thermocycler the protocol can use. Choose "another thermocycler" to build the ` +
        `plate on the deck and cycle it elsewhere.`,
    );
  }
  const onHeater = assemblyOn === "heater-block";
  const heaterFixture = findFixture(deck, "temperature_module");
  if (onHeater && onboard) {
    throw new Error("The heater block only holds the plate when cycling on another thermocycler — onboard, the thermocycler itself does.");
  }
  if (onHeater && !heaterFixture?.usableByProtocol) {
    throw new Error(`Deck "${deck.name}" has no heater block the protocol can use. Build the plate on a deck slot instead.`);
  }

  const wells = sortRowMajor(new Set(layout.rows.map((r) => r.well)));
  if (wells.length !== layout.rows.length) throw new Error("Assembly layout contains duplicate well names.");
  assertWellsExist(wells, shapeFor(plateType), "Assembly plate");
  const rows = new Map(layout.rows.map((r) => [r.well, r]));
  const orderedRows = wells.map((well) => rows.get(well)!);
  const master = new Set(masterMixParts);
  const unknownMaster = masterMixParts.filter((part) => !layout.partColumns.includes(part));
  if (unknownMaster.length) throw new Error(`Master-mix columns not found in layout: ${unknownMaster.join(", ")}.`);
  const activeColumns = layout.partColumns.filter((column) => !master.has(column));
  const repoIndex = buildPartIndex(repoPlate);
  const missing = new Set<string>();
  for (const row of orderedRows) for (const column of activeColumns) {
    const part = row.parts[column];
    if (part && !repoIndex[basePartName(part)]) missing.add(part);
  }
  if (missing.size) throw new Error(`Parts missing from repository plate: ${[...missing].join(", ")}.`);

  const mmBatchSize = reverseBatchSize(P50.maxUl, enzymeVolumePerWellUl);
  const partBatchMax = Math.floor(P50.maxUl / transferVolumeUl);
  const plan: GoldenGatePartBatch[] = [];
  activeColumns.forEach((column, index) => {
    const groups = new Map<string, { part: string; wells: string[] }>();
    const prefix = activeColumns.slice(0, index + 1);
    for (const row of orderedRows) {
      const part = row.parts[column] ?? "";
      if (!part) continue;
      const key = JSON.stringify(prefix.map((c) => row.parts[c] ?? ""));
      const group = groups.get(key) ?? { part, wells: [] };
      group.wells.push(row.well);
      groups.set(key, group);
    }
    for (const { part, wells: groupWells } of groups.values()) {
      const sourceWell = repoIndex[basePartName(part)];
      for (let i = 0; i < groupWells.length; i += partBatchMax) {
        plan.push({ column, part, sourceWell, destinations: groupWells.slice(i, i + partBatchMax) });
      }
    }
  });
  const partTips = plan.length;
  // One tip covers the whole master-mix pass; see the step comments below.
  const tipsUsed = partTips + 1;
  const tipCount = tipRacksFor(tipsUsed);

  const requests: LabwareRequest[] = [
    { id: "repository", loadName: plateType, label: "Repository plate", kind: "plate", preferredSlots: GOLDENGATE_DEFAULT_SLOTS.repository },
    { id: "master-mix", loadName: MM_RACK, label: "Master mix tube rack", kind: "tuberack", preferredSlots: GOLDENGATE_DEFAULT_SLOTS.masterMix },
    { id: "tips", loadName: SMALL_TIPRACK, label: "50 uL tips", kind: "tips", count: tipCount, preferredSlots: GOLDENGATE_DEFAULT_SLOTS.tips },
  ];
  // Off the robot, the assembly plate is ordinary labware on a free slot —
  // unless it goes on the heater block, which is a fixture, not a request.
  if (!onboard && !onHeater) requests.unshift({ id: "assembly", loadName: plateType, label: "Assembly plate", kind: "plate" });
  const deckLayout = allocateDeck(deck, requests);
  const tcFixture = onboard ? findFixture(deck, "thermocycler")! : undefined;
  const thermocyclerLocation = tcFixture ? tcFixture.slots[1] ?? tcFixture.slots[0] : "";
  if (tcFixture) {
    // The assembly plate sits on the thermocycler, which spans two slots.
    // Replace the module's own entry for that slot rather than stacking a
    // second label on it, and keep the module kind so the deck still shows
    // the thermocycler occupying both A1 and B1, as every other protocol does.
    const entry: DeckSlotAssignment = {
      slot: thermocyclerLocation,
      id: "assembly",
      loadName: plateType,
      label: "Thermocycler — assembly plate",
      kind: "module",
      group: `fixture:${tcFixture.kind}`,
    };
    const onModule = deckLayout.findIndex(
      (a) => a.slot === thermocyclerLocation && a.group === `fixture:${tcFixture.kind}`,
    );
    if (onModule >= 0) deckLayout.splice(onModule, 1, entry);
    else deckLayout.push(entry);
  }
  const heaterSlot = onHeater ? heaterFixture!.slots[0] : "";
  if (onHeater) {
    // Same treatment as the thermocycler: the plate stands in for the
    // module's own entry, keeping the heater block's footprint visible.
    const entry: DeckSlotAssignment = {
      slot: heaterSlot,
      id: "assembly",
      loadName: plateType,
      label: "Heater block — assembly plate",
      kind: "module",
      group: `fixture:${heaterFixture!.kind}`,
    };
    const onModule = deckLayout.findIndex((a) => a.slot === heaterSlot);
    if (onModule >= 0) deckLayout.splice(onModule, 1, entry);
    else deckLayout.push(entry);
  }
  const assemblySlot = slotFor(deckLayout, "assembly");
  const repoSlot = slotFor(deckLayout, "repository");
  const mmSlot = slotFor(deckLayout, "master-mix");
  const tipSlots = slotsFor(deckLayout, "tips");
  const warnings: string[] = [];
  const totalReaction = enzymeVolumePerWellUl + activeColumns.length * transferVolumeUl;
  if (totalReaction > 150) throw new Error(`Reaction volume ${totalReaction} uL exceeds the 150 uL working capacity of the PCR plate.`);

  const rec = new StepRecorder();
  const add = (step: Omit<ProtocolStep, "index" | "tipId">) => rec.add(step);
  // One tip serves the whole master-mix pass, as in the run that worked: the
  // mix is the first liquid into every (empty) well, so the tip stays clean
  // and may return to the tube for the next batch. The dispenses carry
  // `intoEmpty`, and the hygiene check rejects that claim on any well that
  // already received liquid.
  add({ kind: "pick_up_tip", slot: tipSlots[0], labwareId: "tips", labwareLabel: "50 uL tips", label: "Pick up tip for enzyme master mix" });
  add({ kind: "aspirate", slot: mmSlot, labwareId: "master-mix", labwareLabel: "Master mix tube rack", well: mmTubeWell, volumeUl: prewetVolumeUl, label: `Pre-wet in ${mmTubeWell}` });
  add({ kind: "dispense", slot: mmSlot, labwareId: "master-mix", labwareLabel: "Master mix tube rack", well: mmTubeWell, volumeUl: prewetVolumeUl, label: `Return pre-wet to ${mmTubeWell}` });
  for (let start = 0; start < orderedRows.length; start += mmBatchSize) {
    const batch = orderedRows.slice(start, start + mmBatchSize);
    const excess = reverseExcessUl(batch.length * enzymeVolumePerWellUl);
    add({ kind: "aspirate", slot: mmSlot, labwareId: "master-mix", labwareLabel: "Master mix tube rack", well: mmTubeWell, volumeUl: batch.length * enzymeVolumePerWellUl + excess, label: `Aspirate master mix for ${batch.length} wells plus ${excess} uL excess` });
    for (const row of batch) add({ kind: "dispense", slot: assemblySlot, labwareId: "assembly", labwareLabel: "Assembly plate", well: row.well, volumeUl: enzymeVolumePerWellUl, label: `Add master mix to ${row.well}`, sample: row.well, intoEmpty: true, note: "First liquid into an empty well, so the shared tip stays clean." });
    add({ kind: "blow_out", slot: mmSlot, labwareId: "master-mix", labwareLabel: "Master mix tube rack", well: mmTubeWell, volumeUl: excess, label: "Return master-mix excess", note: `Return at bottom(${RETURN_BLOWOUT_BOTTOM_MM}).` });
  }
  add({ kind: "drop_tip", label: "Discard master-mix tip" });
  for (const batch of plan) {
    const destLabel = `${batch.column}: ${batch.part}`;
    const destinations = [batch.destinations];
    for (const wellsInBatch of destinations) {
      const firstWell = wellsInBatch[0];
      add({ kind: "pick_up_tip", slot: tipSlots[0], labwareId: "tips", labwareLabel: "50 uL tips", label: `Pick up fresh tip for ${destLabel} → ${firstWell}`, sample: firstWell });
      if (wellsInBatch.length === 1) {
        add({ kind: "aspirate", slot: repoSlot, labwareId: "repository", labwareLabel: "Repository plate", well: batch.sourceWell, volumeUl: transferVolumeUl, label: `Aspirate ${batch.part}`, sample: firstWell });
        add({ kind: "dispense", slot: assemblySlot, labwareId: "assembly", labwareLabel: "Assembly plate", well: firstWell, volumeUl: transferVolumeUl, label: `Add ${batch.part} to ${firstWell}`, sample: firstWell });
        add({ kind: "blow_out", slot: assemblySlot, labwareId: "assembly", labwareLabel: "Assembly plate", well: firstWell, label: `Blow out at bottom(${SMALL_BLOWOUT_BOTTOM_MM})`, sample: firstWell });
      } else {
        if (prewetVolumeUl) {
          add({ kind: "aspirate", slot: repoSlot, labwareId: "repository", labwareLabel: "Repository plate", well: batch.sourceWell, volumeUl: prewetVolumeUl, label: `Pre-wet ${batch.part}`, sample: firstWell });
          add({ kind: "dispense", slot: repoSlot, labwareId: "repository", labwareLabel: "Repository plate", well: batch.sourceWell, volumeUl: prewetVolumeUl, label: `Return pre-wet ${batch.part}`, sample: firstWell });
        }
        const volume = wellsInBatch.length * transferVolumeUl;
        add({ kind: "aspirate", slot: repoSlot, labwareId: "repository", labwareLabel: "Repository plate", well: batch.sourceWell, volumeUl: volume, label: `Aspirate ${batch.part} for ${wellsInBatch.length} wells`, sample: firstWell });
        wellsInBatch.forEach((well) => add({ kind: "dispense", slot: assemblySlot, labwareId: "assembly", labwareLabel: "Assembly plate", well, volumeUl: transferVolumeUl, label: `Add ${batch.part} to ${well}`, sample: well }));
        const lastWell = wellsInBatch[wellsInBatch.length - 1];
        add({ kind: "blow_out", slot: assemblySlot, labwareId: "assembly", labwareLabel: "Assembly plate", well: lastWell, label: `Final-well blow-out at bottom(${SMALL_BLOWOUT_BOTTOM_MM})`, sample: lastWell });
      }
      add({ kind: "drop_tip", label: `Discard ${destLabel} tip after ${wellsInBatch.length} well(s)`, sample: firstWell });
    }
  }
  const program = `${profile.cycles} cycles: ${profile.cutTemp} °C ${profile.cutTimeMin} min, ${profile.ligTemp} °C ${profile.ligTimeMin} min; inactivate at ${profile.inactivationTemp} °C for ${profile.inactivationTimeMin} min, hold at ${profile.holdTemp} °C.`;
  if (onboard) {
    rec.comment("Pause for plate sealing", "Evaporation reduced yield in an unsealed 96-well run; seal before thermocycling.");
    rec.comment("Thermocycle", program);
  } else {
    rec.comment("Assembly done: seal the plate and take it to your thermocycler", program);
  }
  const steps = rec.all();

  const planLiteral = py(orderedRows.map((r) => ({ well: r.well, combination_id: r.combinationId, parts: r.parts })));
  const repoLiteral = py(Object.fromEntries(Object.entries(repoIndex)));
  const rackLoads = tipSlots.map((slot, i) => `    tips_${i} = protocol.load_labware(${py(SMALL_TIPRACK)}, ${py(slot)})`).join("\n");
  const rackNames = tipSlots.map((_, i) => `tips_${i}`).join(", ");
  const body = `
    repo_plate = protocol.load_labware(${py(plateType)}, ${py(repoSlot)})
${onboard
    ? `    tc_mod = protocol.load_module("thermocyclerModuleV2", ${py(thermocyclerLocation)})
    assembly_plate = tc_mod.load_labware(${py(plateType)})`
    : onHeater
      ? `    # Cycled on another thermocycler; the heater block stands in for the
    # thermocycler's cold block, holding the plate while the robot pipettes.
    heat_mod = protocol.load_module(module_name="temperatureModuleV2", location=${py(heaterSlot)})
    assembly_plate = heat_mod.load_labware(${py(plateType)})`
      : `    # Cycled on another thermocycler, so the plate sits on an ordinary slot.
    assembly_plate = protocol.load_labware(${py(plateType)}, ${py(assemblySlot)})`}
    mm_tuberack = protocol.load_labware(${py(MM_RACK)}, ${py(mmSlot)})
    enzyme_tube = mm_tuberack[MM_TUBE_WELL]
${rackLoads}
    protocol.load_trash_bin(${py(trashSlot(deck))})
    pipette = protocol.load_instrument(${py(P50.name)}, mount=${py(P50.mount)}, tip_racks=[${rackNames}])
    pipette.default_speed = 500
${onboard ? `    tc_mod.open_lid()
    tc_mod.set_block_temperature(${profile.holdTemp})
` : onHeater ? `    heat_mod.set_temperature(${profile.holdTemp})
` : ""}    notify(f"Golden Gate assembly started - {len(ASSEMBLY_ROWS)} wells, {len(ACTIVE_COLUMNS)} pipetted part types")
    # One tip serves the whole master-mix pass: the mix is the first liquid
    # into every (empty) well, so the tip stays clean and may return to the
    # tube. Each batch is reverse-pipetted; the real excess returns at
    # bottom(${RETURN_BLOWOUT_BOTTOM_MM}) before the next aspirate.
    pipette.pick_up_tip()
    pipette.aspirate(PREWET_VOLUME_UL, enzyme_tube.bottom(${ASPIRATE_BOTTOM_MM}))
    pipette.dispense(PREWET_VOLUME_UL, enzyme_tube.bottom(${ASPIRATE_BOTTOM_MM}))
    for start in range(0, len(ASSEMBLY_ROWS), MM_BATCH_SIZE):
        batch = ASSEMBLY_ROWS[start:start + MM_BATCH_SIZE]
        dispensed = len(batch) * ENZYME_VOLUME_PER_WELL_UL
        excess = max(5, round(dispensed * 0.15, 1))
        pipette.aspirate(dispensed + excess, enzyme_tube.bottom(${ASPIRATE_BOTTOM_MM}))
        for entry in batch:
            pipette.dispense(ENZYME_VOLUME_PER_WELL_UL, assembly_plate[entry["well"]].bottom(0.5).move(types.Point(x=${DISPENSE_X_OFFSET_MM}, y=0, z=0)), rate=${SLOW_DISPENSE_RATE})
        pipette.blow_out(enzyme_tube.bottom(${RETURN_BLOWOUT_BOTTOM_MM}))
    pipette.drop_tip()
    for col_idx, column in enumerate(ACTIVE_COLUMNS):
        groups = {}
        for entry in ASSEMBLY_ROWS:
            part = entry["parts"].get(column, "")
            if not part:
                continue
            key = tuple(entry["parts"].get(pc, "") for pc in ACTIVE_COLUMNS[:col_idx + 1])
            groups.setdefault(key, []).append(entry["well"])
        for key, destinations in groups.items():
            part = key[-1]
            source_well = get_part_well(part)
            for start in range(0, len(destinations), PART_BATCH_SIZE):
                batch = destinations[start:start + PART_BATCH_SIZE]
                if len(batch) == 1:
                    for dest in batch:
                        pipette.pick_up_tip()
                        pipette.aspirate(TRANSFER_VOLUME_UL, repo_plate[source_well].bottom(${ASPIRATE_BOTTOM_MM}))
                        pipette.dispense(TRANSFER_VOLUME_UL, assembly_plate[dest].bottom(0.5).move(types.Point(x=${DISPENSE_X_OFFSET_MM}, y=0, z=0)), rate=${SLOW_DISPENSE_RATE})
                        pipette.blow_out(assembly_plate[dest].bottom(${SMALL_BLOWOUT_BOTTOM_MM}))
                        pipette.drop_tip()
                else:
                    pipette.pick_up_tip()
                    if PREWET_VOLUME_UL:
                        pipette.aspirate(PREWET_VOLUME_UL, repo_plate[source_well].bottom(${ASPIRATE_BOTTOM_MM}))
                        pipette.dispense(PREWET_VOLUME_UL, repo_plate[source_well].bottom(${ASPIRATE_BOTTOM_MM}))
                    dispensed = len(batch) * TRANSFER_VOLUME_UL
                    # 2026-11-12: exact batch total, then final-well blow-out (bench validation pending).
                    pipette.aspirate(dispensed, repo_plate[source_well].bottom(${ASPIRATE_BOTTOM_MM}))
                    for dest in batch:
                        pipette.dispense(TRANSFER_VOLUME_UL, assembly_plate[dest].bottom(0.5).move(types.Point(x=${DISPENSE_X_OFFSET_MM}, y=0, z=0)), rate=${SLOW_DISPENSE_RATE})
                    pipette.blow_out(assembly_plate[batch[-1]].bottom(${SMALL_BLOWOUT_BOTTOM_MM}))
                    pipette.drop_tip()
${onboard ? `    notify("Assembly complete. Seal the plate before starting thermocycling.")
    protocol.pause("Seal the assembly plate with a heat-compatible seal. Confirm it is fully seated, then resume to start thermocycling.")
    tc_mod.close_lid()
    tc_mod.set_lid_temperature(${profile.lidTemp})
    tc_mod.execute_profile(steps=[{"temperature": ${profile.cutTemp}, "hold_time_minutes": ${profile.cutTimeMin}}, {"temperature": ${profile.ligTemp}, "hold_time_minutes": ${profile.ligTimeMin}}], repetitions=${profile.cycles}, block_max_volume=${Math.max(10, Math.ceil(totalReaction))})
    tc_mod.set_block_temperature(${profile.inactivationTemp}, hold_time_minutes=${profile.inactivationTimeMin})
    tc_mod.set_block_temperature(${profile.holdTemp})
    notify("Golden Gate assembly complete. Retrieve the plate from the thermocycler.")
` : `    program = ${py(program.replace(/°C/g, "C"))}
    protocol.comment("Assembly complete. Seal the plate and run it on your thermocycler: " + program)
    notify("Golden Gate plate assembled. Seal it and move it to your thermocycler: " + program)
${onHeater ? `    protocol.comment("The heater block keeps holding at ${profile.holdTemp} C until you collect the plate.")
` : ""}`}`;
  const constants = `\nACTIVE_COLUMNS = ${py(activeColumns)}\nTRANSFER_VOLUME_UL = ${py(transferVolumeUl)}\nPREWET_VOLUME_UL = ${py(prewetVolumeUl)}\nENZYME_VOLUME_PER_WELL_UL = ${py(enzymeVolumePerWellUl)}\nMM_BATCH_SIZE = ${py(mmBatchSize)}\nPART_BATCH_SIZE = ${py(partBatchMax)}\nMM_TUBE_WELL = ${py(mmTubeWell)}\nASSEMBLY_ROWS = ${planLiteral}\nREPO_INDEX = ${repoLiteral}\ndef get_part_well(name):\n    return REPO_INDEX.get(name.split(":")[0].strip().lower())\n`;
  const source = finalise(preamble({ protocolName, description, author, apiLevel: "2.25" }, notify, ["from opentrons import types"]) + constants + runFunction(body.replace(/^    /gm, ""), "Golden Gate") + "\n");
  return { source, profile, thermocycler, assemblyOn, plan, deckLayout, steps, warnings, tipsUsed };
}
