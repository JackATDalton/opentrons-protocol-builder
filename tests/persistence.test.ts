import { afterEach, describe, expect, it } from "vitest";

import { loadDeckLayouts, storeDeckLayouts } from "../src/ui/persistence";

/** Minimal localStorage stand-in: the vitest environment has none. */
function stubStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
  return data;
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).localStorage;
});

describe("saved deck layouts", () => {
  it("round-trips layouts per deck preset", () => {
    stubStorage();
    storeDeckLayouts("Steel Lab Flex", { miniprep: { "rack:0": "D3" } });
    expect(loadDeckLayouts("Steel Lab Flex")).toEqual({ miniprep: { "rack:0": "D3" } });
    expect(loadDeckLayouts("Bare Flex")).toEqual({});
  });

  it("drops junk instead of throwing", () => {
    stubStorage({
      "deck-layout:Steel Lab Flex": '{"miniprep": {"rack:0": 3, "tips": "C1"}, "bad": [1], "worse": "x"}',
      "deck-layout:Bare Flex": "not json",
    });
    expect(loadDeckLayouts("Steel Lab Flex")).toEqual({ miniprep: { tips: "C1" } });
    expect(loadDeckLayouts("Bare Flex")).toEqual({});
  });

  it("removes the stored entry when every layout is reset", () => {
    const data = stubStorage();
    storeDeckLayouts("Steel Lab Flex", { miniprep: { "rack:0": "D3" } });
    storeDeckLayouts("Steel Lab Flex", {});
    expect(data.has("deck-layout:Steel Lab Flex")).toBe(false);
  });

  it("is inert where no storage exists, as in a server render", () => {
    expect(loadDeckLayouts("Steel Lab Flex")).toEqual({});
    expect(() => storeDeckLayouts("Steel Lab Flex", { miniprep: { a: "D3" } })).not.toThrow();
  });
});
