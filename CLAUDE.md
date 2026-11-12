# CLAUDE.md

Read **[AGENTS.md](AGENTS.md)** first — it is the entry point for writing
protocols in this repo, and everything below is in it.

In short:

- Check whether a generator in `src/generators/` already covers the task
  before writing a protocol by hand. A generated protocol inherits every
  pipetting and safety rule; a hand-written one does not.
- [`docs/protocol-invariants.md`](docs/protocol-invariants.md) is the review
  checklist. All seven rules were broken by code that simulated cleanly, so
  `opentrons_simulate` passing is not sufficient evidence a protocol is right.
- [`docs/pipetting-guide.md`](docs/pipetting-guide.md) holds the hard-won
  parameters. The values are in `src/core/pipetting.ts` — import them rather
  than retyping numbers.
- Verify with `npx tsc -b`, `npm test`, `npm run fixtures`, `npm run simulate`,
  and then read the emitted Python against the invariants yourself.
