/**
 * The one way a plate, tube rack or tip rack is drawn in the forms and plans.
 *
 * Every grid of wells in the app goes through here, so a 24-tube rack and a
 * 96-well plate look and behave alike: round wells, column numbers across the
 * top, row letters down the side, the same colours for "chosen", "filled in
 * automatically" and the two warning flags. The shape comes from the labware
 * registry by load name, never from a hand-typed row list. (The simulator's
 * deck drawing is the only other renderer; it draws to scale from the same
 * registry.)
 *
 * Three ways to use it:
 *
 * - **Select wells:** pass `selection` and `onSelectionChange`. Click toggles a
 *   well; "Select all" / "Clear" and a count sit underneath.
 * - **Show contents:** pass `cells`. Read-only unless `onCellClick` is given,
 *   with `active` marking the position currently picked up.
 * - Both: contents with a selection on top.
 */
import { Fragment } from "react";

import { geometryFor } from "../core/labware";
import { rowMajor } from "../core/wells";

export interface MapCell {
  /** Written in the well, e.g. a part name. */
  label: string;
  /** Hover text and the accessible name, after the well name. */
  title?: string;
  /** Smaller second line, e.g. a destination well or a concentration. */
  sub?: string;
  /** False when the position was filled in automatically rather than chosen. Drawn dashed. */
  set?: boolean;
  flag?: "below" | "mass";
}

export function PlateMap({
  loadName,
  label,
  cells,
  active,
  onCellClick,
  selection,
  onSelectionChange,
}: {
  loadName: string;
  /** Heading above the map, and its accessible name. */
  label?: string;
  cells?: Record<string, MapCell | undefined>;
  /** A single highlighted position, e.g. the tube currently being moved. */
  active?: string | null;
  onCellClick?: (well: string) => void;
  selection?: Set<string>;
  onSelectionChange?: (next: Set<string>) => void;
}) {
  const { shape, label: labwareLabel } = geometryFor(loadName);
  const all = rowMajor(shape);
  const selecting = !!(selection && onSelectionChange);
  const clickable = selecting || !!onCellClick;
  const dense = shape.columns.length > 6;

  const click = (well: string) => {
    if (onCellClick) onCellClick(well);
    else if (selection && onSelectionChange) {
      const next = new Set(selection);
      if (next.has(well)) next.delete(well);
      else next.add(well);
      onSelectionChange(next);
    }
  };

  return (
    <div className="platemap">
      {label && <h3>{label}</h3>}
      <div className="platemap-scroll">
        <div
          className={`platemap-grid${dense ? " dense" : ""}`}
          style={{ gridTemplateColumns: `auto repeat(${shape.columns.length}, var(--well))` }}
          role="group"
          aria-label={label ?? labwareLabel}
        >
          <span />
          {shape.columns.map((c) => (
            <span className="head" key={`h${c}`}>
              {c}
            </span>
          ))}
          {shape.rows.map((r) => (
            <Fragment key={r}>
              <span className="rowhead">{r}</span>
              {shape.columns.map((c) => {
                const well = `${r}${c}`;
                const cell = cells?.[well];
                const picked = selection?.has(well) ?? false;
                const cls = [
                  "well",
                  cell ? (cell.set === false ? "auto" : "filled") : picked ? "picked" : "empty",
                  cell?.flag,
                  picked && cell ? "picked" : "",
                  active === well ? "active" : "",
                ]
                  .filter(Boolean)
                  .join(" ");
                const title = `${well}${cell?.title ? ` — ${cell.title}` : cell ? ` — ${cell.label}` : picked ? " — selected" : ""}`;
                const body = cell ? (
                  <>
                    <span className="name">{cell.label}</span>
                    {cell.sub && <span className="sub">{cell.sub}</span>}
                  </>
                ) : picked ? (
                  <span className="name">{well}</span>
                ) : null;
                return clickable ? (
                  <button
                    key={well}
                    type="button"
                    className={cls}
                    title={title}
                    aria-label={title}
                    aria-pressed={selecting ? picked : active === well}
                    onClick={() => click(well)}
                  >
                    {body}
                  </button>
                ) : (
                  <span key={well} className={cls} title={title}>
                    {body}
                  </span>
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>
      {selecting && (
        <div className="grid-actions">
          <button className="ghost" onClick={() => onSelectionChange!(new Set(all))}>
            Select all
          </button>
          <button className="ghost" onClick={() => onSelectionChange!(new Set())} disabled={!selection!.size}>
            Clear
          </button>
          <span className="count">
            {selection!.size} of {all.length}
          </span>
        </div>
      )}
    </div>
  );
}

/** The key under a map that uses `set: false` or flags. */
export function PlateMapLegend({ auto, flags }: { auto?: string; flags?: boolean }) {
  return (
    <div className="legend platemap-legend">
      <span>
        <i className="key filled" /> {auto ? "set by you" : "filled"}
      </span>
      {auto && (
        <span>
          <i className="key auto" /> {auto}
        </span>
      )}
      {flags && (
        <>
          <span>
            <i className="key mass" /> mass limited
          </span>
          <span>
            <i className="key below" /> below target
          </span>
        </>
      )}
    </div>
  );
}
