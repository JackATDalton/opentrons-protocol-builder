/**
 * Vacuum-manifold plasmid miniprep, from resuspended cells to eluted DNA.
 *
 * Port of the lab's miniprep_generator.py. The run is a sequence of robot
 * stages separated by pauses where the operator spins tubes down and moves
 * columns, so most of the design here is about what must *not* be reordered.
 *
 * Rules carried across (docs/pipetting-guide.md, docs/protocol-invariants.md):
 *
 * - **Lysis and neutralisation interleave in groups of LYSIS_GROUP_SIZE.**
 *   A refactor that lysed every tube before neutralising any left the first
 *   tubes in lysis buffer for the whole pass. Do not "optimise" this into two
 *   passes (invariant 5).
 * - **Every dispense into an open tube or column happens OPEN_LID_CLEARANCE_MM
 *   above its top.** Lower, tips caught on open lids while travelling.
 * - **Buffers that go to every tube are reverse-pipetted from one tip.** One
 *   aspirate serves as many tubes as the p1000 holds. Safe because the
 *   dispense never contacts the tube (invariant 1). Reusing a contacting tip
 *   with neutralisation buffer caused repeated overpressure errors.
 * - **The p1000 does everything, elution included**, so no 50 uL rack is on
 *   deck. 1000 uL covers 20 tubes at 50 uL.
 * - **Manifolds are chained by external tubing**, so they must sit in the same
 *   row with one at the deck's right edge: preferred slots C3 then C2.
 * - **Tube-rack slots are reused for elution tubes** via move_labware(OFF_DECK)
 *   once lysis is done, because the deck has no room for both.
 * - **Tip refills only happen at a batch pause**, never mid-batch, so no tube
 *   sits in lysis buffer waiting for the operator.
 */
import {
  allocateDeck,
  slotsFor,
  trashSlot,
  type DeckConfig,
  type DeckSlotAssignment,
  type LabwareRequest,
} from "../core/deck";
import { finalise, indent, preamble, py, runFunction, type NotifyConfig } from "../core/emit";
import {
  FALCON_ASPIRATE_BOTTOM_MM,
  OPEN_LID_CLEARANCE_MM,
  P1000,
  TIPS_PER_RACK,
} from "../core/pipetting";
import { StepRecorder, type ProtocolStep } from "../core/steps";
import { shapeFor, sortColumnMajor, wellCount } from "../core/wells";
import { LABWARE } from "../core/labware";

const TUBE_RACK = LABWARE.tubeRack;
const MANIFOLD = LABWARE.vacuumRack;
const BUFFERS = LABWARE.falconRack;

/** Deck capacity: two racks plus two manifolds alongside tips and buffers. */
export const MAX_RACKS = 2;

/**
 * Tubes lysed then neutralised before moving on. Bounds how long any tube
 * sits in lysis buffer (invariant 5).
 */
export const LYSIS_GROUP_SIZE = 4;

/** Manifolds are tubing-chained, so one must sit at the deck's right edge. */
export const MANIFOLD_PREFERRED_SLOTS = ["C3", "C2"];

const FALCON_MAX_ML = 50;

/**
 * Where the resuspended cells start.
 *
 * - `tubes`: each tube already holds its own resuspended sample, loaded by
 *   hand. The culture stage is skipped entirely and no Falcon is needed. The
 *   default, because most runs are separate clones.
 * - `culture`: one shared culture in a Falcon, dispensed into every tube by
 *   the robot. The lab's original protocol.
 */
export type SampleSource = "culture" | "tubes";

export interface MiniprepParams {
  sampleSource: SampleSource;
  cultureVolumeUl: number;
  cultureWell: string;
  /** Mix the Falcon before every this-many tubes, so cells don't settle. */
  cultureMixEvery: number;
  cultureMixVolUl: number;
  cultureMixReps: number;
  lysisVolumeUl: number;
  lysisMixVolUl: number;
  lysisMixReps: number;
  lysisBufferWell: string;
  neutralisationVolumeUl: number;
  neutralisationBufferWell: string;
  /** Mix each tube after neutralising (own tip each) instead of inverting. */
  neutralisationMix: boolean;
  neutralisationMixVolUl: number;
  neutralisationMixReps: number;
  washVolumeUl: number;
  washRounds: number;
  washBufferWell: string;
  elutionVolumeUl: number;
  elutionBufferWell: string;
  /** Re-elute the same columns into fresh tubes this many times. */
  nElutions: number;
  /** Reuse the same tube positions for this many batches of samples. */
  nBatches: number;
}

export const DEFAULT_PARAMS: MiniprepParams = {
  sampleSource: "tubes",
  cultureVolumeUl: 250,
  cultureWell: "B3",
  cultureMixEvery: 6,
  cultureMixVolUl: 800,
  cultureMixReps: 5,
  lysisVolumeUl: 250,
  lysisMixVolUl: 200,
  lysisMixReps: 3,
  lysisBufferWell: "A1",
  neutralisationVolumeUl: 350,
  neutralisationBufferWell: "A2",
  neutralisationMix: false,
  neutralisationMixVolUl: 500,
  neutralisationMixReps: 3,
  washVolumeUl: 250,
  washRounds: 4,
  washBufferWell: "A3",
  elutionVolumeUl: 50,
  elutionBufferWell: "B1",
  nElutions: 1,
  nBatches: 1,
};

