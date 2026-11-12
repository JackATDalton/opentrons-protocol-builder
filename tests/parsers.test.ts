import { describe, expect, it } from "vitest";

import {
  basePartName,
  buildPartIndex,
  checkPartVolumes,
  parseAssemblyLayout,
} from "../src/parsers/assembly-layout";
import { occupiedWells, parsePlateCsv, parseVolumesCsv } from "../src/parsers/plate-csv";

describe("parsePlateCsv", () => {
  it("reads a names block followed by a concentrations block with no second header", () => {
    // The real stacked export: every well's name, then every well's number,
    // under one header. A row is classified by whether its value is numeric.
    const csv = [
      "Location,Name",
      "A1,P1d",
      "A2,P2d",
      "B1,U1d",
      "A1,62.5",
      "A2,67.8",
      "B1,63.5",
    ].join("\n");

    const plate = parsePlateCsv(csv);
    expect(plate.A1).toEqual({ name: "P1d", concentration: 62.5 });
    expect(plate.A2).toEqual({ name: "P2d", concentration: 67.8 });
    expect(plate.B1).toEqual({ name: "U1d", concentration: 63.5 });
    expect(occupiedWells(plate).sort()).toEqual(["A1", "A2", "B1"]);
  });

  it("takes the blocks in either order, last value winning per field", () => {
    const plate = parsePlateCsv(["Location,Name", "A1,62.5", "A1,P1d"].join("\n"));
    expect(plate.A1).toEqual({ name: "P1d", concentration: 62.5 });
  });

  it("counts only wells that have a concentration as occupied", () => {
    // A name with no number is a labelled but unmeasured well, not sample.
    const plate = parsePlateCsv(["Location,Name", "A1,P1d", "B1,U1d", "A1,62.5"].join("\n"));
    expect(occupiedWells(plate)).toEqual(["A1"]);
    expect(plate.B1.name).toBe("U1d");
  });

  it("skips blank values rather than inventing wells", () => {
    const plate = parsePlateCsv(["Location,Name", "A1,P1d", "B1,", ",X", "A1,40"].join("\n"));
    expect(Object.keys(plate)).toEqual(["A1"]);
  });

  it("names the wells it could not read", () => {
    expect(() => parsePlateCsv(["Location,Name", "A1,P1d", "banana,U1d"].join("\n"))).toThrow(
      /banana/,
    );
  });
});

describe("parseVolumesCsv", () => {
  it("reads name/volume pairs", () => {
    const parsed = parseVolumesCsv(["name,volume_ul", "P1d,45", "U1d,12.5"].join("\n"));
    expect(parsed.P1d.volumeUl).toBe(45);
    expect(parsed.U1d.volumeUl).toBe(12.5);
  });
});

describe("parseAssemblyLayout", () => {
  const csv = [
    "Plate,Well,Combination_ID,Promoter,UTR,CDS,Terminator,Vector",
    "1,A1,Combo_0001,P1d,U1d,C1J,T1m,V37m",
    "1,A2,Combo_0002,P1d,U1d,C1J,T2m,V37m",
    "1,B1,Combo_0003,P2d,U2d,C1J,T1m,V37m",
  ].join("\n");

  it("discovers part columns from the header, keeping their order", () => {
    const layout = parseAssemblyLayout(csv);
    expect(layout.partColumns).toEqual(["Promoter", "UTR", "CDS", "Terminator", "Vector"]);
    expect(layout.rows).toHaveLength(3);
    expect(layout.rows[0]).toEqual({
      well: "A1",
      combinationId: "Combo_0001",
      parts: { Promoter: "P1d", UTR: "U1d", CDS: "C1J", Terminator: "T1m", Vector: "V37m" },
    });
  });

  it("works with part columns this lab has never used", () => {
    const layout = parseAssemblyLayout(
      ["Well,Insulator,RBS", "A1,I1,R1", "A2,I2,R2"].join("\n"),
    );
    expect(layout.partColumns).toEqual(["Insulator", "RBS"]);
  });

  it("rejects a layout with no Well column, naming what it found", () => {
    expect(() => parseAssemblyLayout("Plate,Position\n1,A1")).toThrow(/"Well" column/);
  });

  it("rejects a layout with no part columns", () => {
    expect(() => parseAssemblyLayout("Plate,Well,Combination_ID\n1,A1,X")).toThrow(
      /no part-type columns/,
    );
  });

  it("gives a helpful error for a malformed well name", () => {
    expect(() => parseAssemblyLayout("Well,Promoter\nnot-a-well,P1d")).toThrow(/not a valid well/);
  });

  it("rejects a header with no data rows", () => {
    // Blank lines are stripped, so a header alone reads as an empty file.
    expect(() => parseAssemblyLayout("Well,Promoter\n")).toThrow(/empty/);
    // A row present but with no well name is the other way to have no data.
    expect(() => parseAssemblyLayout("Well,Promoter\n,P1d")).toThrow(/no data rows/);
  });
});

