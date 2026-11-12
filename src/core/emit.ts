/**
 * Helpers for emitting Opentrons Python protocol source.
 *
 * Generators build protocol text with template literals. These helpers cover
 * the parts every protocol shares, so notification handling and Python literal
 * escaping are implemented once rather than four times.
 *
 * Note on secrets: the Slack webhook is *never* baked into generator source.
 * It is supplied by the user at generate time and, if omitted, the emitted
 * protocol simply prints instead of posting. Never commit a real webhook URL.
 */

export interface NotifyConfig {
  /** Incoming webhook URL. Omit to emit a protocol that only prints. */
  slackWebhookUrl?: string;
  /** Optional Slack member ID to @-mention, e.g. "U01ABCDEFGH". */
  slackUserId?: string;
}

export interface ProtocolMeta {
  protocolName: string;
  description: string;
  author: string;
  /** Opentrons Protocol API level. */
  apiLevel?: string;
}

/** Render a JS value as a Python literal. Handles the None/True/False mapping. */
export function py(value: unknown): string {
  if (value === null || value === undefined) return "None";
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Cannot emit non-finite number: ${value}`);
    return String(value);
  }
  if (typeof value === "string") return pyStr(value);
  if (Array.isArray(value)) return `[${value.map(py).join(", ")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${pyStr(k)}: ${py(v)}`)
      .join(", ");
    return `{${entries}}`;
  }
  throw new Error(`Cannot emit ${typeof value} as a Python literal.`);
}

/** Single-quoted Python string with proper escaping. */
export function pyStr(value: string): string {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
  return `'${escaped}'`;
}

/** Indent every line of a block to sit at the given depth (4 spaces per level). */
export function indent(text: string, level: number): string {
  const pad = "    ".repeat(level);
  return text
    .split("\n")
    .map((line) => (line.trim() ? pad + line : line))
    .join("\n");
}

/**
 * Emit the metadata/requirements header plus a `notify` helper.
 *
 * When no webhook is configured the helper still exists and still logs, so
 * generator code can call `notify(...)` unconditionally.
 */
export function preamble(meta: ProtocolMeta, notify: NotifyConfig = {}, extraImports: string[] = []): string {
  const apiLevel = meta.apiLevel ?? "2.23";
  const hasWebhook = Boolean(notify.slackWebhookUrl);
  const mention = notify.slackUserId ? `<@${notify.slackUserId}> ` : "";

  const imports = ["from opentrons import protocol_api", ...extraImports];
  if (hasWebhook) imports.push("import requests");

  const notifyBody = hasWebhook
    ? `def notify(message):
    """Post to Slack, and always log locally so the run record is complete."""
    print(message)
    try:
        requests.post(WEBHOOK_URL, json={"text": f"${mention}{message}"}, timeout=10)
    except Exception as exc:
        print(f"Slack notification failed: {exc}")`
    : `def notify(message):
    """No webhook configured for this run, so just log."""
    print(message)`;

  return `${imports.join("\n")}

metadata = {
    "protocolName": ${pyStr(meta.protocolName)},
    "description": ${pyStr(meta.description)},
    "author": ${pyStr(meta.author)},
}

requirements = {
    "robotType": "Flex",
    "apiLevel": ${pyStr(apiLevel)},
}
${hasWebhook ? `\nWEBHOOK_URL = ${pyStr(notify.slackWebhookUrl as string)}\n` : ""}

${notifyBody}
`;
}

/**
 * Wrap a protocol body so any failure is reported before it propagates.
 * `body` should be written at one indent level (inside `run`).
 */
export function runFunction(body: string, protocolLabel: string): string {
  return `
def run(protocol: protocol_api.ProtocolContext):
    try:
${indent(body.trim(), 2)}
    except Exception as exc:
        notify(f":rotating_light: ${protocolLabel} FAILED: {exc}")
        raise
`;
}

/** Append a trailing newline and collapse >2 consecutive blank lines. */
export function finalise(source: string): string {
  return source.replace(/\n{4,}/g, "\n\n\n").trimEnd() + "\n";
}
