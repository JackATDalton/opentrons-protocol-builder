/**
 * Plasmid concentration normalisation.
 *
 * Dilutes each selected source well to a target concentration in a fixed final
 * volume, transferring plasmid then topping up with water.
 *
 * Source volumes are supplied per-well by the user. An earlier version probed
 * them with the Flex pressure sensor (liquid-level detection) instead; in
 * practice that under-read badly and under-transferred nearly every well, so
 * the design was changed to trust declared volumes. If a well holds less than
 * declared, the protocol transfers what it can and reports the shortfall
 * rather than failing.
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
import { assertWellsExist, shapeFor, sortRowMajor } from "../core/wells";

const TIPRACK = "opentrons_flex_96_tiprack_50ul";
const PIPETTE = "flex_1channel_50";
const TIPS_PER_RACK = 96;

export interface NormalisationWell {
  /** Well on the source plate, e.g. "A1". */
  well: string;
  /** Sample name, carried into the run report. */
  name: string;
  /** Measured concentration, ng/uL. */
  concentration: number;
  /** Desired concentration, ng/uL. */
  targetConcentration: number;
  /** Declared volume available in the source well, uL. */
  sourceVolumeUl: number;
}

export interface NormalisationOptions {
  deck: DeckConfig;
  wells: NormalisationWell[];
  plateType: string;
  waterLabware: string;
  waterWell: string;
  /** Total volume each destination well should end up at, uL. */
  finalVolumeUl: number;
  /** Volume left behind in a source well to avoid aspirating air, uL. */
  deadVolumeUl?: number;
  protocolName?: string;
  author?: string;
  notify?: NotifyConfig;
}

export interface WellPlan {
  well: string;
  name: string;
  /** Plasmid to transfer, uL. */
  plasmidUl: number;
  /** Water to add, uL. */
  waterUl: number;
  /** Volume the well will actually reach, uL. */
  finalVolumeUl: number;
  /** Concentration the well will actually reach, ng/uL. */
  achievedConcentrationUl: number;
  /** True when the source well can't supply enough to hit the target volume. */
  short: boolean;
}

export interface NormalisationResult {
  source: string;
  plan: WellPlan[];
  deckLayout: DeckSlotAssignment[];
  warnings: string[];
}

/**
 * Work out the plasmid/water split for one well.
 *
 * Two branches. If the source is more concentrated than the target, dilute it:
 * take `target * final / concentration` of plasmid and make up the rest with
 * water. If it's already at or below target, dilution can't help — transfer as
 * much as is available and accept the lower concentration.
 *
 * When the source can't supply the full plasmid volume, the well is filled to
 * a *smaller* total volume that still hits the target concentration, rather
 * than being topped up with water to the nominal volume (which would land
 * below target).
 */
