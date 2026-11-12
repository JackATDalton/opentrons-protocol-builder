/**
 * Step-by-step viewer for a generated protocol.
 *
 * It renders the `ProtocolStep[]` the generator produced — not a re-reading of
 * the emitted Python, and not an independent reconstruction from the plan. That
 * is the whole point: if the animation shows the arm going somewhere wrong,
 * the protocol is wrong, because both come from the same list.
 *
 * Well contents are replayed from step 1 up to the cursor, so scrubbing
 * backwards is exact rather than approximated.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DeckSlotAssignment } from "../core/deck";
import {
  DECK_COLUMNS,
  DECK_ROWS,
  deckSize,
  layoutFor,
  replaySteps,
  slotOrigin,
  wellPosition,
  type DeckState,
  type Point,
  type ProtocolStep,
} from "../core/steps";

const PAD = 26;
const SPEEDS = [0.5, 1, 2, 4, 8] as const;

interface Props {
  steps: ProtocolStep[];
  deckLayout: DeckSlotAssignment[];
}

export function SimulationViewer({ steps, deckLayout }: Props) {
  const [cursor, setCursor] = useState(steps.length ? 1 : 0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(2);
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    setCursor(steps.length ? 1 : 0);
    setPlaying(false);
  }, [steps]);

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      setCursor((c) => {
        if (c >= steps.length) {
          setPlaying(false);
          return c;
        }
        return c + 1;
      });
    }, 600 / speed);
    return () => window.clearInterval(id);
  }, [playing, speed, steps.length]);

  useEffect(() => {
    const active = listRef.current?.querySelector('[aria-current="true"]');
    active?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setCursor((c) => Math.min(steps.length, c + 1));
      else if (e.key === "ArrowLeft") setCursor((c) => Math.max(1, c - 1));
      else if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      } else return;
    },
    [steps.length],
  );

  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onKey]);

  const state = useMemo(() => replaySteps(steps, cursor, deckLayout), [steps, cursor, deckLayout]);
  const size = deckSize();
  const current = steps[cursor - 1];

  // Peak volume per labware, so the fill shading has a sensible scale.
  const peak = useMemo(() => {
    let max = 0;
    for (const v of replaySteps(steps, steps.length).volumes.values()) max = Math.max(max, v);
    return max || 1;
  }, [steps]);

  const armAt = armPosition(state.at, deckLayout);
  const armFrom = armPosition(state.from, deckLayout);

  if (!steps.length) {
    return <p className="note">Generate a protocol to see its steps.</p>;
  }

  return (
    <div className="sim">
      <div className="sim-controls">
        <button className="ghost" onClick={() => setCursor(1)} disabled={cursor <= 1}>
          ⏮
        </button>
        <button className="ghost" onClick={() => setCursor((c) => Math.max(1, c - 1))} disabled={cursor <= 1}>
          ◀
        </button>
        <button className="primary" onClick={() => setPlaying((p) => !p)}>
          {playing ? "Pause" : "Play"}
        </button>
        <button
          className="ghost"
          onClick={() => setCursor((c) => Math.min(steps.length, c + 1))}
          disabled={cursor >= steps.length}
        >
          ▶
        </button>
        <input
          type="range"
          min={1}
          max={steps.length}
          value={cursor}
          onChange={(e) => {
            setPlaying(false);
            setCursor(Number(e.target.value));
          }}
          aria-label="Step"
        />
        <span className="counter">
          {cursor} / {steps.length}
        </span>
        <select
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
          aria-label="Playback speed"
          style={{ width: "auto" }}
        >
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
      </div>

      <div className="sim-split">
      <svg
        className="deck"
        viewBox={`${-PAD} ${-PAD} ${size.x + PAD * 2} ${size.y + PAD * 2}`}
        role="img"
        aria-label={`Deck at step ${cursor}: ${current?.label ?? ""}`}
      >
        {/* Empty slots first, so labware draws on top of its own slot. */}
        {DECK_ROWS.flatMap((row) =>
          DECK_COLUMNS.map((col) => {
            const slot = `${row}${col}`;
            const o = slotOrigin(slot);
            return (
              <g key={slot}>
                <rect className="slot-box" x={o.x} y={o.y} width={127.76} height={85.48} rx={4} />
                <text className="slot-label" x={o.x + 5} y={o.y + 15}>
                  {slot}
                </text>
              </g>
            );
          }),
        )}

        {deckLayout.map((a) => {
          const o = slotOrigin(a.slot);
          const isReserved = a.kind === "reserved" || a.kind === "trash";
          const layout = layoutFor(a.loadName);
          const isTips = a.kind === "tips";
          return (
            <g key={`${a.slot}-${a.id}`}>
              {isReserved && (
                <rect
                  className="slot-box reserved"
                  x={o.x}
                  y={o.y}
                  width={127.76}
                  height={85.48}
                  rx={4}
                />
              )}
              <text className="lw-label" x={o.x + 5} y={o.y + 81}>
                {a.label}
              </text>
              {!isReserved &&
                a.loadName &&
                layout.rows.flatMap((row, ri) =>
                  layout.columns.map((col, ci) => {
                    const well = `${row}${col}`;
                    const key = `${a.id}:${well}`;
                    const volume = state.volumes.get(key) ?? 0;
                    const used = state.tipsUsed.has(key);
                    const isActive =
                      state.at?.labwareId === a.id && state.at?.well === well;
                    const classes = ["well"];
                    if (isTips && used) classes.push("tip-used");
                    if (volume > 0) classes.push("filled");
                    if (isActive) classes.push("active");
                    return (
                      <circle
                        key={well}
                        className={classes.join(" ")}
                        cx={o.x + layout.origin.x + ci * layout.spacing.x}
                        cy={o.y + layout.origin.y + ri * layout.spacing.y}
                        r={layout.wellDiameter / 2}
                        style={
                          volume > 0
                            ? {
                                fill: "var(--part)",
                                fillOpacity: 0.18 + 0.6 * Math.min(1, volume / peak),
                              }
                            : undefined
                        }
                      >
                        <title>
                          {`${a.label} ${well}${volume > 0 ? ` — ${volume.toFixed(1)} µL` : ""}`}
                        </title>
                      </circle>
                    );
                  }),
                )}
            </g>
          );
        })}

        {armFrom && armAt && (
          <line className="travel" x1={armFrom.x} y1={armFrom.y} x2={armAt.x} y2={armAt.y} />
        )}
        {armAt && (
          <g>
            <circle className="arm" cx={armAt.x} cy={armAt.y} r={9} />
            <circle className="arm-dot" cx={armAt.x} cy={armAt.y} r={2.5} />
            <line className="arm" x1={armAt.x - 14} y1={armAt.y} x2={armAt.x - 10} y2={armAt.y} />
            <line className="arm" x1={armAt.x + 10} y1={armAt.y} x2={armAt.x + 14} y2={armAt.y} />
          </g>
        )}
      </svg>

      <ol className="steplist" ref={listRef}>
        {steps.map((s) => (
          <li
            key={s.index}
            aria-current={s.index === cursor}
            className={s.kind === "comment" ? "comment" : undefined}
            onClick={() => {
              setPlaying(false);
              setCursor(s.index);
            }}
          >
            <span className="ix">{s.kind === "comment" ? "" : s.index}</span>
            <span>{s.label}</span>
          </li>
        ))}
      </ol>
      </div>

      <div className="legend">
        <span>
          <i className="swatch" style={{ background: "var(--part)", opacity: 0.6 }} /> liquid in well
        </span>
        <span>
          <i className="swatch" style={{ background: "var(--tips)", opacity: 0.4 }} /> tip used
        </span>
        <span>
          <i className="swatch" style={{ background: "var(--fixture)" }} /> fixture / trash
        </span>
        <span>← → step, space to play</span>
      </div>

      <div>
        <strong style={{ fontSize: 13.5 }}>{current?.label}</strong>
        {current?.note && <p className="why" style={{ marginTop: 6 }}>{current.note}</p>}
      </div>

    </div>
  );
}

/** A position with no well (the trash) is drawn at the slot's centre. */
function armPosition(pos: DeckState["at"], deckLayout: DeckSlotAssignment[]): Point | undefined {
  if (!pos?.slot) return undefined;
  if (!pos.well) {
    const o = slotOrigin(pos.slot);
    return { x: o.x + 127.76 / 2, y: o.y + 85.48 / 2 };
  }
  return wellPosition(pos.slot, loadNameOf(deckLayout, pos.labwareId), pos.well);
}

function loadNameOf(layout: DeckSlotAssignment[], id?: string): string | null {
  if (!id) return null;
  return layout.find((a) => a.id === id)?.loadName ?? null;
}
