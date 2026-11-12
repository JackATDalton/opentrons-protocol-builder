# Pipetting guide

Everything here came out of a run that failed, under-delivered, or crashed on
this lab's Opentrons Flex. Each rule names the run it came from so you can
judge whether it applies to what you are doing.

The numbers are in [`src/core/pipetting.ts`](../src/core/pipetting.ts).
Generators import them rather than writing their own literals. **If you change
a value, change it there, update this file in the same commit, and say which
run justified it.**

> The single most important thing on this page: `opentrons_simulate` passing
> tells you a protocol is *runnable*, not that it is *right*. Every mistake
> below simulated cleanly. See [protocol-invariants.md](protocol-invariants.md).

---

## 1. Small volumes

### Historical result: reverse pipetting below 3 µL (15 Oct 2025)

Reverse pipetting 1 µL of part left **liquid in roughly one well in three** —
many wells had nothing at all, some had more than 1 µL. About 3 µL is the
floor for reverse pipetting on this machine.
*(Testing GG Part Pipetting, 15 Oct 2025)*

### Historical workaround: fresh tip and blow-out for ≤ 2 µL

```python
pipette.pick_up_tip()
pipette.aspirate(1, source.bottom(1))
pipette.dispense(1, dest.bottom(), rate=0.5)
pipette.blow_out(dest.bottom(1))   # at the BOTTOM, not the top
pipette.drop_tip()
```

