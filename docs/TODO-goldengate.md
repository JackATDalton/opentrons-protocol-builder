# Golden Gate assembly port status

The combinatorial Golden Gate assembly generator is now ported at
[`src/generators/goldengate.ts`](../src/generators/goldengate.ts), with its
setup view at [`src/ui/views/GoldenGateView.tsx`](../src/ui/views/GoldenGateView.tsx).
This document retains the behavioural specification and settled lab decisions
used to review future changes.

## Where the specification lives

The behaviour to reproduce is in the lab's private repo:

- `Normalisation/app/backend/goldengate_generator.py` — the generator,
  including the prefix-based tip grouping, the master-mix pass and the
  thermocycler profile.
- `GoldenGate/Plate3.py` — the hand-written protocol it generalises. This is
  the version that ran successfully in October 2025.

Both are the specification for behaviour. They are **not** the specification
for pipetting technique, because they disagree with each other and with what
the runs showed. Where they conflict, the decisions below win.

## Decisions already taken

These were settled by the lab on 9 Nov 2026; do not re-derive them.

1. **Master mix: reverse-pipetted with real excess.** Aspirate enough for the
   batch *plus* `reverseExcessUl()` worth of spare, dispense the per-well
   volume to each well, then blow the remainder back into the tube at
   `bottom(3)`. The Python generator had drifted to aspirating exactly
   `n × volume`, which leaves nothing to reverse-pipette with and starves the
   last wells of each batch.

2. **Dispense 0.2 mm off-centre at `rate=0.5`, with no `touch_tip`.**
   `Plate3.py` did exactly this. The Python generator added
   `touch_tip(v_offset=-3)`; the direct test of touch_tip found it added
   nothing, and the off-centre dispense solves the same retention problem.

3. **Singleton part batches: exact transfer with a fresh tip.** Aspirate the
   exact volume, dispense at `rate=0.5` with the −0.2 mm x-offset, blow out at
   `bottom(1)`, then discard. Technique follows batch size, not volume.

4. **Shared part batches: exact total and final-well blow-out.** Group by the
   full prefix of parts received so far (invariant 2), pre-wet, aspirate exactly
   the batch total, dispense slowly off-centre, then blow out at `bottom(1)`
   in the final well and discard. No excess and no return to repository stock.
   **12 Nov 2026 revision requested by Jack; bench validation pending.** This
   supersedes the ≤2 µL rule and removes the 2–3 µL rejection gap. Preserve the
   2025 result as history in the pipetting guide. Master mix is unchanged.

5. **Master-mix columns are skipped entirely.** Any part-type column the user
   marks as premixed by hand is never pipetted, spends no tips and needs no
   repository-plate lookup.

6. **The thermocycler is a deck fixture, not an assumption.** Request it from
   the deck config rather than hardcoding A1/B1. `STEEL_LAB_FLEX` marks it
   `usableByProtocol: true`, meaning labware may be loaded onto it.

7. **Pause before cycling** so the operator can seal the plate. An unsealed
   run lost 64 of 96 wells to evaporation.

## Port checklist

- [`docs/protocol-invariants.md`](protocol-invariants.md), in particular
  invariants 1 and 2 — this generator is where both were originally broken.
- `checkTipHygiene` and `checkTipSharing` from
  [`src/core/invariants.ts`](../src/core/invariants.ts), with a contents key
  built from each well's accumulated part prefix.
- [x] Fixture in `scripts/write-fixtures.ts`, passing `opentrons_simulate`.
- [x] Emits `ProtocolStep[]` alongside Python from the generator's plan.
- [x] UI view accepts assembly and repository plate CSV input.
- [x] Tests cover prefix grouping, small-volume tip use, hygiene, and deck/module requirements.
- [x] One tip serves the whole master-mix pass, as in `Plate3.py` and the
  Python generator. Legitimate because every dispense is the first liquid into
  an empty well; the steps carry `intoEmpty`, and `checkTipHygiene` rejects
  that flag on any well that already received liquid.
- [x] Several assembly plates at once, one protocol per plate, matching the
  original app's bulk mode.
- [x] Part-volume check across all loaded plates against an optional volumes
  CSV (`checkPartVolumes` + `parseVolumesCsv`), shown on the Plan tab.
- [x] Master-mix columns as checkboxes discovered from the layout headers,
  plate type, protocol name, master-mix tube well, pre-wet volume and the full
  thermocycler profile are all editable in the view.
- [x] Option to cycle on an external thermocycler instead of the Flex module
  (an addition over the original app, not a port). When cycling elsewhere, the
  plate can be built on a free deck slot or on the heater block, which stands
  in for the thermocycler's cold block (loaded directly, as the lab's
  transformation protocols load labware onto it).

One deliberate non-port: the original generator silently skipped parts missing
from the repository plate, emitting a comment mid-run. A well missing a part
is a failed assembly, so this port refuses to generate instead, and the
volume-check table shows NOT IN REPO rows before generation is attempted.

The parsers it needs are already ported and tested:
`parseAssemblyLayout`, `buildPartIndex` and `checkPartVolumes` in
[`src/parsers/assembly-layout.ts`](../src/parsers/assembly-layout.ts).

## Known-bad source

`AL-4-protein_expression/96well_GG_assembly_plate1.py` is the **buggy**
version. Lines 287–290 aspirate from the repository plate inside the
destination loop, which is the invariant 1 violation behind the P006–P008
contamination. Do not use it as a reference.
