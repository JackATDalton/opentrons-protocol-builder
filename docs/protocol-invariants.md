# Protocol invariants

Rules that must hold in every protocol this repo produces. **Each one was
broken by code that passed `opentrons_simulate` with no errors.** Simulation
checks that a command sequence can run, not that it is scientifically correct.

Use this as the review checklist for any change under `src/generators/`.

Where a rule can be checked by a machine it is, in
[`src/core/invariants.ts`](../src/core/invariants.ts), and the checks run in
the test suite. Where it cannot, it is enforced by the structure of the
generators and has to be read for.

---

## 1. A tip must never re-enter a source after touching a destination {#1}

**What went wrong.** The Golden Gate part transfer alternated
aspirate-from-repository / dispense-to-destination under a single tip. Anything
picked up from a destination well — master mix plus the parts already added —
was carried back into the shared repository plate on the next aspirate,
contaminating stock that every later plate drew from. Plates 4 and 5 and the
repository plate all had to be treated as suspect.

**The rule.** Bulk-aspirate for a whole batch, dispense to all of them, then
discard the tip. A tip goes source → destination(s) → trash.

**The exception.** A dispense that happens *above* the well, never contacting
its contents, leaves the tip clean. That is the only reason a single tip may
serve a whole water or buffer pass. Mark those steps `nonContact: true` so the
check knows, and so the exception is visible rather than assumed.

**Also allowed.** Re-aspirating the exact well just dispensed into — that is a
mix, and the liquid goes straight back.

*Checked by `checkTipHygiene`. Fixed in the private repo at `757e666`.*

---

## 2. A tip may be shared only across wells whose contents are identical {#2}

**What went wrong.** A generalised generator used one tip per unique part
value, reused across every well needing that part. But those wells already
held different earlier parts, so the tip carried each well's contents into the
next.

**The rule.** When adding part-type column *N*, group wells by the **full
prefix** of part values received so far, columns 1 through *N* inclusive.
Wells sharing that entire prefix hold identical liquid and can share a tip.
Once combinations diverge, use fresh tips.

In practice this reproduces what the hand-written protocol did, without
hardcoding column names: the first column groups by itself, the second by
(first, second), and by the third or fourth the combinations have usually
diverged well-by-well — which is simply one tip per well.

*Checked by `checkTipSharing` when a generator supplies a contents key.
Fixed in the private repo at `578bd55`.*

---

## 3. Positionally-paired well lists must come from the same traversal {#3}

**What went wrong.** Source wells were sorted column-major over a 3-row
selection while destination tubes were filled in column-major order over a
4-row rack. The strides differed, so the two lists agreed for the first column
and silently diverged from the second onward. Every downstream tube was
mislabelled, and nothing errored.

**The rule.** Use [`src/core/wells.ts`](../src/core/wells.ts) for all
ordering, on both sides of any pairing. Prefer matching by well **name** over
index. Where the shapes make name-matching impossible — a 4×6 rack against an
8×12 plate — **materialise the pairing by name into the emitted protocol**
rather than re-deriving it at run time, and print the loading map from the
same structure the robot reads.

*Enforced structurally; pinned by a regression test in `tests/wells.test.ts`
and by the transfer generator's ordering test. Fixed at `28e9f5f`.*

---

## 4. Check volumes against real labware capacity {#4}

**What went wrong.** A rescue plan would have pushed wells to 228 µL in wells
the lab treats as full at 150 µL.

**The rule.** Validate that the final volume of every well is within capacity,
and surface the constraint to the user instead of silently truncating. Note
that a definition's advertised capacity is not the working capacity: the 200 µL
PCR plates in use here are full at 150 µL.

*Checked by `checkWellCapacity`.*

---

## 5. Respect time-sensitive step ordering {#5}

**What went wrong.** A refactor changed the miniprep from "lyse a group,
neutralise that group, repeat" into "lyse everything, then neutralise
everything". The first tubes then sat in lysis buffer for the entire pass.

**The rule.** Where the chemistry is time-sensitive, interleave in small
groups. The miniprep uses groups of 4. **Do not "optimise" this into two
passes** — it looks like an obvious batching win and it ruins the samples.

Related: a tip-refill pause must never land mid-stage, or samples wait in
buffer for however long the operator takes.

*Enforced structurally, and pinned by the group-order test in
`tests/generators.test.ts`.*

---

## 6. Deck slots must never collide {#6}

**The rule.** Generators declare `LabwareRequest`s and let `allocateDeck`
assign slots. Never hardcode a slot name. Every lab's robot has different
fixed hardware, and a generator that assumes "thermocycler at A1/B1" emits
protocols that collide with someone else's deck.

Physical constraints go in `preferredSlots`: the vacuum manifolds are chained
by external tubing, so they must sit in the same row with one at the deck's
right edge.

*Enforced by `allocateDeck`, covered in `tests/deck.test.ts`.*

---

## 7. Never rely on liquid-level detection {#7}

**What went wrong.** It under-read badly and under-transferred nearly every
well. It is also invisible to simulation: `current_liquid_volume()` returns a
sentinel under `opentrons_simulate`, so any logic branching on it is never
exercised.

**The rule.** Source volumes are declared by the user. If you must add
volume-dependent logic, cover it with unit tests, not a simulation run.

---

## How to verify a change

```bash
npm install
npm run typecheck     # tsc -b --force; must be clean
npm test              # must pass; includes the invariant checks
npm run fixtures      # emit one protocol per generator
npm run simulate      # run every fixture through opentrons_simulate
```

Then **read the emitted protocol against this list by hand.** All seven
failures above simulated cleanly, so the simulator cannot be your only check.
