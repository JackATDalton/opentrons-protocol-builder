import { describe, expect, it } from "vitest";
import {
  assertWellsExist,
  batchSize,
  byColumn,
  chunk,
  columnMajor,
  parseWell,
  rowMajor,
  SHAPE_24,
  SHAPE_96,
  shapeFor,
  sortColumnMajor,
  sortRowMajor,
} from "../src/core/wells";

describe("well names", () => {
  it("parses row and column", () => {
    expect(parseWell("A1")).toEqual({ row: "A", column: 1 });
    expect(parseWell("h12")).toEqual({ row: "H", column: 12 });
  });

  it("rejects malformed names rather than guessing", () => {
    expect(() => parseWell("1A")).toThrow(/not a valid well name/);
    expect(() => parseWell("")).toThrow(/not a valid well name/);
  });
});

describe("traversal order", () => {
  it("row-major reads left to right, then down", () => {
    expect(rowMajor(SHAPE_24).slice(0, 8)).toEqual(["A1", "A2", "A3", "A4", "A5", "A6", "B1", "B2"]);
  });

  it("column-major reads down, then across (matches Opentrons wells())", () => {
    expect(columnMajor(SHAPE_24).slice(0, 8)).toEqual(["A1", "B1", "C1", "D1", "A2", "B2", "C2", "D2"]);
  });

  it("covers every well exactly once, in both orders", () => {
    const row = rowMajor(SHAPE_96);
    const col = columnMajor(SHAPE_96);
    expect(row).toHaveLength(96);
    expect(new Set(row).size).toBe(96);
    expect(new Set(col)).toEqual(new Set(row));
  });

  /**
   * Regression guard for the real bug this module exists to prevent: a source
   * list sorted one way zipped against a destination list sorted the other.
   * They agree only for the first column, then silently diverge.
   */
  it("row- and column-major diverge after the first column", () => {
    const partial = ["A1", "A2", "A3", "B1", "B2", "B3", "C1", "C2", "C3"];
    const asRead = sortRowMajor(partial);
    const asColumn = sortColumnMajor(partial);
    expect(asRead[0]).toBe(asColumn[0]);
    expect(asRead).not.toEqual(asColumn);
  });

  it("sorts an unordered selection into reading order", () => {
    expect(sortRowMajor(["C2", "A1", "B6", "A3"])).toEqual(["A1", "A3", "B6", "C2"]);
  });

  it("de-duplicates while sorting", () => {
    expect(sortRowMajor(["A1", "A1", "B2"])).toEqual(["A1", "B2"]);
  });

  it("orders columns numerically, not lexically", () => {
    expect(sortColumnMajor(["A10", "A2", "A1"])).toEqual(["A1", "A2", "A10"]);
  });
});

describe("grouping and batching", () => {
  it("groups by column in ascending numeric order", () => {
    const grouped = byColumn(["B2", "A1", "A2", "C1"]);
    expect([...grouped.keys()]).toEqual([1, 2]);
    expect(grouped.get(1)).toEqual(["A1", "C1"]);
    expect(grouped.get(2)).toEqual(["A2", "B2"]);
  });

  it("chunks without dropping or duplicating items", () => {
    const items = [1, 2, 3, 4, 5];
    const chunks = chunk(items, 2);
    expect(chunks).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunks.flat()).toEqual(items);
  });

  it("rejects a zero chunk size instead of looping forever", () => {
    expect(() => chunk([1, 2], 0)).toThrow(/at least 1/);
  });

  it("computes how many wells one pipette load covers", () => {
    expect(batchSize(1000, 50)).toBe(20); // the p1000 elution case
    expect(batchSize(1000, 350)).toBe(2); // the neutralisation case
    expect(batchSize(50, 1)).toBe(50);
  });

  it("never returns a batch size below 1, even for oversized volumes", () => {
    expect(batchSize(50, 200)).toBe(1);
  });
});

describe("labware shapes", () => {
  it("maps known loadNames to the right grid", () => {
    expect(shapeFor("opentrons_96_wellplate_200ul_pcr_full_skirt")).toBe(SHAPE_96);
    expect(shapeFor("jd_24_tuberack_1.5ml")).toBe(SHAPE_24);
    expect(shapeFor("nest_24_wellplate_10.4ml")).toBe(SHAPE_24);
  });

  it("validates a selection against the labware, naming the offenders", () => {
    expect(() => assertWellsExist(["A1", "E1"], SHAPE_24, "Tube rack")).toThrow(/Tube rack has no well\(s\) E1/);
    expect(() => assertWellsExist(["A1", "D6"], SHAPE_24, "Tube rack")).not.toThrow();
  });
});
