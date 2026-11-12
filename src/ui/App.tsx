/**
 * The shell: pick a tool on the left, work through four stages on the right,
 * with the deck always in view.
 *
 * Each view is a thin wrapper over one generator call. Nothing on screen is
 * computed separately from the protocol you download, so the plan table, the
 * deck, the animation and the file cannot disagree with each other.
 */
import { useMemo, useState } from "react";

import { DECK_PRESETS } from "../core/deck";
import { LAB_SLACK_WEBHOOK_URL, labNotify, normaliseSlackUserId } from "../config/lab";
import { TABS, TAB_LABELS, type Tab } from "./tabs";
import { DeckPlacementContext, type DeckPlacementApi } from "./deckPlacement";
import { loadDeckLayouts, storeDeckLayouts } from "./persistence";
import { MiniprepView } from "./views/MiniprepView";
import { PlateNormalisationView } from "./views/PlateNormalisationView";
import { TransferView } from "./views/TransferView";
import { GoldenGateView } from "./views/GoldenGateView";
import { TubeNormalisationView } from "./views/TubeNormalisationView";

type ToolId = "tube-normalisation" | "plate-normalisation" | "miniprep" | "transfer" | "goldengate";

interface Tool {
  id: ToolId;
  name: string;
  what: string;
  ready: boolean;
  /** Shown under the title: what the protocol does, start to finish. */
  description: string;
  /** Shown on the Setup tab: one line per option on that screen. */
  options: { name: string; what: string }[];
}

const TOOLS: Tool[] = [
  {
    id: "tube-normalisation",
    name: "Normalise tubes",
    what: "a box of Eppendorfs into one source plate",
    ready: true,
    description:
      "Takes a box of 1.5 mL tubes of parts at whatever concentration they came off the miniprep at, " +
      "and builds one 96-well source plate with every part at the same concentration, ready for Golden " +
      "Gate. Water goes in first from one shared tip, then each part gets its own tip; any transfer too " +
      "big for the 50 µL pipette goes to the 1000 µL one rather than being split.",
    options: [
      { name: "Tube list", what: "One line per tube: part name, concentration (ng/µL), volume (µL). Add mastermix as a fourth field to keep a part off the plate because you premix it by hand." },
      { name: "Target", what: "The concentration every well ends at. Parts already below it go in undiluted and are flagged." },
      { name: "Final volume", what: "How much ends up in each plate well." },
      { name: "Tube dead volume", what: "Liquid left in the bottom of each tube that the robot cannot reach, so it is never counted as usable." },
      { name: "Mix cycles", what: "How many times each well is mixed after its part goes in." },
      { name: "Water labware and well", what: "Where the water sits on the deck." },
    ],
  },
  {
    id: "plate-normalisation",
    name: "Normalise a plate",
    what: "dilute every well to one concentration",
    ready: true,
    description:
      "Takes a plate of plasmids at measured concentrations and makes a fresh plate where every well is " +
      "at the same concentration: plasmid is transferred from the source plate into the matching well of " +
      "the destination plate, then topped up with water. A well that cannot supply enough plasmid is " +
      "filled to a smaller volume that still hits the target, and reported.",
    options: [
      { name: "Plate contents", what: "The plate export: Well,Name rows and Well,Number rows, in any order. A row whose value is a number is read as a concentration (ng/µL)." },
      { name: "Target", what: "The concentration every destination well ends at." },
      { name: "Final volume", what: "How much ends up in each destination well." },
      { name: "Volume in each well", what: "How much is in each source well. Declared rather than sensed, because the liquid-level sensor under-reads on this robot." },
      { name: "Dead volume", what: "Liquid left in each source well that the tip cannot reach." },
      { name: "Plate", what: "The plate type, used for both the source and destination plates." },
      { name: "Water well", what: "Where the water sits on the deck." },
    ],
  },
  {
    id: "miniprep",
    name: "Miniprep",
    what: "vacuum manifold, cells to eluate",
    ready: true,
    description:
      "Plasmid miniprep on the vacuum manifold, from resuspended cells to eluted DNA. The robot lyses and " +
      "neutralises the tubes in groups of four so none sits in lysis buffer for long, then pauses for you " +
      "to spin down and load the columns, washes them, pauses again for the dry spin, and elutes. " +
      "Every dispense happens well above the tubes so tips never catch on open lids.",
    options: [
      { name: "Sample tubes", what: "The rack positions that hold a sample. Up to two racks, each with its own vacuum manifold." },
      { name: "Samples start as", what: "Separate samples you have already loaded into the tubes (the usual case), or one culture in a Falcon that the robot dispenses into every tube." },
      { name: "Sample names", what: "A name for each tube, so the eluates can be labelled. Paste a spreadsheet column into any box to fill that tube and the ones after it." },
      { name: "Batches", what: "Run the same positions again with fresh tubes. The robot pauses between batches so you can swap them." },
      { name: "Elutions", what: "Elute the same columns again into fresh tubes, for more yield." },
      { name: "Lysis, neutralisation, wash, elution", what: "Volume of each buffer per tube or column." },
      { name: "Wash rounds", what: "How many times each column is washed. Every column gets one round before any gets the next." },
      { name: "Mix after neutralising", what: "Mix each tube with its own tip instead of you inverting the rack. Costs one tip per tube." },
    ],
  },
  {
    id: "transfer",
    name: "Plate to tubes",
    what: "one tube per well",
    ready: true,
    description:
      "Moves the wells you pick from up to three plates into individual 1.5 mL tubes, one tube per well. " +
      "Every well is treated as a separate sample, so each transfer gets a fresh tip. The Plan tab gives " +
      "the map for labelling the tubes.",
    options: [
      { name: "Volume per well", what: "How much is moved from each well into its tube." },
      { name: "Source plate", what: "The plate type, and the wells to move. Add up to three plates." },
    ],
  },
  {
    id: "goldengate",
    name: "Golden Gate",
    what: "combinatorial assembly",
    ready: true,
    description:
      "Builds combinatorial Golden Gate assemblies. The robot adds enzyme master mix to every assembly " +
      "well, pipettes each part from the repository plate into the wells that need it, then runs the cut " +
      "and ligate cycles and the heat inactivation — on the Flex thermocycler, or on another machine of " +
      "your choice. Load several assembly plates at once and each downloads as its own protocol.",
    options: [
      { name: "Assembly plates", what: "One CSV per plate: a header of Well, Combination_ID and one column per part type, then one row per assembly well naming the part of each type to add. Upload several files for a batch." },
      { name: "Repository plate", what: "CSV with a header row, then Well,Part rows saying which part is in which well of the repository plate." },
      { name: "Repository volumes", what: "Optional CSV of how much of each part is in its well — a normalisation run's summary works as-is. The Plan tab then checks every part covers all the plates." },
      { name: "Reaction", what: "Protocol name, plate type, master mix volume and tube, part transfer volume and pre-wet volume. Identical-content wells share an exact-total batch with a final-well blow-out; singletons use a fresh tip." },
      { name: "Already in the master mix", what: "Tick the part types you premixed by hand, such as the vector, so the robot never pipettes them." },
      { name: "Cycle the plate on", what: "The Flex thermocycler, or another machine: the plate is then built on the heater block, held cold while the robot pipettes (or on a normal deck slot), and the Plan tab gives the program to run." },
      { name: "Cycling profile", what: "Cut and ligation temperatures and times, cycle count, lid, inactivation and hold temperatures." },
    ],
  },
];

