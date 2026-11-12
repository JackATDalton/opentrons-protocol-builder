/**
 * Normalise parts from 1.5 mL Eppendorf tubes into a 96-well PCR plate.
 *
 * The lab's Golden Gate source plate starts life as a box of Eppendorfs at
 * whatever concentration the minipreps came off at. This takes that box and
 * produces one plate where every well is at the same concentration, so the
 * assembly protocol can pipette a fixed volume of every part.
 *
 * Three things here are deliberate and should not be "simplified":
 *
 * 1. **The tube-to-well mapping is materialised, not zipped.** Tube racks are
 *    4x6 and the plate is 8x12, so the two sides cannot be matched by well
 *    name. Rather than pairing two orderings by index — the exact shape of the
 *    bug behind invariant 3 — every assignment is written into the emitted
 *    `PLAN` by name, and the loading map the user fills tubes from is printed
 *    from that same structure.
 *
 * 2. **Water goes in first, with a non-contact dispense.** A single tip serves
 *    the whole water pass, which is only safe because the tip dispenses above
 *    the well and never touches it (invariant 1). Water first also means the
 *    per-sample tip can mix on arrival without a second tip.
 *
 * 3. **A transfer larger than the small pipette's capacity uses the large
 *    pipette, never two aspirates.** Splitting would mean returning to the
 *    tube with a tip that had already touched the destination — invariant 1
 *    again. Parts only slightly above target need nearly the full well volume,
 *    so this case is normal here, not an edge case.
 */
import {
  allocateDeck,
  slotFor,
  slotsFor,
  trashSlot,
  type DeckConfig,
  type DeckSlotAssignment,
  type LabwareRequest,
} from "../core/deck";
import { finalise, indent, preamble, py, runFunction, type NotifyConfig } from "../core/emit";
import { StepRecorder, type ProtocolStep } from "../core/steps";
import { columnMajor, shapeFor, wellCount } from "../core/wells";

const TUBE_RACK = "jd_24_tuberack_1.5ml";
const DEST_PLATE = "opentrons_96_wellplate_200ul_pcr_full_skirt";
const SMALL = { name: "flex_1channel_50", tiprack: "opentrons_flex_96_tiprack_50ul", mount: "left", min: 1, max: 50 } as const;
const LARGE = { name: "flex_1channel_1000", tiprack: "opentrons_flex_96_tiprack_1000ul", mount: "right", min: 5, max: 1000 } as const;
const TIPS_PER_RACK = 96;

/** The lab treats 150 uL as the working maximum on a 200 uL PCR plate. */
export const DEFAULT_MAX_WELL_UL = 150;

export interface TubeSample {
  /** Part name, e.g. "P10d". Becomes the well label. */
  name: string;
  /** Measured concentration, ng/uL. */
  concentration: number;
  /** Volume in the tube, uL. */
  volumeUl: number;
  /**
   * Premixed into the Golden Gate master mix by hand rather than pipetted from
   * the source plate (the CDS and the vector). Excluded from the plate, and
   * reported so the exclusion is visible rather than silent.
   */
  masterMix?: boolean;
}

export interface TubeNormalisationOptions {
  deck: DeckConfig;
  samples: TubeSample[];
  /** Concentration every well should end up at, ng/uL. */
  targetConcentration: number;
  /** Volume each well should end up at, uL, before any mass-limited scaling. */
  finalVolumeUl: number;
  waterLabware: string;
  waterWell: string;
  /** Volume left in the tube to avoid aspirating air, uL. */
  tubeDeadVolumeUl?: number;
  /** Destination well capacity to validate against, uL. */
  maxWellVolumeUl?: number;
  /** Mix cycles after the part lands in the water. 0 disables mixing. */
  mixCycles?: number;
  tubeRackLoadName?: string;
  destPlateType?: string;
  protocolName?: string;
  author?: string;
  notify?: NotifyConfig;
}

