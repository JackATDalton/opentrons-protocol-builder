/**
 * Plate wells to individual tubes.
 *
 * The tube map is the output that matters: whoever runs this has to label
 * tubes to match, so the plan table is the thing to print.
 */
import { useMemo, useState } from "react";

import type { DeckConfig } from "../../core/deck";
import { MAX_PLATES, generateTransfer, type TransferResult } from "../../generators/transfer";
import { SimulationViewer } from "../SimulationViewer";
import { DeckViewport } from "../DeckViewport";
import { Messages, NumberField, Panel, ProtocolTab, SelectField, Tally, WellGrid } from "../common";
import type { Tab } from "../tabs";

const PLATE_TYPES = [
  { value: "opentrons_96_wellplate_200ul_pcr_full_skirt", label: "96-well PCR plate, full skirt" },
  { value: "corning_96_wellplate_360ul_flat", label: "Corning 96-well flat" },
  { value: "nest_96_wellplate_200ul_flat", label: "NEST 96-well flat" },
  { value: "jd_24_tuberack_1.5ml", label: "24 × 1.5 mL tube rack" },
];

interface PlateState {
  plateType: string;
  selected: Set<string>;
}

interface Props {
  deck: DeckConfig;
  tab: Tab;
  author: string;
  slackUserId: string;
  notify: (id: string) => { slackWebhookUrl?: string; slackUserId?: string };
}

export function TransferView({ deck, tab, author, slackUserId, notify }: Props) {
  const [plates, setPlates] = useState<PlateState[]>([
    { plateType: PLATE_TYPES[0].value, selected: new Set(["A1", "A2", "A3"]) },
  ]);
  const [volume, setVolume] = useState(200);

  const generated = useMemo((): { result?: TransferResult; error?: string } => {
    if (plates.some((p) => p.selected.size === 0)) {
      return { error: "Every source plate needs at least one well selected." };
    }
    try {
      return {
        result: generateTransfer({
          deck,
          plates: plates.map((p) => ({ plateType: p.plateType, selectedWells: [...p.selected] })),
          transferVolumeUl: volume,
          author,
          notify: notify(slackUserId),
        }),
      };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [deck, plates, volume, author, slackUserId, notify]);

  const result = generated.result;

  const update = (i: number, patch: Partial<PlateState>) =>
    setPlates((prev) => prev.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  return (
    <>
      <Messages errors={generated.error ? [generated.error] : []} />

      {tab === "setup" && (
        <div className="with-deck">
          <div style={{ display: "grid", gap: 16 }}>
            <Panel title="Transfer volume">
              <div className="fields">
                <NumberField label="Volume per well" unit="µL" value={volume} onChange={setVolume} min={5} max={1000} step={10} />
              </div>
              <p className="note" style={{ marginTop: 8 }}>
                Every well is treated as a separate sample, so each transfer gets a fresh tip.
                {result && ` This run uses ${result.tipsUsed}.`}
              </p>
            </Panel>

            {plates.map((p, i) => (
              <Panel
                key={i}
                title={plates.length > 1 ? `Source plate ${i + 1}` : "Source plate"}
                actions={
                  plates.length > 1 ? (
                    <button
                      className="ghost"
                      onClick={() => setPlates(plates.filter((_, j) => j !== i))}
                    >
                      Remove
                    </button>
                  ) : undefined
                }
              >
                <div className="fields" style={{ marginBottom: 12 }}>
                  <SelectField
                    label="Labware"
                    value={p.plateType}
                    onChange={(plateType) => update(i, { plateType, selected: new Set() })}
                    options={PLATE_TYPES}
                  />
                </div>
                <WellGrid
                  loadName={p.plateType}
                  selected={p.selected}
                  onChange={(selected) => update(i, { selected })}
                />
              </Panel>
            ))}

            {plates.length < MAX_PLATES && (
              <div>
                <button
                  className="ghost"
                  onClick={() =>
                    setPlates([...plates, { plateType: PLATE_TYPES[0].value, selected: new Set() }])
                  }
                >
                  Add another source plate
                </button>
              </div>
            )}
          </div>

          <DeckViewport
            layout={result?.deckLayout ?? []}
            tally={result ? [{ label: "transfers", value: String(result.plan.length) }] : undefined}
          />
        </div>
      )}

      {tab === "plan" && result && (
        <>
          <Tally
            items={[
              { label: "Transfers", value: result.plan.length },
              { label: "Tube racks", value: Math.max(...result.plan.map((p) => p.rack)) },
              { label: "Tips", value: result.tipsUsed },
              {
                label: "Volume moved",
                value: (
                  <>
                    {((result.plan.length * volume) / 1000).toFixed(1)} <small>mL</small>
                  </>
                ),
              },
            ]}
          />

          <Panel title="Label the tubes like this" tight>
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th className="num">#</th>
                    <th>From plate</th>
                    <th>Well</th>
                    <th>Rack</th>
                    <th>Tube</th>
                  </tr>
                </thead>
                <tbody>
                  {result.plan.map((p, i) => (
                    <tr key={`${p.plate}-${p.sourceWell}`}>
                      <td className="num">{i + 1}</td>
                      <td className="num">{p.plate}</td>
                      <td className="well">{p.sourceWell}</td>
                      <td className="num">{p.rack}</td>
                      <td className="well">{p.tube}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          {result.warnings.length > 0 && (
            <Panel title="Things to check" tight>
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
        <ProtocolTab source={result.source} filename={`plate_to_tube_${result.plan.length}.py`} />
      )}

      {tab !== "setup" && !result && (
        <div className="banner">
          <h3>Nothing to show yet</h3>
          Select at least one well on each source plate.
        </div>
      )}
    </>
  );
}
