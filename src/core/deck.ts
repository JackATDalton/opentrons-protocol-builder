/**
 * Deck configuration and slot allocation.
 *
 * Protocol generators must never hardcode deck slots. Every lab's robot has a
 * different set of permanently-installed modules, so a generator that assumes
 * "thermocycler is at A1/B1" produces protocols that collide with hardware on
 * someone else's machine.
 *
 * Instead: the user describes their robot once via a `DeckConfig`, generators
 * declare what labware they *need* via `LabwareRequest`s, and `allocateDeck`
 * assigns real slots from whatever is actually free.
 */

/** Flex deck: 4 rows (A-D) x 3 columns (1-3). */
export const FLEX_ROWS = ["A", "B", "C", "D"] as const;
export const FLEX_COLUMNS = [1, 2, 3] as const;

export function flexSlots(): string[] {
  const slots: string[] = [];
  for (const row of FLEX_ROWS) for (const col of FLEX_COLUMNS) slots.push(`${row}${col}`);
  return slots;
}

/** Hardware permanently installed on the deck, unavailable for labware. */
export interface DeckFixture {
  /** Slots this fixture physically occupies. A Thermocycler covers two. */
  slots: string[];
  kind: "thermocycler" | "heater_shaker" | "temperature_module" | "magnetic_block" | "absorbance_reader" | "trash" | "other";
  label: string;
  /**
   * When true, a generator that explicitly needs this module may load labware
   * onto it (e.g. Golden Gate puts its assembly plate on the thermocycler).
   * Otherwise the slots are simply blocked.
   */
  usableByProtocol?: boolean;
}

export interface DeckConfig {
  name: string;
  robot: "flex";
  /** All addressable slots. Defaults to the standard Flex 12. */
  slots?: string[];
  fixtures: DeckFixture[];
  /**
   * Where the user has moved labware, by assignment id (e.g. "tips:1" -> "D2").
   * Applied after allocation; a placement that breaks a constraint or lands on
   * a fixture is ignored rather than honoured.
   */
  placements?: Record<string, string>;
}

export type LabwareKind = "plate" | "tips" | "tuberack" | "reservoir" | "trash" | "module" | "reserved";

export interface LabwareRequest {
  /** Stable key the generator uses to look the assignment back up. */
  id: string;
  /** Opentrons loadName, or null for abstract reservations. */
  loadName: string | null;
  label: string;
  kind: LabwareKind;
  /** How many of this labware are needed. Defaults to 1. */
  count?: number;
  /**
   * Slots to try first, in order, before falling back to the general pool.
   * Use for physical constraints — e.g. chained vacuum manifolds must sit in
   * the same row with one at the deck's right edge.
   */
  preferredSlots?: string[];
  /** When true, allocation fails rather than falling back off preferredSlots. */
  requirePreferred?: boolean;
}

export interface DeckSlotAssignment {
  slot: string;
  id: string;
  loadName: string | null;
  label: string;
  kind: LabwareKind;
  /** Groups multi-slot fixtures (e.g. a Thermocycler) for display. */
  group: string | null;
  /** The only slots this labware may occupy, when a physical constraint pins it. */
  allowedSlots?: string[];
}

/** Labware the user may move: not a fixture, and not sitting on one. */
export function isMovable(a: DeckSlotAssignment): boolean {
  return a.group === null && a.kind !== "trash" && a.kind !== "reserved" && a.kind !== "module";
}

export class DeckAllocationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeckAllocationError";
  }
}

/** A bare Flex with only a trash bin — the safe default for a new user. */
export const BARE_FLEX: DeckConfig = {
  name: "Bare Flex",
  robot: "flex",
  fixtures: [{ slots: ["A3"], kind: "trash", label: "Trash" }],
};

/**
 * The Steel Lab Flex, kept as a worked example of a deck with fixed modules.
 * Copy this and edit it to describe your own robot.
 */
export const STEEL_LAB_FLEX: DeckConfig = {
  name: "Steel Lab Flex",
  robot: "flex",
  fixtures: [
    { slots: ["A1", "B1"], kind: "thermocycler", label: "Thermocycler", usableByProtocol: true },
    // The lab's transformation protocols load labware straight onto it, and
    // Golden Gate can build its assembly plate there when cycling elsewhere.
    { slots: ["D1"], kind: "temperature_module", label: "Heater block", usableByProtocol: true },
    { slots: ["A3"], kind: "trash", label: "Trash" },
  ],
};

export const DECK_PRESETS: DeckConfig[] = [BARE_FLEX, STEEL_LAB_FLEX];

/** Slots blocked by fixtures. */
export function occupiedSlots(config: DeckConfig): Set<string> {
  return new Set(config.fixtures.flatMap((f) => f.slots));
}

/** Slots available for generator-requested labware, in deck order. */
export function freeSlots(config: DeckConfig): string[] {
  const taken = occupiedSlots(config);
  return (config.slots ?? flexSlots()).filter((s) => !taken.has(s));
}

export function findFixture(config: DeckConfig, kind: DeckFixture["kind"]): DeckFixture | undefined {
  return config.fixtures.find((f) => f.kind === kind);
}

