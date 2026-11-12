# Opentrons Protocols

[Open the web app](https://jackatdalton.github.io/opentrons-protocol-builder/) · [Source](https://github.com/JackATDalton/opentrons-protocol-builder)

Public edition: no Slack credentials are bundled. Configure your own optional webhook in the app.
It stays in the current tab and is embedded in downloaded protocols; treat those files as private when notifications are enabled.

Lab hardware and pipetting settings are examples derived from the Steel Lab Flex. Select and verify the deck and labware for your robot.


Protocol generators, pipetting rules and custom labware for the Steel Lab
Opentrons Flex.

Two ways in:

- **Adapt an existing protocol to your own samples** — use the web app. Paste
  your concentrations or pick your wells, check the plan, download a
  ready-to-run `.py`.
- **Have an agent write a new protocol** — point it at
  [`AGENTS.md`](AGENTS.md). It will find the pipetting rules, the failure modes
  behind them, and a way to verify its work.

Either way the protocol comes out carrying what this lab has learned from
runs that went wrong: dispense rates, tip heights, blow-outs, reverse
pipetting, offsets, and which steps must not be reordered.

---

## The web app

```bash
npm install
npm run dev
```

Five working tools:

| Tool | What it does |
|---|---|
| **Normalise tubes** | A box of 1.5 mL Eppendorfs at whatever the minipreps gave → one 96-well source plate at a single concentration. |
| **Normalise a plate** | Dilute the wells of a plate in place to one concentration. |
| **Miniprep** | Vacuum-manifold plasmid prep, culture to eluate, 1–48 samples, batched. |
| **Plate to tubes** | One 1.5 mL tube per selected well. |
| **Golden Gate** | Combinatorial assembly with onboard or external thermocycling. |

Each one works the same way: **Set up**, **Plan**, **Simulate**, **Protocol**.
The deck diagram stays beside the form, so when a setting needs another tip
rack you see it appear.

Everything on screen comes from a single generator call, so the plan table, the
animation and the file you download cannot disagree with each other. If the
animation looks wrong, the protocol *is* wrong.

The app is a static site — no server, and nothing you paste leaves your
machine.

> **Always simulate before running.** The app tells you the command.

## Adding protocols with an agent

Start with [the agent workflow](docs/agent-workflow.md): a copyable experiment
brief, direct generator calls and browser guidance. For a genuinely new tool,
`npm run protocol:new -- your-protocol-name` creates and connects a generator,
view, starter tests and simulation fixture. Preview with `--dry-run`.
The starter uses plate-to-tube behaviour; adapt and validate it before lab use.

## Rules and guidance

- **[`docs/pipetting-guide.md`](docs/pipetting-guide.md)** — what works on this
  machine and the run that proved it. Small volumes, viscous enzyme mixes,
  reverse pipetting, heights, overpressure, evaporation, the miniprep and
  transformation specifics.
- **[`docs/protocol-invariants.md`](docs/protocol-invariants.md)** — seven rules
  that must hold. The review checklist.
- **[`AGENTS.md`](AGENTS.md)** — the entry point for writing a protocol, for an
  agent or a person.

The parameters themselves live in
[`src/core/pipetting.ts`](src/core/pipetting.ts), each with the run it came
from. Import them rather than retyping numbers.

### The thing to understand first

`opentrons_simulate` passing means a protocol **will run**. It does not mean
the protocol is **right**. Every one of the seven invariants was broken by code
that simulated with no errors — including a tip-sharing bug that contaminated a
shared repository plate and put two plates of data in doubt. The invariants
exist because simulation cannot catch that class of mistake.

What the repo does about it: the rules that *can* be checked by a machine are,
in [`src/core/invariants.ts`](src/core/invariants.ts), and those checks run
over every generator in the test suite. The rest have to be read for.

## Custom labware

Definitions and print files for the 3D-printed manifold and racks are in
[`labware/`](labware/README.md), with the sealing and deformation lessons that
are not obvious from the models. Pass them when simulating:

```bash
opentrons_simulate protocol.py --custom-labware-path ./labware/definitions
```

STEP files, FreeCAD sources and technical drawings are in
[VADR](https://github.com/JackATDalton/VADR).

## Verifying a change

```bash
npm run check       # typecheck (from scratch), lint, tests
npm run fixtures    # emit one protocol per generator
npm run simulate    # run them all through opentrons_simulate
```

`npm run simulate` needs the Opentrons Python package:

```bash
conda create -n opentrons python=3.10 && conda activate opentrons
pip install opentrons
```

If it is in a conda env rather than your default `python3`:

```bash
OPENTRONS_PYTHON=/path/to/env/bin/python3 npm run simulate
```

CI runs all of it, plus a scan that keeps credentials out of the repo.

## Slack

Generated protocols post progress to the lab Slack, so a run that fails at
2 a.m. is visible in the morning. The webhook is in
[`src/config/lab.ts`](src/config/lab.ts); put your member ID in the sidebar to
be tagged.

**This repository is private, and the webhook is why.** If it is ever made
public, rotate the webhook and take it out of source first.

## Layout

```
src/core/         deck allocation, well ordering, Python emission,
                  pipetting parameters, invariant checks, step recording
src/generators/   one module per protocol
src/parsers/      plate and assembly-layout CSV
src/ui/           the web app
labware/          definitions and STL print files
docs/             pipetting guide, invariants, how to add a protocol
tests/            111 tests, including the invariant checks
```

## Licence

MIT. See [`LICENSE`](LICENSE).

Public edition and release workflow: [docs/public-sync.md](docs/public-sync.md).
