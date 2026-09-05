export type ReleaseProgram = "v040" | "v050";

export const RELEASE_PROGRAMS: readonly ReleaseProgram[] = ["v040", "v050"];

export function isReleaseProgram(value: unknown): value is ReleaseProgram {
  return value === "v040" || value === "v050";
}

export type ReleaseProgramTable = {
  readonly program: ReleaseProgram;
  readonly registerPath: string;
  readonly dispositions: readonly string[];
  readonly bootstrapOwner: string;
  readonly childIdPrefix: string;
  readonly evaluationChild: string | null;
  readonly trancheRange: readonly [number, number];
  readonly familyId: string | null;
  readonly schemaVersion: 1 | 2;
};

const TABLES: { readonly [K in ReleaseProgram]: ReleaseProgramTable } = {
  v040: {
    program: "v040",
    registerPath: "openspec/changes/v040-release-program/coverage.toml",
    dispositions: [
      "v040_owner",
      "v040_dependency",
      "released_reference",
      "superseded",
      "v050",
    ],
    bootstrapOwner: "openspec-superpowers-convergence",
    childIdPrefix: "v040-t",
    evaluationChild: "v040-t8-evaluation",
    trancheRange: [2, 9],
    familyId: "v040-release-20260822-f1",
    schemaVersion: 1,
  },
  v050: {
    program: "v050",
    registerPath: "openspec/changes/v050-release-program/coverage.toml",
    dispositions: [
      "v050_owner",
      "v050_dependency",
      "released_reference",
      "superseded",
      "v060",
    ],
    bootstrapOwner: "v050-release-program",
    childIdPrefix: "v050-",
    evaluationChild: null,
    trancheRange: [2, 8],
    familyId: null,
    schemaVersion: 2,
  },
};

export function releaseProgramTable(program: ReleaseProgram): ReleaseProgramTable {
  return TABLES[program];
}
