/**
 * Vacuum-manifold miniprep.
 *
 * The tube positions are picked on a rack grid rather than typed, because the
 * protocol cannot detect a tube in the wrong place — what you select here is
 * what someone has to load by hand, so it should look like the rack.
 */
import { useMemo, useState, type ClipboardEvent } from "react";

import type { DeckConfig } from "../../core/deck";
import {
  DEFAULT_PARAMS,
  MAX_RACKS,
  generateMiniprep,
  type MiniprepResult,
  type SampleSource,
} from "../../generators/miniprep";
import { sortColumnMajor } from "../../core/wells";
import { SimulationViewer } from "../SimulationViewer";
import { DeckViewport } from "../DeckViewport";
import { CheckField, Messages, NumberField, Panel, ProtocolTab, SelectField, Tally, WellGrid } from "../common";
import type { Tab } from "../tabs";

const RACK = "jd_24_tuberack_1.5ml";

interface Props {
  deck: DeckConfig;
  tab: Tab;
  author: string;
  slackUserId: string;
  notify: (id: string) => { slackWebhookUrl?: string; slackUserId?: string };
}

/** Column-major, which is the order the protocol processes tubes in. */
function firstN(n: number): Set<string> {
  const wells: string[] = [];
  for (const c of [1, 2, 3, 4, 5, 6]) for (const r of ["A", "B", "C", "D"]) wells.push(`${r}${c}`);
  return new Set(wells.slice(0, n));
}

