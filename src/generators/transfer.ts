/**
 * Plate wells to individual 1.5 mL tubes, one tube per well.
 *
 * Every well is a distinct sample, so each transfer gets a fresh tip. The
 * source and destination orderings both come from `wells.ts` and the pairing
 * is written into the emitted `PLAN` by name rather than zipped by index
 * (invariant 3: a 4x6 rack and an 8x12 plate have different strides, and
 * pairing them by position is the bug that mislabelled a whole run).
 *
 * The blow-out goes into the destination tube, which is safe because the tip
 * is discarded immediately afterwards and never returns to the plate.
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
import { ASPIRATE_BOTTOM_MM, P1000, TIPS_PER_RACK } from "../core/pipetting";
import { StepRecorder, type ProtocolStep } from "../core/steps";
import { rowMajor, shapeFor, sortRowMajor, wellCount } from "../core/wells";

const TUBE_RACK = "jd_24_tuberack_1.5ml";
export const MAX_PLATES = 3;

export interface SourcePlate {
  plateType: string;
  selectedWells: string[];
  label?: string;
}

export interface TransferOptions {
  deck: DeckConfig;
  plates: SourcePlate[];
  transferVolumeUl: number;
  tubeRackLoadName?: string;
  protocolName?: string;
  author?: string;
  notify?: NotifyConfig;
}

export interface TransferPlanEntry {
  /** 1-based source plate number. */
  plate: number;
  plateType: string;
  sourceWell: string;
  /** 1-based destination rack number. */
  rack: number;
  tube: string;
}

export interface TransferResult {
  source: string;
  plan: TransferPlanEntry[];
  deckLayout: DeckSlotAssignment[];
  steps: ProtocolStep[];
  warnings: string[];
  tipsUsed: number;
}