export interface MiniprepOptions {
  deck: DeckConfig;
  /** One entry per physical tube rack: which positions hold a sample. */
  racks: string[][];
  /**
   * Optional name per tube, one map per rack (position -> name). Used for the
   * sample map in the protocol and the plan. Unnamed tubes fall back to their
   * position. Meant for `sampleSource: "tubes"`, where every tube differs.
   */
  sampleNames?: Record<string, string>[];
  params?: Partial<MiniprepParams>;
  tubeRackLoadName?: string;
  manifoldLoadName?: string;
  buffersLoadName?: string;
  protocolName?: string;
  author?: string;
  notify?: NotifyConfig;
}

export interface BufferRequirement {
  label: string;
  well: string;
  /** Total volume the whole run consumes, mL. */
  totalMl: number;
}

export interface MiniprepResult {
  source: string;
  deckLayout: DeckSlotAssignment[];
  steps: ProtocolStep[];
  warnings: string[];
  /** Positions in rack order, as (rack, tube) pairs, with the sample's name. */
  samplePositions: { rack: number; tube: string; name: string }[];
  samplesPerBatch: number;
  totalSamples: number;
  tipsUsed: number;
  tipsOnDeck: number;
  buffers: BufferRequirement[];
}

/** Tubes one reverse-pipetted aspirate can serve. */
function perAspirate(volumeUl: number): number {
  return Math.max(1, Math.floor(P1000.maxUl / volumeUl));
}

