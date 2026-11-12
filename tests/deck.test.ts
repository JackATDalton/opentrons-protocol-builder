import { describe, expect, it } from "vitest";
import {
  allocateDeck,
  BARE_FLEX,
  DeckAllocationError,
  freeSlots,
  isMovable,
  slotFor,
  slotsFor,
  STEEL_LAB_FLEX,
  trashSlot,
  type DeckConfig,
  type LabwareRequest,
} from "../src/core/deck";

const tips = (count = 1): LabwareRequest => ({
  id: "tips",
  loadName: "opentrons_flex_96_tiprack_1000ul",
  label: "Tip Rack",
  kind: "tips",
  count,
});

describe("deck configuration", () => {
  it("frees 11 slots on a bare Flex (12 minus trash)", () => {
    expect(freeSlots(BARE_FLEX)).toHaveLength(11);
    expect(freeSlots(BARE_FLEX)).not.toContain("A3");
  });

  it("blocks every slot a multi-slot fixture covers", () => {
    const free = freeSlots(STEEL_LAB_FLEX);
    // Thermocycler spans A1+B1, heater block D1, trash A3.
    expect(free).not.toContain("A1");
    expect(free).not.toContain("B1");
    expect(free).not.toContain("D1");
    expect(free).not.toContain("A3");
    expect(free).toHaveLength(8);
  });

  it("reports the trash slot, and explains itself when there isn't one", () => {
    expect(trashSlot(STEEL_LAB_FLEX)).toBe("A3");
    const noTrash: DeckConfig = { name: "Broken", robot: "flex", fixtures: [] };
    expect(() => trashSlot(noTrash)).toThrow(/no trash bin/i);
  });
});

describe("slot allocation", () => {
  it("never assigns a slot occupied by a fixture", () => {
    const assignments = allocateDeck(STEEL_LAB_FLEX, [tips(3)]);
    const allocated = assignments.filter((a) => a.kind === "tips").map((a) => a.slot);
    for (const slot of allocated) {
      expect(["A1", "B1", "D1", "A3"]).not.toContain(slot);
    }
  });

  it("never assigns the same slot twice", () => {
    const assignments = allocateDeck(BARE_FLEX, [
      tips(2),
      { id: "src", loadName: "x", label: "Source", kind: "plate" },
      { id: "dst", loadName: "x", label: "Dest", kind: "plate" },
    ]);
    const slots = assignments.map((a) => a.slot);
    expect(new Set(slots).size).toBe(slots.length);
  });

  it("includes fixtures in the layout so the deck view is complete", () => {
    const assignments = allocateDeck(STEEL_LAB_FLEX, []);
    const labels = assignments.map((a) => a.label);
    expect(labels).toContain("Thermocycler");
    expect(labels).toContain("Heater block");
    expect(labels).toContain("Trash");
  });

  it("groups multi-slot fixtures so they can render as one block", () => {
    const assignments = allocateDeck(STEEL_LAB_FLEX, []);
    const thermo = assignments.filter((a) => a.label === "Thermocycler");
    expect(thermo).toHaveLength(2);
    expect(new Set(thermo.map((a) => a.group)).size).toBe(1);
    expect(thermo[0].group).not.toBeNull();
  });

  it("honours preferred slots", () => {
    const assignments = allocateDeck(STEEL_LAB_FLEX, [
      { id: "manifold", loadName: "m", label: "Manifold", kind: "tuberack", count: 2, preferredSlots: ["C3", "C2"] },
      tips(2),
    ]);
    expect(slotsFor(assignments, "manifold").sort()).toEqual(["C2", "C3"]);
  });

  it("gives preferred-slot requests first refusal even when declared last", () => {
    const assignments = allocateDeck(STEEL_LAB_FLEX, [
      tips(5),
      { id: "manifold", loadName: "m", label: "Manifold", kind: "tuberack", preferredSlots: ["C3"] },
    ]);
    expect(slotFor(assignments, "manifold")).toBe("C3");
  });

  it("falls back off preferred slots unless requirePreferred is set", () => {
    const blocked: DeckConfig = {
      name: "C3 blocked",
      robot: "flex",
      fixtures: [
        { slots: ["A3"], kind: "trash", label: "Trash" },
        { slots: ["C3"], kind: "heater_shaker", label: "Heater shaker" },
      ],
    };
    const soft = allocateDeck(blocked, [
      { id: "m", loadName: "m", label: "Manifold", kind: "tuberack", preferredSlots: ["C3"] },
    ]);
    expect(slotFor(soft, "m")).not.toBe("C3");

    expect(() =>
      allocateDeck(blocked, [
        { id: "m", loadName: "m", label: "Manifold", kind: "tuberack", preferredSlots: ["C3"], requirePreferred: true },
      ]),
    ).toThrow(DeckAllocationError);
  });

  it("refuses to over-fill the deck, and says by how much", () => {
    expect(() => allocateDeck(STEEL_LAB_FLEX, [tips(9)])).toThrow(/needs 9 deck slot/i);
  });

  it("allocates exactly to capacity without error", () => {
    const assignments = allocateDeck(STEEL_LAB_FLEX, [tips(8)]);
    expect(slotsFor(assignments, "tips")).toHaveLength(8);
  });

  it("labels multi-count requests individually", () => {
    const assignments = allocateDeck(BARE_FLEX, [tips(3)]);
    expect(assignments.filter((a) => a.kind === "tips").map((a) => a.label)).toEqual([
      "Tip Rack 1",
      "Tip Rack 2",
      "Tip Rack 3",
    ]);
  });

  it("throws a clear error when asked for an unallocated id", () => {
    const assignments = allocateDeck(BARE_FLEX, [tips()]);
    expect(() => slotFor(assignments, "nope")).toThrow(/No deck slot was allocated/);
  });
});

