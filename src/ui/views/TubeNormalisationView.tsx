/**
 * Tubes in, normalised 96-well source plate out.
 *
 * Everything on screen comes from one `generateTubeNormalisation` call, so the
 * plan table, the deck, the animation and the downloaded file cannot disagree.
 */
import { useMemo, useState } from "react";

import type { DeckConfig } from "../../core/deck";
import {
  generateTubeNormalisation,
  type TubeNormalisationResult,
  type TubeSample,
} from "../../generators/tube-normalisation";
import { SimulationViewer } from "../SimulationViewer";
import { DeckViewport } from "../DeckViewport";
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
import { TUBE_LIST_EXAMPLE } from "../examples";

const SEED = `# part, ng/uL, uL in tube, [mastermix]
P10d, 49.6, 50
P18m, 45, 50
P1d, 37.2, 50
P1m, 53.3, 50
P2d, 67.8, 50
P33m, 40, 100
P34m, 25.3, 50
P3d, 55.9, 50
P4d, 33.5, 50
P4m, 39.2, 50
P5d, 55.9, 50
P61m, 65.3, 50
P6d, 60.1, 50
P8d, 35.6, 50
P9d, 46.4, 50
U17m, 39, 200
U1d, 22.6, 50
U2d, 46, 100
U4d, 30.8, 100
U4m, 50, 100
U5d, 53.7, 100
U6d, 29, 100
U9m, 43, 100
T12m, 26, 100
T13m, 41, 100
T14m, 31, 100
T16m, 30, 100
T18m, 29, 100
T1d, 31, 100
T1m, 18.3, 100
T2m, 45, 100
C4J, 60, 3600, mastermix
V35m, 120, 800, mastermix`;

export function parseSamples(text: string): { samples: TubeSample[]; errors: string[] } {
  const samples: TubeSample[] = [];
  const errors: string[] = [];

  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;

    const cells = line.split(/[,\t]/).map((c) => c.trim());
    if (cells.length < 3) {
      errors.push(`Line ${i + 1}: expected "part, ng/uL, uL" — got "${line}".`);
      return;
    }

    const [name, conc, vol, flag] = cells;
    const concentration = Number(conc);
    const volumeUl = Number(vol);
    const problems: string[] = [];

    if (!name) problems.push("no part name");
    if (!Number.isFinite(concentration) || concentration <= 0) problems.push(`"${conc}" is not a concentration`);
    if (!Number.isFinite(volumeUl) || volumeUl <= 0) problems.push(`"${vol}" is not a volume`);

    if (problems.length) {
      errors.push(`Line ${i + 1}: ${problems.join(", ")}.`);
      return;
    }

    samples.push({
      name,
      concentration,
      volumeUl,
      masterMix: /^(mastermix|master mix|mm|true|yes)$/i.test(flag ?? ""),
    });
  });

  return { samples, errors };
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
  const [target, setTarget] = useState(30);
  const [finalVolume, setFinalVolume] = useState(100);
  const [deadVolume, setDeadVolume] = useState(3);
  const [mixCycles, setMixCycles] = useState(3);
  const [waterLabware, setWaterLabware] = useState("jd_6_falconrack_50ml");
  const [waterWell, setWaterWell] = useState("A1");
  const [showFlagged, setShowFlagged] = useState(false);

  const parsed = useMemo(() => parseSamples(text), [text]);

  const generated = useMemo((): { result?: TubeNormalisationResult; error?: string } => {
    if (parsed.errors.length || !parsed.samples.length) return {};
    try {
      return {
        result: generateTubeNormalisation({
          deck,
          samples: parsed.samples,
          targetConcentration: target,
          finalVolumeUl: finalVolume,
          waterLabware,
          waterWell,
          tubeDeadVolumeUl: deadVolume,
          mixCycles,
          author,
          notify: notify(slackUserId),
          protocolName: `Source plate normalisation at ${target} ng/uL`,
        }),
      };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [deck, parsed, target, finalVolume, waterLabware, waterWell, deadVolume, mixCycles, author, slackUserId, notify]);

  const result = generated.result;
  const toPlate = parsed.samples.filter((s) => !s.masterMix).length;
  const inMix = parsed.samples.length - toPlate;

  const rows = result
    ? showFlagged
      ? result.plan.filter((p) => p.belowTarget || p.massLimited)
      : result.plan
    : [];

  return (
    <>
      <Messages errors={[...parsed.errors, ...(generated.error ? [generated.error] : [])]} />

      {tab === "setup" && (
        <div className="with-deck">
          <div style={{ display: "grid", gap: 16 }}>
            <Panel title="Tubes">
              <p className="note">
                One tube per line: part name, concentration in ng/µL, volume in µL. Add a fourth
                field <code>mastermix</code> for parts you premix by hand — those stay off the plate.
              </p>
              <CsvInput label="Tube list" value={text} onChange={setText} example={TUBE_LIST_EXAMPLE} />
              <p className="note">
                {toPlate} to plate{inMix > 0 && `, ${inMix} in the master mix`}
              </p>
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
                  options={[
                    { value: "jd_6_falconrack_50ml", label: "6 × 50 mL Falcon rack" },
                    { value: "jd_24_tuberack_1.5ml", label: "24 × 1.5 mL tube rack" },
                  ]}
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
        <ProtocolTab source={result.source} filename={`source_plate_${target}ngul.py`} />
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