export function App() {
  const [toolId, setToolId] = useState<ToolId>("tube-normalisation");
  const [tab, setTab] = useState<Tab>("setup");
  const [deckName, setDeckName] = useState(DECK_PRESETS[DECK_PRESETS.length - 1].name);
  const [author, setAuthor] = useState("");
  const [slackWebhook, setSlackWebhook] = useState(LAB_SLACK_WEBHOOK_URL);
  const [slackId, setSlackId] = useState("");
  const [slackError, setSlackError] = useState("");

  /**
   * Labware the user has dragged, per tool. Saved per deck preset so an
   * arrangement survives a reload, and swapped wholesale when the preset
   * changes, because slots free on one deck may be fixtures on another.
   */
  const [placements, setPlacements] = useState<Partial<Record<ToolId, Record<string, string>>>>(
    () => loadDeckLayouts(deckName),
  );
  const updatePlacements = (next: Partial<Record<ToolId, Record<string, string>>>) => {
    setPlacements(next);
    storeDeckLayouts(
      deckName,
      Object.fromEntries(Object.entries(next).filter(([, v]) => v)) as Record<string, Record<string, string>>,
    );
  };

  const preset = DECK_PRESETS.find((d) => d.name === deckName) ?? DECK_PRESETS[0];
  const toolPlacements = placements[toolId];
  const deck = useMemo(
    () => (toolPlacements ? { ...preset, placements: toolPlacements } : preset),
    [preset, toolPlacements],
  );
  const placementApi = useMemo(
    (): DeckPlacementApi => ({
      setPlacements: (next) => updatePlacements({ ...placements, [toolId]: next }),
      reset: () => updatePlacements({ ...placements, [toolId]: undefined }),
      customised: !!toolPlacements,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- updatePlacements is stable in behaviour
    [toolId, toolPlacements, placements, deckName],
  );
  const tool = TOOLS.find((t) => t.id === toolId)!;

  const notify = useMemo(
    () => (id: string) => {
      try {
        return labNotify(normaliseSlackUserId(id), slackWebhook);
      } catch {
        return labNotify(undefined, slackWebhook);
      }
    },
    [slackWebhook],
  );

  const onSlackChange = (value: string) => {
    setSlackId(value);
    if (!value.trim()) {
      setSlackError("");
      return;
    }
    try {
      normaliseSlackUserId(value);
      setSlackError("");
    } catch (e) {
      setSlackError(e instanceof Error ? e.message : String(e));
    }
  };

  const shared = { deck, tab, author, slackUserId: slackId, notify };

  return (
    <div className="app">
      <nav className="rail" aria-label="Tools">
        <div className="brand">
          <h1>Opentrons Protocols</h1>
          <span className="robot">Steel Lab · Flex</span>
        </div>

        <span className="rail-heading">Build a protocol</span>
        {TOOLS.map((t) => (
          <button
            key={t.id}
            aria-current={t.id === toolId}
            disabled={!t.ready}
            onClick={() => {
              setToolId(t.id);
              setTab("setup");
            }}
          >
            {t.name}
            <span className="what">{t.what}</span>
          </button>
        ))}

        <span className="rail-heading">This robot</span>
        <div style={{ padding: "0 18px", display: "grid", gap: 9 }}>
          <div className="field">
            <label htmlFor="deck-preset">Deck</label>
            <select
              id="deck-preset"
              value={deckName}
              onChange={(e) => {
                setDeckName(e.target.value);
                // Each preset has its own saved layouts: slots free on one
                // deck may be fixtures on another.
                setPlacements(loadDeckLayouts(e.target.value));
              }}
            >
              {DECK_PRESETS.map((d) => (
                <option key={d.name} value={d.name}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="author">Your name</label>
            <input id="author" value={author} onChange={(e) => setAuthor(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="slack-webhook">Slack webhook URL</label>
            <input
              id="slack-webhook"
              type="password"
              autoComplete="off"
              value={slackWebhook}
              onChange={(e) => setSlackWebhook(e.target.value)}
              placeholder="Optional incoming webhook URL"
            />
            <p className="note">Optional. Kept in this tab and included in downloaded protocols. Leave blank to disable Slack alerts.</p>
          </div>
          <div className="field">
            <label htmlFor="slack">Slack member ID</label>
            <input
              id="slack"
              value={slackId}
              placeholder="U0123ABCD"
              onChange={(e) => onSlackChange(e.target.value)}
            />
            <p className="note">
              {slackError
                ? slackError
                : "Optional. Tags you in the run alerts the protocol posts to Slack."}
            </p>
          </div>
        </div>

        <div className="rail-foot">
          <a href="https://github.com/JackATDalton/opentrons-protocol-builder/blob/main/docs/pipetting-guide.md">
            Pipetting guide
          </a>
          <a href="https://github.com/JackATDalton/opentrons-protocol-builder/blob/main/docs/protocol-invariants.md">
            Protocol rules
          </a>
          <a href="https://github.com/JackATDalton/opentrons-protocol-builder/blob/main/labware/README.md">
            Custom labware
          </a>
        </div>
      </nav>

      <main className="work">
        <div className="workbar">
          <h2>{tool.name}</h2>
          <div className="tabs" role="tablist">
            {TABS.map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                disabled={!tool.ready}
              >
                {TAB_LABELS[t]}
              </button>
            ))}
          </div>
        </div>

        <div className="sheet">
          <section className="intro" aria-label={`About ${tool.name}`}>
            <p className="lede">{tool.description}</p>
            {tab === "setup" && (
              <details className="options-overview" open>
                <summary>What the options do</summary>
                <dl>
                  {tool.options.map((o) => (
                    <div key={o.name}>
                      <dt>{o.name}</dt>
                      <dd>{o.what}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            )}
          </section>
          <DeckPlacementContext.Provider value={placementApi}>
          {toolId === "tube-normalisation" && <TubeNormalisationView {...shared} />}
          {toolId === "plate-normalisation" && <PlateNormalisationView {...shared} />}
          {toolId === "miniprep" && <MiniprepView {...shared} />}
          {toolId === "transfer" && <TransferView {...shared} />}
          {toolId === "goldengate" && <GoldenGateView {...shared} />}
          </DeckPlacementContext.Provider>
        </div>
      </main>
    </div>
  );
}
