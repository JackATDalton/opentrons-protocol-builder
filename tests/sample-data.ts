/**
 * Inputs for tests that need a small, valid run.
 *
 * Kept here rather than borrowed from `src/ui/examples.ts`: the public edition
 * ships those downloadable examples as header rows only, and tests must not
 * depend on what a release chooses to show users.
 */
export const ASSEMBLY_LAYOUT_CSV = `Well,Combination_ID,Promoter,UTR,CDS,Terminator
A1,1,P1,U1,C1,T1
A2,2,P1,U2,C1,T1
A3,3,P2,U1,C1,T1
A4,4,P2,U2,C1,T1
`;

export const REPOSITORY_PLATE_CSV = `Well,Value
A1,P1
A2,P2
A3,U1
A4,U2
A5,C1
A6,T1
`;

export const PLATE_LAYOUT_CSV = `well,name
A1,P1
B1,P2
C1,U1
D1,U2
A2,C1
B2,T1
`;