describe("basePartName and buildPartIndex", () => {
  it("strips a descriptive suffix so P8d and 'P8d: PLacI' match", () => {
    expect(basePartName("P8d: PLacI")).toBe("p8d");
    expect(basePartName("  P8D  ")).toBe("p8d");
  });

  it("indexes the repo plate by normalised name", () => {
    const index = buildPartIndex({
      B4: { name: "P8d: PLacI", concentration: 40 },
      C5: { name: "T1d", concentration: 31 },
      D1: { name: null, concentration: null },
    });
    expect(index).toEqual({ "p8d": "B4", t1d: "C5" });
  });
});

describe("checkPartVolumes", () => {
  const layout = parseAssemblyLayout(
    [
      "Well,Promoter,UTR,CDS,Vector",
      "A1,P1d,U1d,C1J,V37m",
      "A2,P1d,U2d,C1J,V37m",
      "B1,P2d,U1d,C1J,V37m",
    ].join("\n"),
  );
  const repoPlate = {
    A1: { name: "P1d", concentration: 40 },
    A2: { name: "P2d", concentration: 40 },
    E1: { name: "U1d", concentration: 40 },
    E2: { name: "U2d", concentration: 40 },
  };

  it("counts wells needing each part and adds the pre-wet volume once", () => {
    const rows = checkPartVolumes({
      layouts: [layout],
      repoPlate,
      masterMixParts: ["CDS", "Vector"],
      transferVolumeUl: 1,
      prewetVolumeUl: 5,
    });
    const p1d = rows.find((r) => r.part === "P1d");
    expect(p1d?.wellsNeeded).toBe(2);
    expect(p1d?.requiredUl).toBe(7);
  });

  it("excludes master-mix columns entirely", () => {
    const rows = checkPartVolumes({
      layouts: [layout],
      repoPlate,
      masterMixParts: ["CDS", "Vector"],
    });
    expect(rows.map((r) => r.part)).not.toContain("C1J");
    expect(rows.map((r) => r.part)).not.toContain("V37m");
  });

  it("aggregates demand across several layouts, because they share the tubes", () => {
    const rows = checkPartVolumes({
      layouts: [layout, layout],
      repoPlate,
      masterMixParts: ["CDS", "Vector"],
      transferVolumeUl: 1,
      prewetVolumeUl: 5,
    });
    expect(rows.find((r) => r.part === "P1d")?.wellsNeeded).toBe(4);
  });

  it("reports a part absent from the repo plate", () => {
    const rows = checkPartVolumes({
      layouts: [parseAssemblyLayout("Well,Promoter\nA1,P99z")],
      repoPlate,
    });
    expect(rows[0].status).toBe("missing_from_repo");
    expect(rows[0].repoWell).toBeNull();
  });

  it("reports no_volume_data when volumes were not supplied", () => {
    const rows = checkPartVolumes({
      layouts: [parseAssemblyLayout("Well,Promoter\nA1,P1d")],
      repoPlate,
      volumes: {},
    });
    expect(rows[0].status).toBe("no_volume_data");
  });

  it("reports short when the tube holds less than the run needs", () => {
    const rows = checkPartVolumes({
      layouts: [layout],
      repoPlate,
      masterMixParts: ["CDS", "Vector"],
      volumes: { P1d: { volumeUl: 3 }, P2d: { volumeUl: 100 }, U1d: { volumeUl: 100 }, U2d: { volumeUl: 100 } },
      transferVolumeUl: 1,
      prewetVolumeUl: 5,
    });
    expect(rows.find((r) => r.part === "P1d")?.status).toBe("short");
    expect(rows.find((r) => r.part === "P2d")?.status).toBe("ok");
  });
});
