/**
 * The Flex deck, drawn to scale and live.
 *
 * This sits beside every form on purpose. Deck allocation is where protocols
 * collide with real hardware, and the usual failure — "there wasn't room for
 * that" — is invisible in a settings panel and obvious in a picture. Change a
 * batch count and you watch a tip rack appear.
 *
 * The deck is 4 rows (A at the back, D at the front) by 3 columns. Row A draws
 * at the top, which is the deck as seen standing in front of the robot.
 *
 * Labware can be rearranged: drag it to another slot, or click it and then
 * click the destination (which also works on touch screens and keyboards).
 * Dropping onto other labware swaps the two. Fixtures never move, and labware
 * pinned by a physical constraint only moves among the slots it allows.
 */
import { useState, type DragEvent } from "react";

import { DECK_COLUMNS, DECK_ROWS } from "../core/steps";
import { isMovable, type DeckSlotAssignment } from "../core/deck";
import { useDeckPlacement } from "./deckPlacement";

interface Props {
  layout: DeckSlotAssignment[];
  /** Shown under the diagram, e.g. tip counts. */
  tally?: { label: string; value: string }[];
}

const KIND_CLASS: Record<string, string> = {
  plate: "plate",
  tuberack: "tuberack",
  tips: "tips",
  trash: "trash",
  module: "fixture",
  reserved: "fixture",
  reservoir: "tuberack",
};

export function DeckViewport({ layout, tally }: Props) {
  const placement = useDeckPlacement();
  const [picked, setPicked] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  const bySlot = new Map<string, DeckSlotAssignment>();
  for (const a of layout) bySlot.set(a.slot, a);

  const editable = !!placement && layout.length > 0;
  const active = dragging ?? picked;
  const moving = active ? layout.find((a) => a.id === active) : undefined;

  /** Can the labware being moved land on this slot (swapping if occupied)? */
  const accepts = (slot: string): boolean => {
    if (!moving || slot === moving.slot) return false;
    const there = bySlot.get(slot);
    if (there && !isMovable(there)) return false;
    if (moving.allowedSlots && !moving.allowedSlots.includes(slot)) return false;
    if (there?.allowedSlots && !there.allowedSlots.includes(moving.slot)) return false;
    return true;
  };

  const moveTo = (slot: string) => {
    if (!placement || !moving || !accepts(slot)) return;
    const next: Record<string, string> = {};
    for (const a of layout) if (isMovable(a)) next[a.id] = a.slot;
    const there = bySlot.get(slot);
    if (there) next[there.id] = moving.slot;
    next[moving.id] = slot;
    placement.setPlacements(next);
    setPicked(null);
    setDragging(null);
  };

  const onSlotClick = (slot: string) => {
    if (!editable) return;
    const a = bySlot.get(slot);
    if (moving) {
      if (accepts(slot)) moveTo(slot);
      else setPicked(a && isMovable(a) && a.id !== picked ? a.id : null);
    } else if (a && isMovable(a)) {
      setPicked(a.id);
    }
  };

  const used = layout.filter((a) => a.kind !== "reserved" && a.kind !== "trash").length;
  const free = DECK_ROWS.length * DECK_COLUMNS.length - bySlot.size;

  return (
    <aside className="deck-viewport" aria-label="Deck layout">
      <figure>
        <div className="deck-grid">
          {DECK_ROWS.flatMap((row) =>
            DECK_COLUMNS.map((col) => {
              const slot = `${row}${col}`;
              const a = bySlot.get(slot);
              const cls = a ? KIND_CLASS[a.kind] ?? "plate" : "empty";
              const movable = editable && !!a && isMovable(a);
              const target = editable && accepts(slot);
              const classes = ["deck-slot", cls];
              if (movable) classes.push("movable");
              if (a && a.id === active) classes.push("picked");
              if (target) classes.push("drop-ok");
              const onDrop = (e: DragEvent) => {
                e.preventDefault();
                moveTo(slot);
              };
              return (
                <div
                  key={slot}
                  className={classes.join(" ")}
                  role={editable ? "button" : undefined}
                  tabIndex={editable && (movable || target) ? 0 : undefined}
                  aria-label={editable ? `${slot}${a ? `: ${a.label}` : ", empty"}` : undefined}
                  aria-pressed={editable && movable ? a!.id === picked : undefined}
                  draggable={movable}
                  onDragStart={(e) => {
                    if (!a) return;
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", a.id);
                    setDragging(a.id);
                    setPicked(null);
                  }}
                  onDragEnd={() => setDragging(null)}
                  onDragOver={(e) => {
                    if (target) e.preventDefault();
                  }}
                  onDrop={onDrop}
                  onClick={() => onSlotClick(slot)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSlotClick(slot);
                    } else if (e.key === "Escape") setPicked(null);
                  }}
                >
                  <span className="slot-id">{slot}</span>
                  {a && <span className="slot-label">{a.label}</span>}
                </div>
              );
            }),
          )}
        </div>

        {editable && (
          <div className="deck-edit">
            <span className="note">
              {moving
                ? `Now pick where ${moving.label} goes.`
                : "Drag labware to rearrange it, or click it and then its new slot."}
            </span>
            {placement.customised && (
              <button className="ghost" onClick={() => { setPicked(null); placement.reset(); }}>
                Reset layout
              </button>
            )}
          </div>
        )}
        {!editable && placement?.customised && (
          <div className="deck-edit">
            <button className="ghost" onClick={() => placement.reset()}>
              Reset layout
            </button>
          </div>
        )}

        <div className="deck-key">
          <span>
            <i style={{ background: "var(--buffer-wash)", borderColor: "var(--buffer)" }} />
            labware
          </span>
          <span>
            <i style={{ background: "var(--mint-wash)", borderColor: "var(--tips)" }} />
            tips
          </span>
          <span>
            <i style={{ background: "var(--fixture)" }} />
            fixed hardware
          </span>
          <span>
            <i style={{ background: "transparent", borderStyle: "dashed" }} />
            free
          </span>
        </div>

        <div className="deck-tally">
          <span>
            <b>{used}</b> loaded, <b>{free}</b> free
          </span>
          {tally?.map((t) => (
            <span key={t.label}>
              {t.label} <b>{t.value}</b>
            </span>
          ))}
        </div>
      </figure>
    </aside>
  );
}
