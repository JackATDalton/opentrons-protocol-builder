/**
 * Normalise a plate that is already in wells, in place on the deck.
 *
 * Paste the plate export you already have: a well/name block followed by a
 * well/concentration block, which is what the plate reader gives you. Source
 * volumes are declared, never measured — the liquid-level sensor under-reads
 * and cost a whole run in August 2026.
 */
import { useMemo, useState } from "react";

import type { DeckConfig } from "../../core/deck";
import { generateNormalisation, type NormalisationResult } from "../../generators/normalisation";
import { DeckViewport } from "../DeckViewport";
import { PlateMap, PlateMapLegend } from "../PlateMap";
import { CsvInput, Messages, NumberField, Panel, ProtocolTab, SelectField, Tally, TextField } from "../common";
import { occupiedWells, parsePlateCsv } from "../../parsers/plate-csv";
import type { Tab } from "../tabs";
import { PLATE_CONTENTS_EXAMPLE } from "../examples";
import { LABWARE, labwareOptions } from "../../core/labware";

const SEED = `Location,Name
A1,C1J
A2,P1d
A3,P2d
B1,U1d
B2,U2d
B3,T1m
A1,114
A2,62.5
A3,67.8
B1,63.5
B2,76
B3,35`;

interface Props {
  deck: DeckConfig;
  tab: Tab;
  author: string;
  slackUserId: string;
  notify: (id: string) => { slackWebhookUrl?: string; slackUserId?: string };
}

export function PlateNormalisationView({ deck, tab, author, slackUserId, notify }: Props) {
  const [text, setText] = useState(SEED);
  const [target, setTarget] = useState(30);
  const [finalVolume, setFinalVolume] = useState(100);
  const [sourceVolume, setSourceVolume] = useState(45);
  const [deadVolume, setDeadVolume] = useState(2);
  const [plateType, setPlateType] = useState<string>(LABWARE.pcrPlate);
  const [waterWell, setWaterWell] = useState("A1");

  const parsed = useMemo(() => {
    try {
      const plate = parsePlateCsv(text);
      const wells = occupiedWells(plate);
      if (!wells.length) {
        return { errors: ["No well has a concentration. Add the numbers block under the names."] };
      }
      return { plate, wells, errors: [] as string[] };
    } catch (e) {
      return { errors: [e instanceof Error ? e.message : String(e)] };
    }
  }, [text]);

  const generated = useMemo((): { result?: NormalisationResult; error?: string } => {
    if (parsed.errors.length || !parsed.plate || !parsed.wells) return {};
    try {
      return {
        result: generateNormalisation({
          deck,
          wells: parsed.wells.map((well) => ({
            well,
            name: parsed.plate![well].name ?? well,
            concentration: parsed.plate![well].concentration!,
            targetConcentration: target,
            sourceVolumeUl: sourceVolume,
          })),
          plateType,
          waterLabware: LABWARE.falconRack,
          waterWell,
          finalVolumeUl: finalVolume,
          deadVolumeUl: deadVolume,
          author,
          notify: notify(slackUserId),
          protocolName: `Plate normalisation at ${target} ng/uL`,
        }),
      };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [deck, parsed, target, finalVolume, sourceVolume, deadVolume, plateType, waterWell, author, slackUserId, notify]);

  const result = generated.result;

  return (
    <>
      <Messages errors={[...parsed.errors, ...(generated.error ? [generated.error] : [])]} />

      {tab === "setup" && (
        <div className="with-deck">
          <div style={{ display: "grid", gap: 16 }}>
            <Panel title="Plate contents">
              <p className="note">
                Upload or paste the plate export: <code>Well,Name</code> rows, then <code>Well,Number</code>{" "}
                rows. Order does not matter — a row is read as a concentration if its value is a
                number.
              </p>
              <CsvInput label="Plate contents" value={text} onChange={setText} example={PLATE_CONTENTS_EXAMPLE} />
              <p className="note">{parsed.wells?.length ?? 0} wells with a concentration</p>
            </Panel>

            <Panel title="Run settings">
              <div className="fields">
                <NumberField label="Target" unit="ng/µL" value={target} onChange={setTarget} min={1} />
                <NumberField label="Final volume" unit="µL" value={finalVolume} onChange={setFinalVolume} min={1} step={5} />
                <NumberField label="Volume in each well" unit="µL" value={sourceVolume} onChange={setSourceVolume} min={1} step={5} />
                <NumberField label="Dead volume" unit="µL" value={deadVolume} onChange={setDeadVolume} min={0} />
                <SelectField
                  label="Plate"
                  value={plateType}
                  onChange={setPlateType}
                  options={labwareOptions([LABWARE.pcrPlate, LABWARE.corningFlat96])}
                />
                <TextField label="Water well" value={waterWell} onChange={setWaterWell} upper />
              </div>
              <p className="note" style={{ marginTop: 9 }}>
                Declare the volume in the wells rather than relying on the robot to sense it. The
                liquid-level sensor under-reads on this machine and under-transferred nearly every
                well on 13 August 2026.
              </p>
            </Panel>
          </div>

          <DeckViewport layout={result?.deckLayout ?? []} />
        </div>
      )}

      {tab === "plan" && result && (
        <>
          <Tally
            items={[
              { label: "Wells", value: result.plan.length },
              { label: "Short", value: result.plan.filter((p) => p.short).length },
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

          <Panel title="Plate after normalisation">
            <PlateMap
              loadName={plateType}
              cells={Object.fromEntries(
                result.plan.map((p) => [
                  p.well,
                  {
                    label: p.name,
                    sub: String(p.achievedConcentrationUl),
                    flag: p.short ? ("mass" as const) : undefined,
                    title: `${p.name}, ${p.plasmidUl} µL + ${p.waterUl} µL water = ${p.finalVolumeUl} µL at ${p.achievedConcentrationUl} ng/µL`,
                  },
                ]),
              )}
            />
            <PlateMapLegend flags />
          </Panel>

          <Panel title="Volumes" tight>
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th>Well</th>
                    <th>Sample</th>
                    <th className="num">Plasmid µL</th>
                    <th className="num">Water µL</th>
                    <th className="num">Final µL</th>
                    <th className="num">Achieved</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {result.plan.map((p) => (
                    <tr key={p.well}>
                      <td className="well">{p.well}</td>
                      <td>{p.name}</td>
                      <td className="num">{p.plasmidUl}</td>
                      <td className="num">{p.waterUl}</td>
                      <td className="num">{p.finalVolumeUl}</td>
                      <td className="num">{p.achievedConcentrationUl}</td>
                      <td>{p.short && <span className="flag mass">mass limited</span>}</td>
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

      {tab === "simulate" && (
        <div className="banner quiet">
          <h3>No animation for this one yet</h3>
          This generator predates the step recorder, so it emits Python without a step list. The
          volumes on the Plan tab come from the same pass as the protocol, so they are still the
          authority on what will happen.
        </div>
      )}

      {tab === "protocol" && result && (
        <ProtocolTab source={result.source} filename={`plate_normalisation_${target}ngul.py`} />
      )}

      {tab !== "setup" && tab !== "simulate" && !result && (
        <div className="banner">
          <h3>Nothing to show yet</h3>
          Fix the plate contents on the Set up tab.
        </div>
      )}
    </>
  );
}
