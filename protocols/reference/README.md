# Reference protocols

Hand-written protocols that have actually run on this robot, kept as worked
examples. They are a record, not the recommended route.

**Prefer a generator.** These scripts carry only the care of the day they were
written. A generated protocol carries every rule in
[`docs/protocol-invariants.md`](../../docs/protocol-invariants.md) and is
checked by tests. If you need to change one of these, consider whether the
change belongs in a generator instead.

All seven simulate cleanly:

```bash
opentrons_simulate protocols/reference/<file>.py --custom-labware-path ./labware/definitions
```

| File | What it does | Read it for |
|---|---|---|
| `golden_gate_plate3.py` | 96-well combinatorial Golden Gate, the October 2025 version | The master-mix pass: pre-wet, bulk aspirate, off-centre slow dispense, excess returned at `bottom(3)`. **Its part-addition loop re-enters the repository plate with a used tip** — that is [invariant 1](../../docs/protocol-invariants.md#1), and it is why the generator does it differently. |
| `miniprep_handwritten.py` | Vacuum miniprep, 1–24 samples, dual pipette | The stage boundaries and pause wording. Superseded by `src/generators/miniprep.ts`, which adds batching and the off-deck rack swap. |
| `heatshock_transformation_96.py` | Heat-shock transformation across 96 wells | The timings: 30 min on ice, 30 s at 42 °C, 5 min back on ice. Note the heat block needs ~1 min to reach 42 °C and ~6 min to return to 4 °C. |
| `plate_recovered_cells.py` | Recovered cells → 96-well agar plate | Slow dispense onto a solid surface. |
| `plate_recovered_cells_petri.py` | Recovered cells → petri dishes | Uses the `jd_petri_dish` definition. |
| `heatblock_prewarm.py` | Hold the heat block at temperature | Running a module on its own before an experiment. |
| `heatblock_precool.py` | Hold the heat block at 5 °C | Same, for cooling. |

## Slack

These post to the lab Slack. `SLACK_USER_ID` at the top of each file is empty —
set it to `"<@YOUR_MEMBER_ID>"` to be tagged in your own run's alerts (Slack
profile → ⋯ → Copy member ID).

## Not here on purpose

`AL-4-protein_expression/96well_GG_assembly_plate1.py` is the **buggy** Golden
Gate version. It aspirates from the repository plate inside the destination
loop, which is the contamination behind the P006–P008 plates. Do not copy it.
