/**
 * Combinatorial Golden Gate assembly.
 *
 * Mirrors the lab's original builder: several assembly plates can be loaded at
 * once (they draw from the same repository plate, so the part-volume check
 * aggregates demand across all of them), and each plate downloads as its own
 * protocol.
 */
import { useMemo, useState } from "react";

import type { DeckConfig } from "../../core/deck";
import { checkPartVolumes, parseAssemblyLayout, type AssemblyLayout } from "../../parsers/assembly-layout";
import { parsePlateCsv, parseVolumesCsv } from "../../parsers/plate-csv";
import {
  DEFAULT_GOLDENGATE_PROFILE,
  generateGoldenGate,
  type GoldenGateResult,
  type ThermocyclerProfile,
} from "../../generators/goldengate";
import { DeckViewport } from "../DeckViewport";
import { PlateMap } from "../PlateMap";
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
  downloadPython,
} from "../common";
import { ASSEMBLY_LAYOUT_EXAMPLE, REPO_VOLUMES_EXAMPLE, REPOSITORY_PLATE_EXAMPLE } from "../examples";
import { SimulationViewer } from "../SimulationViewer";
import type { Tab } from "../tabs";
import { LABWARE, labwareOptions } from "../../core/labware";

const PLATE_TYPES = labwareOptions([LABWARE.pcrPlate, LABWARE.corningFlat96, LABWARE.nestFlat96]);

const STATUS_LABEL: Record<string, string> = {
  ok: "OK",
  short: "SHORT",
  missing_from_repo: "NOT IN REPO",
  no_volume_data: "NO VOLUME DATA",
};

interface Props {
  deck: DeckConfig;
  tab: Tab;
  author: string;
  slackUserId: string;
  notify: (id: string) => { slackWebhookUrl?: string; slackUserId?: string };
}

interface PlateEntry {
  label: string;
  text: string;
}

function slug(text: string): string {
  return text.trim().replace(/\W+/g, "_").toLowerCase() || "golden_gate";
}

