import { describe, expect, it } from "vitest";

import { protocolStem, protocolTitle, todayStamp, uploadLabel } from "../src/ui/naming";

describe("protocol naming", () => {
  it("stamps the local date", () => {
    expect(todayStamp(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });

  it("puts the date and uploaded plate names in the file stem", () => {
    expect(protocolStem("plate_normalisation_30ngul", [uploadLabel("Plate 7 (JD).csv")], "2026-11-17"))
      .toBe("2026-11-17_plate_normalisation_30ngul_Plate_7_JD");
  });

  it("skips sources that were pasted rather than uploaded", () => {
    expect(protocolStem("miniprep_24_samples", ["", undefined], "2026-11-17")).toBe("2026-11-17_miniprep_24_samples");
    expect(protocolTitle("Vacuum Manifold Miniprep", [""], "2026-11-17")).toBe("Vacuum Manifold Miniprep (2026-11-17)");
  });

  it("names every source plate in the title", () => {
    expect(protocolTitle("Golden Gate Assembly", ["assembly_A", "repo_v3"], "2026-11-17"))
      .toBe("Golden Gate Assembly — assembly_A, repo_v3 (2026-11-17)");
  });
});
