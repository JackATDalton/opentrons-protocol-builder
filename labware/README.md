# Custom labware

Opentrons definitions for this lab's 3D-printed and non-catalogue labware.

Pass the definitions directory whenever you simulate a protocol that uses any
of them:

```bash
opentrons_simulate protocol.py --custom-labware-path ./labware/definitions
```

To use them on the robot, upload each JSON through the Opentrons App
(Labware → Import), then calibrate it on the deck.

## Definitions

| `loadName` | Description | Print file |
|---|---|---|
| `jdvacuum_24_tuberack_500ul` | 24-position vacuum manifold for spin columns | `stl/vacuum-manifold-dualport.stl`, `stl/vacuum-manifold-singleport.stl` |
| `jd_24_tuberack_1.5ml` | 24 × 1.5 mL Eppendorf rack | `stl/eppendorf-rack-24x1.5ml.stl` |
| `jd_6_falconrack_50ml` | 6 × 50 mL Falcon rack, for buffers | `stl/falcon-rack-6x50ml.stl` |
| `jd_petri_dish` | Petri dish, for plating recovered cells | — |

The definitions are schema-validated. **Do not add fields to them**, and keep
them byte-identical to the copies in the lab's private repo and in
[VADR](https://github.com/JackATDalton/VADR) — a protocol calibrated against
one copy must behave identically against another.

### Known defect

`jd_24_tuberack_1.5ml.json` declares `totalLiquidVolume: 1.5` — millilitres
where the schema wants microlitres. The definition therefore claims a 1.5 µL
tube, and its display name renders as "eppendorf 0 mL". Nothing reads the field
today, because tube volumes are declared by the user, but **do not write a
capacity check against source labware without fixing this first**. Fixing it
changes a file shared with two other repos, so it needs coordinating.

## Printing

The manifold comes in single-port and dual-port versions. The dual-port is the
current one; chain several together with external tubing to a shared vacuum
source.

Assembly notes, tolerances and the vacuum-sealing method are in the hardware
paper and in [VADR](https://github.com/JackATDalton/VADR), which also holds
the STEP and FreeCAD sources and the technical drawings.

Two things learned the hard way:

- **V1.0 and V1.1 deformed under vacuum.** V1.2 added internal support ribs
  and holds its shape. The STLs here are the current versions.
- **Sealing needs plumber's tape, not silicone.** Two coats of silicone spray
  never sealed. Stretching PTFE tape over the holes and piercing it with a
  1 mL pipette tip seals all 24 positions and needs no silicone.
