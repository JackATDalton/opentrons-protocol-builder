/**
 * Machine-readable step list, and the deck geometry needed to draw it.
 *
 * A generator emits Python *and* a `ProtocolStep[]` from the same plan, in the
 * same loop. That matters: a visualiser that re-parsed the emitted Python, or
 * rebuilt the order from the plan independently, would be a second
 * implementation of the ordering logic — exactly the divergence invariant 3
 * exists to prevent. The steps are the record of what the robot was told to
 * do, so if the animation looks wrong, the protocol *is* wrong.
 *
 * Coordinates are in millimetres from the deck's front-left corner, matching
 * the labware definitions' own well coordinates. They are good enough to show
 * where the arm travels; they are not a kinematic model.
 */

import type { DeckSlotAssignment } from "./deck";
import { geometryFor, LABWARE, type LabwareGeometry, type Point } from "./labware";

export type StepKind =
  | "pick_up_tip"
  | "aspirate"
  | "dispense"
  | "blow_out"
  | "drop_tip"
  | "comment";

export interface ProtocolStep {
  /** Position in the run, from 1. */
  index: number;
  kind: StepKind;
  /** Deck slot the arm is over, e.g. "C2". Absent for comments. */
  slot?: string;
  /** Labware request id, matching the deck allocation. */
  labwareId?: string;
  /** Human label for the labware, e.g. "Tube rack 1". */
  labwareLabel?: string;
  /** Well or tube name, e.g. "A1". */
  well?: string;
  volumeUl?: number;
  /** Which tip is on the pipette, counted from 1. Lets a viewer colour by tip. */
  tipId?: number;
  /** One line describing the step, shown in the step list. */
  label: string;
  /** Why this step is where it is — surfaces invariants in the UI. */
  note?: string;
  /**
   * Set on a dispense that happens *above* the well, so the tip never contacts
   * its contents. This is what makes a shared tip legitimate: a tip that has
   * only ever dispensed non-contact may still return to a source. Any dispense
   * without this flag dirties the tip permanently. Tests assert the rule
   * against this field, so the exception is checked rather than commented.
   */
  nonContact?: boolean;
  /**
   * Set on a contacting dispense that is the first liquid into an empty well.
   * Touching an empty well leaves the tip clean, so it may return to its
   * source — the master-mix pass serves a whole plate from one tip this way.
   * `checkTipHygiene` rejects the flag on any well that already received
   * liquid, so the claim is policed rather than assumed.
   */
  intoEmpty?: boolean;
  /** Sample this step is handling, for filtering. */
  sample?: string;
}

/** Collects steps so a generator never has to track indices by hand. */
export class StepRecorder {
  private readonly steps: ProtocolStep[] = [];
  private tip = 0;

  /** Current tip number, or 0 when no tip is attached. */
  get currentTip(): number {
    return this.tip;
  }

  add(step: Omit<ProtocolStep, "index" | "tipId">): ProtocolStep {
    if (step.kind === "pick_up_tip") this.tip += 1;
    const recorded: ProtocolStep = {
      ...step,
      index: this.steps.length + 1,
      tipId: this.tip > 0 ? this.tip : undefined,
    };
    this.steps.push(recorded);
    if (step.kind === "drop_tip") this.tipDropped();
    return recorded;
  }

  comment(label: string, note?: string): void {
    this.add({ kind: "comment", label, note });
  }

  private tipDropped(): void {
    // The tip number keeps incrementing so each tip stays distinguishable in
    // the viewer; only the "is a tip attached" state resets.
  }

  all(): ProtocolStep[] {
    return [...this.steps];
  }

  /** Total tips consumed — checked against rack capacity by the generators. */
  tipCount(): number {
    return this.tip;
  }
}

/* ------------------------------------------------------------------ geometry */

export type { Point } from "./labware";

/** Drawing geometry for a load name. See `labware.ts`, the one registry. */
export type LabwareLayout = LabwareGeometry;
export { LABWARE_GEOMETRY as LABWARE_LAYOUTS } from "./labware";

export function layoutFor(loadName: string | null | undefined): LabwareLayout {
  return geometryFor(loadName);
}

const SBS_FOOTPRINT: Point = { x: 127.76, y: 85.48 };

/**
 * Front-left corner of a Flex deck slot, in mm.
 *
 * Row A is at the *back* of the robot and D at the front, so A has the largest
 * y. The viewer draws y downward, which puts A at the top of the screen —
 * matching how the deck looks when you stand in front of the robot.
 */
export const SLOT_PITCH: Point = { x: 164, y: 107 };
export const DECK_ROWS = ["A", "B", "C", "D"];
export const DECK_COLUMNS = [1, 2, 3];

export function slotOrigin(slot: string): Point {
  const row = slot[0].toUpperCase();
  const column = Number(slot.slice(1));
  const rowIndex = DECK_ROWS.indexOf(row);
  const colIndex = DECK_COLUMNS.indexOf(column);
  if (rowIndex < 0 || colIndex < 0) throw new Error(`"${slot}" is not a Flex deck slot.`);
  return { x: colIndex * SLOT_PITCH.x, y: rowIndex * SLOT_PITCH.y };
}

