/**
 * Tubes in, normalised 96-well source plate out.
 *
 * Everything on screen comes from one `generateTubeNormalisation` call, so the
 * rack maps, the plate layout, the plan table, the animation and the
 * downloaded files cannot disagree.
 *
 * Where each tube sits and which well it fills can come from three places, in
 * rising priority: the tube CSV's own `rack`/`tube`/`plate_well` columns, an
 * uploaded plate layout (wells only), and clicks on the maps here. Anything
 * still unset is filled in by the generator — tubes into the first free rack
 * position, parts into the next free well in rack order — and drawn dashed so
 * the difference is visible. The first click on a map pins every position as
 * shown, so moving one tube never reshuffles the others.
 */
import { useMemo, useState } from "react";

import type { DeckConfig } from "../../core/deck";
import {
  generateTubeNormalisation,
  MAX_TUBE_RACKS,
  type TubeNormalisationResult,
  type TubeSample,
} from "../../generators/tube-normalisation";
import { parsePlateLayout, parseSamples } from "../../parsers/tube-list";
import { SimulationViewer } from "../SimulationViewer";
import { DeckViewport } from "../DeckViewport";
import { PlateMap, PlateMapLegend, type MapCell } from "../PlateMap";
import {
  CheckField,
  CsvInput,
  Messages,
  NumberField,
  Panel,
  ProtocolTab,
  SelectField,
  Tally,
  TextField,
} from "../common";
import type { Tab } from "../tabs";
import { TUBE_LIST_EXAMPLE, TUBE_PLATE_LAYOUT_EXAMPLE } from "../examples";
import { LABWARE, labwareOptions } from "../../core/labware";

// Kept for existing imports; the parser lives with the other CSV parsers.
export { parseSamples };

const TUBE_RACK = LABWARE.tubeRack;
const DEST_PLATE = LABWARE.pcrPlate;

const SEED = `# part, ng/uL, uL in tube, [mastermix]
A1, 49.6, 50
B1, 45, 50
C1, 37.2, 50
D1, 53.3, 50
A2, 67.8, 50
B2, 40, 100
C2, 25.3, 50
D2, 55.9, 50
A3, 33.5, 50
B3, 39.2, 50
C3, 55.9, 50
D3, 65.3, 50
A4, 60.1, 50
B4, 35.6, 50
C4, 46.4, 50
D4, 39, 200
A5, 22.6, 50
B5, 46, 100
C5, 30.8, 100
D5, 50, 100
A6, 53.7, 100
B6, 29, 100
C6, 43, 100
D6, 26, 100`;

type RackPos = { rack: number; tube: string };

/** What a map shows for a part: where it is and whether that was chosen. */
interface Placed {
  name: string;
  rack?: number;
  tube?: string;
  well?: string;
  positionSet: boolean;
  wellSet: boolean;
  concentration: number;
  achieved?: number;
  flag?: "below" | "mass";
}

interface Props {
  deck: DeckConfig;
  tab: Tab;
  author: string;
  slackUserId: string;
  notify: (id: string) => { slackWebhookUrl?: string; slackUserId?: string };
}

