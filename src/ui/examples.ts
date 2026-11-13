/**
 * Example CSVs offered for download beside every CSV upload.
 *
 * Each one is run through the real parser (and, where it applies, the real
 * generator) in tests/examples.test.ts, so an example cannot drift out of step
 * with the format it demonstrates.
 */
import { downloadText } from "./download";

export interface CsvExample {
  filename: string;
  content: string;
}

export const TUBE_LIST_EXAMPLE: CsvExample = {
  filename: "tube-list-example.csv",
  content: `# part, concentration ng/uL, volume uL, [mastermix]
`,
};

/** A desired output plate for tube normalisation: well, part. Optional. */
export const TUBE_PLATE_LAYOUT_EXAMPLE: CsvExample = {
  filename: "plate-layout-example.csv",
  content: `well,name
`,
};

export const PLATE_CONTENTS_EXAMPLE: CsvExample = {
  filename: "plate-contents-example.csv",
  content: `Well,Value
`,
};

export const ASSEMBLY_LAYOUT_EXAMPLE: CsvExample = {
  filename: "assembly-layout-example.csv",
  content: `Well,Combination_ID,Promoter,UTR,CDS,Terminator
`,
};

export const REPOSITORY_PLATE_EXAMPLE: CsvExample = {
  filename: "repository-plate-example.csv",
  content: `Well,Value
`,
};

export const REPO_VOLUMES_EXAMPLE: CsvExample = {
  filename: "repo-volumes-example.csv",
  content: `well,name,target_ngul,final_volume_ul,achieved_ngul,shortfall
`,
};

export function downloadCsv(example: CsvExample): void {
  downloadText(example.content, example.filename, "text/csv");
}
