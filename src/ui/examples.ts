/**
 * Example CSVs offered for download beside every CSV upload.
 *
 * Each one is run through the real parser (and, where it applies, the real
 * generator) in tests/examples.test.ts, so an example cannot drift out of step
 * with the format it demonstrates.
 */

export interface CsvExample {
  filename: string;
  content: string;
}

export const TUBE_LIST_EXAMPLE: CsvExample = {
  filename: "tube-list-example.csv",
  content: `# part, concentration ng/uL, volume uL, [mastermix]
P1d, 37.2, 50
P2d, 67.8, 50
U1d, 22.6, 50
U2d, 46, 100
C1J, 114, 60
T1m, 18.3, 100
V35m, 120, 800, mastermix
`,
};

export const PLATE_CONTENTS_EXAMPLE: CsvExample = {
  filename: "plate-contents-example.csv",
  content: `Well,Value
A1,C1J
A2,P1d
A3,P2d
B1,U1d
B2,U2d
B3,T1m
A1,114
A2,62.5
A3,67.8
B1,63.5
B2,76
B3,35
`,
};

export const ASSEMBLY_LAYOUT_EXAMPLE: CsvExample = {
  filename: "assembly-layout-example.csv",
  content: `Well,Combination_ID,Promoter,UTR,CDS,Terminator
A1,1,P1d,U1d,C1J,T1m
A2,2,P1d,U2d,C1J,T1m
A3,3,P2d,U1d,C1J,T1m
A4,4,P2d,U2d,C1J,T1m
`,
};

export const REPOSITORY_PLATE_EXAMPLE: CsvExample = {
  filename: "repository-plate-example.csv",
  content: `Well,Value
A1,P1d
A2,P2d
A3,U1d
A4,U2d
A5,C1J
A6,T1m
`,
};

export const REPO_VOLUMES_EXAMPLE: CsvExample = {
  filename: "repo-volumes-example.csv",
  content: `well,name,target_ngul,final_volume_ul,achieved_ngul,shortfall
A1,P1d,30,100,30,
A2,P2d,30,100,30,
A3,U1d,30,80,22.6,
A4,U2d,30,100,30,
A5,C1J,30,100,30,
A6,T1m,30,60,18.3,
`,
};

export function downloadCsv(example: CsvExample): void {
  const blob = new Blob([example.content], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = example.filename;
  a.click();
  URL.revokeObjectURL(url);
}
