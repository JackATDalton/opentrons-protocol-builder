/**
 * Mechanical checks of the protocol invariants against a generator's steps.
 *
 * Every invariant in docs/protocol-invariants.md was broken by code that
 * passed `opentrons_simulate` with no errors. Simulation proves a command
 * sequence is *runnable*, not that it is *right*. These checks close part of
 * that gap: they run over the `ProtocolStep[]` a generator emits alongside its
 * Python, so a violation fails a test instead of contaminating a plate.
 *
 * What this can check: tip hygiene and cross-contamination (invariants 1 and
 * 2), and well capacity (invariant 4). What it cannot: whether a positional
 * pairing is correct (invariant 3 — enforced by both sides coming from
 * `wells.ts`), or whether time-sensitive steps interleave (invariant 5 —
 * enforced by generator structure and reviewed by eye).
 */
import type { ProtocolStep } from "./steps";

export interface Violation {
  invariant: number;
  /** Step index the violation was detected at. */
  step: number;
  message: string;
}

/** Labware a tip may legitimately return to after dispensing. */
export interface InvariantOptions {
  /**
   * Labware ids treated as destinations. A tip that contacts one of these may
   * never go back to any other labware. Defaults to inferring destinations
   * from the steps: anything a contacting dispense targets.
   */
  destinationIds?: string[];
  /** Per-labware well capacity in uL, for the capacity check. */
  capacityUl?: Record<string, number>;
}

/**
 * Check tip hygiene over a step list.
 *
 * The rule, stated once: a tip becomes *dirty* the moment it makes a dispense
 * that contacts a well's contents. A dirty tip may not aspirate anywhere
 * except the well it just dirtied (a mix). Dispensing above a well, flagged
 * `nonContact`, leaves the tip clean — which is the only reason a shared tip
 * may serve a whole buffer or water pass.
 */
export function checkTipHygiene(steps: ProtocolStep[]): Violation[] {
  const violations: Violation[] = [];

  // Where this tip has made a contacting dispense, as `labwareId:well`.
  let contacted = new Set<string>();
  let contactedLabware = new Set<string>();
  // Wells that have received any liquid, to police the `intoEmpty` claim.
  const received = new Set<string>();

  for (const s of steps) {
    if (s.kind === "pick_up_tip" || s.kind === "drop_tip") {
      contacted = new Set();
      contactedLabware = new Set();
      continue;
    }

    if (s.kind === "dispense" && s.labwareId) {
      const key = `${s.labwareId}:${s.well ?? ""}`;
      if (s.intoEmpty && received.has(key)) {
        violations.push({
          invariant: 1,
          step: s.index,
          message:
            `Step ${s.index} claims ${s.labwareLabel ?? s.labwareId} ${s.well ?? ""} is empty, but an ` +
            `earlier step already dispensed into it. A contacting dispense there dirties the tip; drop ` +
            `the intoEmpty flag or use a fresh tip.`,
        });
      }
      received.add(key);
      // A dispense above the well, or the first liquid into an empty one,
      // leaves the tip clean. Everything else dirties it.
      if (!s.nonContact && !s.intoEmpty) {
        contacted.add(key);
        contactedLabware.add(s.labwareId);
      }
      continue;
    }

    if (s.kind === "aspirate" && s.labwareId) {
      const key = `${s.labwareId}:${s.well ?? ""}`;
      // Re-aspirating from the exact well just dispensed into is a mix, which
      // puts the liquid straight back and carries nothing anywhere new.
      if (contacted.size && !contacted.has(key)) {
        violations.push({
          invariant: 1,
          step: s.index,
          message:
            `Step ${s.index} aspirates from ${s.labwareLabel ?? s.labwareId} ${s.well ?? ""} with a tip that ` +
            `already dispensed into ${[...contacted].join(", ")}. Anything picked up there would be carried ` +
            `back into a shared source. Drop the tip first, or make the dispense non-contact.`,
        });
      }
    }
  }

  return violations;
}

/**
 * Check that no tip is shared between wells whose contents differ.
 *
 * `contentsOf` maps a destination well to a key describing everything in it.
 * Wells with equal keys hold identical liquid and may share a tip; once the
 * keys diverge, sharing cross-contaminates the difference (invariant 2).
 */
export function checkTipSharing(
  steps: ProtocolStep[],
  contentsOf: (labwareId: string, well: string) => string | null,
): Violation[] {
  const violations: Violation[] = [];
  let seen: { key: string; well: string } | null = null;

  for (const s of steps) {
    if (s.kind === "pick_up_tip" || s.kind === "drop_tip") {
      seen = null;
      continue;
    }
    if (s.kind !== "dispense" || s.nonContact || !s.labwareId || !s.well) continue;

    const key = contentsOf(s.labwareId, s.well);
    if (key === null) continue;

    if (seen && seen.key !== key) {
      violations.push({
        invariant: 2,
        step: s.index,
        message:
          `Step ${s.index} dispenses into ${s.well} with the tip that served ${seen.well}, but those wells ` +
          `hold different liquid (${seen.key} vs ${key}). Use a fresh tip once combinations diverge.`,
      });
      return violations;
    }
    seen = { key, well: s.well };
  }

  return violations;
}

/**
 * Check that replaying the steps never pushes a well past its capacity.
 *
 * A rescue plan once would have put 228 uL into 150 uL wells and simulated
 * fine (invariant 4).
 */
export function checkWellCapacity(
  steps: ProtocolStep[],
  capacityUl: Record<string, number>,
): Violation[] {
  const violations: Violation[] = [];
  const volumes = new Map<string, number>();
  const reported = new Set<string>();

  for (const s of steps) {
    if (!s.labwareId || !s.well || !s.volumeUl) continue;
    const key = `${s.labwareId}:${s.well}`;
    const capacity = capacityUl[s.labwareId];

    if (s.kind === "dispense") {
      const next = (volumes.get(key) ?? 0) + s.volumeUl;
      volumes.set(key, next);
      if (capacity !== undefined && next > capacity + 1e-6 && !reported.has(key)) {
        reported.add(key);
        violations.push({
          invariant: 4,
          step: s.index,
          message:
            `Step ${s.index} brings ${s.labwareLabel ?? s.labwareId} ${s.well} to ${next.toFixed(1)} uL, ` +
            `over its ${capacity} uL working capacity.`,
        });
      }
    } else if (s.kind === "aspirate") {
      volumes.set(key, Math.max(0, (volumes.get(key) ?? 0) - s.volumeUl));
    }
  }

  return violations;
}

/** Run every check that needs no generator-specific knowledge. */
export function checkAll(steps: ProtocolStep[], options: InvariantOptions = {}): Violation[] {
  return [
    ...checkTipHygiene(steps),
    ...(options.capacityUl ? checkWellCapacity(steps, options.capacityUl) : []),
  ];
}

/** Format violations for a test failure or a CI log. */
export function formatViolations(violations: Violation[]): string {
  if (!violations.length) return "No invariant violations.";
  return violations
    .map((v) => `invariant ${v.invariant}, step ${v.step}: ${v.message}`)
    .join("\n");
}
