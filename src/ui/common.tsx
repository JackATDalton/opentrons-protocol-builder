/**
 * Small pieces shared by every tool view.
 *
 * Deliberately plain. The interface's job is to make numbers and warnings
 * legible; anything here that drew attention to itself would be competing with
 * the deck diagram, which is the one thing that should.
 */
import { useId, useRef, useState, type ReactNode } from "react";

import { parseWell } from "../core/wells";
import { downloadCsv, type CsvExample } from "./examples";
import { downloadText, downloadZip } from "./download";
import type { ZipEntry } from "./zip";

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
  downloadText(source, filename.endsWith(".py") ? filename : `${filename}.py`, "text/x-python");
}

/**
 * The protocol, ready to download. With `files`, the download is a zip of the
 * protocol and those files (e.g. the plate layout it produces), so the two
 * travel together and cannot be mismatched later.
 */
export function ProtocolTab({ source, filename, files }: { source: string; filename: string; files?: ZipEntry[] }) {
  const stem = filename.replace(/\.py$/, "");
  const py = `${stem}.py`;
  return (
    <>
      <Panel
        title={py}
        actions={
          files?.length ? (
            <>
              <button className="ghost" onClick={() => downloadPython(source, py)}>
                Protocol only
              </button>
              <button className="primary" onClick={() => downloadZip([{ name: py, content: source }, ...files], `${stem}.zip`)}>
                Download protocol + {files.length === 1 ? files[0].name : `${files.length} files`} (.zip)
              </button>
            </>
          ) : (
            <button className="primary" onClick={() => downloadPython(source, py)}>
              Download protocol
            </button>
          )
        }
      >
        <p className="note">
          Simulate it before you run it. A clean simulation means the protocol will run, not that
          it is correct — check it against the invariants too.
        </p>
        {!!files?.length && (
          <p className="note">
            The zip holds {py} and {files.map((f) => f.name).join(", ")}.
          </p>
        )}
        <div className="cmd">
          opentrons_simulate {py} --custom-labware-path ./labware/definitions
        </div>
      </Panel>
      {files?.map((f) => (
        <Panel
          key={f.name}
          title={f.name}
          tight
          actions={
            <button className="ghost" onClick={() => downloadText(f.content, f.name, "text/csv")}>
              Download
            </button>
          }
        >
          <pre className="code">{f.content}</pre>
        </Panel>
      ))}
      <Panel title="Protocol source" tight>
        <pre className="code">{source}</pre>
      </Panel>
    </>
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