export function MiniprepView({ deck, tab, author, slackUserId, notify }: Props) {
  const [racks, setRacks] = useState<Set<string>[]>([firstN(24)]);
  const [sampleSource, setSampleSource] = useState<SampleSource>(DEFAULT_PARAMS.sampleSource);
  /** Per rack, position -> sample name. Kept when a tube is deselected. */
  const [names, setNames] = useState<Record<string, string>[]>([{}]);
  const preloaded = sampleSource === "tubes";
  const [nBatches, setNBatches] = useState(1);
  const [nElutions, setNElutions] = useState(1);
  const [cultureVolume, setCultureVolume] = useState(DEFAULT_PARAMS.cultureVolumeUl);
  const [lysisVolume, setLysisVolume] = useState(DEFAULT_PARAMS.lysisVolumeUl);
  const [neutralisationVolume, setNeutralisationVolume] = useState(
    DEFAULT_PARAMS.neutralisationVolumeUl,
  );
  const [neutralisationMix, setNeutralisationMix] = useState(DEFAULT_PARAMS.neutralisationMix);
  const [washVolume, setWashVolume] = useState(DEFAULT_PARAMS.washVolumeUl);
  const [washRounds, setWashRounds] = useState(DEFAULT_PARAMS.washRounds);
  const [elutionVolume, setElutionVolume] = useState(DEFAULT_PARAMS.elutionVolumeUl);

  const generated = useMemo((): { result?: MiniprepResult; error?: string } => {
    try {
      return {
        result: generateMiniprep({
          deck,
          racks: racks.map((r) => [...r]),
          sampleNames: preloaded ? names : undefined,
          params: {
            sampleSource,
            nBatches,
            nElutions,
            cultureVolumeUl: cultureVolume,
            lysisVolumeUl: lysisVolume,
            neutralisationVolumeUl: neutralisationVolume,
            neutralisationMix,
            washVolumeUl: washVolume,
            washRounds,
            elutionVolumeUl: elutionVolume,
          },
          author,
          notify: notify(slackUserId),
        }),
      };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [
    deck, racks, sampleSource, preloaded, names, nBatches, nElutions, cultureVolume, lysisVolume, neutralisationVolume,
    neutralisationMix, washVolume, washRounds, elutionVolume, author, slackUserId, notify,
  ]);

  const result = generated.result;

  const setRack = (i: number, next: Set<string>) =>
    setRacks((prev) => prev.map((r, j) => (j === i ? next : r)));

  const setName = (rack: number, well: string, name: string) =>
    setNames((prev) => prev.map((m, j) => (j === rack ? { ...m, [well]: name } : m)));

  /** Pasting a column of names fills this tube and the ones after it, in order. */
  const pasteNames = (rack: number, from: number, e: ClipboardEvent<HTMLInputElement>) => {
    const lines = e.clipboardData.getData("text").split(/\r?\n/).map((l) => l.trim());
    while (lines.length && !lines[lines.length - 1]) lines.pop();
    if (lines.length < 2) return;
    e.preventDefault();
    const order = sortColumnMajor(racks[rack]);
    setNames((prev) =>
      prev.map((m, j) => {
        if (j !== rack) return m;
        const next = { ...m };
        lines.forEach((name, k) => {
          const well = order[from + k];
          if (well) next[well] = name;
        });
        return next;
      }),
    );
  };

  return (
    <>
      <Messages errors={generated.error ? [generated.error] : []} />

      {tab === "setup" && (
        <div className="with-deck">
          <div style={{ display: "grid", gap: 16 }}>
            <Panel
              title="Sample tubes"
              actions={
                racks.length < MAX_RACKS ? (
                  <button
                    className="ghost"
                    onClick={() => {
                      setRacks([...racks, firstN(24)]);
                      setNames([...names.slice(0, 1), {}]);
                    }}
                  >
                    Add a second rack
                  </button>
                ) : (
                  <button
                    className="ghost"
                    onClick={() => {
                      setRacks(racks.slice(0, 1));
                      setNames(names.slice(0, 1));
                    }}
                  >
                    Remove second rack
                  </button>
                )
              }
            >
              <p className="note">
                Pick the positions holding a sample. Positions are per rack — rack 1's
                A1 and rack 2's A1 are different tubes. Each rack needs its own vacuum manifold, so
                two racks is the deck's limit.
              </p>
              <div className="rack-stack" style={{ marginTop: 12 }}>
                {racks.map((r, i) => (
                  <WellGrid
                    key={i}
                    loadName={RACK}
                    selected={r}
                    onChange={(next) => setRack(i, next)}
                    label={racks.length > 1 ? `Rack ${i + 1}` : undefined}
                  />
                ))}
              </div>
            </Panel>

            {preloaded && (
              <Panel title="Sample names">
                <p className="note">
                  Name the sample in each tube, so the eluates can be labelled. Paste a column from a
                  spreadsheet into any box to fill that tube and the ones after it, in run order.
                  Unnamed tubes go by their position.
                </p>
                <div className="rack-stack" style={{ marginTop: 12 }}>
                  {racks.map((r, i) => (
                    <div key={i}>
                      {racks.length > 1 && <h3>Rack {i + 1}</h3>}
                      {r.size === 0 ? (
                        <p className="note">No tubes selected.</p>
                      ) : (
                        <table>
                          <tbody>
                            {sortColumnMajor(r).map((well, k) => (
                              <tr key={well}>
                                <td className="well">{well}</td>
                                <td>
                                  <input
                                    aria-label={`Sample in rack ${i + 1} ${well}`}
                                    value={names[i]?.[well] ?? ""}
                                    placeholder={well}
                                    onChange={(e) => setName(i, well, e.target.value)}
                                    onPaste={(e) => pasteNames(i, k, e)}
                                  />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  ))}
                </div>
              </Panel>
            )}

            <Panel title="Run settings">
              <div className="fields">
                <SelectField
                  label="Samples start as"
                  value={sampleSource}
                  onChange={(v) => setSampleSource(v as SampleSource)}
                  options={[
                    { value: "tubes", label: "Separate samples, already in tubes" },
                    { value: "culture", label: "One culture, robot dispenses" },
                  ]}
                />
                <NumberField label="Batches" value={nBatches} onChange={setNBatches} min={1} max={10} />
                <NumberField label="Elutions" value={nElutions} onChange={setNElutions} min={1} max={5} />
                {!preloaded && (
                  <NumberField label="Culture" unit="µL" value={cultureVolume} onChange={setCultureVolume} min={50} step={50} />
                )}
                <NumberField label="Lysis" unit="µL" value={lysisVolume} onChange={setLysisVolume} min={50} step={50} />
                <NumberField label="Neutralisation" unit="µL" value={neutralisationVolume} onChange={setNeutralisationVolume} min={50} step={50} />
                <NumberField label="Wash" unit="µL" value={washVolume} onChange={setWashVolume} min={50} step={50} />
                <NumberField label="Wash rounds" value={washRounds} onChange={setWashRounds} min={1} max={8} />
                <NumberField label="Elution" unit="µL" value={elutionVolume} onChange={setElutionVolume} min={10} step={5} />
              </div>
              <div style={{ marginTop: 12 }}>
                <CheckField
                  label="Mix each tube after neutralising, instead of inverting the rack"
                  checked={neutralisationMix}
                  onChange={setNeutralisationMix}
                />
                <p className="note" style={{ marginTop: 5 }}>
                  Mixing costs one tip per tube. Leave it off and the robot shares a tip per group,
                  dispensing above the tube so it stays clean — then you invert the rack yourself.
                </p>
              </div>
            </Panel>

            <div className="banner quiet">
              <h3>Batches reuse the same positions</h3>
              With more than one batch, the robot pauses between stages so you can swap tubes into
              the same slots. Lysis and neutralisation for batch 2 run while batch 1 is spinning
              down, so the run interleaves with your hands rather than waiting for them.
            </div>
          </div>

          <DeckViewport
            layout={result?.deckLayout ?? []}
            tally={
              result
                ? [
                    { label: "tips needed", value: String(result.tipsUsed) },
                    { label: "on deck", value: String(result.tipsOnDeck) },
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
              { label: "Samples", value: result.totalSamples },
              {
                label: "Per batch",
                value: (
                  <>
                    {result.samplesPerBatch} <small>× {nBatches}</small>
                  </>
                ),
              },
              { label: "Tips", value: result.tipsUsed },
              {
                label: "Lysis groups",
                value: (
                  <>
                    {Math.ceil(result.samplesPerBatch / 4)} <small>of 4</small>
                  </>
                ),
              },
            ]}
          />

          <Panel title="Load the buffers rack like this" tight>
            <table>
              <thead>
                <tr>
                  <th>Well</th>
                  <th>Contents</th>
                  <th className="num">Volume for the run</th>
                </tr>
              </thead>
              <tbody>
                {result.buffers.map((b) => (
                  <tr key={b.well}>
                    <td className="well">{b.well}</td>
                    <td>{b.label}</td>
                    <td className="num">{b.totalMl.toFixed(1)} mL</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>

          <Panel title="Tube order" tight>
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th className="num">#</th>
                    <th>Rack</th>
                    <th>Tube</th>
                    {preloaded && <th>Sample</th>}
                    <th>Lysis group</th>
                  </tr>
                </thead>
                <tbody>
                  {result.samplePositions.map((s, i) => (
                    <tr key={`${s.rack}-${s.tube}`}>
                      <td className="num">{i + 1}</td>
                      <td className="num">{s.rack}</td>
                      <td className="well">{s.tube}</td>
                      {preloaded && <td>{s.name}</td>}
                      <td className="num">{Math.floor(i / 4) + 1}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          {result.warnings.length > 0 && (
            <Panel title={`${result.warnings.length} thing${result.warnings.length > 1 ? "s" : ""} to check`} tight>
              <Messages warnings={result.warnings} />
            </Panel>
          )}
        </>
      )}

      {tab === "simulate" && result && (
        <>
          <div className="banner quiet">
            <h3>One batch shown</h3>
            Later batches repeat these moves on swapped labware, so the animation covers batch 1.
          </div>
          <Panel title="Every move the robot will make">
            <SimulationViewer steps={result.steps} deckLayout={result.deckLayout} />
          </Panel>
        </>
      )}

      {tab === "protocol" && result && (
        <ProtocolTab source={result.source} filename={`miniprep_${result.totalSamples}_samples.py`} />
      )}

      {tab !== "setup" && !result && (
        <div className="banner">
          <h3>Nothing to show yet</h3>
          Fix the setup and the plan will appear here.
        </div>
      )}
    </>
  );
}
