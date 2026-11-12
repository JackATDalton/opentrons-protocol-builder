/**
 * Pipetting parameters learned the hard way on the Steel Lab Flex.
 *
 * Every number here came out of a failed or marginal run, and each is
 * explained in `docs/pipetting-guide.md` with the experiment it came from.
 * Generators import these rather than writing their own literals, so a change
 * to the lab's practice is made once and the docs stay the single reference.
 *
 * If you change a value, change the guide in the same commit and say which
 * run justified it.
 */

/* ---------------------------------------------------------------- pipettes */

export const P50 = {
  name: "flex_1channel_50",
  tiprack: "opentrons_flex_96_tiprack_50ul",
  mount: "left",
  minUl: 1,
  maxUl: 50,
} as const;

export const P1000 = {
  name: "flex_1channel_1000",
  tiprack: "opentrons_flex_96_tiprack_1000ul",
  mount: "right",
  minUl: 5,
  maxUl: 1000,
} as const;

export const TIPS_PER_RACK = 96;

/* ----------------------------------------------------------- small volumes */

/**
 * Slow dispense for small and viscous volumes, as a fraction of the default
 * flow rate. 0.5 gave even distribution of 5-30 % glycerol mixes
 * (Pipetting Test, 2025-10-14).
 */
export const SLOW_DISPENSE_RATE = 0.5;

/**
 * Dispense this far off the well centre (x, mm) so the droplet is laid against
 * the wall rather than riding the tip. Used instead of touch_tip, which the
 * 2025-10-14 tests found added nothing (Plate3.py, normalisation).
 */
export const DISPENSE_X_OFFSET_MM = -0.2;

/* ------------------------------------------------------- reverse pipetting */

/**
 * Extra volume aspirated beyond what a reverse-pipetted batch dispenses, then
 * blown back into the source. In the 2025-10-14 test the last wells of a batch
 * came up short until the aspirate was raised from 45 to 50 uL; Plate3.py
 * aspirates 50 uL to dispense 6 x 7 uL, i.e. ~8 uL spare.
 */
export const REVERSE_EXCESS_MIN_UL = 5;
export const REVERSE_EXCESS_FRACTION = 0.15;

export function reverseExcessUl(dispensedUl: number): number {
  return Math.max(REVERSE_EXCESS_MIN_UL, Math.round(dispensedUl * REVERSE_EXCESS_FRACTION * 10) / 10);
}

/**
 * Largest number of wells one reverse-pipetted aspirate can serve, keeping
 * room for the excess. Never less than 1.
 */
export function reverseBatchSize(pipetteMaxUl: number, perWellUl: number): number {
  let n = Math.floor(pipetteMaxUl / perWellUl);
  while (n > 1 && n * perWellUl + reverseExcessUl(n * perWellUl) > pipetteMaxUl) n -= 1;
  return Math.max(1, n);
}

/**
 * Blow the reverse-pipetting excess back into the source this far above the
 * bottom. At top() the liquid stayed in the tip; at bottom(3) it went back
 * (Pipetting Test, 2025-10-14).
 */
export const RETURN_BLOWOUT_BOTTOM_MM = 3;

/* ---------------------------------------------------------- heights (mm) */

/**
 * Aspirate this far above a tube or well bottom. At default height the last
 * wells of a master-mix pass got air; bottom(1) fixed it (2025-10-14).
 * Raise to 2 if you see overpressure errors on a plate (2025-10-15).
 */
export const ASPIRATE_BOTTOM_MM = 1;
export const ASPIRATE_BOTTOM_PLATE_SAFE_MM = 2;

/** Aspirate this far above the bottom of a 50 mL Falcon. */
export const FALCON_ASPIRATE_BOTTOM_MM = 3;

/** Blow-out height after a small-volume contact dispense. */
export const SMALL_BLOWOUT_BOTTOM_MM = 1;

/**
 * Dispense this far *above* the top of open-lid 1.5 mL tubes and spin columns.
 * Lower, the tip caught on open lids while travelling between tubes
 * (miniprep, 2026-10).
 */
export const OPEN_LID_CLEARANCE_MM = 35;

/** Non-contact dispense depth below the rim of a plate well. */
export const NON_CONTACT_DISPENSE_TOP_MM = -2;

/* ----------------------------------------------------------- volumes */

/**
 * Working maximum of a 200 uL PCR plate well. The definition says 200; the lab
 * treats 150 as full, leaving room to mix without spilling.
 */
export const PCR_WELL_WORKING_MAX_UL = 150;

/**
 * Overage to make up in any hand-prepared master mix. The first automated
 * MoClo run lost its last reaction to an empty tube (2025-07-23).
 */
export const MASTER_MIX_OVERAGE_FRACTION = 0.1;

/** Default flow-speed of the gantry between moves for small-volume work. */
export const GANTRY_SPEED_MM_S = 500;