export function trashSlot(config: DeckConfig): string {
  const trash = findFixture(config, "trash");
  if (!trash) {
    throw new DeckAllocationError(
      `Deck "${config.name}" has no trash bin. Add a fixture with kind "trash" — every protocol needs somewhere to drop tips.`,
    );
  }
  return trash.slots[0];
}

/**
 * Assign real deck slots to a generator's labware requests.
 *
 * Requests with `preferredSlots` are placed first so they can claim their
 * required positions before the general pool is consumed.
 */
export function allocateDeck(config: DeckConfig, requests: LabwareRequest[]): DeckSlotAssignment[] {
  const pool = freeSlots(config);
  const available = new Set(pool);
  const assignments: DeckSlotAssignment[] = [];

  // Fixtures first, so the deck view always shows the full picture.
  for (const fixture of config.fixtures) {
    const group = fixture.slots.length > 1 ? `fixture:${fixture.kind}` : null;
    for (const slot of fixture.slots) {
      assignments.push({
        slot,
        id: `fixture:${fixture.kind}:${slot}`,
        loadName: null,
        label: fixture.label,
        kind: fixture.kind === "trash" ? "trash" : fixture.usableByProtocol ? "module" : "reserved",
        group,
      });
    }
  }

  const take = (slot: string): void => {
    available.delete(slot);
  };

  const totalRequested = requests.reduce((sum, r) => sum + (r.count ?? 1), 0);
  if (totalRequested > pool.length) {
    throw new DeckAllocationError(
      `This run needs ${totalRequested} deck slot(s) but only ${pool.length} are free on "${config.name}". ` +
        `Reduce the number of plates/racks, or remove a module from the deck config.`,
    );
  }

  // Preferred-slot requests get first refusal on their required positions.
  const ordered = [...requests].sort((a, b) => {
    const aPref = a.preferredSlots?.length ? 0 : 1;
    const bPref = b.preferredSlots?.length ? 0 : 1;
    return aPref - bPref;
  });

  for (const req of ordered) {
    const count = req.count ?? 1;
    for (let i = 0; i < count; i++) {
      let slot: string | undefined;

      if (req.preferredSlots?.length) {
        slot = req.preferredSlots.find((s) => available.has(s));
        if (!slot && req.requirePreferred) {
          throw new DeckAllocationError(
            `"${req.label}" must occupy one of [${req.preferredSlots.join(", ")}], but none are free on "${config.name}". ` +
              `Those slots are taken by deck fixtures or other labware.`,
          );
        }
      }

      slot ??= available.values().next().value as string | undefined;
      if (!slot) {
        throw new DeckAllocationError(
          `Ran out of deck slots while placing "${req.label}" on "${config.name}".`,
        );
      }

      take(slot);
      assignments.push({
        slot,
        id: count > 1 ? `${req.id}:${i}` : req.id,
        loadName: req.loadName,
        label: count > 1 ? `${req.label} ${i + 1}` : req.label,
        kind: req.kind,
        group: null,
        // Pinned labware may only move among the slots its constraint allows.
        ...(req.requirePreferred && req.preferredSlots?.length
          ? { allowedSlots: req.preferredSlots.slice(0, count) }
          : {}),
      });
    }
  }

  if (config.placements) applyPlacements(assignments, pool, config.placements, config.name);
  return assignments;
}

/**
 * Move labware to where the user put it.
 *
 * Valid placements are honoured first. Anything unplaced keeps its allocated
 * slot if that is still free, and otherwise takes the next free slot — so a
 * tip rack that appears after the user arranged the deck still finds a home.
 */
function applyPlacements(
  assignments: DeckSlotAssignment[],
  pool: string[],
  placements: Record<string, string>,
  deckName: string,
): void {
  const free = new Set(pool);
  const allows = (a: DeckSlotAssignment, slot: string) =>
    free.has(slot) && (!a.allowedSlots || a.allowedSlots.includes(slot));
  const movable = assignments.filter(isMovable);
  const taken = new Set<string>();
  const settled = new Set<DeckSlotAssignment>();

  for (const a of movable) {
    const target = placements[a.id];
    if (target && !taken.has(target) && allows(a, target)) {
      a.slot = target;
      taken.add(target);
      settled.add(a);
    }
  }
  for (const a of movable) {
    if (settled.has(a) || taken.has(a.slot)) continue;
    taken.add(a.slot);
    settled.add(a);
  }
  for (const a of movable) {
    if (settled.has(a)) continue;
    const slot = pool.find((s) => !taken.has(s) && allows(a, s));
    if (!slot) {
      throw new DeckAllocationError(`No free slot left for "${a.label}" on "${deckName}". Reset the deck layout.`);
    }
    a.slot = slot;
    taken.add(slot);
  }
}

/** Look up an assigned slot by request id. Throws if the id was never allocated. */
export function slotFor(assignments: DeckSlotAssignment[], id: string): string {
  const found = assignments.find((a) => a.id === id);
  if (!found) throw new DeckAllocationError(`No deck slot was allocated for "${id}".`);
  return found.slot;
}

/** Look up every slot assigned to a multi-count request, in allocation order. */
export function slotsFor(assignments: DeckSlotAssignment[], idPrefix: string): string[] {
  return assignments
    .filter((a) => a.id === idPrefix || a.id.startsWith(`${idPrefix}:`))
    .map((a) => a.slot);
}