This was consistent where reverse pipetting was not. It costs one tip per
well, which is the price of both accuracy and a clean source — the tip must
not go back to a shared stock plate once it has touched a destination
([invariant 1](protocol-invariants.md#1)).
*(Testing GG Part Pipetting, 15 Oct 2025; tip rule from the P006–P008
contamination, Aug 2026)*

### Golden Gate revision — 12 Nov 2026

At Jack's request, Golden Gate part transfers now choose technique by batch
size, regardless of volume. Wells with an identical full prefix of parts share
one pre-wetted tip. Aspirate exactly the batch total, dispense at rate 0.5
with the −0.2 mm x-offset, then blow out at `bottom(1)` in the final well and
discard the tip. Do not add the former ≥5 µL excess to part batches. Never
return to repository stock after destination contact.

A singleton uses a fresh tip, exact aspiration, the same slow offset dispense,
and a blow-out at `bottom(1)`. The 2–3 µL rejection gap is removed.
This supersedes the historical volume threshold for Golden Gate parts; it is
an operator-requested change awaiting bench validation, not a new experimental
result. The earlier observations above remain the record of the 2025 tests.
Master mix retains its separate excess-and-return method.

### Prefer scaling the reaction up to pipetting below 2 µL

A 20 µL reaction with 2 µL parts is far more forgiving than a 10 µL reaction
with 1 µL parts. If accuracy matters more than reagent cost, double the
reaction.
*(Plate 1 Assembly attempt 2, 10 Oct 2025)*

---

## 2. Reverse pipetting

The Golden Gate part-transfer revision in §1 is an explicit exception to the
excess-and-return method below.

Use it when **one liquid goes to many wells**: master mix, buffers, water,
culture. Aspirate more than you will dispense, dispense the per-well volume
repeatedly, then return the excess to the source.

### Leave real excess

Aspirating exactly `n × volume` leaves nothing to reverse-pipette with, and
the last wells of the batch come up short. In the 2025-10-14 test the first 8
wells of a pass ran dry until the aspirate went from 45 µL to 50 µL for the
same 42 µL of dispensing.

`reverseExcessUl()` uses the larger of 5 µL or 15 % of the batch.
*(Pipetting Test, 14 Oct 2025)*

### Blow the excess back at the bottom, not the top

```python
pipette.blow_out(source_tube.bottom(3))   # works
pipette.blow_out(source_tube.top())       # liquid stays in the tip
```

At `top()` the excess did not return to the tube. At `bottom(3)` it did.
*(Pipetting Test, 14 Oct 2025)*

### The blow-out also keeps the tip accurate

A single tip reused across a whole plate stayed accurate **because** of the
per-batch blow-out emptying it each time. Without it, residue accumulates.
*(Pipetting Test, 14 Oct 2025 — "repeated tip use doesn't seem to be affecting
aspirate accuracy as feared; blowout step important here")*

### Never blow out between wells mid-batch

A blow-out between the wells of one bulk aspirate empties the **entire**
remaining volume into that well. Blow out once, into the source, at the end of
the batch.

---

## 3. Dispensing

### Slow down, and go off-centre

```python
pipette.dispense(
    volume,
    dest.bottom().move(types.Point(x=-0.2, y=0, z=0)),
    rate=0.5,
)
```

Half rate gave even distribution across 5 %, 10 %, 20 % and 30 % glycerol.
The 0.2 mm offset lays the drop against the well wall instead of leaving it
riding the tip.
*(Pipetting Test, 14 Oct 2025; Plate3.py)*

### Do not use `touch_tip`

Tested directly and found to add nothing — "tip touching seems unneeded",
"the touch tip is really fast and doesn't feel like it does anything". The
off-centre slow dispense replaces it. This is the lab's settled position; one
later run re-added `touch_tip` to fix retention, but the off-centre dispense
addresses the same problem without the extra move.
*(Pipetting Test, 14 Oct 2025; Assembly of plate 1, 30 Jul 2025)*

### Fill column by column

Filling row-wise left the last wells of a pass short. Switching to column
order fixed it and the run dropped to 7 minutes.
*(Pipetting Test, 14 Oct 2025 — "will change code to actually go column by
column… perfect pipetting now")*

---

## 4. Viscous liquids

Enzyme master mixes, glycerol stocks and lysis buffer all behave badly at
default settings. On the first attempt most of a 5 µL enzyme transfer ended up
**on the outside of the tip** and only 2 of 4 wells got anything.

What fixed it:

- Reverse pipetting with a real excess.
- A pre-wet: aspirate and dispense back into the source once before starting.
- Dispense at `rate=0.5`, off-centre.
- Blow out the remainder back into the tube at `bottom(3)`.

A faster dispense (130–150 µL/s) was also found to help viscous mixes leave
the tip; the half-rate dispense is used because it is what the later, cleaner
runs settled on. If a thick liquid is beading on the tip, raising the gantry
speed is the knob to try next.
*(Assembly of plate 1 of training data, 29–30 Jul 2025)*

---

## 5. Heights

| Where | Use | Why |
|---|---|---|
| Aspirate from a tube or well | `.bottom(1)` | At default height the last wells of a pass got air. |
| Aspirate from a plate, if you see overpressure | `.bottom(2)` | Raising the tip cleared repeated overpressure errors. |
| Aspirate from a 50 mL Falcon | `.bottom(3)` | Clears the conical taper. |
| Blow out after a small-volume dispense | `.bottom(1)` | At the top the liquid does not leave the tip. |
| Return reverse-pipetting excess | `.bottom(3)` | Same reason. |
| Dispense into an open 1.5 mL tube or spin column | `.top(35)` | Below this the tip caught on open lids while travelling. |
| Non-contact dispense into a plate well | `.top(-2)` | Just inside the rim; keeps the tip clean. |

*(Pipetting Test, 14 Oct 2025; Testing GG Part Pipetting, 15 Oct 2025;
miniprep generator, Oct 2026)*

---

## 6. Tips, pressure and contamination

### Overpressure usually means a dirty or too-low tip

Repeated "pipette overpressure" errors came from reusing tips with viscous
buffer, and from aspirating too close to the bottom. Both fixes help: change
tips more often, and raise the aspirate height.
*(Miniprep in the Opentrons, 29 Sep 2025; Testing GG Part Pipetting, 15 Oct
2025)*

### A tip that will not come off is a calibration problem

Tips seating too firmly to release point at the **tip-rack offset**, not the
pipette. Recalibrate the rack.
*(Testing GG Part Pipetting, 15 Oct 2025)*

### Neutralisation buffer cannot be re-aspirated with a contacting tip

Every reuse of a tip for neutralisation buffer produced an overpressure error.
The protocol now dispenses it **above** the tube, which keeps the tip clean
and lets one tip serve a whole group.
*(Miniprep in the Opentrons, 29 Sep 2025)*

### One tip may serve many wells only if the wells are identical

See [invariant 2](protocol-invariants.md#2). Sharing a tip across wells that
already hold different parts cross-contaminates the difference. This is what
put plates 4 and 5, and the repository plate, in doubt in August 2026.

### A non-contact dispense keeps a tip clean

This is the exception that makes shared-tip buffer passes legal: if the tip
never touches the liquid in the well, it has picked nothing up and may return
to the source. It is asserted mechanically in
[`src/core/invariants.ts`](../src/core/invariants.ts), not just stated here.

---

## 7. Liquid-level detection: do not use it

The Flex's liquid-level sensor **is not accurate** on this machine. It
under-read badly on 13 Aug 2026 and under-transferred nearly every well.

It is also untestable: under `opentrons_simulate`, `current_liquid_volume()`
returns a sentinel whose comparisons are hardwired, so volume-capping logic
based on it is never actually exercised by a simulation.

Declare source volumes explicitly instead.
*(Assemble plates 4–10, 13 Jul 2026 — "Opentrons liquid level sensor is not
accurate at all")*

---

## 8. Volumes and capacity

- **A 200 µL PCR plate well is full at 150 µL** in this lab. Leave room to mix.
- **Make up 10 % extra master mix.** The first automated MoClo run lost its
  last reaction to an empty tube. *(First automated MoClo assembly, 23 Jul 2025)*
- **Validate the final volume against real capacity**, and tell the user,
  rather than silently truncating ([invariant 4](protocol-invariants.md#4)).

---

## 9. Plates, seals and evaporation

- **Seal the plate before thermocycling.** An unsealed run lost 64 of 96 wells
  to evaporation. Split assembly and cycling so there is a pause to apply a
  seal. *(Assembly of plate 1, 31 Jul 2025)*
- **Keep the source plate off the thermocycler.** Heat from the cycler
  evaporated the repository plate too. Put it on a cooled block or elsewhere
  on the deck.
- **Check the thermocycler plate offset in x** before a full plate; a bad
  offset made wells need a spin to collect liquid at the bottom.
  *(First automated MoClo assembly, 23 Jul 2025; Plate 1 GG assembly V3,
  21 Oct 2025)*

---

## 10. Miniprep specifics

- **Lyse and neutralise in groups of 4.** Lysing everything first leaves the
  earliest tubes in lysis buffer for the whole pass
  ([invariant 5](protocol-invariants.md#5)).
- **Resuspend by hand.** Robot resuspension of the cell pellet did not work.
  *(Miniprep in the Opentrons, 29 Sep 2025)*
- **Use tubes, not 24-well plates.** Lysed cells do not pellet in a plate —
  the g-force is too low to separate lysate from debris.
  *(Test Opentrons Miniprep Yields)*
- **At most 2 mL of culture per column.** More biomass overloads the column
  and the lysis/neutralisation step stops working. Four columns clogged on
  21 Oct 2025. *(Assemble plates 4–10, 6 Aug 2026)*
- **Always spin to remove residual ethanol before eluting.** Skipping it
  "significantly reduces yield". *(Plate 1 GG assembly V3, 21 Oct 2025)*
- **Mix the culture Falcon every few tubes** while dispensing, or the cells
  settle and later tubes get less.
- Yields match hand minipreps; hands-on time drops from ~2 h to ~30 min for
  24 samples. *(Miniprep repeats, 27 Nov 2025)*

---

## 11. Transformation specifics

- Current protocol: 30 min on ice, **30 s at 42 °C**, 5 min back on ice.
- **A zero-colony result is usually the competent cells, not the robot.**
  The Aug 2026 failure across plates 4–10 produced no colonies even on the
  pUC19 control, which points at the cells. NEB's BL21 guidance suggests 10 s
  rather than 30 s, which is worth testing, but the 30 s default stands until
  a run says otherwise. *(Transform plates 4-10 V1, 26–27 Aug 2026)*
- Budget ~25 µL of competent cells per well.
- The heat block takes ~1 min to reach 42 °C and ~6 min to return to 4 °C.
  Build that into the timing.

---

## 12. Protocol structure

- **Notify at every stage boundary.** An assembly once sat finished for 40
  minutes because no alert was sent. Protocols post to the lab Slack by
  default (see [`src/config/lab.ts`](../src/config/lab.ts)).
- **Pause rather than assume.** Anything needing a spin, a seal or a labware
  swap is a `protocol.pause()` with an instruction specific enough to follow
  without the written protocol to hand.
- **Only ask for tips at a stage boundary**, never mid-stage — a refill
  prompt partway through lysis leaves samples sitting in buffer.
- **Wrap the run in try/except and notify on failure**, so a crash at 2 a.m.
  is visible. `runFunction()` in [`src/core/emit.ts`](../src/core/emit.ts)
  does this for you.
