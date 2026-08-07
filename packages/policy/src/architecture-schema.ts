/**
 * Closed result schema for the architecture policy checker.
 * No raw file content, process output, environment values, or secrets.
 */

export const ARCHITECTURE_SCHEMA_VERSION = 1 as const;

/** Closed policy finding reasons (sorted keys in emit). */
export type PolicyReason =
  | "prohibited_python"
  | "prohibited_posix_shell"
  | "prohibited_powershell"
  | "prohibited_cmd"
  | "prohibited_javascript"
  | "prohibited_jsx"
  | "prohibited_mjs"
  | "prohibited_cjs"
  | "prohibited_bun_only"
  | "prohibited_deno_only"
  | "prohibited_extensionless_executable"
  | "prohibited_special_mode"
  | "legacy_adapter_domain_logic"
  | "undeclared_generated_bundle"
  | "manifest_bundle_mismatch"
  | "manifest_bundle_missing"
  | "manifest_bundle_duplicate"
  | "manifest_bundle_linked"
  | "malformed_delta"
  | "oversize_output"
  | "git_failure"
  | "head_moved"
  | "invalid_git_output"
  | "schema_mismatch"
  | "internal_failed";

export type DeltaKind = "added" | "modified" | "deleted" | "renamed";

export type PolicyFinding = {
  readonly path: string;
  readonly kind: "added" | "modified" | "renamed";
  readonly reason: PolicyReason;
};

export type LegacyDebtRecord = {
  readonly path: string;
  readonly reason: PolicyReason;
};

export type ArchitectureCheckPass = {
  readonly schemaVersion: typeof ARCHITECTURE_SCHEMA_VERSION;
  readonly _tag: "Pass";
  readonly base: string;
  readonly mergeBase: string;
  readonly head: string;
  readonly findings: readonly PolicyFinding[];
  readonly legacyDebt: readonly LegacyDebtRecord[];
};

export type ArchitectureCheckFail = {
  readonly schemaVersion: typeof ARCHITECTURE_SCHEMA_VERSION;
  readonly _tag: "Fail";
  readonly base: string;
  readonly mergeBase: string;
  readonly head: string;
  readonly findings: readonly PolicyFinding[];
  readonly legacyDebt: readonly LegacyDebtRecord[];
};

export type ArchitectureCheckFailed = {
  readonly schemaVersion: typeof ARCHITECTURE_SCHEMA_VERSION;
  readonly _tag: "Failed";
  readonly reason: PolicyReason;
  readonly base: string | null;
  readonly mergeBase: string | null;
  readonly head: string | null;
  readonly findings: readonly PolicyFinding[];
  readonly legacyDebt: readonly LegacyDebtRecord[];
};

export type ArchitectureCheckResult =
  | ArchitectureCheckPass
  | ArchitectureCheckFail
  | ArchitectureCheckFailed;

export function sortFindings(
  findings: readonly PolicyFinding[],
): PolicyFinding[] {
  return [...findings].sort((a, b) => {
    const pc = a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
    if (pc !== 0) return pc;
    const rc = a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : 0;
    if (rc !== 0) return rc;
    return a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0;
  });
}

export function sortLegacyDebt(
  debt: readonly LegacyDebtRecord[],
): LegacyDebtRecord[] {
  return [...debt].sort((a, b) => {
    const pc = a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
    if (pc !== 0) return pc;
    return a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : 0;
  });
}

export function failedResult(
  reason: PolicyReason,
  ids?: {
    readonly base?: string | null;
    readonly mergeBase?: string | null;
    readonly head?: string | null;
  },
): ArchitectureCheckFailed {
  return {
    schemaVersion: ARCHITECTURE_SCHEMA_VERSION,
    _tag: "Failed",
    reason,
    base: ids?.base ?? null,
    mergeBase: ids?.mergeBase ?? null,
    head: ids?.head ?? null,
    findings: [],
    legacyDebt: [],
  };
}