describe("user placements", () => {
  const requests = [
    { id: "plate", loadName: "opentrons_96_wellplate_200ul_pcr_full_skirt", label: "Plate", kind: "plate" as const },
    { id: "tips", loadName: "opentrons_flex_96_tiprack_1000ul", label: "Tips", kind: "tips" as const, count: 2 },
  ];
  const slotOf = (layout: ReturnType<typeof allocateDeck>, id: string) => layout.find((a) => a.id === id)?.slot;

  it("puts labware where the user dragged it", () => {
    const layout = allocateDeck({ ...STEEL_LAB_FLEX, placements: { plate: "D3", "tips:1": "C1" } }, requests);
    expect(slotOf(layout, "plate")).toBe("D3");
    expect(slotOf(layout, "tips:1")).toBe("C1");
    expect(new Set(layout.map((a) => a.slot)).size).toBe(layout.length);
  });

  it("ignores a placement onto a fixture", () => {
    const layout = allocateDeck({ ...STEEL_LAB_FLEX, placements: { plate: "A3" } }, requests);
    expect(slotOf(layout, "plate")).not.toBe("A3");
  });

  it("keeps constrained labware inside its allowed slots", () => {
    const pinned = [{ id: "m", loadName: null, label: "Manifold", kind: "tuberack" as const, preferredSlots: ["C3"], requirePreferred: true }];
    const layout = allocateDeck({ ...STEEL_LAB_FLEX, placements: { m: "D2" } }, pinned);
    expect(slotOf(layout, "m")).toBe("C3");
    expect(layout.find((a) => a.id === "m")?.allowedSlots).toEqual(["C3"]);
  });

  it("finds a free slot for labware that appeared after the user arranged the deck", () => {
    const first = allocateDeck(STEEL_LAB_FLEX, requests);
    const placements = Object.fromEntries(first.filter(isMovable).map((a) => [a.id, a.slot]));
    // A third tip rack now lands wherever the first default allocation would have put it.
    const more = [requests[0], { ...requests[1], count: 3 }];
    const layout = allocateDeck({ ...STEEL_LAB_FLEX, placements }, more);
    expect(slotOf(layout, "tips:2")).toBeDefined();
    expect(new Set(layout.map((a) => a.slot)).size).toBe(layout.length);
  });
});
