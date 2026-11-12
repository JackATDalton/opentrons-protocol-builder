# Writing Opentrons protocols in this repo

For an agent — or a person — asked to produce a protocol for the Steel Lab
Opentrons Flex. Read this first. It is short on purpose; the detail is in two
documents it points to.

## Before anything else

**Check whether a generator already covers the task.** A generated protocol
inherits every rule below automatically. A hand-written one does not.

| Task | Generator |
|---|---|
| Normalise a 96-well plate to one concentration | `src/generators/normalisation.ts` |
| Normalise a box of tubes into a 96-well source plate | `src/generators/tube-normalisation.ts` |
| Vacuum-manifold plasmid miniprep | `src/generators/miniprep.ts` |
| Plate wells → individual 1.5 mL tubes | `src/generators/transfer.ts` |
| Combinatorial Golden Gate assembly | `src/generators/goldengate.ts` |

If one fits, drive it (via the web app or `npx tsx`) and stop. If one nearly
fits, extend it rather than writing a new script. Write a new protocol only
when nothing is close.

## The two documents that matter

1. **[`docs/protocol-invariants.md`](docs/protocol-invariants.md)** — seven
   rules that must hold. Every one was broken by code that simulated cleanly.
   This is the review checklist.
2. **[`docs/pipetting-guide.md`](docs/pipetting-guide.md)** — what actually
   works on this machine: dispense rates, heights, reverse pipetting,
   blow-outs, offsets, and what to do when a thick liquid clings to the tip.

The numbers live in [`src/core/pipetting.ts`](src/core/pipetting.ts). Import
them; do not retype them.

## The rules in one screen

- **A tip goes source → destination → trash.** It never returns to a shared
  source after touching a destination. The one exception is a dispense made
  *above* the well, which keeps the tip clean — mark those `nonContact: true`.
- **One tip may serve several wells only if those wells hold identical
  liquid.** Group by the full prefix of what each well has received.
- **Golden Gate parts: technique follows batch size.** Singleton: exact
  aspiration and blow-out at `bottom(1)`. Identical-content batch: pre-wet,
  aspirate exact total, slow offset dispenses, final-well blow-out, discard.
  Revision 2026-11-12; bench validation pending (see pipetting guide §1).
- **Outside the Golden Gate part method above, reverse-pipette one liquid
  going to many wells**, with real excess (≥ 5 µL
  or 15 %), returned to the source at `bottom(3)`. Never blow out between the
  wells of one aspirate.
- **Dispense slowly and 0.2 mm off-centre. Do not use `touch_tip`.**
- **Fill column by column.**
- **Dispense 35 mm above open tubes and spin columns**, or tips catch on lids.
- **Pair well lists only from `src/core/wells.ts`**, and write the pairing
  into the emitted protocol by name.
- **Never hardcode a deck slot.** Declare `LabwareRequest`s; `allocateDeck`
  assigns them.
- **Never use liquid-level detection.** It under-reads, and simulation cannot
  test it.
- **Interleave time-sensitive steps in small groups.** Do not batch lysis and
  neutralisation into two passes.
- **150 µL is full** for the 200 µL PCR plates in use. Make 10 % extra master
  mix.
- **Pause for anything manual** — spins, seals, labware swaps — with an
  instruction specific enough to follow unaided. Notify at every stage
  boundary.

## How to write a new generator

For a task brief, headless generation and browser guidance, see
[`docs/agent-workflow.md`](docs/agent-workflow.md). Use
`npm run protocol:new -- <name> --dry-run`, then omit `--dry-run` to scaffold
and register a plate-to-tube starter. Adapt it to the intended experiment.


See [`docs/adding-a-protocol.md`](docs/adding-a-protocol.md). The shape is:

1. Define an options interface.
2. Validate inputs and build a plan, with per-item warnings.
3. Declare `LabwareRequest`s and call `allocateDeck`.
4. Emit Python **and** a `ProtocolStep[]` from the same loop. This is the
   point of the design: the viewer, the plan table and the downloaded file all
   come from one pass, so they cannot disagree. If the animation looks wrong,
   the protocol *is* wrong.
5. Add tests, including the invariant checks.
6. Add a fixture to `scripts/write-fixtures.ts` so CI simulates it.
7. Add a view to the web app.

## How to verify your work

```bash
npm install
npm run typecheck  # tsc -b --force; must be clean
npm test           # must pass
npm run fixtures   # emit a protocol per generator
npm run simulate   # run them all through opentrons_simulate
```

`npm run simulate` needs the `opentrons` package. On this machine:
`/opt/homebrew/Caskroom/miniforge/base/envs/opentrons/bin/python3` — it is not
on the default `python3`.

**Then read the emitted protocol against the invariants yourself.** A clean
simulation is necessary and not sufficient.

## Things that will bite you

- Opentrons writes `jd_24_tuberack_1.5ml` with a dot. TypeScript object keys
  can't hold one unquoted, so there is an alias in `wells.ts` and `steps.ts`.
  Keep both in step.
- The Flex deck is **4 rows (A–D) × 3 columns (1–3)** — 12 slots, not 16.
- `jd_24_tuberack_1.5ml.json` declares `totalLiquidVolume: 1.5`, millilitres
  where the schema wants microlitres, so it claims a 1.5 µL tube. Nothing
  reads it today, but do not write a capacity check against it without fixing
  the definition first — and that file is shared with the lab's private repo.
- `plate_6_layout.csv` in the private repo contains the literal text `okay`.
  It is not a usable fixture.

## Conventions

- British spelling in prose and identifiers (`normalisation`, `neutralisation`).
- Comments explain *why*, with the run that justified it. A comment that
  restates the code is noise; one that records a failed run is the reason this
  repo is useful.
- Never commit webhooks or other credentials. Configure Slack in the app.