/** Absolute deck position of a well, for drawing the arm's travel. */
export function wellPosition(slot: string, loadName: string | null | undefined, well: string): Point {
  const layout = layoutFor(loadName);
  const match = /^([A-Z]+)(\d+)$/.exec(well.trim().toUpperCase());
  if (!match) throw new Error(`"${well}" is not a valid well name.`);
  const rowIndex = layout.shape.rows.indexOf(match[1]);
  const colIndex = layout.shape.columns.indexOf(Number(match[2]));
  const origin = slotOrigin(slot);
  // Fall back to the labware centre for a well the layout doesn't know, so an
  // unfamiliar loadName degrades to a plausible drawing instead of an error.
  if (rowIndex < 0 || colIndex < 0) {
    return { x: origin.x + layout.size.x / 2, y: origin.y + layout.size.y / 2 };
  }
  return {
    x: origin.x + layout.origin.x + colIndex * layout.spacing.x,
    y: origin.y + layout.origin.y + rowIndex * layout.spacing.y,
  };
}

/** Full deck extent, for sizing the viewer's SVG. */
export function deckSize(): Point {
  return {
    x: (DECK_COLUMNS.length - 1) * SLOT_PITCH.x + SBS_FOOTPRINT.x,
    y: (DECK_ROWS.length - 1) * SLOT_PITCH.y + SBS_FOOTPRINT.y,
  };
}

/* -------------------------------------------------------------------- replay */

export interface DeckState {
  /** `${labwareId}:${well}` -> volume in uL. */
  volumes: Map<string, number>;
  /** `${labwareId}:${well}` of tip-rack positions already consumed. */
  tipsUsed: Set<string>;
  /** Where the arm is now, and where it moved from. */
  at?: { slot: string; labwareId?: string; well?: string };
  from?: { slot: string; labwareId?: string; well?: string };
}

const TIP_ROWS = geometryFor(LABWARE.tips50).shape.rows;

/**
 * Replay the first `upTo` steps to get the deck's state at that point.
 *
 * Replaying from the start rather than stepping incrementally means scrubbing
 * backwards is exact instead of an approximation, and it keeps the viewer
 * stateless. Destination aspirates are ignored because the only thing that
 * aspirates from a destination here is a mix, which puts the liquid back.
 */
export function replaySteps(
  steps: ProtocolStep[],
  upTo: number,
  deckLayout: DeckSlotAssignment[] = [],
): DeckState {
  const volumes = new Map<string, number>();
  const tipsUsed = new Set<string>();
  let at: DeckState["at"];
  let from: DeckState["from"];
  // Tips drain per pipette, so count each tip-rack group separately.
  const tipIndexByGroup = new Map<string, number>();
  const trash = deckLayout.find((a) => a.kind === "trash");

  for (let i = 0; i < upTo && i < steps.length; i++) {
    const s = steps[i];
    if (s.kind === "comment") continue;

    if (s.kind === "pick_up_tip" && s.labwareId) {
      // The emitted protocol lets the API pick the next tip: column-major
      // through the first rack, then on to the next. Mirror that, so the arm
      // goes where the robot's will rather than always to A1.
      const tip = nextTip(s, tipIndexByGroup, deckLayout);
      tipsUsed.add(`${tip.labwareId}:${tip.well}`);
      from = at;
      at = tip;
      continue;
    }

    if (s.kind === "drop_tip") {
      // Steps record no position for a drop; the robot goes to the trash.
      if (trash) {
        from = at;
        at = { slot: trash.slot, labwareId: trash.id };
      }
      continue;
    }

    if (s.kind === "dispense" && s.labwareId && s.well && s.volumeUl) {
      const key = `${s.labwareId}:${s.well}`;
      volumes.set(key, (volumes.get(key) ?? 0) + s.volumeUl);
    }
    if (s.kind === "aspirate" && s.labwareId && s.well && s.volumeUl && s.labwareId !== "dest") {
      const key = `${s.labwareId}:${s.well}`;
      volumes.set(key, (volumes.get(key) ?? 0) - s.volumeUl);
    }

    if (s.slot) {
      from = at;
      at = { slot: s.slot, labwareId: s.labwareId, well: s.well };
    }
  }

  return { volumes, tipsUsed, at, from };
}

/**
 * Where the next tip comes from. A generator records pick-ups against a
 * request id ("tips"); with several racks the deck names them "tips:0",
 * "tips:1", in the order the pipette's tip_racks list them.
 */
function nextTip(
  s: ProtocolStep,
  tipIndexByGroup: Map<string, number>,
  deckLayout: DeckSlotAssignment[],
): { slot: string; labwareId: string; well: string } {
  const group = s.labwareId as string;
  const racks = deckLayout.filter((a) => a.id === group || a.id.startsWith(`${group}:`));
  const index = tipIndexByGroup.get(group) ?? 0;
  tipIndexByGroup.set(group, index + 1);

  const perRack = TIP_ROWS.length * 12;
  // Past the last rack the operator has refilled, so wrap to the first.
  const rack = racks.length ? racks[Math.floor(index / perRack) % racks.length] : undefined;
  const inRack = index % perRack;
  const well = `${TIP_ROWS[inRack % TIP_ROWS.length]}${Math.floor(inRack / TIP_ROWS.length) + 1}`;
  return { slot: rack?.slot ?? s.slot ?? "", labwareId: rack?.id ?? group, well };
}