export function generateTransfer(options: TransferOptions): TransferResult {
  const {
    deck,
    plates,
    transferVolumeUl,
    tubeRackLoadName = TUBE_RACK,
    protocolName = "Plate to Tube Transfer",
    author = "",
    notify = {},
  } = options;

  if (!plates.length) throw new Error("Add at least one source plate.");
  if (plates.length > MAX_PLATES) {
    throw new Error(`At most ${MAX_PLATES} source plates are supported; got ${plates.length}.`);
  }
  if (transferVolumeUl < P1000.minUl || transferVolumeUl > P1000.maxUl) {
    throw new Error(
      `Transfer volume must be between ${P1000.minUl} and ${P1000.maxUl} uL for the ${P1000.name}.`,
    );
  }

  const warnings: string[] = [];
  const rackShape = shapeFor(tubeRackLoadName);
  const tubesPerRack = wellCount(rackShape);

  // Both orderings come from wells.ts. Row-major on each side, matching the
  // Python original's reading-order convention.
  const tubeOrder = rowMajor(rackShape);

  const plan: TransferPlanEntry[] = [];
  plates.forEach((plate, plateIdx) => {
    if (!plate.selectedWells.length) {
      throw new Error(`Source plate ${plateIdx + 1} has no wells selected.`);
    }
    const shape = shapeFor(plate.plateType);
    const wells = sortRowMajor(new Set(plate.selectedWells));
    for (const well of wells) {
      const i = plan.length;
      plan.push({
        plate: plateIdx + 1,
        plateType: plate.plateType,
        sourceWell: well,
        rack: Math.floor(i / tubesPerRack) + 1,
        tube: tubeOrder[i % tubesPerRack],
      });
    }
    if (wells.length > wellCount(shape)) {
      throw new Error(`Plate ${plateIdx + 1} has more selected wells than a ${plate.plateType} holds.`);
    }
  });

  const rackCount = Math.ceil(plan.length / tubesPerRack);
  const tipsUsed = plan.length;

  const requests: LabwareRequest[] = [
    ...plates.map(
      (p, i): LabwareRequest => ({
        id: `plate:${i}`,
        loadName: p.plateType,
        label: p.label ?? `Source plate ${i + 1}`,
        kind: "plate",
      }),
    ),
    {
      id: "tips",
      loadName: P1000.tiprack,
      label: "1000 uL tips",
      kind: "tips",
      count: Math.max(1, Math.ceil(tipsUsed / TIPS_PER_RACK)),
    },
    { id: "rack", loadName: tubeRackLoadName, label: "Tube rack", kind: "tuberack", count: rackCount },
  ];

  const deckLayout = allocateDeck(deck, requests);
  const plateSlots = plates.map((_, i) => slotFor(deckLayout, `plate:${i}`));
  const tipSlots = slotsFor(deckLayout, "tips");
  const rackSlots = slotsFor(deckLayout, "rack");

  if (tipsUsed > tipSlots.length * TIPS_PER_RACK) {
    warnings.push(
      `${tipsUsed} transfers need more than the ${tipSlots.length * TIPS_PER_RACK} tips on deck. ` +
        `The run will pause for a tip refill.`,
    );
  }

  /* ---------------------------------------------------------------- steps */

  const rec = new StepRecorder();
  rec.comment(
    `${plan.length} transfer(s) of ${transferVolumeUl} uL`,
    "Fresh tip per well: each well is a distinct sample, so no tip is ever shared.",
  );
  for (const p of plan) {
    const plateId = `plate:${p.plate - 1}`;
    const plateLabel = plates[p.plate - 1].label ?? `Source plate ${p.plate}`;
    const rackId = rackCount > 1 ? `rack:${p.rack - 1}` : "rack";
    const rackLabel = rackCount > 1 ? `Tube rack ${p.rack}` : "Tube rack";
    rec.add({
      kind: "pick_up_tip",
      slot: tipSlots[0],
      labwareId: "tips",
      labwareLabel: "1000 uL tips",
      label: `Pick up tip for ${plateLabel} ${p.sourceWell}`,
      sample: p.sourceWell,
    });
    rec.add({
      kind: "aspirate",
      slot: plateSlots[p.plate - 1],
      labwareId: plateId,
      labwareLabel: plateLabel,
      well: p.sourceWell,
      volumeUl: transferVolumeUl,
      label: `Aspirate ${transferVolumeUl} uL from ${plateLabel} ${p.sourceWell}`,
      sample: p.sourceWell,
    });
    rec.add({
      kind: "dispense",
      slot: rackSlots[p.rack - 1],
      labwareId: rackId,
      labwareLabel: rackLabel,
      well: p.tube,
      volumeUl: transferVolumeUl,
      label: `Dispense into ${rackLabel} ${p.tube}`,
      note: "Dispensed above the tube, then blown out — the tip is discarded straight after.",
      nonContact: true,
      sample: p.sourceWell,
    });
    rec.add({ kind: "drop_tip", label: `Drop tip — ${p.sourceWell} done`, sample: p.sourceWell });
  }
  const steps = rec.all();

  /* ---------------------------------------------------------- python emit */

  const planLiteral = plan
    .map(
      (p) =>
        `    {"plate": ${p.plate}, "source_well": ${py(p.sourceWell)}, ` +
        `"rack": ${p.rack}, "tube": ${py(p.tube)}},`,
    )
    .join("\n");

  const plateLoads = plates
    .map((p, i) => `plates[${i + 1}] = protocol.load_labware(${py(p.plateType)}, ${py(plateSlots[i])})`)
    .join("\n");
  const rackLoads = rackSlots
    .map((slot, i) => `racks[${i + 1}] = protocol.load_labware(${py(tubeRackLoadName)}, ${py(slot)})`)
    .join("\n");
  const tipLoads = tipSlots
    .map((slot, i) => `tips_${i} = protocol.load_labware(${py(P1000.tiprack)}, ${py(slot)})`)
    .join("\n");
  const tipList = tipSlots.map((_, i) => `tips_${i}`).join(", ");

  const body = `
plates = {}
${plateLoads}

racks = {}
${rackLoads}

${tipLoads}
protocol.load_trash_bin(${py(trashSlot(deck))})

pipette = protocol.load_instrument(${py(P1000.name)}, mount=${py(P1000.mount)}, tip_racks=[${tipList}])

notify(f"Plate to tube transfer started - {len(PLAN)} well(s) at {TRANSFER_VOLUME_UL} uL")

# One tip per well. Each well is a different sample, so nothing is shared, and
# the blow-out into the tube is safe because the tip goes straight to the trash.
for entry in PLAN:
    source = plates[entry["plate"]].wells_by_name()[entry["source_well"]]
    tube = racks[entry["rack"]].wells_by_name()[entry["tube"]]
    pipette.pick_up_tip()
    pipette.aspirate(TRANSFER_VOLUME_UL, source.bottom(${ASPIRATE_BOTTOM_MM}))
    pipette.dispense(TRANSFER_VOLUME_UL, tube.top(0))
    pipette.blow_out(tube.top(0))
    pipette.drop_tip()

notify(f"Transfer complete - {len(PLAN)} well(s) in tubes. Cap and store them.")
protocol.comment("Transfer complete.")
`.trim();

  const loadingComment = plan
    .map(
      (p) =>
        `#   plate ${p.plate} ${p.sourceWell.padEnd(4)} -> rack ${p.rack} ${p.tube}`,
    )
    .join("\n");

  const source = finalise(
    preamble(
      {
        protocolName,
        description:
          `Transfer ${transferVolumeUl} uL from ${plan.length} well(s) across ` +
          `${plates.length} plate(s) into individual 1.5 mL tubes.`,
        author,
        apiLevel: "2.23",
      },
      notify,
    ) +
      `
TRANSFER_VOLUME_UL = ${transferVolumeUl}

# Tube map. Label the tubes as below before the run -- the protocol cannot tell
# which tube is which, and this pairing is fixed here rather than recomputed.
${loadingComment}

PLAN = [
${planLiteral}
]
` +
      runFunction(indent(body, 0), protocolName),
  );

  return { source, plan, deckLayout, steps, warnings, tipsUsed };
}
