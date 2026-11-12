/**
 * Saved deck layouts.
 *
 * Where the user drags labware is part of how a run is physically set up, so
 * it survives a reload: layouts are stored per deck preset, then per tool,
 * as {toolId: {assignmentId: slot}}. Slots free on one deck preset may be
 * fixtures on another, which is why presets do not share layouts.
 *
 * Storage can be absent (server-side render), blocked, or hold junk; every
 * path tolerates that by falling back to "no saved layout".
 */

export type SavedDeckLayouts = Record<string, Record<string, string>>;

const key = (deckName: string) => `deck-layout:${deckName}`;

export function loadDeckLayouts(deckName: string): SavedDeckLayouts {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key(deckName)) ?? "{}");
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
    const layouts: SavedDeckLayouts = {};
    for (const [tool, placements] of Object.entries(raw)) {
      if (typeof placements !== "object" || placements === null || Array.isArray(placements)) continue;
      const entries = Object.entries(placements).filter(
        (pair): pair is [string, string] => typeof pair[1] === "string",
      );
      if (entries.length) layouts[tool] = Object.fromEntries(entries);
    }
    return layouts;
  } catch {
    return {};
  }
}

export function storeDeckLayouts(deckName: string, layouts: SavedDeckLayouts): void {
  try {
    const kept = Object.fromEntries(Object.entries(layouts).filter(([, v]) => v && Object.keys(v).length));
    if (Object.keys(kept).length) localStorage.setItem(key(deckName), JSON.stringify(kept));
    else localStorage.removeItem(key(deckName));
  } catch {
    // Nothing to do: the layout still applies for this session.
  }
}