export function planWell(well: NormalisationWell, finalVolumeUl: number, deadVolumeUl: number): WellPlan {
  const usable = Math.max(0, well.sourceVolumeUl - deadVolumeUl);
  const diluting = well.concentration > well.targetConcentration;

  const desiredPlasmid = diluting
    ? (well.targetConcentration * finalVolumeUl) / well.concentration
    : finalVolumeUl;

  const plasmidUl = Math.min(desiredPlasmid, usable);
  const short = plasmidUl < desiredPlasmid - 1e-6;

  let waterUl: number;
  if (!diluting) {
    waterUl = 0;
  } else if (!short) {
    waterUl = finalVolumeUl - plasmidUl;
  } else {
    // Scale the whole well down so concentration still lands on target.
    const totalAtTarget = (well.concentration * plasmidUl) / well.targetConcentration;
    waterUl = Math.max(0, totalAtTarget - plasmidUl);
  }

  const total = plasmidUl + waterUl;
  return {
    well: well.well,
    name: well.name,
    plasmidUl: round1(plasmidUl),
    waterUl: round1(waterUl),
    finalVolumeUl: round1(total),
    achievedConcentrationUl: total > 0 ? round2((well.concentration * plasmidUl) / total) : 0,
    short: short && diluting,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function generateNormalisation(options: NormalisationOptions): NormalisationResult {
  const {
    deck,
    plateType,
    waterLabware,
    waterWell,
    finalVolumeUl,
    deadVolumeUl = 2,
    protocolName = "Plasmid Concentration Normalisation",
    author = "",
    notify = {},
  } = options;

  if (!options.wells.length) {
    throw new Error("Select at least one well to normalise.");
  }
  if (finalVolumeUl <= 0) {
    throw new Error("Final volume must be greater than zero.");
  }

  const shape = shapeFor(plateType);
  assertWellsExist(options.wells.map((w) => w.well), shape, "Source plate");

  const order = sortRowMajor(options.wells.map((w) => w.well));
  const byName = new Map(options.wells.map((w) => [w.well, w]));
  const wells = order.map((w) => byName.get(w)!);

  const warnings: string[] = [];
  for (const w of wells) {
    if (w.concentration <= 0) throw new Error(`${w.well} (${w.name}) has a non-positive concentration.`);
    if (w.targetConcentration <= 0) throw new Error(`${w.well} (${w.name}) has a non-positive target concentration.`);
    if (w.concentration < w.targetConcentration) {
      warnings.push(
        `${w.well} (${w.name}) is ${w.concentration} ng/uL, below its ${w.targetConcentration} ng/uL target — ` +
          `it will be transferred undiluted and stay below target.`,
      );
    }
  }

  const plan = wells.map((w) => planWell(w, finalVolumeUl, deadVolumeUl));

  for (const p of plan.filter((p) => p.short)) {
    warnings.push(
      `${p.well} (${p.name}) has too little sample for a full ${finalVolumeUl} uL — ` +
        `filling to ${p.finalVolumeUl} uL to hold the target concentration.`,
    );
  }

  // One tip per plasmid transfer, plus one shared tip for the whole water pass.
  const tipRacks = Math.max(1, Math.ceil((plan.length + 1) / TIPS_PER_RACK));

  const requests: LabwareRequest[] = [
    { id: "source", loadName: plateType, label: "Source Plate", kind: "plate" },
    { id: "dest", loadName: plateType, label: "Destination Plate", kind: "plate" },
    { id: "water", loadName: waterLabware, label: "Water", kind: "tuberack" },
    { id: "tips", loadName: TIPRACK, label: "Tip Rack", kind: "tips", count: tipRacks },
  ];

  const deckLayout = allocateDeck(deck, requests);
  const tipSlots = slotsFor(deckLayout, "tips");

  const tipLoads = tipSlots
    .map((slot, i) => `tips_${i} = protocol.load_labware(${py(TIPRACK)}, ${py(slot)})`)
    .join("\n");
  const tipList = tipSlots.map((_, i) => `tips_${i}`).join(", ");

  const planLiteral = plan
    .map(
      (p) =>
        `    ${py(p.well)}: {"name": ${py(p.name)}, "plasmid_ul": ${p.plasmidUl}, ` +
        `"water_ul": ${p.waterUl}, "final_ul": ${p.finalVolumeUl}, ` +
        `"achieved_ngul": ${p.achievedConcentrationUl}, "short": ${py(p.short)}},`,
    )
    .join("\n");

  const body = `
source_plate = protocol.load_labware(${py(plateType)}, ${py(slotFor(deckLayout, "source"))})
dest_plate = protocol.load_labware(${py(plateType)}, ${py(slotFor(deckLayout, "dest"))})
water_rack = protocol.load_labware(${py(waterLabware)}, ${py(slotFor(deckLayout, "water"))})
water = water_rack.wells_by_name()[${py(waterWell)}]

${tipLoads}
protocol.load_trash_bin(${py(trashSlot(deck))})

pipette = protocol.load_instrument(${py(PIPETTE)}, mount="left", tip_racks=[${tipList}])

notify(f"Normalisation started - {len(PLAN)} well(s)")

# Pass 1: plasmid, fresh tip per well. Volumes are pre-computed from the
# declared source volumes, so nothing is probed at run time.
for well_name, entry in PLAN.items():
    volume = entry["plasmid_ul"]
    if volume <= 0:
        print(f"Skipping {well_name} - no plasmid volume to transfer")
        continue
    pipette.pick_up_tip()
    pipette.transfer(
        volume,
        source_plate.wells_by_name()[well_name].bottom(1),
        dest_plate.wells_by_name()[well_name],
        new_tip="never",
    )
    pipette.drop_tip()

notify("Plasmid transfers complete - starting water top-up")

# Pass 2: water, one shared tip. Dispensing above the destination liquid means
# the tip never contacts a well, so a single tip is safe for the whole plate.
water_wells = [(w, e["water_ul"]) for w, e in PLAN.items() if e["water_ul"] > 0]
if water_wells:
    pipette.pick_up_tip()
    for well_name, volume in water_wells:
        pipette.transfer(
            volume,
            water.bottom(3),
            dest_plate.wells_by_name()[well_name].top(-1),
            new_tip="never",
        )
    pipette.drop_tip()

rows = ["well,name,target_ngul,final_volume_ul,achieved_ngul,shortfall"]
for well_name, entry in PLAN.items():
    rows.append(
        f"{well_name},{entry['name']},{TARGET_BY_WELL[well_name]:.2f},"
        f"{entry['final_ul']:.1f},{entry['achieved_ngul']:.2f},"
        f"{'YES' if entry['short'] else ''}"
    )
notify("Normalisation complete - final volumes:\\n\`\`\`" + "\\n".join(rows) + "\`\`\`")
`.trim();

  const source = finalise(
    preamble(
      {
        protocolName,
        description: `Normalise ${plan.length} well(s) to target concentration in ${finalVolumeUl} uL.`,
        author,
      },
      notify,
    ) +
      `
FINAL_VOLUME_UL = ${finalVolumeUl}
DEAD_VOLUME_UL = ${deadVolumeUl}

# Pre-computed per well. Volumes come from the source volumes declared in the
# app, not from run-time liquid-level detection.
PLAN = {
${planLiteral}
}

TARGET_BY_WELL = {
${wells.map((w) => `    ${py(w.well)}: ${w.targetConcentration},`).join("\n")}
}
` +
      runFunction(indent(body, 0), protocolName),
  );

  return { source, plan, deckLayout, warnings };
}
