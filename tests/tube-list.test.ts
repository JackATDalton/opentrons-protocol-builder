import { describe, expect, it } from "vitest";

import { STEEL_LAB_FLEX } from "../src/core/deck";
import { generateTubeNormalisation } from "../src/generators/tube-normalisation";
import { parsePlateLayout, parseSamples } from "../src/parsers/tube-list";
import { TUBE_PLATE_LAYOUT_EXAMPLE } from "../src/ui/examples";
import { crc32, makeZip } from "../src/ui/zip";

describe("parseSamples, headed CSV", () => {
  it("reads loosely named columns, with rack, tube and plate well", () => {
    const { samples, errors } = parseSamples(
      "Part,Conc1 (ng/uL),Vol,rack,tube,plate_well,mastermix\nP1d,37.2,50,2,b03,h12,\nC4J,60,3600,,,,mastermix",
    );
    expect(errors).toEqual([]);
    expect(samples[0]).toEqual({ name: "P1d", concentration: 37.2, volumeUl: 50, masterMix: false, rack: 2, tube: "B3", well: "H12" });
    expect(samples[1]).toMatchObject({ name: "C4J", masterMix: true });
    expect(samples[1].tube).toBeUndefined();
  });

  it("defaults the rack to 1 when only a tube is given", () => {
    expect(parseSamples("name,concentration,volume_ul,tube\nP1,40,50,C2").samples[0]).toMatchObject({ rack: 1, tube: "C2" });
  });

  it("reports a bad position rather than guessing", () => {
    const { samples, errors } = parseSamples("name,concentration,volume_ul,tube\nP1,40,50,Z9");
    expect(samples).toHaveLength(0);
    expect(errors[0]).toContain("Z9");
  });

  it("rejects a header with no volume column", () => {
    expect(parseSamples("name,concentration\nP1,40").errors[0]).toMatch(/volume/);
  });
});

describe("parsePlateLayout", () => {
  it("reads well,name rows", () => {
    expect(parsePlateLayout(TUBE_PLATE_LAYOUT_EXAMPLE.content).wells).toMatchObject({ P1d: "A1", T1m: "B2" });
  });

  it("reads a plate grid", () => {
    const { wells, errors } = parsePlateLayout(",1,2,3\nA,P1,,P3\nB,,P2,");
    expect(errors).toEqual([]);
    expect(wells).toEqual({ P1: "A1", P3: "A3", P2: "B2" });
  });

  it("reads a briefly.bio export, ignoring the concentration block", () => {
    expect(parsePlateLayout("Well,Value\nA1,P1\nB1,P2\nA1,40\nB1,50").wells).toEqual({ P1: "A1", P2: "B1" });
  });

  it("reads back this tool's own layout CSV", () => {
    const r = generateTubeNormalisation({
      deck: STEEL_LAB_FLEX,
      samples: [
        { name: "P1", concentration: 90, volumeUl: 50, well: "D4" },
        { name: "P2", concentration: 60, volumeUl: 50 },
        { name: "C4J", concentration: 60, volumeUl: 3600, masterMix: true },
      ],
      targetConcentration: 30,
      finalVolumeUl: 60,
      waterLabware: "jd_6_falconrack_50ml",
      waterWell: "A1",
    });
    const { wells, errors } = parsePlateLayout(r.layoutCsvFull);
    expect(errors).toEqual([]);
    expect(wells).toEqual({ P1: "D4", P2: "A1" });
  });

  it("rejects two parts in one well", () => {
    expect(parsePlateLayout("well,name\nA1,P1\nA1,P2").errors[0]).toMatch(/both P1 and P2/);
  });
});

describe("makeZip", () => {
  it("computes the standard CRC-32", () => {
    expect(crc32(new TextEncoder().encode("hello")).toString(16)).toBe("3610a686");
  });

  it("writes a local header per file and a closing directory", () => {
    const zip = makeZip([
      { name: "a.py", content: "print(1)\n" },
      { name: "b.csv", content: "well,name\n" },
    ]);
    const view = new DataView(zip.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    const end = zip.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(2);
  });
});
