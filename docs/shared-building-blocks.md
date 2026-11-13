# Shared building blocks

Everything a new protocol can reuse rather than rebuild. Read this before
writing a generator or a view; if you write something here that a second
protocol could use, put it in a shared module and add a line to this file.

The rule of thumb: **a generator should contain only the experiment.** Labware,
pipettes, well order, deck slots, rounding, placement, CSV parsing, downloads
and every picture of a plate already exist.

## Core (`src/core/`) — used by generators

| Need | Use | File |
|---|---|---|
| A labware load name | `LABWARE.pcrPlate`, `LABWARE.tubeRack`, … — never retype the string | `labware.ts` |
| Well grid, footprint, A1 position, pitch, well diameter | `geometryFor(loadName)`; `isKnownLabware` before trusting it | `labware.ts` |
| Labware dropdown | `labwareOptions([LABWARE.pcrPlate, …])` — same labels everywhere | `labware.ts` |
| Rows and columns of a plate | `shapeFor(loadName)`, `SHAPE_96`, `SHAPE_24`, `SHAPE_6` | `wells.ts` (data in `labware.ts`) |
| Well order | `columnMajor`, `rowMajor`, `sortColumnMajor`, `sortRowMajor`, `byColumn` — the only legal way to pair two well lists ([invariant 3](protocol-invariants.md#3)) | `wells.ts` |
| Validate wells / parse a well name | `assertWellsExist`, `parseWell`, `wellCount` | `wells.ts` |
| Batch wells per aspirate | `chunk`, `batchSize`; reverse pipetting: `reverseBatchSize`, `reverseExcessUl` | `wells.ts`, `pipetting.ts` |
| Pipette specs | `P50`, `P1000` (name, tip rack, mount, min/max µL) | `pipetting.ts` |
| Tip racks needed | `tipRacksFor(tips)`, `TIPS_PER_RACK` | `pipetting.ts` |
| Heights, rates, offsets, capacities | `ASPIRATE_BOTTOM_MM`, `SLOW_DISPENSE_RATE`, `DISPENSE_X_OFFSET_MM`, `OPEN_LID_CLEARANCE_MM`, `NON_CONTACT_DISPENSE_TOP_MM`, `PCR_WELL_WORKING_MAX_UL`, `MASTER_MIX_OVERAGE_FRACTION`, … ([pipetting guide](pipetting-guide.md)) | `pipetting.ts` |
| Deck slots | `LabwareRequest[]` → `allocateDeck` → `slotFor` / `slotsFor`; `trashSlot`; presets `STEEL_LAB_FLEX`, `BARE_FLEX` | `deck.ts` |
| Python output | `preamble` (metadata + `notify`), `runFunction` (try/except + notify on failure), `py` / `pyStr` literals, `indent`, `finalise` | `emit.ts` |
| Simulator steps | `StepRecorder` — record a step beside every emitted command; mark above-well dispenses `nonContact` | `steps.ts` |
| Invariant checks for tests | `checkTipHygiene`, `checkTipSharing`, `checkWellCapacity`, `checkAll`, `formatViolations` | `invariants.ts` |
| Tubes → rack positions, parts → plate wells | `assignTubePositions`, `assignPlateWells` (honour chosen positions, reject clashes, fill the rest in a stated order), `MAX_TUBE_RACKS`, `cleanPosition` | `placement.ts` |
| Plate drawn in the protocol header | `plateMapComment(byWell, shape)` | `placement.ts` |
| CSV field quoting when writing | `csvCell` | `placement.ts` |
| Rounding volumes / concentrations | `round1` (µL), `round2` (ng/µL) | `numbers.ts` |
| Slack | `labNotify`, `normaliseSlackUserId` | `src/config/lab.ts` |

## Parsers (`src/parsers/`) — reading what users upload

| Input | Use | File |
|---|---|---|
| Any CSV text | `parseCsv` (quotes, BOM, blank lines) | `plate-csv.ts` |
| briefly.bio plate export (well→name block, then well→concentration) | `parsePlateCsv`, `occupiedWells` | `plate-csv.ts` |
| Per-well volumes (e.g. a normalisation summary) | `parseVolumesCsv` | `plate-csv.ts` |
| Tube list — typed, or a headed CSV with optional `rack`/`tube`/`plate_well` | `parseSamples` | `tube-list.ts` |
| A desired plate layout — `well,name`, a plate grid, a briefly.bio export, or our own layout CSV | `parsePlateLayout` | `tube-list.ts` |
| Golden Gate assembly layout and part check | `parseAssemblyLayout`, `buildPartIndex`, `checkPartVolumes` | `assembly-layout.ts` |

Parsers report what they could not read, by line, and never guess.

## UI (`src/ui/`) — building a view

| Need | Use | File |
|---|---|---|
| **Any plate, tube rack or tip rack** | `PlateMap` — selection mode (`selection` + `onSelectionChange`), contents mode (`cells`), editable contents (`onCellClick` + `active`); `PlateMapLegend` for the key. 24- and 96-well labware look and behave the same. Never draw a well grid by hand. | `PlateMap.tsx` |
| The deck, live, with drag-to-rearrange | `DeckViewport` | `DeckViewport.tsx` |
| Step-by-step animation | `SimulationViewer` (takes the generator's `steps` and `deckLayout`) | `SimulationViewer.tsx` |
| Section, form fields, messages, tallies | `Panel`, `NumberField`, `TextField`, `SelectField`, `CheckField`, `Messages`, `Tally` | `common.tsx` |
| CSV upload + paste box + example download | `CsvInput` (with an example from `examples.ts`) | `common.tsx` |
| Free-text well list | `parseWellList` | `common.tsx` |
| Protocol tab with download | `ProtocolTab`; pass `files` (e.g. a layout CSV) and the download becomes a zip of the protocol plus those files | `common.tsx` |
| Downloads | `downloadText`, `downloadZip`, `downloadBlob`, `downloadPython`, `downloadCsv` | `download.ts`, `common.tsx`, `examples.ts` |
| Zip without a dependency | `makeZip` | `zip.ts` |
| Example CSVs | one `CsvExample` per format; each is run through its parser in `tests/examples.test.ts` | `examples.ts` |
| Tabs | `Tab`, `TABS`, `TAB_LABELS` — every tool uses Set up / Plan / Simulate / Protocol | `tabs.ts` |
| Saved deck arrangement | `loadDeckLayouts`, `storeDeckLayouts`, `useDeckPlacement` | `persistence.ts`, `deckPlacement.ts` |

## Patterns to copy

- **One pass, two outputs.** The generator emits Python and `ProtocolStep[]` from
  the same loop; the view only renders what the generator returns.
- **Materialise the pairing.** Write tube→well (or well→tube) into the protocol
  as a `PLAN` literal by name, and print the loading map from the same
  structure. See `tube-normalisation.ts`, `transfer.ts`.
- **Positions are inputs with a fallback.** Accept a chosen position per item,
  fill the rest automatically, flag which was which (`positionSet`, `wellSet`),
  and draw automatic ones dashed (`MapCell.set = false`).
- **Export the layout with the protocol.** If a run produces a plate, return a
  layout CSV and pass it to `ProtocolTab` via `files`. `well,name` first, so it
  reads back through `parsePlateLayout` and the briefly.bio readers.
- **Pin on first edit.** In an editable map, the first manual move makes every
  shown position explicit so one move never reshuffles the rest
  (`TubeNormalisationView`).
- **Fixtures and invariants.** Every generator has a fixture in
  `scripts/write-fixtures.ts` and runs the invariant checks in its tests.

## Not shared yet — extract when a second protocol needs it

These exist in one place, or are repeated, and should move into a shared module
when the next protocol needs them. Moving one? Update this list.

- **Map editing state** — hold/swap on racks, select/move on a plate, pin on
  first edit, reset. Lives inline in `TubeNormalisationView`; it would make a
  `usePlacementEditor` hook for any plate↔tube tool.
- **Shared-tip, non-contact water pass** — written out separately in
  `normalisation.ts` (water after the plasmid) and `tube-normalisation.ts`
  (water first).
- **Choose pipette by volume** (`pipetteFor` / `pipette_for`) — only in
  `tube-normalisation.ts`; any tool using both pipettes needs it.
- **Load trash, tip racks and instruments** — each generator writes its own
  `load_trash_bin` / `load_labware(tips…)` / `load_instrument` block.
- **Achieved concentration / mass-limited split** — `planTube` and
  `normalisation.ts`'s per-well plan are the same arithmetic.
- **"Nothing to show yet" banner** and **"only flagged" table filter** — repeated
  across views; candidates for `common.tsx`.
- **Header-matching for CSV columns** (`pick` in `tube-list.ts`) — the other
  parsers use fixed column positions; reuse `pick` when a new format has
  loosely named headers.
