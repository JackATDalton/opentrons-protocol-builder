# Adding a protocol

The anatomy of a generator, using `src/generators/transfer.ts` as the shortest
worked example. Read [protocol-invariants.md](protocol-invariants.md) first.

## Quick start

Read [the agent workflow](agent-workflow.md) for a copyable task brief and a
headless generation example. When no existing generator fits, run:

```bash
npm run protocol:new -- your-protocol-name --dry-run
npm run protocol:new -- your-protocol-name
```

This wires a plate-to-tube starter into the app, tests and simulation fixtures.
Adapt the experimental behaviour before lab use; follow the steps below.

## Why generators rather than scripts

A hand-written protocol carries only the care of whoever wrote it that day. A
generator carries every rule in this repo, every time, and is checked by tests.
The lab's two worst automation incidents — a contaminated repository plate and
a plate of samples left in lysis buffer — were both hand edits to a working
script that passed simulation.

So: extend a generator if one is close. Write a new one if none is.

## The shape

### 1. Options interface

One interface, every knob explicit, units in the field name (`volumeUl`, not
`volume`). Defaults as named constants, not inline literals.

```ts
export interface TransferOptions {
  deck: DeckConfig;
  plates: SourcePlate[];
  transferVolumeUl: number;
  notify?: NotifyConfig;
}
```

### 2. Validate, then plan

Validate inputs before touching the deck, and fail with a message that says
what to change:

```ts
if (transferVolumeUl < P1000.minUl || transferVolumeUl > P1000.maxUl) {
  throw new Error(`Transfer volume must be between ${P1000.minUl} and ${P1000.maxUl} uL …`);
}
```

Build a plan — one entry per well or tube, fully resolved. Collect
`warnings: string[]` for anything the user should know but that should not stop
the run, such as a well that cannot reach target. Throw only when the run
cannot proceed.

Take all ordering from [`src/core/wells.ts`](../src/core/wells.ts)
([invariant 3](protocol-invariants.md#3)).

### 3. Declare labware, let the deck allocate it

Never name a slot:

```ts
const requests: LabwareRequest[] = [
  { id: "tips", loadName: P1000.tiprack, label: "1000 uL tips", kind: "tips", count: n },
  { id: "rack", loadName: TUBE_RACK, label: "Tube rack", kind: "tuberack", count: rackCount },
];
const deckLayout = allocateDeck(deck, requests);
const rackSlots = slotsFor(deckLayout, "rack");
```

Physical constraints go in `preferredSlots` with a comment saying what the
constraint is — the vacuum manifolds are chained by tubing, so one must be at
the deck's right edge.

### 4. Emit Python and steps from the same loop

This is the part that matters. Record a `ProtocolStep` beside every command:

```ts
const rec = new StepRecorder();
rec.add({ kind: "aspirate", slot, labwareId, well, volumeUl, label: "…" });
```

One pass produces both outputs, so the viewer, the plan table and the file
cannot diverge. A viewer that re-parsed the emitted Python would be a second
implementation of the ordering logic, which is exactly the bug invariant 3
exists to prevent.

Mark a dispense made *above* a well `nonContact: true`. That flag is what
licenses a shared tip, and the invariant check reads it.

Emit the Python with the helpers in [`src/core/emit.ts`](../src/core/emit.ts):
`preamble()` for metadata and the `notify` helper, `runFunction()` to wrap the
body in try/except that notifies on failure, `py()` for literals, `finalise()`
at the end.

Pipetting values come from
[`src/core/pipetting.ts`](../src/core/pipetting.ts). Interpolate them into the
emitted source so the protocol and the guide cannot drift:

```ts
pipette.aspirate(volume, source.bottom(${ASPIRATE_BOTTOM_MM}))
```

### 5. Materialise the plan into the protocol

Write the plan into the emitted file as a `PLAN` literal, and generate the
loading map the operator reads from the same structure the robot reads. The
protocol cannot detect a tube in the wrong position, so the map and the
behaviour must come from one source.

### 6. Tests

Three kinds:

```ts
// Behaviour: the ordering, the grouping, the tip count.
expect(plan.map((p) => p.tube)).toEqual(["A1", "A2", "A3"]);

// Invariants, mechanically.
expect(checkTipHygiene(result.steps)).toEqual([]);

// Refusals, with the message the user will see.
expect(() => generate({ … })).toThrow(/At most 3 source plates/);
```

### 7. A fixture, so CI simulates it

Add a representative call to `scripts/write-fixtures.ts` — ideally the awkward
case, not the easy one. The batched miniprep fixture uses two racks, two
batches and two elutions because that exercises the manifold pinning, the
off-deck rack swap and the pauses at once.

### 8. A view in the app

Add a `src/ui/views/` component and an entry in `TOOLS` in
[`src/ui/App.tsx`](../src/ui/App.tsx). Keep it a thin wrapper over one
generator call: compute nothing in the component that the generator already
returns.

## Verify

```bash
npm run check
npm run fixtures
npm run simulate
```

Then read the emitted protocol against the invariants yourself.
