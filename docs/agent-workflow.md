# Creating protocols with an agent

Give the agent access to this repository and ask it to read `AGENTS.md` first.
Use the generators directly for existing tasks; browser automation is optional.
No server or account is required for generation.

## A brief to copy

> Create or adapt an Opentrons Flex protocol in this repository. Read AGENTS.md,
> docs/protocol-invariants.md and docs/pipetting-guide.md first. Reuse or extend
> an existing generator before creating a new one.
>
> Goal and samples: …
> Starting liquids, concentrations and available volumes: …
> Destination layout, final volumes and required concentrations: …
> Labware load names and installed modules/deck preset: …
> Timing, temperature, mixing and manual steps: …
> Known bench results or exceptions: …
>
> Ask about missing experimental requirements. Keep the plan, animation and
> emitted Python aligned. Include loading instructions, warnings, notifications
> and specific pauses for manual actions. Run the checks and simulation, then
> read the emitted protocol against the invariants. Report what was tested and
> what still needs bench validation.

Do not invent concentrations, available volumes, incubation conditions or
bench evidence to fill a gap. An agent can choose routine implementation
structure; experimental requirements come from the lab user.

## Use an existing generator without the browser

Create a temporary TypeScript entry point in the repository root, for example
`local-run.ts` (remove it before committing):

```ts
import { writeFileSync } from "node:fs";
import { STEEL_LAB_FLEX } from "./src/core/deck";
import { generateTransfer } from "./src/generators/transfer";

const result = generateTransfer({
  deck: STEEL_LAB_FLEX,
  plates: [{
    plateType: "opentrons_96_wellplate_200ul_pcr_full_skirt",
    selectedWells: ["A1", "B1"],
  }],
  transferVolumeUl: 100,
  notify: {},
});
writeFileSync("/tmp/transfer.py", result.source);
console.log(JSON.stringify({ plan: result.plan, warnings: result.warnings, tipsUsed: result.tipsUsed }, null, 2));
```

Run `node --import tsx local-run.ts`. This avoids the `tsx` CLI's local IPC
socket, which some sandboxes block. Every generator returns Python, a plan,
steps, deck layout and warnings; its options interface is the input contract.
Use `BARE_FLEX` or a custom `DeckConfig` when the Steel Lab preset does not
match the actual machine. Do not enable Slack notifications in tests or fixtures.

## Scaffold a genuinely new protocol

```bash
npm run protocol:new -- colony-transfer --dry-run
npm run protocol:new -- colony-transfer
```

This creates a generator, view and starter test, and registers the view in the
app and the protocol in the fixture writer. It refuses duplicate names and
existing files; preview mode writes nothing. Run from the repository root.

The starter performs **plate-to-tube transfers**. It is a worked example to
adapt, not an implementation of the name you chose. It remains labelled as a
development scaffold in the app until you update its metadata and copy.
Replace its options, behaviour, view, tests and fixture with the intended
protocol. Follow [adding-a-protocol.md](adding-a-protocol.md), especially the
requirement to emit Python and viewer steps together. The starter emits transfer commands and viewer steps in one traversal; keep
new operations together as you adapt it.

Before sharing, run `npm run check`, `npm run fixtures` and `npm run simulate`
with an Opentrons Python environment. On this machine:

```bash
OPENTRONS_PYTHON=/opt/homebrew/Caskroom/miniforge/base/envs/opentrons/bin/python3 npm run simulate
```

Read the resulting Python against all seven invariants. Passing simulation
shows that commands can execute; it does not validate the chemistry or liquid
handling. Keep changes awaiting bench validation clearly recorded.

## Interacting through the app

Run `npm run dev`, choose a tool and deck, then use Set up → Plan → Simulate →
Protocol. Controls have visible labels; well buttons expose well names. CSV
inputs support pasted text as well as file uploads, which is usually easier
for a browser agent. Resolve errors, inspect warnings and the loading map,
then download the Python. The app's Simulate tab is a step visualisation;
run `opentrons.simulate` separately before the robot run.
