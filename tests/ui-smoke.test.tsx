/**
 * Render every view on every tab and assert it does not throw.
 *
 * This is a smoke test, not a design review — it cannot tell you the app looks
 * right. What it does catch is the failure that would otherwise reach someone
 * at the bench: a view that crashes on mount, or a generator whose error is
 * thrown during render instead of being shown as a message.
 */
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BARE_FLEX, STEEL_LAB_FLEX, type DeckConfig } from "../src/core/deck";
import { LAB_SLACK_WEBHOOK_URL, labNotify, normaliseSlackUserId } from "../src/config/lab";
import { App } from "../src/ui/App";
import { MiniprepView } from "../src/ui/views/MiniprepView";
import { PlateNormalisationView } from "../src/ui/views/PlateNormalisationView";
import { TransferView } from "../src/ui/views/TransferView";
import { TubeNormalisationView } from "../src/ui/views/TubeNormalisationView";
import { parseSamples } from "../src/ui/views/TubeNormalisationView";
import { TABS, type Tab } from "../src/ui/tabs";

const VIEWS = {
  "tube normalisation": TubeNormalisationView,
  "plate normalisation": PlateNormalisationView,
  miniprep: MiniprepView,
  transfer: TransferView,
};

function props(tab: Tab, deck: DeckConfig) {
  return { deck, tab, author: "test", slackUserId: "", notify: () => labNotify() };
}

describe("the app shell", () => {
  it("renders", () => {
    expect(renderToString(<App />)).toContain("Opentrons Protocols");
  });
});

describe("every view renders on every tab", () => {
  for (const [name, View] of Object.entries(VIEWS)) {
    for (const tab of TABS) {
      it(`${name}, ${tab}`, () => {
        expect(() => renderToString(<View {...props(tab, STEEL_LAB_FLEX)} />)).not.toThrow();
      });
    }
  }
});

describe("a deck too small to hold the run", () => {
  // BARE_FLEX has 11 free slots, but the point is that a generator throwing a
  // DeckAllocationError must surface as a message, not as a render crash.
  for (const [name, View] of Object.entries(VIEWS)) {
    it(`${name} reports the problem instead of crashing`, () => {
      const html = renderToString(<View {...props("setup", BARE_FLEX)} />);
      expect(html.length).toBeGreaterThan(0);
    });
  }
});

describe("parseSamples", () => {
  it("reads name, concentration and volume", () => {
    const { samples, errors } = parseSamples("P1d, 37.2, 50");
    expect(errors).toEqual([]);
    expect(samples[0]).toEqual({ name: "P1d", concentration: 37.2, volumeUl: 50, masterMix: false });
  });

  it("skips comments and blank lines", () => {
    expect(parseSamples("# header\n\nP1d, 37.2, 50").samples).toHaveLength(1);
  });

  it("marks a master-mix part and keeps it off the plate", () => {
    expect(parseSamples("C4J, 60, 3600, mastermix").samples[0].masterMix).toBe(true);
  });

  it("reports the line and what was wrong, and drops that row", () => {
    const { samples, errors } = parseSamples("P1d, 37.2, 50\nT1m, banana, 100");
    expect(samples).toHaveLength(1);
    expect(errors[0]).toContain("Line 2");
    expect(errors[0]).toContain("banana");
  });

  it("reports a row with too few fields", () => {
    expect(parseSamples("P1d, 37.2").errors[0]).toContain("expected");
  });

  it("accepts tab-separated input pasted from a spreadsheet", () => {
    expect(parseSamples("P1d\t37.2\t50").samples).toHaveLength(1);
  });
});

describe("normaliseSlackUserId", () => {
  it("accepts the three shapes Slack copies", () => {
    for (const raw of ["U0123ABCD", "@U0123ABCD", "<@U0123ABCD>"]) {
      expect(normaliseSlackUserId(raw)).toBe("U0123ABCD");
    }
  });

  it("treats blank as no tag", () => {
    expect(normaliseSlackUserId("  ")).toBe("");
  });

  it("rejects something that is not a member ID", () => {
    expect(() => normaliseSlackUserId("jack")).toThrow(/member ID/);
  });
});


describe("Slack configuration", () => {
  it("falls back to the lab webhook when the box is cleared", () => {
    // The lab webhook in the private build; nothing in the public export.
    expect(labNotify("U0123ABCD", " ")).toEqual({
      slackWebhookUrl: LAB_SLACK_WEBHOOK_URL || undefined,
      slackUserId: "U0123ABCD",
    });
  });
  it("uses a user-supplied webhook instead of the lab default", () => {
    expect(labNotify(undefined, " https://example.org/webhook ").slackWebhookUrl).toBe("https://example.org/webhook");
  });
  it("offers a webhook input without persisting its value", () => {
    expect(renderToString(<App />)).toContain('id="slack-webhook"');
  });
});
