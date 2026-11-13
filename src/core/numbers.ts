/**
 * Rounding for volumes and concentrations shown to people and written into
 * protocols. One place, so a plan table and the emitted PLAN round alike.
 */

/** To 0.1 — volumes in uL. */
export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** To 0.01 — concentrations in ng/uL. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