export function generateMiniprep(options: MiniprepOptions): MiniprepResult {
  const {
    deck,
    racks,
    tubeRackLoadName = TUBE_RACK,
    manifoldLoadName = MANIFOLD,
    buffersLoadName = BUFFERS,
    protocolName = "Vacuum Manifold Miniprep",
    author = "",
    notify = {},
  } = options;

  const p: MiniprepParams = { ...DEFAULT_PARAMS, ...options.params };
  const warnings: string[] = [];

  const rackShape = shapeFor(tubeRackLoadName);
  const tubesPerRack = wellCount(rackShape);

  // Empty racks are dropped, so carry each rack's names along with it.
  const kept = racks
    .map((wells, i) => ({
      wells: sortColumnMajor(new Set(wells.map((w) => w.trim().toUpperCase()))),
      names: options.sampleNames?.[i] ?? {},
    }))
    .filter((r) => r.wells.length);
  const cleaned = kept.map((r) => r.wells);

  if (!cleaned.length) throw new Error("Select at least one tube position.");
  if (cleaned.length > MAX_RACKS) {
    throw new Error(
      `At most ${MAX_RACKS} tube racks fit on the deck alongside their manifolds; got ${cleaned.length}.`,
    );
  }
  for (const [i, wells] of cleaned.entries()) {
    if (wells.length > tubesPerRack) {
      throw new Error(`Rack ${i + 1} holds ${tubesPerRack} tubes; ${wells.length} were selected.`);
    }
  }
  if (p.nBatches < 1) throw new Error("Batches must be at least 1.");
  if (p.nElutions < 1) throw new Error("Elutions must be at least 1.");
  if (p.washVolumeUl <= 0 || p.washRounds < 1) throw new Error("Wash volume and rounds must be positive.");

  const preloaded = p.sampleSource === "tubes";

  // Names are keyed by position within each rack; normalise the keys the same
  // way the positions were, and fall back to the position for unnamed tubes.
  const namesByRack = kept.map((r) => {
    const map = new Map<string, string>();
    for (const [well, name] of Object.entries(r.names)) {
      if (name.trim()) map.set(well.trim().toUpperCase(), name.trim());
    }
    return map;
  });
  const fallbackName = (rack: number, tube: string) => (cleaned.length > 1 ? `R${rack} ${tube}` : tube);
  const samplePositions = cleaned.flatMap((wells, rackIdx) =>
    wells.map((tube) => ({
      rack: rackIdx + 1,
      tube,
      name: namesByRack[rackIdx].get(tube) ?? fallbackName(rackIdx + 1, tube),
    })),
  );
  const samplesPerBatch = samplePositions.length;
  const totalSamples = samplesPerBatch * p.nBatches;
  const rackCount = cleaned.length;

  const seen = new Map<string, string>();
  for (const s of samplePositions) {
    const where = `rack ${s.rack} ${s.tube}`;
    const prior = seen.get(s.name);
    if (prior) warnings.push(`"${s.name}" names both ${prior} and ${where}. Check the tubes are labelled right.`);
    else seen.set(s.name, where);
  }
  if (preloaded && p.nBatches > 1) {
    warnings.push(
      `Sample names cover batch 1 only. Batches 2-${p.nBatches} reuse the same positions, so keep ` +
        `your own record of which sample went where in each batch.`,
    );
  }

  /* ----------------------------------------------------- buffer accounting */

  const cultureMl = preloaded ? 0 : (p.cultureVolumeUl * totalSamples) / 1000;
  if (cultureMl > FALCON_MAX_ML) {
    throw new Error(
      `${totalSamples} samples x ${p.cultureVolumeUl} uL needs ${cultureMl.toFixed(1)} mL of culture, ` +
        `more than one ${FALCON_MAX_ML} mL Falcon holds. Reduce the batch count or the volume per tube.`,
    );
  }

  const buffers: BufferRequirement[] = [
    ...(preloaded ? [] : [{ label: "Resuspended culture", well: p.cultureWell, totalMl: cultureMl }]),
    { label: "Lysis buffer", well: p.lysisBufferWell, totalMl: (p.lysisVolumeUl * totalSamples) / 1000 },
    {
      label: "Neutralisation buffer",
      well: p.neutralisationBufferWell,
      totalMl: (p.neutralisationVolumeUl * totalSamples) / 1000,
    },
    {
      label: "Wash buffer",
      well: p.washBufferWell,
      totalMl: (p.washVolumeUl * p.washRounds * totalSamples) / 1000,
    },
    {
      label: "Elution buffer",
      well: p.elutionBufferWell,
      totalMl: (p.elutionVolumeUl * totalSamples * p.nElutions) / 1000,
    },
  ];
  for (const b of buffers) {
    if (b.totalMl > FALCON_MAX_ML) {
      warnings.push(
        `${b.label} needs ${b.totalMl.toFixed(1)} mL across the whole run, more than one ` +
          `${FALCON_MAX_ML} mL Falcon holds. Top it up at a batch pause, or split the run.`,
      );
    }
  }

  /* --------------------------------------------------------- tip budgeting */

  // Per batch: one shared tip for culture (none when tubes are pre-loaded), one
  // per tube for lysis, then either one per tube (mixing) or one per group
  // (reverse-pipetted), plus one shared tip for the wash pass and one per
  // elution pass.
  const neutralisationTipsPerBatch = p.neutralisationMix
    ? samplesPerBatch
    : Math.ceil(samplesPerBatch / LYSIS_GROUP_SIZE);
  const lysisBatchTips = (preloaded ? 0 : 1) + samplesPerBatch + neutralisationTipsPerBatch;
  const tipsUsed = p.nBatches * (lysisBatchTips + 1 + p.nElutions);

  /* ------------------------------------------------------------------ deck */

  const requests: LabwareRequest[] = [
    {
      id: "manifold",
      loadName: manifoldLoadName,
      label: "Vacuum manifold",
      kind: "tuberack",
      count: rackCount,
      // Chained by tubing: same row, one at the right edge.
      preferredSlots: MANIFOLD_PREFERRED_SLOTS,
      requirePreferred: true,
    },
    { id: "buffers", loadName: buffersLoadName, label: "Buffers", kind: "tuberack" },
    {
      id: "rack",
      loadName: tubeRackLoadName,
      label: "Sample tubes, then elution tubes",
      kind: "tuberack",
      count: rackCount,
    },
  ];

  // Fill the remaining free slots with tip racks, up to what the run needs.
  const fixedSlots = 1 + 2 * rackCount;
  const freeForTips = Math.max(
    1,
    deck.fixtures.length >= 0 ? 12 - deck.fixtures.flatMap((f) => f.slots).length - fixedSlots : 1,
  );
  const tipRacks = Math.max(1, Math.min(Math.ceil(tipsUsed / TIPS_PER_RACK), freeForTips));
  requests.push({
    id: "tips",
    loadName: P1000.tiprack,
    label: "1000 uL tips",
    kind: "tips",
    count: tipRacks,
  });

  const deckLayout = allocateDeck(deck, requests);
  const manifoldSlots = slotsFor(deckLayout, "manifold");
  const buffersSlot = slotsFor(deckLayout, "buffers")[0];
  const rackSlots = slotsFor(deckLayout, "rack");
  const tipSlots = slotsFor(deckLayout, "tips");
  const tipsOnDeck = tipSlots.length * TIPS_PER_RACK;

  // A batch's lysis/neutralisation cannot pause partway through for a refill,
  // so that stage's tips must all fit on the deck at once.
  if (lysisBatchTips > tipsOnDeck) {
    throw new Error(
      `Lysing and neutralising ${samplesPerBatch} tubes needs ${lysisBatchTips} tips, but only ` +
        `${tipsOnDeck} fit on the deck beside ${rackCount} rack(s) and manifold(s). ` +
        `Process fewer tubes per batch.`,
    );
  }
  if (tipsUsed > tipsOnDeck) {
    warnings.push(
      `The run needs ${tipsUsed} tips and the deck holds ${tipsOnDeck}. The protocol will ask for ` +
        `fresh racks at a batch pause — never mid-batch, so nothing sits in lysis buffer waiting.`,
    );
  }

  /* ---------------------------------------------------------------- steps */

  const rec = new StepRecorder();
  const rackId = (n: number) => (rackCount > 1 ? `rack:${n - 1}` : "rack");
  const rackLabel = (n: number) => (rackCount > 1 ? `Sample tubes ${n}` : "Sample tubes");
  const manifoldId = (n: number) => (rackCount > 1 ? `manifold:${n - 1}` : "manifold");
  const manifoldLabel = (n: number) => (rackCount > 1 ? `Vacuum manifold ${n}` : "Vacuum manifold");

  const pickUp = (label: string) =>
    rec.add({ kind: "pick_up_tip", slot: tipSlots[0], labwareId: "tips", labwareLabel: "1000 uL tips", label });
  const fromBuffer = (well: string, volumeUl: number, label: string) =>
    rec.add({
      kind: "aspirate",
      slot: buffersSlot,
      labwareId: "buffers",
      labwareLabel: "Buffers",
      well,
      volumeUl,
      label,
    });

  // Steps are recorded for batch 1 only; later batches repeat the same moves
  // on swapped labware, and the viewer would just replay them identically.
  if (preloaded) {
    rec.comment(
      `${samplesPerBatch} sample(s) already in their tubes`,
      "Each tube was loaded by hand with its own resuspended cells, so there is no culture pass.",
    );
  } else {
    rec.comment(
      `Culture: ${p.cultureVolumeUl} uL into ${samplesPerBatch} tube(s)`,
      "One shared tip, reverse-pipetted. The Falcon is mixed every few tubes so settled cells are resuspended.",
    );
    pickUp("Pick up tip — culture pass");
  }
  const cultureBatch = perAspirate(p.cultureVolumeUl);
  for (let i = 0; !preloaded && i < samplePositions.length; i += cultureBatch) {
    const group = samplePositions.slice(i, i + cultureBatch);
    fromBuffer(
      p.cultureWell,
      p.cultureVolumeUl * group.length,
      `Aspirate ${p.cultureVolumeUl * group.length} uL culture for ${group.length} tube(s)`,
    );
    for (const s of group) {
      rec.add({
        kind: "dispense",
        slot: rackSlots[s.rack - 1],
        labwareId: rackId(s.rack),
        labwareLabel: rackLabel(s.rack),
        well: s.tube,
        volumeUl: p.cultureVolumeUl,
        label: `Dispense culture into rack ${s.rack} ${s.tube}`,
        nonContact: true,
        note: `Dispensed ${OPEN_LID_CLEARANCE_MM} mm above the tube top, clearing open lids.`,
      });
    }
  }
  if (!preloaded) rec.add({ kind: "drop_tip", label: "Drop tip — culture pass done" });

  rec.comment(
    `Lysis and neutralisation, in groups of ${LYSIS_GROUP_SIZE}`,
    "Each group is lysed then neutralised before the next starts, so no tube sits in lysis buffer (invariant 5).",
  );
  for (let g = 0; g < samplePositions.length; g += LYSIS_GROUP_SIZE) {
    const group = samplePositions.slice(g, g + LYSIS_GROUP_SIZE);
    for (const s of group) {
      pickUp(`Pick up tip — lysis, rack ${s.rack} ${s.tube}`);
      fromBuffer(p.lysisBufferWell, p.lysisVolumeUl, `Aspirate ${p.lysisVolumeUl} uL lysis buffer`);
      rec.add({
        kind: "dispense",
        slot: rackSlots[s.rack - 1],
        labwareId: rackId(s.rack),
        labwareLabel: rackLabel(s.rack),
        well: s.tube,
        volumeUl: p.lysisVolumeUl,
        label: `Lyse rack ${s.rack} ${s.tube}${preloaded ? ` (${s.name})` : ""}, mix ${p.lysisMixReps}x`,
        nonContact: true,
      });
      rec.add({ kind: "drop_tip", label: `Drop tip — lysis ${s.tube}` });
    }
    if (p.neutralisationMix) {
      for (const s of group) {
        pickUp(`Pick up tip — neutralise rack ${s.rack} ${s.tube}`);
        fromBuffer(
          p.neutralisationBufferWell,
          p.neutralisationVolumeUl,
          `Aspirate ${p.neutralisationVolumeUl} uL neutralisation buffer`,
        );
        rec.add({
          kind: "dispense",
          slot: rackSlots[s.rack - 1],
          labwareId: rackId(s.rack),
          labwareLabel: rackLabel(s.rack),
          well: s.tube,
          volumeUl: p.neutralisationVolumeUl,
          label: `Neutralise rack ${s.rack} ${s.tube}, mix ${p.neutralisationMixReps}x`,
          nonContact: true,
        });
        rec.add({ kind: "drop_tip", label: `Drop tip — neutralise ${s.tube}` });
      }
    } else {
      pickUp("Pick up tip — neutralisation, shared across the group");
      const nBatch = perAspirate(p.neutralisationVolumeUl);
      for (let i = 0; i < group.length; i += nBatch) {
        const sub = group.slice(i, i + nBatch);
        fromBuffer(
          p.neutralisationBufferWell,
          p.neutralisationVolumeUl * sub.length,
          `Aspirate ${p.neutralisationVolumeUl * sub.length} uL neutralisation buffer`,
        );
        for (const s of sub) {
          rec.add({
            kind: "dispense",
            slot: rackSlots[s.rack - 1],
            labwareId: rackId(s.rack),
            labwareLabel: rackLabel(s.rack),
            well: s.tube,
            volumeUl: p.neutralisationVolumeUl,
            label: `Neutralise rack ${s.rack} ${s.tube}`,
            nonContact: true,
            note: "Non-contact, so one tip serves the group. A contacting tip clogged on this buffer.",
          });
        }
      }
      rec.add({ kind: "drop_tip", label: "Drop tip — group neutralised" });
    }
  }

  rec.comment(
    `Wash: ${p.washRounds} x ${p.washVolumeUl} uL per column`,
    "One shared tip. Each round covers every column before the next round starts, so a column drains " +
      "under vacuum while the rest are washed. Each aspirate covers as many columns as the p1000 holds.",
  );
  pickUp("Pick up tip — wash pass");
  const columnsPerAspirate = perAspirate(p.washVolumeUl);
  for (let r = 1; r <= p.washRounds; r++) {
    for (let i = 0; i < samplePositions.length; i += columnsPerAspirate) {
      const group = samplePositions.slice(i, i + columnsPerAspirate);
      fromBuffer(
        p.washBufferWell,
        p.washVolumeUl * group.length,
        `Aspirate ${p.washVolumeUl * group.length} uL wash buffer for ${group.length} column(s)`,
      );
      for (const s of group) {
        rec.add({
          kind: "dispense",
          slot: manifoldSlots[s.rack - 1],
          labwareId: manifoldId(s.rack),
          labwareLabel: manifoldLabel(s.rack),
          well: s.tube,
          volumeUl: p.washVolumeUl,
          label: `Wash ${r}/${p.washRounds} — manifold ${s.rack} ${s.tube}`,
          nonContact: true,
        });
      }
    }
  }
  rec.add({ kind: "drop_tip", label: "Drop tip — wash pass done" });

  rec.comment(
    `Elution: ${p.elutionVolumeUl} uL per column`,
    "One shared tip, reverse-pipetted into the elution tubes that replaced the sample racks.",
  );
  pickUp("Pick up tip — elution pass");
  const elutionBatch = perAspirate(p.elutionVolumeUl);
  for (let i = 0; i < samplePositions.length; i += elutionBatch) {
    const group = samplePositions.slice(i, i + elutionBatch);
    fromBuffer(
      p.elutionBufferWell,
      p.elutionVolumeUl * group.length,
      `Aspirate ${p.elutionVolumeUl * group.length} uL elution buffer for ${group.length} tube(s)`,
    );
    for (const s of group) {
      rec.add({
        kind: "dispense",
        slot: rackSlots[s.rack - 1],
        labwareId: rackId(s.rack),
        labwareLabel: rackLabel(s.rack),
        well: s.tube,
        volumeUl: p.elutionVolumeUl,
        label: `Elute into rack ${s.rack} ${s.tube}${preloaded ? ` (${s.name})` : ""}`,
        nonContact: true,
      });
    }
  }
  rec.add({ kind: "drop_tip", label: "Drop tip — elution pass done" });

  const steps = rec.all();

  /* ---------------------------------------------------------- python emit */

  const racksLiteral = cleaned.map((wells) => py(wells)).join(", ");
  const tipLoads = tipSlots
    .map((slot, i) => `tips_${i} = protocol.load_labware(${py(P1000.tiprack)}, ${py(slot)})`)
    .join("\n");
  const tipList = tipSlots.map((_, i) => `tips_${i}`).join(", ");

  // Culture mode keeps its original text exactly; pre-loaded mode drops the
  // culture function and pass, and lists which sample sits in which tube.
  const cultureFn = preloaded
    ? ""
    : `def add_culture():
    """One shared tip, reverse-pipetted. Every tube gets the same culture, and
    the dispense is above the tube, so the tip never contacts a sample."""
    culture = buffers[CULTURE_WELL]
    pick_up()
    for mix_start in range(0, len(tube_wells), CULTURE_MIX_EVERY):
        group = tube_wells[mix_start:mix_start + CULTURE_MIX_EVERY]
        p1000.mix(CULTURE_MIX_REPS, CULTURE_MIX_VOL_UL, culture.bottom(${FALCON_ASPIRATE_BOTTOM_MM}))
        for start in range(0, len(group), CULTURE_PER_ASPIRATE):
            batch = group[start:start + CULTURE_PER_ASPIRATE]
            p1000.aspirate(CULTURE_VOLUME_UL * len(batch), culture.bottom(${FALCON_ASPIRATE_BOTTOM_MM}))
            for well in batch:
                p1000.dispense(CULTURE_VOLUME_UL, well.top(DISPENSE_HEIGHT_MM))
    p1000.drop_tip()

`;

  const stageOne = preloaded
    ? `### 1. Lysis, neutralisation -- batch by batch ###
# Every tube was loaded by hand with its own resuspended sample, so there is no
# culture pass. Between batches, the next batch's samples go into the same
# positions.
for rack, (wells, names) in enumerate(zip(RACKS, SAMPLE_NAMES), start=1):
    for well, sample in zip(wells, names):
        protocol.comment(f"Rack {rack} {well}: {sample}")

for batch in range(1, N_BATCHES + 1):
    protocol.comment(f"Lysing and neutralising in groups of {LYSIS_GROUP_SIZE}{batch_label(batch)}")
    lyse_and_neutralise()
    if batch < N_BATCHES:
        batch_pause(
            f"Lysis and neutralisation done{batch_label(batch)}. Remove those tubes from "
            f"{TUBE_RACK_SLOTS} (invert to mix, then spin down), then load batch {batch + 1}'s "
            f"resuspended samples into the same positions. Resume when ready.",
            tips_needed_next=LYSIS_BATCH_TIPS,
        )`
    : `### 1. Culture, lysis, neutralisation -- batch by batch ###
# While one batch spins down off the deck, fresh tubes go into the same
# positions and are filled for the next.
for batch in range(1, N_BATCHES + 1):
    protocol.comment(f"Adding culture{batch_label(batch)}")
    add_culture()
    protocol.comment(f"Lysing and neutralising in groups of {LYSIS_GROUP_SIZE}{batch_label(batch)}")
    lyse_and_neutralise()
    if batch < N_BATCHES:
        batch_pause(
            f"Lysis and neutralisation done{batch_label(batch)}. Remove those tubes from "
            f"{TUBE_RACK_SLOTS} (invert to mix, then spin down), put fresh empty tubes in the same "
            f"positions for batch {batch + 1}, and invert the culture Falcon to resuspend. Resume when ready.",
            tips_needed_next=LYSIS_BATCH_TIPS,
        )`;

  const cultureConstants = preloaded
    ? `# Each tube already holds its own resuspended sample, loaded by hand. Names
# line up with RACKS, position for position, and cover batch 1.
SAMPLE_NAMES = [${cleaned
        .map((_, i) => py(samplePositions.filter((s) => s.rack === i + 1).map((s) => s.name)))
        .join(", ")}]
`
    : `CULTURE_VOLUME_UL = ${p.cultureVolumeUl}
CULTURE_WELL = ${py(p.cultureWell)}
CULTURE_PER_ASPIRATE = ${perAspirate(p.cultureVolumeUl)}
CULTURE_MIX_EVERY = ${Math.max(1, Math.round(p.cultureMixEvery))}
CULTURE_MIX_VOL_UL = ${p.cultureMixVolUl}
CULTURE_MIX_REPS = ${p.cultureMixReps}
`;

  const body = `
num_racks = len(RACKS)
samples_per_batch = sum(len(r) for r in RACKS)
num_samples = samples_per_batch * N_BATCHES
protocol.comment(
    f"Processing {num_samples} sample(s): {N_BATCHES} batch(es) of {samples_per_batch} "
    f"across {num_racks} rack(s)/manifold(s)"
)

${tipLoads}
protocol.load_trash_bin(${py(trashSlot(deck))})
p1000 = protocol.load_instrument(${py(P1000.name)}, mount=${py(P1000.mount)}, tip_racks=[${tipList}])

manifolds = [protocol.load_labware(${py(manifoldLoadName)}, slot) for slot in MANIFOLD_SLOTS]
buffers = protocol.load_labware(${py(buffersLoadName)}, ${py(buffersSlot)})
tube_racks = [protocol.load_labware(${py(tubeRackLoadName)}, slot) for slot in TUBE_RACK_SLOTS]

# (rack index, tube name) in one fixed order, so every stage treats the
# samples in the same sequence.
positions = [(i, name) for i, wells in enumerate(RACKS) for name in wells]
tube_wells = [tube_racks[i].wells_by_name()[name] for i, name in positions]
manifold_wells = [manifolds[i].wells_by_name()[name] for i, name in positions]

# Tips are counted so a refill can only ever be asked for at a batch pause.
tips_left = [len(p1000.tip_racks) * TIPS_PER_RACK]

def pick_up():
    p1000.pick_up_tip()
    tips_left[0] -= 1

def batch_pause(message, tips_needed_next):
    refill = tips_left[0] < tips_needed_next
    if refill:
        message += f" ALSO swap in {len(p1000.tip_racks)} full 1000 uL tip rack(s) before resuming."
    notify(message)
    protocol.pause(message)
    if refill:
        p1000.reset_tipracks()
        tips_left[0] = len(p1000.tip_racks) * TIPS_PER_RACK

def batch_label(batch):
    return f" (batch {batch}/{N_BATCHES})" if N_BATCHES > 1 else ""

${cultureFn}def lyse_and_neutralise():
    """Groups of LYSIS_GROUP_SIZE: lyse the group, neutralise that same group,
    then move on. Lysing every tube first would leave the earliest tubes in
    lysis buffer for the whole pass. Do not split this into two passes."""
    for start in range(0, len(tube_wells), LYSIS_GROUP_SIZE):
        group = tube_wells[start:start + LYSIS_GROUP_SIZE]

        for well in group:
            pick_up()
            p1000.aspirate(LYSIS_VOLUME_UL, buffers[LYSIS_BUFFER_WELL].bottom(${FALCON_ASPIRATE_BOTTOM_MM}))
            p1000.dispense(LYSIS_VOLUME_UL, well.top(DISPENSE_HEIGHT_MM))
            p1000.mix(LYSIS_MIX_REPS, LYSIS_MIX_VOL_UL, well)
            p1000.drop_tip()

        if NEUTRALISATION_MIX:
            for well in group:
                pick_up()
                p1000.aspirate(NEUTRALISATION_VOLUME_UL, buffers[NEUTRALISATION_BUFFER_WELL].bottom(${FALCON_ASPIRATE_BOTTOM_MM}))
                p1000.dispense(NEUTRALISATION_VOLUME_UL, well.top(DISPENSE_HEIGHT_MM))
                p1000.mix(NEUTRALISATION_MIX_REPS, NEUTRALISATION_MIX_VOL_UL, well)
                p1000.drop_tip()
        else:
            # Shared tip, reverse-pipetted. Legitimate only because the
            # dispense is above the tube: a tip that contacted this buffer and
            # went back for more caused repeated overpressure errors.
            pick_up()
            for i in range(0, len(group), NEUTRALISATION_PER_ASPIRATE):
                batch = group[i:i + NEUTRALISATION_PER_ASPIRATE]
                p1000.aspirate(NEUTRALISATION_VOLUME_UL * len(batch), buffers[NEUTRALISATION_BUFFER_WELL].bottom(${FALCON_ASPIRATE_BOTTOM_MM}))
                for well in batch:
                    p1000.dispense(NEUTRALISATION_VOLUME_UL, well.top(DISPENSE_HEIGHT_MM))
            p1000.drop_tip()

def wash():
    """Round by round, shared tip: every column gets one wash before any gets
    the next, so each column drains under vacuum while the others are washed.
    One aspirate covers as many columns as the p1000 can take."""
    pick_up()
    for _ in range(WASH_ROUNDS):
        for i in range(0, len(manifold_wells), WASH_COLUMNS_PER_ASPIRATE):
            batch = manifold_wells[i:i + WASH_COLUMNS_PER_ASPIRATE]
            p1000.aspirate(WASH_VOLUME_UL * len(batch), buffers[WASH_BUFFER_WELL].bottom(${FALCON_ASPIRATE_BOTTOM_MM}))
            for well in batch:
                p1000.dispense(WASH_VOLUME_UL, well.top(DISPENSE_HEIGHT_MM))
    p1000.drop_tip()

def elute(wells):
    """Shared tip, reverse-pipetted: 1000 uL covers 20 tubes at 50 uL."""
    pick_up()
    for i in range(0, len(wells), ELUTION_PER_ASPIRATE):
        batch = wells[i:i + ELUTION_PER_ASPIRATE]
        p1000.aspirate(ELUTION_VOLUME_UL * len(batch), buffers[ELUTION_BUFFER_WELL].bottom(${FALCON_ASPIRATE_BOTTOM_MM}))
        for well in batch:
            p1000.dispense(ELUTION_VOLUME_UL, well.top(DISPENSE_HEIGHT_MM))
    p1000.drop_tip()

notify(f"Miniprep started - {num_samples} sample(s)")

${stageOne}

first = "batch 1's " if N_BATCHES > 1 else ""
batch_pause(
    f"Lysis and neutralisation complete. Invert the rack(s) to mix, spin down at >12,000 g for 5 min, "
    f"transfer {first}supernatant onto the manifold columns, then take the tube rack(s) off "
    f"{TUBE_RACK_SLOTS}. Turn the vacuum on. Resume when ready.",
    tips_needed_next=1,
)

# The deck has no room for sample tubes and elution tubes at once, so the same
# slots are reused: the operator swapped the racks at the pause above.
for rack in tube_racks:
    protocol.move_labware(rack, OFF_DECK, use_gripper=False)
elution_racks = [protocol.load_labware(${py(tubeRackLoadName)}, slot) for slot in TUBE_RACK_SLOTS]
elution_wells = [elution_racks[i].wells_by_name()[name] for i, name in positions]

### 2. Wash, one batch of columns at a time ###
for batch in range(1, N_BATCHES + 1):
    protocol.comment(f"Washing columns{batch_label(batch)}")
    wash()
    if batch < N_BATCHES:
        batch_pause(
            f"Washing done{batch_label(batch)}. Remove those columns and spin them down to clear residual "
            f"ethanol, then load batch {batch + 1}'s supernatant onto fresh columns. Resume when ready.",
            tips_needed_next=1,
        )

batch_pause(
    f"Washing complete. Turn the vacuum off. Spin the columns down at >12,000 g for 1 min to remove "
    f"residual ethanol -- skipping this drops the yield badly -- then move {first}columns onto elution "
    f"tubes in {TUBE_RACK_SLOTS}. Resume when ready.",
    tips_needed_next=1,
)

### 3. Elution ###
for batch in range(1, N_BATCHES + 1):
    for elution in range(1, N_ELUTIONS + 1):
        label = f" (elution {elution}/{N_ELUTIONS})" if N_ELUTIONS > 1 else ""
        protocol.comment(f"Adding elution buffer{batch_label(batch)}{label}")
        elute(elution_wells)
        if elution < N_ELUTIONS:
            batch_pause(
                f"Elution {elution}/{N_ELUTIONS} added{batch_label(batch)}. Spin down, keep the eluate, "
                f"then move the same columns onto fresh tubes in the same positions. Resume when ready.",
                tips_needed_next=1,
            )
    if batch < N_BATCHES:
        batch_pause(
            f"Elution buffer added{batch_label(batch)}. Spin down, store those elutions at -20 C, then put "
            f"batch {batch + 1}'s columns onto elution tubes in the same positions. Resume when ready.",
            tips_needed_next=1,
        )

notify(f"Miniprep complete - {num_samples} sample(s). Spin down and store elutions at -20 C.")
protocol.comment("Miniprep complete. Spin down and store elutions at -20 C.")
`.trim();

  const bufferComment = buffers
    .map((b) => `#   ${b.well}  ${b.label.padEnd(22)} ${b.totalMl.toFixed(1)} mL for the whole run`)
    .join("\n");

  const source = finalise(
    preamble(
      {
        protocolName,
        description:
          `Vacuum-manifold miniprep of ${totalSamples} sample(s) ` +
          `(${p.nBatches} batch(es) of ${samplesPerBatch}) with ${p.nElutions} elution(s).`,
        author,
        apiLevel: "2.23",
      },
      notify,
      ["from opentrons.protocol_api import OFF_DECK"],
    ) +
      `
# One list per physical rack: which positions hold a sample. Positions are not
# shared between racks -- rack 1's "A1" and rack 2's "A1" are different tubes.
RACKS = [${racksLiteral}]
TUBE_RACK_SLOTS = ${py(rackSlots)}
MANIFOLD_SLOTS = ${py(manifoldSlots)}

# Load the buffers rack like this. Volumes include every batch.
${bufferComment}

${cultureConstants}
LYSIS_VOLUME_UL = ${p.lysisVolumeUl}
LYSIS_MIX_VOL_UL = ${p.lysisMixVolUl}
LYSIS_MIX_REPS = ${p.lysisMixReps}
LYSIS_BUFFER_WELL = ${py(p.lysisBufferWell)}

# Tubes lysed then neutralised before the next group starts. This bounds how
# long any tube sits in lysis buffer; do not raise it to cover the whole rack.
LYSIS_GROUP_SIZE = ${LYSIS_GROUP_SIZE}

NEUTRALISATION_VOLUME_UL = ${p.neutralisationVolumeUl}
NEUTRALISATION_BUFFER_WELL = ${py(p.neutralisationBufferWell)}
NEUTRALISATION_PER_ASPIRATE = ${perAspirate(p.neutralisationVolumeUl)}
NEUTRALISATION_MIX = ${py(p.neutralisationMix)}
NEUTRALISATION_MIX_VOL_UL = ${p.neutralisationMixVolUl}
NEUTRALISATION_MIX_REPS = ${p.neutralisationMixReps}

WASH_VOLUME_UL = ${p.washVolumeUl}
WASH_ROUNDS = ${p.washRounds}
WASH_BUFFER_WELL = ${py(p.washBufferWell)}
WASH_COLUMNS_PER_ASPIRATE = ${perAspirate(p.washVolumeUl)}

ELUTION_VOLUME_UL = ${p.elutionVolumeUl}
ELUTION_BUFFER_WELL = ${py(p.elutionBufferWell)}
ELUTION_PER_ASPIRATE = ${perAspirate(p.elutionVolumeUl)}
N_ELUTIONS = ${p.nElutions}

# Dispenses into open tubes and columns happen this far above their top, so the
# tip never travels at lid height -- tips used to catch on open lids.
DISPENSE_HEIGHT_MM = ${OPEN_LID_CLEARANCE_MM}

N_BATCHES = ${p.nBatches}
TIPS_PER_RACK = ${TIPS_PER_RACK}
LYSIS_BATCH_TIPS = ${lysisBatchTips}
` +
      runFunction(indent(body, 0), protocolName),
  );

  return {
    source,
    deckLayout,
    steps,
    warnings,
    samplePositions,
    samplesPerBatch,
    totalSamples,
    tipsUsed,
    tipsOnDeck,
    buffers,
  };
}