export interface TubePlanEntry {
  /** 1-based rack number the tube sits in. */
  rack: number;
  /** Tube position within that rack, e.g. "A1". */
  tube: string;
  /** Destination well on the plate. */
  well: string;
  name: string;
  concentration: number;
  /** Part to transfer, uL. */
  partUl: number;
  /** Water to add, uL. */
  waterUl: number;
  finalVolumeUl: number;
  achievedConcentration: number;
  /** Source tube cannot supply a full-volume well at target. */
  massLimited: boolean;
  /** Stock is at or below target, so dilution cannot reach it. */
  belowTarget: boolean;
}

export interface TubeNormalisationResult {
  /** Ready-to-run Opentrons Python. */
  source: string;
  plan: TubePlanEntry[];
  /** Parts excluded because they go into the master mix. */
  excluded: TubeSample[];
  deckLayout: DeckSlotAssignment[];
  /** Every command, in order, for the simulation viewer. */
  steps: ProtocolStep[];
  warnings: string[];
  tipsUsed: { small: number; large: number };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Part/water split for one tube.
 *
 * Above target, dilute: `target * final / concentration` of part, water for the
 * rest. At or below target, dilution cannot help — transfer as much as the tube
 * holds and accept the lower concentration. Mass-limited wells are filled to a
 * *smaller* volume that still lands on target, rather than topped up with water
 * to the nominal volume and landing under it.
 */
export function planTube(
  sample: TubeSample,
  target: number,
  finalVolumeUl: number,
  deadVolumeUl: number,
): { partUl: number; waterUl: number; total: number; achieved: number; massLimited: boolean; belowTarget: boolean } {
  const usable = Math.max(0, sample.volumeUl - deadVolumeUl);
  const belowTarget = sample.concentration <= target;

  const desiredPart = belowTarget ? finalVolumeUl : (target * finalVolumeUl) / sample.concentration;
  const partUl = Math.min(desiredPart, usable);
  const massLimited = partUl < desiredPart - 1e-6;

  let waterUl: number;
  if (belowTarget) {
    waterUl = 0;
  } else if (!massLimited) {
    waterUl = finalVolumeUl - partUl;
  } else {
    waterUl = Math.max(0, (sample.concentration * partUl) / target - partUl);
  }

  const total = partUl + waterUl;
  return {
    partUl: round1(partUl),
    waterUl: round1(waterUl),
    total: round1(total),
    achieved: total > 0 ? round2((sample.concentration * partUl) / total) : 0,
    massLimited: massLimited && !belowTarget,
    belowTarget,
  };
}

/** Which pipette can deliver this volume in one go. */
function pipetteFor(volumeUl: number): typeof SMALL | typeof LARGE {
  return volumeUl <= SMALL.max ? SMALL : LARGE;
}

export function generateTubeNormalisation(options: TubeNormalisationOptions): TubeNormalisationResult {
  const {
    deck,
    samples,
    targetConcentration: target,
    finalVolumeUl,
    waterLabware,
    waterWell,
    tubeDeadVolumeUl = 3,
    maxWellVolumeUl = DEFAULT_MAX_WELL_UL,
    mixCycles = 3,
    tubeRackLoadName = TUBE_RACK,
    destPlateType = DEST_PLATE,
    protocolName = "Source Plate Normalisation from Tubes",
    author = "",
    notify = {},
  } = options;

  if (!samples.length) throw new Error("Add at least one tube.");
  if (target <= 0) throw new Error("Target concentration must be greater than zero.");
  if (finalVolumeUl <= 0) throw new Error("Final volume must be greater than zero.");
  if (finalVolumeUl > maxWellVolumeUl) {
    // Invariant 4: never silently exceed real well capacity.
    throw new Error(
      `A final volume of ${finalVolumeUl} uL exceeds the ${maxWellVolumeUl} uL working capacity of ` +
        `${destPlateType}. Lower the final volume, or raise the capacity if the labware really holds more.`,
    );
  }

  const excluded = samples.filter((s) => s.masterMix);
  const plated = samples.filter((s) => !s.masterMix);
  if (!plated.length) throw new Error("Every tube is marked master-mix — there is nothing to put on the plate.");

  for (const s of plated) {
    if (s.concentration <= 0) throw new Error(`${s.name} has a non-positive concentration.`);
    if (s.volumeUl <= 0) throw new Error(`${s.name} has a non-positive volume.`);
  }
  const duplicates = plated.map((s) => s.name).filter((n, i, a) => a.indexOf(n) !== i);
  if (duplicates.length) {
    throw new Error(`Duplicate tube name(s): ${[...new Set(duplicates)].join(", ")}.`);
  }

  const rackShape = shapeFor(tubeRackLoadName);
  const destShape = shapeFor(destPlateType);
  const tubesPerRack = wellCount(rackShape);
  const rackCount = Math.ceil(plated.length / tubesPerRack);

  if (plated.length > wellCount(destShape)) {
    throw new Error(
      `${plated.length} tubes will not fit a ${wellCount(destShape)}-well ${destPlateType}.`,
    );
  }

  // Invariant 3: both orderings come from wells.ts, and the pairing they
  // produce is then written down by name rather than re-derived anywhere else.
  const tubeOrder = columnMajor(rackShape);
  const destOrder = columnMajor(destShape);

  const warnings: string[] = [];
  const plan: TubePlanEntry[] = plated.map((sample, i) => {
    const split = planTube(sample, target, finalVolumeUl, tubeDeadVolumeUl);
    return {
      rack: Math.floor(i / tubesPerRack) + 1,
      tube: tubeOrder[i % tubesPerRack],
      well: destOrder[i],
      name: sample.name,
      concentration: sample.concentration,
      partUl: split.partUl,
      waterUl: split.waterUl,
      finalVolumeUl: split.total,
      achievedConcentration: split.achieved,
      massLimited: split.massLimited,
      belowTarget: split.belowTarget,
    };
  });

  for (const p of plan) {
    if (p.belowTarget) {
      warnings.push(
        `${p.name} is ${p.concentration} ng/uL, at or below the ${target} ng/uL target — it cannot be ` +
          `diluted up. It will go in neat at ${p.finalVolumeUl} uL and stay at ${p.achievedConcentration} ng/uL. ` +
          `Concentrate the tube first if the well must be on target.`,
      );
    } else if (p.massLimited) {
      warnings.push(
        `${p.name} has too little DNA for a ${finalVolumeUl} uL well — filling to ${p.finalVolumeUl} uL ` +
          `to hold ${target} ng/uL.`,
      );
    }
    if (p.partUl > 0 && p.partUl < SMALL.min) {
      warnings.push(
        `${p.name} needs only ${p.partUl} uL of part, below the ${SMALL.min} uL minimum of the ` +
          `${SMALL.name}. Dilute the tube by hand first, or raise the final volume.`,
      );
    }
    if (p.finalVolumeUl > maxWellVolumeUl + 1e-6) {
      throw new Error(`${p.name} would reach ${p.finalVolumeUl} uL, over the ${maxWellVolumeUl} uL well capacity.`);
    }
  }

  /* ----------------------------------------------------- deck and tip counts */

  const waterGroups = new Map<string, TubePlanEntry[]>();
  for (const p of plan.filter((p) => p.waterUl > 0)) {
    const pip = pipetteFor(p.waterUl);
    const existing = waterGroups.get(pip.name);
    if (existing) existing.push(p);
    else waterGroups.set(pip.name, [p]);
  }

  let smallTips = 0;
  let largeTips = 0;
  for (const [pipName, entries] of waterGroups) {
    if (!entries.length) continue;
    if (pipName === SMALL.name) smallTips += 1;
    else largeTips += 1;
  }
  for (const p of plan.filter((p) => p.partUl > 0)) {
    if (pipetteFor(p.partUl).name === SMALL.name) smallTips += 1;
    else largeTips += 1;
  }

  const usesSmall = smallTips > 0;
  const usesLarge = largeTips > 0;

  const requests: LabwareRequest[] = [
    { id: "dest", loadName: destPlateType, label: "Source plate (output)", kind: "plate" },
    { id: "water", loadName: waterLabware, label: "Water", kind: "tuberack" },
    { id: "rack", loadName: tubeRackLoadName, label: "Tube rack", kind: "tuberack", count: rackCount },
  ];
  if (usesSmall) {
    requests.push({
      id: "tips50",
      loadName: SMALL.tiprack,
      label: "50 uL tips",
      kind: "tips",
      count: Math.max(1, Math.ceil(smallTips / TIPS_PER_RACK)),
    });
  }
  if (usesLarge) {
    requests.push({
      id: "tips1000",
      loadName: LARGE.tiprack,
      label: "1000 uL tips",
      kind: "tips",
      count: Math.max(1, Math.ceil(largeTips / TIPS_PER_RACK)),
    });
  }

  const deckLayout = allocateDeck(deck, requests);
  const destSlot = slotFor(deckLayout, "dest");
  const waterSlot = slotFor(deckLayout, "water");
  const rackSlots = slotsFor(deckLayout, "rack");
  const tip50Slots = usesSmall ? slotsFor(deckLayout, "tips50") : [];
  const tip1000Slots = usesLarge ? slotsFor(deckLayout, "tips1000") : [];

  /* -------------------------------------------------- steps for the viewer */

  const rec = new StepRecorder();
  const rackSlotFor = (rack: number): string => rackSlots[rack - 1];

  rec.comment(
    `Water first: ${plan.filter((p) => p.waterUl > 0).length} well(s)`,
    "One tip per pipette for the whole water pass. Safe only because the dispense is above the well, so the tip never contacts it (invariant 1).",
  );
  for (const [pipName, entries] of waterGroups) {
    rec.add({
      kind: "pick_up_tip",
      slot: pipName === SMALL.name ? tip50Slots[0] : tip1000Slots[0],
      labwareId: pipName === SMALL.name ? "tips50" : "tips1000",
      labwareLabel: pipName === SMALL.name ? "50 uL tips" : "1000 uL tips",
      label: `Pick up tip — ${pipName} for the water pass`,
    });
    for (const p of entries) {
      rec.add({
        kind: "aspirate",
        slot: waterSlot,
        labwareId: "water",
        labwareLabel: "Water",
        well: waterWell,
        volumeUl: p.waterUl,
        label: `Aspirate ${p.waterUl} uL water`,
        sample: p.name,
      });
      rec.add({
        kind: "dispense",
        slot: destSlot,
        labwareId: "dest",
        labwareLabel: "Source plate (output)",
        well: p.well,
        volumeUl: p.waterUl,
        label: `Dispense ${p.waterUl} uL water into ${p.well}`,
        nonContact: true,
        note: "Dispensed above the well — no contact, so this tip may go back to the water.",
        sample: p.name,
      });
    }
    rec.add({ kind: "drop_tip", label: "Drop tip — water pass complete" });
  }

  rec.comment(
    `Parts: ${plan.filter((p) => p.partUl > 0).length} tube(s)`,
    "Fresh tip per tube. The tip goes tube -> well -> trash and never returns to a tube after touching the plate (invariant 1).",
  );
  for (const p of plan) {
    if (p.partUl <= 0) continue;
    const pip = pipetteFor(p.partUl);
    rec.add({
      kind: "pick_up_tip",
      slot: pip.name === SMALL.name ? tip50Slots[0] : tip1000Slots[0],
      labwareId: pip.name === SMALL.name ? "tips50" : "tips1000",
      labwareLabel: pip.name === SMALL.name ? "50 uL tips" : "1000 uL tips",
      label: `Pick up tip for ${p.name}`,
      sample: p.name,
    });
    rec.add({
      kind: "aspirate",
      slot: rackSlotFor(p.rack),
      labwareId: rackCount > 1 ? `rack:${p.rack - 1}` : "rack",
      labwareLabel: rackCount > 1 ? `Tube rack ${p.rack}` : "Tube rack",
      well: p.tube,
      volumeUl: p.partUl,
      label: `Aspirate ${p.partUl} uL ${p.name} from rack ${p.rack} ${p.tube}`,
      sample: p.name,
    });
    rec.add({
      kind: "dispense",
      slot: destSlot,
      labwareId: "dest",
      labwareLabel: "Source plate (output)",
      well: p.well,
      volumeUl: p.partUl,
      label: `Dispense ${p.name} into ${p.well}${mixCycles > 0 ? ` and mix ${mixCycles}x` : ""}`,
      note: `${p.achievedConcentration} ng/uL in ${p.finalVolumeUl} uL`,
      sample: p.name,
    });
    rec.add({ kind: "drop_tip", label: `Drop tip — ${p.name} done`, sample: p.name });
  }

  const steps = rec.all();

  /* ------------------------------------------------------------ python emit */

  const planLiteral = plan
    .map(
      (p) =>
        `    ${py(p.well)}: {"name": ${py(p.name)}, "rack": ${p.rack}, "tube": ${py(p.tube)}, ` +
        `"part_ul": ${p.partUl}, "water_ul": ${p.waterUl}, "final_ul": ${p.finalVolumeUl}, ` +
        `"stock_ngul": ${p.concentration}, "achieved_ngul": ${p.achievedConcentration}, ` +
        `"mass_limited": ${py(p.massLimited)}, "below_target": ${py(p.belowTarget)}},`,
    )
    .join("\n");

  const rackLoads = rackSlots
    .map((slot, i) => `racks[${i + 1}] = protocol.load_labware(${py(tubeRackLoadName)}, ${py(slot)})`)
    .join("\n");

  const tipLoads = [
    ...tip50Slots.map((slot, i) => `tips50_${i} = protocol.load_labware(${py(SMALL.tiprack)}, ${py(slot)})`),
    ...tip1000Slots.map((slot, i) => `tips1000_${i} = protocol.load_labware(${py(LARGE.tiprack)}, ${py(slot)})`),
  ].join("\n");

  const pipetteLoads = [
    usesSmall
      ? `small = protocol.load_instrument(${py(SMALL.name)}, mount=${py(SMALL.mount)}, tip_racks=[${tip50Slots.map((_, i) => `tips50_${i}`).join(", ")}])`
      : "small = None",
    usesLarge
      ? `large = protocol.load_instrument(${py(LARGE.name)}, mount=${py(LARGE.mount)}, tip_racks=[${tip1000Slots.map((_, i) => `tips1000_${i}`).join(", ")}])`
      : "large = None",
  ].join("\n");

  const body = `
dest = protocol.load_labware(${py(destPlateType)}, ${py(destSlot)})
water_rack = protocol.load_labware(${py(waterLabware)}, ${py(waterSlot)})
water = water_rack.wells_by_name()[${py(waterWell)}]

racks = {}
${rackLoads}

${tipLoads}
protocol.load_trash_bin(${py(trashSlot(deck))})

${pipetteLoads}

def pipette_for(volume):
    """Smallest pipette that can deliver this volume in a single aspirate.

    Never split a tube-to-plate transfer across two aspirates: the second
    aspirate would dip a tip that has already touched the destination back
    into the shared stock tube.
    """
    if volume <= ${SMALL.max} and small is not None:
        return small
    if large is not None:
        return large
    raise RuntimeError(f"No pipette loaded can deliver {volume} uL")

notify(f"Source plate normalisation started - {len(PLAN)} part(s) to {TARGET_NGUL} ng/uL")

# Pass 1: water into empty wells. One tip per pipette for the whole pass, which
# is only safe because every dispense is above the well and never contacts it.
water_jobs = [(w, e["water_ul"]) for w, e in PLAN.items() if e["water_ul"] > 0]
for pipette in [p for p in (small, large) if p is not None]:
    jobs = [j for j in water_jobs if pipette_for(j[1]) is pipette]
    if not jobs:
        continue
    pipette.pick_up_tip()
    for well_name, volume in jobs:
        pipette.aspirate(volume, water.bottom(3))
        pipette.dispense(volume, dest.wells_by_name()[well_name].top(-2))
        pipette.blow_out(dest.wells_by_name()[well_name].top(-2))
    pipette.drop_tip()

notify("Water added - starting part transfers")

# Pass 2: one fresh tip per tube. Tube -> well -> trash, so no tip ever returns
# to a stock tube after touching the plate.
for well_name, entry in PLAN.items():
    volume = entry["part_ul"]
    if volume <= 0:
        print(f"Skipping {entry['name']} - no part volume to transfer")
        continue
    pipette = pipette_for(volume)
    tube = racks[entry["rack"]].wells_by_name()[entry["tube"]]
    pipette.pick_up_tip()
    pipette.aspirate(volume, tube.bottom(2))
    pipette.dispense(volume, dest.wells_by_name()[well_name].bottom(2))
${
    mixCycles > 0
      ? `    mix_volume = min(entry["final_ul"] * 0.5, pipette.max_volume)
    pipette.mix(${mixCycles}, mix_volume, dest.wells_by_name()[well_name].bottom(2))`
      : "    pass"
  }
    pipette.blow_out(dest.wells_by_name()[well_name].top(-2))
    pipette.drop_tip()

rows = ["well,part,rack,tube,stock_ngul,part_ul,water_ul,final_ul,achieved_ngul,flag"]
for well_name, entry in PLAN.items():
    flag = "BELOW TARGET" if entry["below_target"] else ("MASS LIMITED" if entry["mass_limited"] else "")
    rows.append(
        f"{well_name},{entry['name']},{entry['rack']},{entry['tube']},"
        f"{entry['stock_ngul']:.1f},{entry['part_ul']:.1f},{entry['water_ul']:.1f},"
        f"{entry['final_ul']:.1f},{entry['achieved_ngul']:.2f},{flag}"
    )
notify("Normalisation complete:\\n\`\`\`" + "\\n".join(rows) + "\`\`\`")
`.trim();

  const loadingComment = plan
    .map((p) => `#   rack ${p.rack} ${p.tube.padEnd(3)} ${p.name.padEnd(6)} -> plate ${p.well}`)
    .join("\n");

  const excludedComment = excluded.length
    ? `#\n# Not on this plate (premixed into the Golden Gate master mix by hand):\n` +
      excluded.map((s) => `#   ${s.name} (${s.concentration} ng/uL)`).join("\n")
    : "";

  const source = finalise(
    preamble(
      {
        protocolName,
        description:
          `Normalise ${plan.length} part(s) from 1.5 mL tubes into a ${destPlateType} ` +
          `at ${target} ng/uL in ${finalVolumeUl} uL.`,
        author,
        apiLevel: "2.23",
      },
      notify,
    ) +
      `
TARGET_NGUL = ${target}
FINAL_VOLUME_UL = ${finalVolumeUl}
TUBE_DEAD_VOLUME_UL = ${tubeDeadVolumeUl}

# Tube loading map. Fill the racks exactly as below before starting the run --
# the protocol has no way to detect a tube in the wrong position.
${loadingComment}
${excludedComment}

# Pre-computed from the concentrations and volumes declared in the app. Nothing
# is measured at run time.
PLAN = {
${planLiteral}
}
` +
      runFunction(indent(body, 0), protocolName),
  );

  return {
    source,
    plan,
    excluded,
    deckLayout,
    steps,
    warnings,
    tipsUsed: { small: smallTips, large: largeTips },
  };
}