export function GoldenGateView({ deck, tab, author, slackUserId, notify }: Props) {
  const [plates, setPlates] = useState<PlateEntry[]>([{ label: "Plate 1", text: "" }]);
  const [selected, setSelected] = useState(0);
  const [repoText, setRepoText] = useState("");
  const [volumesText, setVolumesText] = useState("");
  const [masterMix, setMasterMix] = useState<Set<string>>(new Set());
  const [protocolName, setProtocolName] = useState("Golden Gate Assembly");
  const [plateType, setPlateType] = useState(PLATE_TYPES[0].value);
  const [enzymeVolume, setEnzymeVolume] = useState(7);
  const [mmTubeWell, setMmTubeWell] = useState("B2");
  const [transferVolume, setTransferVolume] = useState(1);
  const [prewetVolume, setPrewetVolume] = useState(5);
  const [profile, setProfile] = useState<ThermocyclerProfile>(DEFAULT_GOLDENGATE_PROFILE);
  // Default to the Flex thermocycler only when this deck has one to use.
  const hasThermocycler = deck.fixtures.some((f) => f.kind === "thermocycler" && f.usableByProtocol);
  const [thermocycler, setThermocycler] = useState<"onboard" | "external">(hasThermocycler ? "onboard" : "external");
  const hasHeaterBlock = deck.fixtures.some((f) => f.kind === "temperature_module" && f.usableByProtocol);
  // The heater block stands in for the thermocycler's cold hold, so it is the
  // default home for the plate whenever this deck has one.
  const [assemblyOn, setAssemblyOn] = useState<"deck" | "heater-block">(hasHeaterBlock ? "heater-block" : "deck");

  const parsedPlates = useMemo(
    () =>
      plates.map((p): { label: string; layout?: AssemblyLayout; error?: string } => {
        if (!p.text.trim()) return { label: p.label, error: `${p.label}: upload or paste the assembly layout CSV.` };
        try {
          return { label: p.label, layout: parseAssemblyLayout(p.text) };
        } catch (e) {
          return { label: p.label, error: `${p.label}: ${e instanceof Error ? e.message : String(e)}` };
        }
      }),
    [plates],
  );

  const parsedRepo = useMemo((): { repo?: ReturnType<typeof parsePlateCsv>; error?: string } => {
    if (!repoText.trim()) return { error: "Upload or paste the repository plate CSV." };
    try {
      return { repo: parsePlateCsv(repoText) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [repoText]);

  const parsedVolumes = useMemo((): { volumes?: ReturnType<typeof parseVolumesCsv>; error?: string } => {
    if (!volumesText.trim()) return {};
    try {
      return { volumes: parseVolumesCsv(volumesText) };
    } catch (e) {
      return { error: `Volumes CSV: ${e instanceof Error ? e.message : String(e)}` };
    }
  }, [volumesText]);

  /** Part-type columns across every plate, for the master-mix checkboxes. */
  const allPartColumns = useMemo(() => {
    const seen = new Set<string>();
    const columns: string[] = [];
    for (const p of parsedPlates) {
      for (const c of p.layout?.partColumns ?? []) {
        if (!seen.has(c)) {
          seen.add(c);
          columns.push(c);
        }
      }
    }
    return columns;
  }, [parsedPlates]);

  const results = useMemo(
    () =>
      parsedPlates.map((p): { label: string; result?: GoldenGateResult; error?: string } => {
        if (!p.layout || !parsedRepo.repo) return { label: p.label };
        try {
          return {
            label: p.label,
            result: generateGoldenGate({
              deck,
              layout: p.layout,
              repoPlate: parsedRepo.repo,
              plateType,
              protocolName: plates.length > 1 ? `${protocolName} — ${p.label}` : protocolName,
              enzymeVolumePerWellUl: enzymeVolume,
              mmTubeWell,
              transferVolumeUl: transferVolume,
              prewetVolumeUl: prewetVolume,
              profile,
              // Columns this plate does not have cannot be in its master mix.
              masterMixParts: [...masterMix].filter((c) => p.layout!.partColumns.includes(c)),
              thermocycler,
              // A heater-block choice is meaningless onboard, and stale once
              // the deck preset loses its module.
              assemblyOn: thermocycler === "external" && hasHeaterBlock ? assemblyOn : "deck",
              author,
              notify: notify(slackUserId),
            }),
          };
        } catch (e) {
          return { label: p.label, error: `${p.label}: ${e instanceof Error ? e.message : String(e)}` };
        }
      }),
    [
      parsedPlates, parsedRepo, deck, plateType, plates.length, protocolName, enzymeVolume, mmTubeWell,
      transferVolume, prewetVolume, profile, masterMix, thermocycler, assemblyOn, author, slackUserId, notify,
    ],
  );

  /** Demand aggregated across every plate: they draw from the same tubes. */
  const check = useMemo(() => {
    const layouts = parsedPlates.map((p) => p.layout).filter((l): l is AssemblyLayout => !!l);
    if (!layouts.length || !parsedRepo.repo) return null;
    return checkPartVolumes({
      layouts,
      repoPlate: parsedRepo.repo,
      volumes: parsedVolumes.volumes,
      transferVolumeUl: transferVolume,
      prewetVolumeUl: prewetVolume,
      masterMixParts: [...masterMix],
    });
  }, [parsedPlates, parsedRepo, parsedVolumes, transferVolume, prewetVolume, masterMix]);
  const shortfalls = check?.filter((r) => r.status !== "ok" && r.status !== "no_volume_data").length ?? 0;

  const current = results[selected] ?? results[0];
  const result = current?.result;
  const errors = [
    ...(parsedRepo.error ? [parsedRepo.error] : []),
    ...(parsedVolumes.error ? [parsedVolumes.error] : []),
    ...(parsedPlates[selected]?.error ? [parsedPlates[selected].error!] : []),
    ...(current?.error ? [current.error] : []),
  ];
  const warnings = [
    ...(result?.warnings ?? []),
    ...(shortfalls > 0 ? [`${shortfalls} part(s) are short or missing in the volume check — see the Plan tab.`] : []),
  ];

  const addFiles = (files: { name: string; text: string }[]) => {
    setPlates((prev) => {
      // A file replaces the plate with its name; otherwise it becomes a new
      // plate. A single file also fills the one still-empty starter plate.
      let next = [...prev];
      for (const f of files) {
        const label = f.name.replace(/\.csv$/i, "");
        const existing = next.findIndex((p) => p.label === label);
        if (existing >= 0) next[existing] = { label, text: f.text };
        else if (next.length === 1 && !next[0].text.trim()) next = [{ label, text: f.text }];
        else next.push({ label, text: f.text });
      }
      return next;
    });
    setSelected(0);
  };

  const removePlate = (i: number) => {
    setPlates((prev) => (prev.length > 1 ? prev.filter((_, j) => j !== i) : [{ label: "Plate 1", text: "" }]));
    setSelected((s) => Math.max(0, Math.min(s === i ? 0 : s > i ? s - 1 : s, plates.length - 2)));
  };

  const downloadAll = () => {
    for (const r of results) {
      if (r.result) downloadPython(r.result.source, `${slug(protocolName)}_${slug(r.label)}.py`);
    }
  };

  const setProfileField = (key: keyof ThermocyclerProfile) => (v: number) =>
    setProfile((prev) => ({ ...prev, [key]: v }));

  return <>
    <Messages errors={errors} warnings={warnings} />
    {tab === "setup" && <div className="with-deck">
      <div style={{ display: "grid", gap: 16 }}>
        <Panel
          title={plates.length > 1 ? `Assembly plates (${plates.length})` : "Assembly plate"}
          actions={
            <button className="ghost" onClick={() => {
              setPlates([...plates, { label: `Plate ${plates.length + 1}`, text: "" }]);
              setSelected(plates.length);
            }}>
              Add a plate
            </button>
          }
        >
          <p className="note">
            A header row of <code>Well,Combination_ID</code> followed by one column per part type
            (for example <code>Promoter,UTR,CDS,Terminator</code>). Then one row per assembly well,
            naming the part of each type that goes into it. Leave a cell blank to skip that part
            type in that well. Upload several files to build a batch of plates — each downloads as
            its own protocol, and the volume check adds their demands together.
          </p>
          {plates.length > 1 && (
            <div className="plate-chips">
              {plates.map((p, i) => (
                <span key={i} className="plate-chip">
                  <button className="ghost" aria-current={i === selected} onClick={() => setSelected(i)}>
                    {p.label}
                  </button>
                  <button className="ghost" aria-label={`Remove ${p.label}`} onClick={() => removePlate(i)}>
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          <CsvInput
            label={`Assembly layout CSV${plates.length > 1 ? ` — ${plates[selected].label}` : ""}`}
            rows={8}
            value={plates[selected]?.text ?? ""}
            onChange={(text) => setPlates((prev) => prev.map((p, i) => (i === selected ? { ...p, text } : p)))}
            placeholder="Well,Combination_ID,Promoter,UTR,CDS,Terminator"
            example={ASSEMBLY_LAYOUT_EXAMPLE}
            onFiles={addFiles}
          />
        </Panel>
        <Panel title="Repository plate">
          <p className="note">
            A header row, then one row per well of the repository plate: <code>Well,Part</code>, for
            example <code>A1,P1d</code>. Part names match the layout ignoring case and anything after
            a colon, so <code>P1d: PLacI</code> matches <code>P1d</code>. Rows whose second value is a
            number are read as concentrations and are not needed here.
          </p>
          <CsvInput label="Repository plate CSV" rows={8} value={repoText} onChange={setRepoText} placeholder="Well,Value" example={REPOSITORY_PLATE_EXAMPLE} />
        </Panel>
        <Panel title="Repository volumes (optional)">
          <p className="note">
            A CSV with <code>name</code> and volume columns saying how much of each part is in its
            well — the summary a normalisation run produces works as-is. With it, the Plan tab
            checks every part has enough volume for all the plates above; without it, availability
            shows as unknown.
          </p>
          <CsvInput label="Repository volumes CSV" rows={4} value={volumesText} onChange={setVolumesText} placeholder="well,name,final_volume_ul" example={REPO_VOLUMES_EXAMPLE} />
        </Panel>
        <Panel title="Reaction">
          <div className="fields">
            <TextField label="Protocol name" value={protocolName} onChange={setProtocolName} />
            <SelectField label="Plate type" value={plateType} onChange={setPlateType} options={PLATE_TYPES} />
            <NumberField label="Enzyme master mix per well" unit="µL" value={enzymeVolume} onChange={setEnzymeVolume} min={1} max={50} step={0.5} />
            <TextField label="Master mix tube" value={mmTubeWell} onChange={setMmTubeWell} upper />
            <NumberField label="Each pipetted part" unit="µL" value={transferVolume} onChange={setTransferVolume} min={1} max={50} step={1} />
            <NumberField label="Pre-wet" unit="µL" value={prewetVolume} onChange={setPrewetVolume} min={0} max={50} step={1} />
          </div>
          {allPartColumns.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <p className="note">Already in the master mix, so never pipetted:</p>
              <div className="fields" style={{ marginTop: 5 }}>
                {allPartColumns.map((col) => (
                  <CheckField
                    key={col}
                    label={col}
                    checked={masterMix.has(col)}
                    onChange={(on) => {
                      const next = new Set(masterMix);
                      if (on) next.add(col);
                      else next.delete(col);
                      setMasterMix(next);
                    }}
                  />
                ))}
              </div>
            </div>
          )}
          <p className="note" style={{ marginTop: 9 }}>
            Part transfers share a tip only across wells with identical accumulated parts.
            Aspirate the exact batch total and blow out in the final well; singletons use a fresh tip.
            Revised 12 Nov 2026; bench validation pending.
          </p>
        </Panel>
        <Panel title="Thermocycling">
          <div className="fields">
            <SelectField
              label="Cycle the plate on"
              value={thermocycler}
              onChange={(v) => setThermocycler(v as "onboard" | "external")}
              options={[
                { value: "onboard", label: "The Flex thermocycler" },
                { value: "external", label: "Another thermocycler" },
              ]}
            />
            {thermocycler === "external" && hasHeaterBlock && (
              <SelectField
                label="Build the plate on"
                value={assemblyOn}
                onChange={(v) => setAssemblyOn(v as "deck" | "heater-block")}
                options={[
                  { value: "heater-block", label: `The heater block, held at ${profile.holdTemp} °C` },
                  { value: "deck", label: "A free deck slot" },
                ]}
              />
            )}
          </div>
          <p className="note" style={{ marginTop: 8 }}>
            {thermocycler === "onboard"
              ? "The plate is built on the thermocycler, held cold while the robot pipettes, then cycled once you seal it."
              : (assemblyOn === "heater-block" && hasHeaterBlock)
                ? "The plate is built on the heater block, which stands in for the thermocycler's cold block while the robot pipettes, and keeps holding until you collect it. Seal the plate and run the program on the Plan tab on your own machine."
                : "The plate is built on an ordinary deck slot at room temperature, and the protocol stops when it is assembled. Seal it and run the program on the Plan tab on your own machine. Keep the master mix cold until you load it."}
          </p>
          <details style={{ marginTop: 10 }}>
            <summary className="note" style={{ cursor: "pointer" }}>Cycling profile</summary>
            <div className="fields" style={{ marginTop: 10 }}>
              <NumberField label="Cut" unit="°C" value={profile.cutTemp} onChange={setProfileField("cutTemp")} />
              <NumberField label="Cut time" unit="min" value={profile.cutTimeMin} onChange={setProfileField("cutTimeMin")} min={0.5} step={0.5} />
              <NumberField label="Ligation" unit="°C" value={profile.ligTemp} onChange={setProfileField("ligTemp")} />
              <NumberField label="Ligation time" unit="min" value={profile.ligTimeMin} onChange={setProfileField("ligTimeMin")} min={0.5} step={0.5} />
              <NumberField label="Cycles" value={profile.cycles} onChange={setProfileField("cycles")} min={1} max={99} />
              <NumberField label="Lid" unit="°C" value={profile.lidTemp} onChange={setProfileField("lidTemp")} />
              <NumberField label="Inactivation" unit="°C" value={profile.inactivationTemp} onChange={setProfileField("inactivationTemp")} />
              <NumberField label="Inactivation time" unit="min" value={profile.inactivationTimeMin} onChange={setProfileField("inactivationTimeMin")} min={1} />
              <NumberField label="Hold" unit="°C" value={profile.holdTemp} onChange={setProfileField("holdTemp")} />
            </div>
          </details>
        </Panel>
      </div>
      <DeckViewport layout={result?.deckLayout ?? []} tally={result ? [{ label: "wells", value: String(result.steps.filter((s) => s.kind === "dispense" && s.labwareId === "assembly").length) }, { label: "tips", value: String(result.tipsUsed) }] : undefined} />
    </div>}
    {tab === "plan" && <>
      {result && <Tally items={[{ label: "Wells", value: new Set(result.plan.flatMap((p) => p.destinations)).size }, { label: "Part batches", value: result.plan.length }, { label: "Tips", value: result.tipsUsed }, ...(plates.length > 1 ? [{ label: "Plates", value: plates.length }] : [])]} />}
      {check && (
        <Panel title={`Part volumes${plates.length > 1 ? ` across all ${plates.length} plates` : ""}${parsedVolumes.volumes ? "" : " — no volumes CSV, availability unknown"}`} tight>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Part</th>
                  <th className="num">Wells needed</th>
                  <th className="num">Required (µL)</th>
                  <th className="num">Available (µL)</th>
                  <th>Repository well</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {check.map((row) => (
                  <tr key={row.part}>
                    <td>{row.part}</td>
                    <td className="num">{row.wellsNeeded}</td>
                    <td className="num">{row.requiredUl.toFixed(1)}</td>
                    <td className="num">{row.availableUl != null ? row.availableUl.toFixed(1) : "—"}</td>
                    <td className="well">{row.repoWell ?? "—"}</td>
                    <td>{STATUS_LABEL[row.status] ?? row.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
      {result?.thermocycler === "external" && <Panel title="Program for your thermocycler" tight>
        <table><tbody>
          <tr><td>Cycle</td><td>{result.profile.cycles} ×: {result.profile.cutTemp} °C for {result.profile.cutTimeMin} min, then {result.profile.ligTemp} °C for {result.profile.ligTimeMin} min</td></tr>
          <tr><td>Inactivate</td><td>{result.profile.inactivationTemp} °C for {result.profile.inactivationTimeMin} min</td></tr>
          <tr><td>Hold</td><td>{result.profile.holdTemp} °C</td></tr>
          <tr><td>Lid</td><td>{result.profile.lidTemp} °C</td></tr>
        </tbody></table>
      </Panel>}
      {result && parsedPlates[selected]?.layout && (
        <Panel title={`Assembly plate${plates.length > 1 ? ` — ${current.label}` : ""}`}>
          <PlateMap
            loadName={plateType}
            cells={Object.fromEntries(
              parsedPlates[selected].layout!.rows.map((r) => [
                r.well,
                {
                  label: r.combinationId,
                  title: `#${r.combinationId}: ${Object.values(r.parts).filter(Boolean).join(" + ")}`,
                },
              ]),
            )}
          />
          <p className="note">Each well shows its combination ID; hover for the parts.</p>
        </Panel>
      )}
      {result && <Panel title={`Part transfer plan${plates.length > 1 ? ` — ${current.label}` : ""}`} tight><div className="scroll"><table><thead><tr><th>Part type</th><th>Part</th><th>Repository well</th><th>Assembly wells</th></tr></thead><tbody>{result.plan.map((p, i) => <tr key={`${p.column}-${p.part}-${i}`}><td>{p.column}</td><td>{p.part}</td><td className="well">{p.sourceWell}</td><td>{p.destinations.join(", ")}</td></tr>)}</tbody></table></div></Panel>}
    </>}
    {tab === "simulate" && result && <Panel title={`Every move the robot will make${plates.length > 1 ? ` — ${current.label}` : ""}`}><SimulationViewer steps={result.steps} deckLayout={result.deckLayout} /></Panel>}
    {tab === "protocol" && result && <>
      {plates.length > 1 && (
        <div className="banner quiet">
          <h3>One protocol per plate</h3>
          This shows {current.label}. Pick another plate on the Setup tab, or{" "}
          <button className="ghost" onClick={downloadAll} disabled={results.some((r) => !r.result)}>
            download all {results.length} protocols
          </button>
          {results.some((r) => !r.result) && " (fix the plates with errors first)"}.
        </div>
      )}
      <ProtocolTab source={result.source} filename={`${slug(protocolName)}${plates.length > 1 ? `_${slug(current.label)}` : ""}.py`} />
    </>}
    {(tab === "simulate" || tab === "protocol") && !result && (
      <div className="banner">
        <h3>Nothing to show yet</h3>
        Fix the setup and the protocol will appear here.
      </div>
    )}
  </>;
}
