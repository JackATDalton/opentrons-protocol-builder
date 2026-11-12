# Contributing

Protocols run on real samples that took weeks to make, so the bar for a change
is "I have evidence this works", not "it typechecks".

## Before you start

Read [AGENTS.md](AGENTS.md). It is short, and it is the same guidance whether
you are a person or an agent.

## Setup

```bash
npm install
npm run dev        # the web app, on localhost
```

For simulation you also need the Opentrons Python package:

```bash
conda create -n opentrons python=3.10
conda activate opentrons
pip install opentrons
```

## Checks that must pass

```bash
npm run typecheck  # tsc -b --force
npm run lint
npm test
npm run fixtures   # emit one protocol per generator
npm run simulate   # run them all through opentrons_simulate
```

CI runs all of these.

`--force` matters: plain `tsc -b` trusts its incremental state, so a local
`.tsbuildinfo` can report a clean build over code that does not compile from
scratch. That is exactly how a broken typecheck once reached CI here.

## What a reviewer will look for

1. **The invariants** in [docs/protocol-invariants.md](docs/protocol-invariants.md),
   read against the emitted Python by hand. A clean simulation is not enough —
   every one of those seven rules was broken by code that simulated cleanly.
2. **Pipetting parameters imported from `src/core/pipetting.ts`**, not retyped.
3. **A comment saying why**, and which run justified it, wherever a value or
   an ordering is non-obvious.
4. **A test**, and a fixture if you added a generator.

## Changing a pipetting parameter

Change the value in `src/core/pipetting.ts`, update
[docs/pipetting-guide.md](docs/pipetting-guide.md) in the same commit, and say
which run justified it. A parameter with no run behind it is a guess, and
guesses here cost plates.

## Conventions

- British spelling, in prose and in identifiers.
- Explain *why*, not *what*.