export function TubeNormalisationView({ deck, tab, author, slackUserId, notify }: Props) {
  const [text, setText] = useState(SEED);
  const [layoutText, setLayoutText] = useState("");
  const [target, setTarget] = useState(30);
  const [finalVolume, setFinalVolume] = useState(100);
  const [deadVolume, setDeadVolume] = useState(3);
  const [mixCycles, setMixCycles] = useState(3);
  const [waterLabware, setWaterLabware] = useState<string>(LABWARE.falconRack);
  const [waterWell, setWaterWell] = useState("A1");
  const [showFlagged, setShowFlagged] = useState(false);

  // Edits made on the maps, by part name. `null` means "explicitly unset".
  const [positionEdits, setPositionEdits] = useState<Record<string, RackPos | null>>({});
  const [wellEdits, setWellEdits] = useState<Record<string, string | null>>({});
  const [heldTube, setHeldTube] = useState<string | null>(null);
  const [selectedWell, setSelectedWell] = useState<string | null>(null);
  const [racksShown, setRacksShown] = useState(1);

  const parsed = useMemo(() => parseSamples(text), [text]);
  const layout = useMemo(
    () => (layoutText.trim() ? parsePlateLayout(layoutText) : { wells: {}, errors: [] }),
    [layoutText],
  );

  /** The tube list with every position source applied, in priority order. */
  const samples = useMemo((): TubeSample[] => {
    return parsed.samples.map((s) => {
      if (s.masterMix) return s;
      const out: TubeSample = { ...s };
      const pos = positionEdits[s.name];
      if (pos !== undefined) {
        out.rack = pos?.rack;
        out.tube = pos?.tube;
      }
      const well = wellEdits[s.name];
      if (well !== undefined) out.well = well ?? undefined;
      else if (layout.wells[s.name]) out.well = layout.wells[s.name];
      return out;
    });
  }, [parsed.samples, positionEdits, wellEdits, layout.wells]);

  const layoutWarnings = useMemo(() => {
    const known = new Map(parsed.samples.map((s) => [s.name, s]));
    const warnings: string[] = [];
    const missing = Object.keys(layout.wells).filter((n) => !known.has(n));
    if (missing.length) {
      warnings.push(`The plate layout names part(s) not in the tube list, so they were ignored: ${missing.join(", ")}.`);
    }
    const mm = Object.keys(layout.wells).filter((n) => known.get(n)?.masterMix);
    if (mm.length) warnings.push(`The plate layout places master-mix part(s), which stay off the plate: ${mm.join(", ")}.`);
    return warnings;
  }, [parsed.samples, layout.wells]);

  const generated = useMemo((): { result?: TubeNormalisationResult; error?: string } => {
    if (parsed.errors.length || !samples.length) return {};
    try {
      return {
        result: generateTubeNormalisation({
          deck,
          samples,
          targetConcentration: target,
          finalVolumeUl: finalVolume,
          waterLabware,
          waterWell,
          tubeDeadVolumeUl: deadVolume,
          mixCycles,
          tubeRackLoadName: TUBE_RACK,
          destPlateType: DEST_PLATE,
          author,
          notify: notify(slackUserId),
          protocolName: `Source plate normalisation at ${target} ng/uL`,
        }),
      };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [deck, parsed, samples, target, finalVolume, waterLabware, waterWell, deadVolume, mixCycles, author, slackUserId, notify]);

  const result = generated.result;
  const toPlate = parsed.samples.filter((s) => !s.masterMix).length;
  const inMix = parsed.samples.length - toPlate;

  /**
   * Where every part is, for the maps. From the plan when there is one, so the
   * maps show exactly what the protocol will do; otherwise only what has been
   * set, so the maps still work while an error is being fixed.
   */
  const placed: Placed[] = useMemo(() => {
    if (result) {
      return result.plan.map((p) => ({
        name: p.name,
        rack: p.rack,
        tube: p.tube,
        well: p.well,
        positionSet: p.positionSet,
        wellSet: p.wellSet,
        concentration: p.concentration,
        achieved: p.achievedConcentration,
        flag: p.belowTarget ? "below" : p.massLimited ? "mass" : undefined,
      }));
    }
    return samples
      .filter((s) => !s.masterMix)
      .map((s) => ({
        name: s.name,
        rack: s.rack,
        tube: s.tube,
        well: s.well,
        positionSet: s.rack != null,
        wellSet: !!s.well,
        concentration: s.concentration,
      }));
  }, [result, samples]);

  const byName = new Map(placed.map((p) => [p.name, p]));
  const atTube = (rack: number, tube: string) => placed.find((p) => p.rack === rack && p.tube === tube);
  const atWell = (well: string) => placed.find((p) => p.well === well);

  const racksNeeded = Math.max(1, result?.rackCount ?? 0, ...placed.map((p) => p.rack ?? 1));
  const rackCount = Math.min(MAX_TUBE_RACKS, Math.max(racksShown, racksNeeded));

  /** Every position as currently shown, so a move never reshuffles the rest. */
  const pinnedPositions = (): Record<string, RackPos | null> => {
    const all: Record<string, RackPos | null> = { ...positionEdits };
    for (const p of placed) if (p.rack != null && p.tube) all[p.name] = { rack: p.rack, tube: p.tube };
    return all;
  };
  const pinnedWells = (): Record<string, string | null> => {
    const all: Record<string, string | null> = { ...wellEdits };
    for (const p of placed) if (p.well) all[p.name] = p.well;
    return all;
  };

  const onTubeClick = (rack: number, tube: string) => {
    const occupant = atTube(rack, tube);
    if (!heldTube) {
      if (occupant) setHeldTube(occupant.name);
      return;
    }
    if (occupant?.name === heldTube) {
      setHeldTube(null);
      return;
    }
    const from = byName.get(heldTube);
    const next = pinnedPositions();
    next[heldTube] = { rack, tube };
    // Swap rather than displace: the occupant takes the held tube's old place.
    if (occupant) next[occupant.name] = from?.rack != null && from.tube ? { rack: from.rack, tube: from.tube } : null;
    setPositionEdits(next);
    setHeldTube(null);
  };

  const putInWell = (name: string, well: string) => {
    const occupant = atWell(well);
    if (occupant?.name === name) return;
    const from = byName.get(name)?.well;
    const next = pinnedWells();
    next[name] = well;
    if (occupant) next[occupant.name] = from ?? null;
    setWellEdits(next);
  };

  const onWellClick = (well: string) => {
    if (!selectedWell || selectedWell === well) {
      setSelectedWell(selectedWell === well ? null : well);
      return;
    }
    const mover = atWell(selectedWell);
    if (!mover) {
      setSelectedWell(well);
      return;
    }
    putInWell(mover.name, well);
    setSelectedWell(null);
  };

  const rackCells = (rack: number): Record<string, MapCell> => {
    const cells: Record<string, MapCell> = {};
    for (const p of placed) {
      if (p.rack !== rack || !p.tube) continue;
      cells[p.tube] = {
        label: p.name,
        sub: p.well ? `→ ${p.well}` : undefined,
        set: p.positionSet,
        title: `${p.name}, ${p.concentration} ng/µL${p.well ? `, fills plate ${p.well}` : ""}${p.positionSet ? "" : " (auto-placed)"}`,
      };
    }
    return cells;
  };

  const plateCells = (withConcentration: boolean): Record<string, MapCell> => {
    const cells: Record<string, MapCell> = {};
    for (const p of placed) {
      if (!p.well) continue;
      cells[p.well] = {
        label: p.name,
        sub: withConcentration && p.achieved != null ? `${p.achieved}` : undefined,
        set: withConcentration ? true : p.wellSet,
        flag: withConcentration ? p.flag : undefined,
        title:
          `${p.name}` +
          (p.rack != null ? ` from rack ${p.rack} ${p.tube}` : "") +
          (p.achieved != null ? `, ${p.achieved} ng/µL` : "") +
          (p.wellSet ? "" : " (auto-placed)"),
      };
    }
    return cells;
  };

  const rows = result
    ? showFlagged
      ? result.plan.filter((p) => p.belowTarget || p.massLimited)
      : result.plan
    : [];
  const unplacedWells = placed.filter((p) => !p.well);
  const selectedOccupant = selectedWell ? atWell(selectedWell) : undefined;
  const stem = `source_plate_${target}ngul`;

  return (
    <>
      <Messages
        errors={[...parsed.errors, ...layout.errors, ...(generated.error ? [generated.error] : [])]}
        warnings={layoutWarnings}
      />

      {tab === "setup" && (
        <div className="with-deck">
          <div style={{ display: "grid", gap: 16, minWidth: 0 }}>
            <Panel title="Tubes">
              <p className="note">
                One tube per line: part name, concentration in ng/µL, volume in µL. Add a fourth
                field <code>mastermix</code> for parts you premix by hand — those stay off the plate.
                A CSV with a header row also works, and may carry <code>rack</code>,{" "}
                <code>tube</code> and <code>plate_well</code> columns.
              </p>
              <CsvInput label="Tube list" value={text} onChange={setText} example={TUBE_LIST_EXAMPLE} />
              <p className="note">
                {toPlate} to plate{inMix > 0 && `, ${inMix} in the master mix`}
              </p>
            </Panel>

            <Panel
              title="Tube racks"
              actions={
                <>
                  <button
                    className="ghost"
                    onClick={() => {
                      setPositionEdits({});
                      setHeldTube(null);
                    }}
                    disabled={!Object.keys(positionEdits).length}
                  >
                    Reset to auto
                  </button>
                  <button
                    className="ghost"
                    onClick={() => setRacksShown(rackCount - 1)}
                    disabled={rackCount <= racksNeeded}
                  >
                    − Rack
                  </button>
                  <button
                    className="ghost"
                    onClick={() => setRacksShown(rackCount + 1)}
                    disabled={rackCount >= MAX_TUBE_RACKS}
                  >
                    + Rack
                  </button>
                </>
              }
            >
              <p className="note">
                {heldTube ? (
                  <>
                    Moving <strong>{heldTube}</strong> — click where it goes (an occupied position
                    swaps), or click it again to cancel.
                  </>
                ) : (
                  <>
                    Load the racks exactly as shown; the robot cannot tell a tube in the wrong place.
                    Click a tube, then click where it should go. Dashed tubes were placed
                    automatically.
                  </>
                )}
              </p>
              <div className="rack-stack" style={{ marginTop: 12 }}>
                {Array.from({ length: rackCount }, (_, i) => i + 1).map((rack) => (
                  <PlateMap
                    key={rack}
                    loadName={TUBE_RACK}
                    label={`Rack ${rack}`}
                    cells={rackCells(rack)}
                    active={heldTube && byName.get(heldTube)?.rack === rack ? byName.get(heldTube)?.tube : null}
                    onCellClick={(tube) => onTubeClick(rack, tube)}
                  />
                ))}
              </div>
              <PlateMapLegend auto="placed automatically" />
            </Panel>

            <Panel
              title="Final plate layout"
              actions={
                <>
                  <button
                    className="ghost"
                    onClick={() => {
                      setWellEdits({});
                      setSelectedWell(null);
                    }}
                    disabled={!Object.keys(wellEdits).length}
                  >
                    Reset to {layoutText.trim() ? "uploaded layout" : "rack order"}
                  </button>
                </>
              }
            >
              <p className="note">
                {selectedWell ? (
                  selectedOccupant ? (
                    <>
                      <strong>{selectedOccupant.name}</strong> in {selectedWell} — click another well
                      to move it there (a filled well swaps), or pick a part below.
                    </>
                  ) : (
                    <>Well {selectedWell} is empty — pick a part below to put in it.</>
                  )
                ) : (
                  <>
                    Click a well, then another to move or swap its part. Dashed wells were filled
                    automatically, in rack order.
                  </>
                )}
              </p>
              <div style={{ marginTop: 12 }}>
                <PlateMap
                  loadName={DEST_PLATE}
                  cells={plateCells(false)}
                  active={selectedWell}
                  onCellClick={onWellClick}
                />
                <PlateMapLegend auto="filled in rack order" />
              </div>
              {selectedWell && (
                <div className="chips" role="group" aria-label={`Parts to put in ${selectedWell}`}>
                  {placed.map((p) => (
                    <button
                      key={p.name}
                      className="ghost"
                      aria-pressed={p.name === selectedOccupant?.name}
                      onClick={() => {
                        putInWell(p.name, selectedWell);
                        setSelectedWell(null);
                      }}
                    >
                      {p.name}
                      {p.well && <span className="at">{p.well}</span>}
                    </button>
                  ))}
                </div>
              )}
              {unplacedWells.length > 0 && !result && (
                <p className="note" style={{ marginTop: 8 }}>
                  {unplacedWells.length} part(s) will take the next free well once the run plans.
                </p>
              )}
              <div className="layout-upload" style={{ marginTop: 14 }}>
                <p className="note" style={{ marginBottom: 6 }}>
                  <strong>Optional:</strong> upload a desired layout — <code>well,name</code> rows, a
                  plate grid, or a layout CSV from an earlier run. Parts it does not name fill the
                  free wells.
                </p>
                <CsvInput
                  label="Desired plate layout"
                  value={layoutText}
                  onChange={(t) => {
                    setLayoutText(t);
                    setWellEdits({});
                  }}
                  example={TUBE_PLATE_LAYOUT_EXAMPLE}
                  placeholder="well,name"
                />
              </div>
            </Panel>

            <Panel title="Run settings">
              <div className="fields">
                <NumberField label="Target" unit="ng/µL" value={target} onChange={setTarget} min={1} />
                <NumberField
                  label="Final volume"
                  unit="µL"
                  value={finalVolume}
                  onChange={setFinalVolume}
                  min={1}
                  step={5}
                />
                <NumberField
                  label="Tube dead volume"
                  unit="µL"
                  value={deadVolume}
                  onChange={setDeadVolume}
                  min={0}
                />
                <NumberField label="Mix cycles" value={mixCycles} onChange={setMixCycles} min={0} max={10} />
                <SelectField
                  label="Water labware"
                  value={waterLabware}
                  onChange={setWaterLabware}
                  options={labwareOptions([LABWARE.falconRack, LABWARE.tubeRack])}
                />
                <TextField label="Water well" value={waterWell} onChange={setWaterWell} upper />
              </div>
            </Panel>
          </div>

          <DeckViewport
            layout={result?.deckLayout ?? []}
            tally={
              result
                ? [
                    { label: "50 µL tips", value: String(result.tipsUsed.small) },
                    { label: "1000 µL tips", value: String(result.tipsUsed.large) },
                  ]
                : undefined
            }
          />
        </div>
      )}

      {tab === "plan" && result && (
        <>
          <Tally
            items={[
              { label: "Parts on plate", value: result.plan.length },
              {
                label: "Below target",
                value: result.plan.filter((p) => p.belowTarget).length,
              },
              {
                label: "Mass limited",
                value: result.plan.filter((p) => p.massLimited).length,
              },
              {
                label: "Water needed",
                value: (
                  <>
                    {(result.plan.reduce((s, p) => s + p.waterUl, 0) / 1000).toFixed(2)}{" "}
                    <small>mL</small>
                  </>
                ),
              },
            ]}
          />

          <Panel title="Final plate layout">
            <PlateMap loadName={DEST_PLATE} cells={plateCells(true)} />
            <PlateMapLegend flags />
            <p className="note">Each well shows the part and the ng/µL it reaches.</p>
            <p className="note" style={{ marginTop: 8 }}>
              This layout downloads with the protocol as <code>{stem}_plate_layout.csv</code>.
            </p>
          </Panel>

          <Panel title="Rack loading map">
            <div className="rack-stack">
              {Array.from({ length: result.rackCount }, (_, i) => i + 1).map((rack) => (
                <PlateMap
                  key={rack}
                  loadName={TUBE_RACK}
                  label={`Rack ${rack}`}
                  cells={Object.fromEntries(
                    Object.entries(rackCells(rack)).map(([k, c]) => [k, { ...c, set: true }]),
                  )}
                />
              ))}
            </div>
          </Panel>

          <Panel
            title="Loading map and volumes"
            actions={
              <CheckField
                label="Only flagged wells"
                checked={showFlagged}
                onChange={setShowFlagged}
              />
            }
            tight
          >
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th>Rack</th>
                    <th>Tube</th>
                    <th>Well</th>
                    <th>Part</th>
                    <th className="num">Stock ng/µL</th>
                    <th className="num">Part µL</th>
                    <th className="num">Water µL</th>
                    <th className="num">Final µL</th>
                    <th className="num">Achieved</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.well}>
                      <td className="num">{p.rack}</td>
                      <td className="well">{p.tube}</td>
                      <td className="well">{p.well}</td>
                      <td>{p.name}</td>
                      <td className="num">{p.concentration}</td>
                      <td className="num">{p.partUl}</td>
                      <td className="num">{p.waterUl}</td>
                      <td className="num">{p.finalVolumeUl}</td>
                      <td className="num">{p.achievedConcentration}</td>
                      <td>
                        {p.belowTarget ? (
                          <span className="flag below">below target</span>
                        ) : p.massLimited ? (
                          <span className="flag mass">mass limited</span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          {result.excluded.length > 0 && (
            <Panel title="Kept off the plate">
              <p className="note">
                Premixed into the master mix by hand:{" "}
                {result.excluded.map((s) => `${s.name} (${s.concentration} ng/µL)`).join(", ")}
              </p>
            </Panel>
          )}

          {result.warnings.length > 0 && (
            <Panel title={`${result.warnings.length} thing${result.warnings.length > 1 ? "s" : ""} to check`} tight>
              <Messages warnings={result.warnings} />
            </Panel>
          )}
        </>
      )}

      {tab === "simulate" && result && (
        <Panel title="Every move the robot will make">
          <SimulationViewer steps={result.steps} deckLayout={result.deckLayout} />
        </Panel>
      )}

      {tab === "protocol" && result && (
        <ProtocolTab
          source={result.source}
          filename={`${stem}.py`}
          files={[
            { name: `${stem}_plate_layout.csv`, content: result.layoutCsv },
            { name: `${stem}_plate_layout_full.csv`, content: result.layoutCsvFull },
          ]}
        />
      )}

      {tab !== "setup" && !result && (
        <div className="banner">
          <h3>Nothing to show yet</h3>
          Fix the tube list on the Set up tab and the plan will appear here.
        </div>
      )}
    </>
  );
}
