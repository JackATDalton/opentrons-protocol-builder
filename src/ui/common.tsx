/**
 * Small pieces shared by every tool view.
 *
 * Deliberately plain. The interface's job is to make numbers and warnings
 * legible; anything here that drew attention to itself would be competing with
 * the deck diagram, which is the one thing that should.
 */
import { Fragment, useId, useRef, useState, type ReactNode } from "react";

import { parseWell, shapeFor, type PlateShape } from "../core/wells";
import { downloadCsv, type CsvExample } from "./examples";

/* ------------------------------------------------------------------ panel */

export function Panel({
  title,
  actions,
  children,
  tight,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  tight?: boolean;
}) {
  return (
    <section className="panel">
      <header>
        <h2>{title}</h2>
        {actions && <div className="spacer">{actions}</div>}
      </header>
      <div className={tight ? "body tight" : "body"}>{children}</div>
    </section>
  );
}

/* ----------------------------------------------------------------- fields */

export function NumberField({
  label,
  unit,
  value,
  onChange,
  min,
  max,
  step = 1,
}: {
  label: string;
  unit?: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  const id = `f-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div className="field num">
      <label htmlFor={id}>
        {label} {unit && <span className="unit">{unit}</span>}
      </label>
      <input
        id={id}
        type="number"
        value={Number.isFinite(value) ? value : ""}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  upper,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  upper?: boolean;
}) {
  const id = `f-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(upper ? e.target.value.toUpperCase() : e.target.value)}
      />
    </div>
  );
}

export function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  const id = `f-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function CheckField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/* ---------------------------------------------------------------- messages */

export function Messages({ errors, warnings }: { errors?: string[]; warnings?: string[] }) {
  if (!errors?.length && !warnings?.length) return null;
  return (
    <ul className="msgs">
      {errors?.map((e) => (
        <li className="err" key={e}>
          {e}
        </li>
      ))}
      {warnings?.map((w) => (
        <li key={w}>{w}</li>
      ))}
    </ul>
  );
}

/** A figure for the summary strip: one number, one label. */
export function Tally({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="tally">
      {items.map((i) => (
        <div key={i.label}>
          <dt>{i.label}</dt>
          <dd>{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/* --------------------------------------------------------------- download */

export function downloadPython(source: string, filename: string): void {
  const blob = new Blob([source], { type: "text/x-python" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".py") ? filename : `${filename}.py`;
  a.click();
  URL.revokeObjectURL(url);
}

export function ProtocolTab({ source, filename }: { source: string; filename: string }) {
  return (
    <>
      <Panel
        title={filename}
        actions={
          <button className="primary" onClick={() => downloadPython(source, filename)}>
            Download protocol
          </button>
        }
      >
        <p className="note">
          Simulate it before you run it. A clean simulation means the protocol will run, not that
          it is correct — check it against the invariants too.
        </p>
        <div className="cmd">
          opentrons_simulate {filename} --custom-labware-path ./labware/definitions
        </div>
      </Panel>
      <Panel title="Protocol source" tight>
        <pre className="code">{source}</pre>
      </Panel>
    </>
  );
}

/* -------------------------------------------------------------- well grid */

/**
 * A clickable plate or rack. Drag to paint a range; the mode is set by the
 * first well you touch, so dragging from a selected well erases.
 */
export function WellGrid({
  loadName,
  selected,
  onChange,
  label,
}: {
  loadName: string;
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  label?: string;
}) {
  const shape: PlateShape = shapeFor(loadName);

  const toggle = (well: string) => {
    const next = new Set(selected);
    if (next.has(well)) next.delete(well);
    else next.add(well);
    onChange(next);
  };

  const fill = (wells: string[]) => onChange(new Set(wells));

  const all = shape.rows.flatMap((r) => shape.columns.map((c) => `${r}${c}`));

  return (
    <div className="rack">
      {label && <h3>{label}</h3>}
      <div
        className="wellgrid"
        style={{ gridTemplateColumns: `auto repeat(${shape.columns.length}, minmax(0, 1fr))` }}
        role="group"
        aria-label={label ?? "Well selection"}
      >
        <span className="corner" />
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
              return (
                <button
                  key={well}
                  type="button"
                  aria-pressed={selected.has(well)}
                  aria-label={well}
                  title={well}
                  onClick={() => toggle(well)}
                >
                  {well}
                </button>
              );
            })}
          </Fragment>
        ))}
      </div>
      <div className="grid-actions">
        <button className="ghost" onClick={() => fill(all)}>
          Select all
        </button>
        <button className="ghost" onClick={() => fill([])} disabled={!selected.size}>
          Clear
        </button>
        <span className="count">
          {selected.size} of {all.length}
        </span>
      </div>
    </div>
  );
}

/** Parse a comma or whitespace separated well list, reporting what failed. */
export function parseWellList(text: string): { wells: string[]; errors: string[] } {
  const wells: string[] = [];
  const errors: string[] = [];
  for (const raw of text.split(/[\s,]+/).filter(Boolean)) {
    const well = raw.toUpperCase();
    try {
      parseWell(well);
      wells.push(well);
    } catch {
      errors.push(`"${raw}" is not a well name. Use names like A1 or H12.`);
    }
  }
  return { wells, errors };
}

/** File contents and pasted text feed the same parser and remain editable. */
export function CsvInput({ label, value, onChange, rows, placeholder, example, onFiles }: {
  label: string;
  value: string;
  onChange: (text: string) => void;
  rows?: number;
  placeholder?: string;
  /** Offered as a download, so the expected format is never a guess. */
  example: CsvExample;
  /**
   * When set, the file input accepts several files and hands them all over
   * (e.g. one assembly plate per file); the textarea still edits one of them
   * via `value`/`onChange`.
   */
  onFiles?: (files: { name: string; text: string }[]) => void;
}) {
  const id = useId();
  const revision = useRef(0);
  const [error, setError] = useState("");
  return <div className="field">
    <div className="csv-head">
      <label htmlFor={`${id}-file`}>Upload a CSV file</label>
      <button type="button" className="ghost" onClick={() => downloadCsv(example)}>
        Download example
      </button>
    </div>
    <input id={`${id}-file`} type="file" accept=".csv,text/csv" multiple={!!onFiles}
      aria-label={`Upload ${label} CSV`}
      onChange={async (event) => {
        const files = [...(event.currentTarget.files ?? [])];
        event.currentTarget.value = "";
        if (!files.length) return;
        const current = ++revision.current;
        setError("");
        try {
          const read = await Promise.all(files.map(async (f) => ({ name: f.name, text: await f.text() })));
          if (current !== revision.current) return;
          if (onFiles) onFiles(read);
          else onChange(read[0].text);
        } catch {
          if (current === revision.current) setError(`Could not read the file. Try again or paste the CSV below.`);
        }
      }} />
    {error && <p role="alert">{error}</p>}
    <label htmlFor={`${id}-text`}>Or paste / edit CSV</label>
    <textarea id={`${id}-text`} aria-label={label} value={value} rows={rows}
      placeholder={placeholder} spellCheck={false}
      onChange={(event) => { revision.current += 1; setError(""); onChange(event.target.value); }} />
  </div>;
}
