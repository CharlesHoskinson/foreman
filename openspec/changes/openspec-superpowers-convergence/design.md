# Design: OpenSpec and Superpowers convergence

## Context

The v0.4 governor is the normative source for this bootstrap. The current
runtime has V1 Endstop contracts, one root RunJournal, contract-bound queue
admission, mutable general audit policy, and exact installed-runtime checks.
It does not have project-local workflow schemas, a coverage command, an
immutable release-admission rule, or contract families.

The package temporarily uses the built-in `spec-driven` metadata while the
custom schemas do not exist. The atomic Track 1 candidate changes its metadata
to `foreman-architectural` before strict validation. No lane can admit this
temporary state.

## Goals and non-goals

This change creates the complete authority bootstrap defined by the governor.
It preserves all V1 behavior until family activation. It does not implement a
later release tranche, create a mutable family child, or add another active
plan outside this package.

## Decisions

### Workflow schemas are closed dependency graphs

Each schema owns a `schema.yaml` and its templates. Bounded artifacts use
`proposal -> specs -> tasks`. Architectural artifacts use
`proposal -> specs -> design -> tasks`. The `apply.requires` list contains
only `tasks`, and `apply.tracks` is `tasks.md`. The release-coverage command
also rejects changed v0.4 planning files under `docs/superpowers` and rejects a
v0.4 package whose `.openspec.yaml` does not name one of these workflows.

### Coverage validation is a pure core with an Effect boundary

`release-coverage.ts` defines a strict parser for only the authored register
schema. It does not accept general TOML features that can create duplicate or
ambiguous values. Its pure validator receives register text, raw Roadmap bytes,
the decoded `openspec list --json` names, workflow metadata, and Git-changed
paths. The main entry point owns bounded file reads and the OpenSpec and Git
subprocesses through Effect.

The result is closed and canonical:

```ts
export type ReleaseCoverageFailureReason =
  | "invalid_register"
  | "invalid_roadmap"
  | "duplicate_identity"
  | "unknown_owner"
  | "inventory_mismatch"
  | "roadmap_mismatch"
  | "workflow_mismatch"
  | "brief_mismatch"
  | "unreconciled"
  | "competing_plan"
  | "dependency_failure";

export type RoadmapAssignmentV1 = {
  readonly key: string;
  readonly scope: string;
  readonly release: "v0.4" | "v0.5";
  readonly owner: string;
};

export type ReleaseCoverageResultV1 =
  | {
      readonly schemaVersion: 1;
      readonly _tag: "Valid";
      readonly activeInventorySha256: string;
      readonly roadmapSha256: string;
      readonly entryCount: number;
    }
  | {
      readonly schemaVersion: 1;
      readonly _tag: "Invalid";
      readonly reason: ReleaseCoverageFailureReason;
    };

export type ReleaseCoveragePhaseV1 =
  | { readonly _tag: "Bootstrap"; readonly owner: "openspec-superpowers-convergence" }
  | { readonly _tag: "Lane"; readonly owner: string }
  | { readonly _tag: "Release" };

export type ReleasePackageBriefV1 = {
  readonly schema: "foreman.release-package-brief.v1";
  readonly familySha256: string;
  readonly childId: string;
  readonly packageId: string;
  readonly objective: string;
  readonly acceptance: readonly string[];
  readonly allowedPaths: readonly string[];
};

export function validateReleaseCoverageV1(input: {
  readonly phase: ReleaseCoveragePhaseV1;
  readonly registerText: string;
  readonly roadmapBytes: Uint8Array;
  readonly activeChangeNames: readonly string[];
  readonly roadmapRows: readonly RoadmapAssignmentV1[];
  readonly workflowByChange: Readonly<Record<string, string | null>>;
  readonly changedSuperpowersPaths: readonly string[];
  readonly expectedBriefByOwner: Readonly<Record<string, ReleasePackageBriefV1>>;
  readonly packageBriefBytesByOwner: Readonly<Record<string, Uint8Array>>;
}): ReleaseCoverageResultV1;
```

Each Roadmap key is 1..256 printable ASCII bytes and starts with `roadmap:`.
Scope is 1..4096 UTF-8 bytes without control characters. Release is one literal
from the type, and owner uses the 1..128-byte `decodeRunId` grammar. Every pure
refusal maps to exactly one listed failure reason. The CLI keeps invalid
invocation separate at exit 64.

The CLI has exactly these forms:

```text
release-coverage check --program v040 --phase bootstrap --owner openspec-superpowers-convergence --register ABS
release-coverage check --program v040 --phase lane --owner PACKAGE --repo ABS --state-root ABS --contract-id ROOT_ID --contract-sha ROOT_SHA --family-sha FAMILY_SHA --register ABS
release-coverage check --program v040 --phase release --repo ABS --state-root ABS --contract-id ROOT_ID --contract-sha ROOT_SHA --family-sha FAMILY_SHA --register ABS
```

All phases validate the full schema, active inventory, Roadmap, and digests.
Bootstrap requires Track 1 reconciliation and workflow metadata. Lane requires
every v0.4 entry owned by `PACKAGE` to be reconciled. Release requires zero
v0.4 `required` entries and all required workflow metadata. Lane and release
load the manifest and family source that the root journal registered. For each
phase-relevant family package, they require
`openspec/changes/<packageId>/release-brief.json` to equal the canonical
`ReleasePackageBriefV1` derived from that source. The pure core receives only
the verified expected mapping and package bytes. Bootstrap requires both brief
maps to be empty. The CLI returns 0
for `Valid`, 1 for an evaluated `Invalid`, and 64 for invalid arguments. It
prints exactly one canonical JSON line and never prints raw exception text.

### Release authority uses canonical digests and Endstop registration

Every receipt, outcome, approval, and evidence bundle is canonical JSON with
one trailing LF. Its authority digest is SHA-256 of the complete file bytes,
including that LF. Endstop stores the exact evidence-bundle digest before use.

Decoders reject duplicate or extra keys, control characters, invalid UTF-8,
wrong types, non-canonical bytes, more than 100 findings, and files larger than
1 MiB. Producer source files are also bounded to 1 MiB. Unless a field has a
more specific rule below,
each `*Sha256` source field is SHA-256 of the exact source file bytes read once.
Identifiers use
the 1..128-byte `decodeRunId` grammar. Evidence bundles contain one or two
receipts in the exact action order below.

```ts
export type ReleaseCandidateIdentityV1 = {
  readonly commit: string;
  readonly tree: string;
  readonly candidateSha256: string; // SHA-256 of ASCII lowercase commit
};

export type ReleaseActionV1 =
  | "implement" | "verify" | "audit" | "correct" | "council"
  | "provider_retry" | "resume" | "integrate" | "publish" | "evaluate";

export type ReleaseAuditFindingV1 = {
  readonly severity: "low" | "medium" | "high" | "critical";
  readonly file: string; // 1..4096 UTF-8 bytes
  readonly line: number; // safe integer, 1..2147483647
  readonly summary: string; // 1..4096 UTF-8 bytes
  readonly evidence: string; // 1..16384 UTF-8 bytes
};

export type ReleaseChecksSourceV1 = {
  readonly schema: "foreman.checks-source.v1";
  readonly program: "v040";
  readonly packageId: string;
  readonly candidate: ReleaseCandidateIdentityV1;
  readonly status: "PASS" | "FAIL";
  readonly commands: readonly {
    readonly commandSha256: string;
    readonly exitCode: number;
    readonly stdoutSha256: string;
    readonly stderrSha256: string;
  }[];
};

export type ReleaseAuditSourceV1 = {
  readonly schema: "foreman.audit-source.v1";
  readonly program: "v040";
  readonly packageId: string;
  readonly candidate: ReleaseCandidateIdentityV1;
  readonly verdict: "APPROVED" | "WARNING" | "BLOCKED" | "UNVERIFIED";
  readonly findings: readonly ReleaseAuditFindingV1[];
  readonly auditArtifactSha256: string;
};

export type ReleaseEvaluationReportSourceV1 = {
  readonly schema: "foreman.evaluation-report-source.v1";
  readonly program: "v040";
  readonly packageId: "graph-eval-falsification";
  readonly candidateSha256: string;
  readonly authorityManifestSha256: string;
  readonly evaluationAuthorityReceiptSha256: string;
  readonly result: ReleaseEvaluationVerdictV1["result"];
  readonly plannedRuns: 2000;
  readonly completedRuns: number;
  readonly unavailableRuns: number;
  readonly notRunRuns: number;
  readonly runSetSha256: string;
  readonly reportArtifactSha256: string;
};

export type ReleaseAuthorityReceiptV1 =
  | {
      readonly schema: "foreman.design-approval.v1";
      readonly program: "v040";
      readonly packageId: string;
      readonly designCommit: string;
      readonly designTree: string;
      readonly approvedOpenSpecSha256: string;
      readonly taskPlanSha256: string;
      readonly approvalStatementSha256: string;
      readonly issuedAt: string;
    }
  | {
      readonly schema: "foreman.checks-evidence.v1";
      readonly program: "v040";
      readonly packageId: string;
      readonly candidate: ReleaseCandidateIdentityV1;
      readonly status: "PASS" | "FAIL";
      readonly checksSha256: string;
      readonly issuedAt: string;
    }
  | {
      readonly schema: "foreman.release-audit.v1";
      readonly program: "v040";
      readonly packageId: string;
      readonly candidate: ReleaseCandidateIdentityV1;
      readonly verdict: "APPROVED" | "WARNING" | "BLOCKED" | "UNVERIFIED";
      readonly findings: readonly ReleaseAuditFindingV1[];
      readonly evidenceSha256: string;
      readonly issuedAt: string;
    }
  | {
      readonly schema: "foreman.council-request.v1";
      readonly program: "v040";
      readonly packageId: string;
      readonly candidateSha256: string;
      readonly questionSha256: string;
      readonly constraintsSha256: string;
      readonly optionsSha256: string;
      readonly issuedAt: string;
    }
  | {
      readonly schema: "foreman.evaluation-authority.v1";
      readonly program: "v040";
      readonly packageId: "graph-eval-falsification";
      readonly manifestSha256: string;
      readonly issuedAt: string;
    };

export type ReleaseActionOutcomeV1 = {
  readonly schema: "foreman.release-action-outcome.v1";
  readonly program: "v040";
  readonly rootContractId: string;
  readonly rootContractSha256: string;
  readonly familySha256: string;
  readonly childId: string;
  readonly packageId: string;
  readonly reservationAction: ReleaseActionV1;
  readonly effectiveAction: ReleaseActionV1;
  readonly reservationId: string;
  readonly originReservationId: string;
  readonly candidateSha256: string;
  readonly status: "PASS" | "BLOCKING" | "EXTERNAL_FAILURE";
  readonly evidenceSha256: string;
  readonly issuedAt: string;
};

export type ReleaseCouncilOutcomeV1 = {
  readonly schema: "foreman.council-outcome.v1";
  readonly program: "v040";
  readonly rootContractId: string;
  readonly rootContractSha256: string;
  readonly familySha256: string;
  readonly childId: string;
  readonly packageId: string;
  readonly reservationAction: "council" | "provider_retry" | "resume";
  readonly reservationId: string;
  readonly originReservationId: string;
  readonly candidateSha256: string;
  readonly requestSha256: string;
  readonly decisionSha256: string;
  readonly status: "ADVICE" | "BLOCKING";
  readonly issuedAt: string;
};

export type ReleaseEvaluationVerdictV1 = {
  readonly schema: "foreman.evaluation-verdict.v1";
  readonly program: "v040";
  readonly rootContractId: string;
  readonly rootContractSha256: string;
  readonly familySha256: string;
  readonly childId: "v040-t8-evaluation";
  readonly packageId: "graph-eval-falsification";
  readonly candidateSha256: string;
  readonly authorityManifestSha256: string;
  readonly evaluationAuthorityReceiptSha256: string;
  readonly result:
    | "PROMOTE"
    | "GRAPH_OFF_FAILED"
    | "GRAPH_OFF_INCONCLUSIVE"
    | "GRAPH_OFF_UNCOMPUTABLE";
  readonly plannedRuns: 2000;
  readonly completedRuns: number;
  readonly unavailableRuns: number;
  readonly notRunRuns: number;
  readonly runSetSha256: string;
  readonly reportSha256: string;
  readonly issuedAt: string;
};

export type ExecutionChildTerminalApprovalV1 =
  | {
      readonly schema: "foreman.execution-child-cancel.v1";
      readonly program: "v040";
      readonly rootContractId: string;
      readonly rootContractSha256: string;
      readonly familySha256: string;
      readonly childId: string;
      readonly reasonSha256: string;
      readonly issuedAt: string;
    }
  | {
      readonly schema: "foreman.execution-child-invalidate.v1";
      readonly program: "v040";
      readonly rootContractId: string;
      readonly rootContractSha256: string;
      readonly familySha256: string;
      readonly childId: string;
      readonly observedFamilySha256: string;
      readonly reasonSha256: string;
      readonly issuedAt: string;
    };

export type RegisteredReleaseAuthorityV1 = {
  readonly rootContractId: string;
  readonly rootContractSha256: string;
  readonly familySha256: string;
  readonly childId: string;
  readonly action: ReleaseActionV1;
  readonly effectiveAction: ReleaseActionV1;
  readonly priorReservationId: string | null;
  readonly originReservationId: string | null;
  readonly candidate: ReleaseCandidateIdentityV1;
  readonly taskPlanSha256: string;
  readonly bundleSha256: string;
  readonly receiptSchemas: readonly ReleaseAuthorityReceiptV1["schema"][];
  readonly receiptSha256s: readonly string[];
  readonly evaluationManifestSha256: string | null;
  readonly registeredAt: string;
};

export type RegisteredReleaseOutcomeV1 = {
  readonly rootContractId: string;
  readonly rootContractSha256: string;
  readonly familySha256: string;
  readonly childId: string;
  readonly reservationId: string;
  readonly originReservationId: string;
  readonly reservationAction: ReleaseActionV1;
  readonly effectiveAction: ReleaseActionV1;
  readonly candidateSha256: string;
  readonly outcomeSha256: string;
  readonly outcomeSchema:
    | ReleaseActionOutcomeV1["schema"]
    | ReleaseCouncilOutcomeV1["schema"];
  readonly registeredAt: string;
};

export type RegisteredEvaluationVerdictV1 = {
  readonly rootContractId: string;
  readonly rootContractSha256: string;
  readonly familySha256: string;
  readonly childId: "v040-t8-evaluation";
  readonly candidateSha256: string;
  readonly result: ReleaseEvaluationVerdictV1["result"];
  readonly completedRuns: number;
  readonly unavailableRuns: number;
  readonly notRunRuns: number;
  readonly runSetSha256: string;
  readonly evaluationAuthorityReceiptSha256: string;
  readonly verdictSha256: string;
  readonly registeredAt: string;
};

export type FailedReservationAuthorityV1 = {
  readonly reservationId: string;
  readonly originReservationId: string;
  readonly originalAction: ReleaseActionV1;
  readonly candidate: ReleaseCandidateIdentityV1;
  readonly failureEvidenceSha256: string;
};

export type ReleaseEvidenceBundleV1 = {
  readonly schema: "foreman.release-evidence-bundle.v1";
  readonly program: "v040";
  readonly rootContractId: string;
  readonly rootContractSha256: string;
  readonly familySha256: string;
  readonly childId: string;
  readonly packageId: string;
  readonly action: ReleaseActionV1;
  readonly candidate: ReleaseCandidateIdentityV1;
  readonly taskPlanSha256: string;
  readonly receipts: readonly ReleaseAuthorityReceiptV1[];
  readonly priorReservation?: FailedReservationAuthorityV1;
  readonly issuedAt: string;
};

export type ApprovedOpenSpecManifestV1 = {
  readonly schema: "foreman.approved-openspec.v1";
  readonly files: readonly {
    readonly path: string;
    readonly sha256: string;
  }[];
};
```

The approved OpenSpec digest is
`sha256Hex(canonicalize(ApprovedOpenSpecManifestV1))`. The manifest contains
exactly `proposal.md`, every `specs/**/*.md` path, and optional `design.md`.
Paths are package-relative and sorted as UTF-8 bytes. Each row contains the
SHA-256 digest of the exact file bytes. The manifest excludes `tasks.md`.
OpenSpec unlocks that artifact only after the design artifact is ready. The
canonical design-approval receipt is recorded after the task plan exists in one
implementation-base commit. It binds the manifest digest, task-plan digest,
implementation-base commit, and implementation-base tree. A bounded package
has no design path. Duplicate, absolute, escaping, unsorted, missing, or extra
paths refuse.

Checks, audit, and evaluation-report sources use their exact types above and
the same canonical JSON plus LF rule. A checks source contains 1..256 commands.
Each exit code is a safe integer from 0 through 255. Receipt `checksSha256` is
the digest of the complete checks-source bytes, and the receipt copies its
status. Audit receipt `evidenceSha256` is the digest of the complete audit-source
bytes, and the receipt copies its verdict and findings. A family audit accepts
only an audit source for the Track 1 candidate with `APPROVED` and no findings.
Evaluation verdict `reportSha256` is the digest of the complete report-source
bytes, and the canonical verdict copies every result and count field. The report
counts are safe integers from 0 through 2,000 and sum to `plannedRuns`.

`receiptSha256s` contains the complete canonical file digest of each nested
receipt in its exact order. For evaluation, `evaluationManifestSha256` equals
the canonical evaluation-authority receipt field. It is null for every other
action. Council and evaluation outcome registration match these journaled
digests and never depend on an unjournaled bundle file.

The host-only `release-authority` artifact validates source artifacts and
creates canonical receipts and a canonical evidence bundle. It
appends the bundle's exact digest as a child-authority event in the existing
root Endstop `RunJournal` before use. No child journal or stream exists. The
append binds family digest, child ID, action, complete candidate identity,
bundle digest, ordered receipt digests and schemas, plan digest, retry
provenance, and timestamp. SessionDB records the same digest for each human
design approval. Queue and gate callers cannot supply expected digests.

Admission is action-specific:

| Action | Required registered authority |
|---|---|
| `implement` | current design approval, exact task-plan digest, and either its exact base identity or the journal's exact current linear descendant |
| `verify` | design approval and frozen candidate identity |
| `audit` | design approval and checks evidence for that candidate |
| `correct` | failed checks or `WARNING`, `BLOCKED`, or `UNVERIFIED` audit for that candidate |
| `council` | council request that predates reservation |
| `provider_retry`, `resume` | recorded failed reservation and the original action authority |
| `integrate`, `publish` | matching `APPROVED` audit with zero findings and current design approval |
| `evaluate` | locked-evaluation authority and the Tranche 8 child |

Bundle receipt order is exact: implementation and verification contain
`[design]`; audit contains `[design, checks(PASS)]`; correction contains
`[design, checks(FAIL)]` or `[design, audit(blocking)]`; council contains
`[design, council-request]`; integration and publication contain
`[design, audit(APPROVED)]`; and evaluation contains `[design, evaluation]`.
Retry and resume use the original array plus one `priorReservation` object. A
completed council call produces a canonical council outcome that binds the exact
request digest, candidate, root, family, child, and spent council reservation.
The outcome cannot authorize its own reservation. The host registers its exact
digest in the root journal before a child mutation. A blocking outcome is then
recorded with `child-record-blocking`. Premature, forged, unregistered,
wrong-reservation, and wrong-candidate outcomes refuse. Nonblocking advice
remains content-addressed in the root journal and linked from SessionDB.

```ts
export type ReleaseAdmissionFailureReason =
  | "invalid_evidence"
  | "wrong_program"
  | "wrong_package"
  | "wrong_action"
  | "wrong_candidate"
  | "wrong_design_base"
  | "approved_openspec_mismatch"
  | "task_plan_mismatch"
  | "missing_registration"
  | "registration_mismatch"
  | "invalid_retry"
  | "git_resolution_failure";

export type ReleaseEvidenceCheckResultV1 =
  | { readonly schemaVersion: 1; readonly _tag: "EvidenceValid" }
  | { readonly schemaVersion: 1; readonly _tag: "EvidenceInvalid"; readonly reason: ReleaseAdmissionFailureReason };

export type ReleaseAdmissionResultV1 =
  | { readonly schemaVersion: 1; readonly _tag: "Admitted" }
  | { readonly schemaVersion: 1; readonly _tag: "Refused"; readonly reason: ReleaseAdmissionFailureReason };

export type ReleaseEvidenceInputV1 = {
  readonly action: ReleaseActionV1;
  readonly packageId: string;
  readonly candidate: ReleaseCandidateIdentityV1;
  readonly approvedOpenSpecBytes: Readonly<Record<string, Uint8Array>>;
  readonly taskPlanBytes: Uint8Array;
  readonly evidenceBytes: Uint8Array;
};

export function evaluateReleaseEvidenceV1(
  input: ReleaseEvidenceInputV1,
): ReleaseEvidenceCheckResultV1;

export function evaluateReleaseAdmissionV1(input: ReleaseEvidenceInputV1 & {
  readonly registered: RegisteredReleaseAuthorityV1;
}): ReleaseAdmissionResultV1;
```

Every evidence or admission refusal maps to one listed reason. Decoder failures
that could disclose input values collapse to `invalid_evidence`. Invalid CLI
syntax is separate and returns exit 64.

The standalone CLI form is exactly:

```text
release-admission check --program v040 --action ACTION --package PACKAGE --repo ABS --candidate-commit SHA40 --evidence ABS
```

The standalone admission CLI resolves `CANDIDATE_COMMIT^{commit}` and
`CANDIDATE_COMMIT^{tree}` in `REPO`; it never uses caller `HEAD`. It returns only `EvidenceValid` or
`EvidenceInvalid`. It is a non-authorizing bundle and identity verifier because
its interface has no Endstop identity. Only the production `release-policy`
composition may return `Admitted`. It obtains the expected receipt digest from
Endstop by root, family, and child identity and calls
`evaluateReleaseAdmissionV1`. No boundary treats standalone success as
permission. No input can substitute another Git object, authority object, receipt
digest, or package approval.

After it verifies the outer evidence schema, the standalone and composed
boundaries obtain the design receipt's `designCommit`. They resolve that commit
and its tree in `REPO`, require exact `designTree` equality, and read the
approved package only from Git blobs below
`openspec/changes/<packageId>/` in that commit. They reconstruct the approved
manifest from `proposal.md`, optional `design.md`, and every `specs/**/*.md`
under the closed manifest rules. They read `tasks.md` from the same commit and
verify its digest. Each blob is at most 1 MiB, there are at most 256 spec blobs,
and the total retained package input is at most 16 MiB. The Git service uses
fixed argument arrays, no checkout, no shell, and no hooks. It never reads these
preimages from the candidate tree, worktree, caller paths, or mutable `HEAD`.
`issue-design`, bundle creation, standalone verification, and composed policy
use this one loader. The pure `approvedOpenSpecBytes` and `taskPlanBytes` inputs
are its verified outputs, not public CLI inputs.

Every implementation bundle carries the same design approval and exact
task-plan digest. For a child's first `implement`, the resolved candidate must
equal the receipt's post-plan implementation-base commit and tree. For each
later `implement`, the composed policy requires the resolved candidate to equal
the child's complete current journaled Git identity. The current identity must
be in the direct-parent lineage that starts at the approved base. Standalone
evidence verification checks the approved identity and that the candidate is a
descendant of the approved base, but only the composed policy can check the exact
current journal state. A retry or resume uses the unchanged identity from its
origin reservation. The task-plan bytes always equal the receipt's
`taskPlanSha256`. The approval digest remains the immutable plan authority while
dependent implementation tasks advance one committed candidate at a time.

### The V2 family extends the V1 journal instead of replacing it

`ExecutionContractFamilyV2` is a closed canonical manifest. Its eight children
are sorted by tranche and have unique IDs and package IDs. Child dependencies
must refer to an earlier listed child. Standard children use only the V1 action
kinds. The evaluation child also defines `evaluate`.

```ts
export type ExecutionChildBriefV1 = {
  readonly schema: "foreman.execution-child-brief.v1";
  readonly childId: string;
  readonly tranche: 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  readonly packageId: string;
  readonly dependencyChildIds: readonly string[];
  readonly objective: string;
  readonly acceptance: readonly string[];
  readonly allowedPaths: readonly string[];
};

export type ExecutionFamilySourceV1 = {
  readonly schema: "foreman.execution-family-source.v1";
  readonly program: "v040";
  readonly familyId: "v040-release-20260822-f1";
  readonly children: readonly ExecutionChildBriefV1[];
};

export type StandardChildLimitsV2 = {
  readonly kind: "standard";
  readonly implementationRounds: 30;
  readonly correctionRounds: 20;
  readonly auditRounds: 20;
  readonly councilRounds: 10;
  readonly providerRetries: 10;
  readonly resumeAttempts: 10;
  readonly verificationRunsPerCandidate: 5;
  readonly totalActions: 100;
  readonly wallTimeMs: 1209600000;
  readonly noProductChangeMs: 259200000;
};

export type EvaluationChildLimitsV2 = {
  readonly kind: "evaluation";
  readonly implementationRounds: 10;
  readonly correctionRounds: 5;
  readonly auditRounds: 10;
  readonly councilRounds: 5;
  readonly providerRetries: 8;
  readonly resumeAttempts: 5;
  readonly verificationRunsPerCandidate: 3;
  readonly evaluationRuns: 2000;
  readonly totalActions: 2048;
  readonly wallTimeMs: 3888000000;
  readonly noProgressMs: 3600000;
};

export type ExecutionChildLimitsV2 =
  | StandardChildLimitsV2
  | EvaluationChildLimitsV2;

export type ExecutionChildContractV2 = {
  readonly childId: string; // 1..128 bytes, decodeRunId grammar
  readonly tranche: 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  readonly packageId: string; // 1..128 bytes, decodeRunId grammar
  readonly objectiveSha256: string;
  readonly acceptanceSha256: string;
  readonly allowedPathsSha256: string;
  readonly dependencyChildIds: readonly string[];
  readonly deadlineAt: string;
  readonly limits: ExecutionChildLimitsV2;
  readonly requiredMilestones: readonly ExecutionMilestone[];
};

export type ExecutionContractFamilyV2 = {
  readonly schemaVersion: 2;
  readonly familyId: "v040-release-20260822-f1";
  readonly rootContractId: string;
  readonly rootContractSha256: string;
  readonly track1Commit: string;
  readonly track1Tree: string;
  readonly sourceSha256: string;
  readonly createdAt: string;
  readonly deadlineAt: string;
  readonly wallTimeMs: 5184000000;
  readonly totalActions: 4096;
  readonly children: readonly ExecutionChildContractV2[];
};

export type ExecutionFamilyAuditReceiptV1 = {
  readonly schema: "foreman.execution-family-audit.v1";
  readonly program: "v040";
  readonly familyId: string;
  readonly manifestSha256: string;
  readonly track1Commit: string;
  readonly track1Tree: string;
  readonly verdict: "APPROVED";
  readonly findings: readonly [];
  readonly evidenceSha256: string;
  readonly issuedAt: string;
};

export type ExecutionFamilyUserApprovalV1 = {
  readonly schema: "foreman.execution-family-user-approval.v1";
  readonly program: "v040";
  readonly familyId: string;
  readonly manifestSha256: string;
  readonly track1Commit: string;
  readonly track1Tree: string;
  readonly approvalStatementSha256: string;
  readonly issuedAt: string;
};
```

The family builder accepts one canonical `ExecutionFamilySourceV1` file. It
writes the manifest to `--out`, the canonical source bytes to the distinct
`--source-out` path, and eight package briefs to the distinct `--briefs-out`
directory. A brief filename is exactly `<packageId>.json`. Each output uses a
temporary file, file fsync, atomic replacement, and parent-directory fsync.
Partial builder output has no authority because registration verifies the
complete set. Existing output files are replaced. A file-directory collision,
overlapping output path, or unexpected entry in the brief output directory
refuses before any replacement.
Each objective is 1..16,384 UTF-8 bytes, permits LF, and rejects CR and other
control characters. Each acceptance array contains 1..256 nonempty items of at
most 4,096 UTF-8 bytes. Each allowed-path array contains 1..256 unique sorted
printable-ASCII paths. A path is a normalized repository-relative path or a
directory prefix with one terminal `/**`. Absolute paths, dot segments,
backslashes, and other glob syntax refuse. A plain path matches only that exact
UTF-8 byte sequence. `P/**` matches a changed path only when it starts with
`P/` and contains at least one byte after the slash. Matching is case-sensitive
and does not normalize Git output.

The manifest `sourceSha256` is the SHA-256 of the complete canonical family-
source file bytes. The builder derives each component digest from canonical
JSON plus one LF. The
objective preimage has schema `foreman.execution-child-objective.v1`, child ID,
and objective. The acceptance preimage has schema
`foreman.execution-child-acceptance.v1`, child ID, and acceptance array. The
allowed-path preimage has schema `foreman.execution-child-paths.v1`, child ID,
and allowed-path array. Each generated `ReleasePackageBriefV1` contains the
family digest and the complete child identity, objective, acceptance, and
allowed-path values. Future package creation copies those exact canonical bytes
to `openspec/changes/<packageId>/release-brief.json`. Lane and release coverage
compare the package artifact with the registered source-derived brief. A later
package cannot replace or reinterpret it.

The family uses `sha256Hex(canonicalize(decodedManifest))`. Its file is exactly
that canonical JSON plus one LF. All digests are lowercase 64-digit SHA-256;
Git commits are lowercase 40-digit object IDs; timestamps are UTC seconds; and
unknown fields, duplicate keys, coercions, out-of-range integers, and
non-canonical bytes refuse.

The live family builder obtains `createdAt` from its host clock. Only tests can
inject that clock. The family
`deadlineAt` is exactly `createdAt + 5184000000` milliseconds. Every child
`deadlineAt` equals that family value. The effective child deadline is the
earlier of its first-accepted-action wall limit and the absolute family
deadline. Family creation fails on timestamp overflow or non-UTC-second input.
Activation requires `createdAt <= activatedAt` and `createdAt` before the V1
root deadline. Replay binds the checked timestamps. A future timestamp refuses.

Children use these exact identities and earlier-only dependencies:

| Tranche | Child ID | Package ID | Dependencies |
|---:|---|---|---|
| 2 | `v040-t2-project-registry` | `project-registry` | none |
| 3 | `v040-t3-memory-index` | `external-memory-index` | Tranche 2 |
| 4 | `v040-t4-appliance` | `hermetic-foreman-appliance` | none |
| 5 | `v040-t5-graphify` | `knowledge-plane-refresh` | none |
| 6 | `v040-t6-work-dag` | `work-dag-projection` | Tranche 5 |
| 7 | `v040-t7-context` | `graph-context-builder` | Tranche 6 |
| 8 | `v040-t8-evaluation` | `graph-eval-falsification` | Tranches 3, 4, and 7 |
| 9 | `v040-t9-release` | `v040-release-program` | Tranches 2 through 8 |

Every standard child has `kind="standard"` and exact limits
`implementationRounds=30`,
`correctionRounds=20`, `auditRounds=20`, `councilRounds=10`,
`providerRetries=10`, `resumeAttempts=10`,
`verificationRunsPerCandidate=5`, `totalActions=100`,
`wallTimeMs=1209600000`, and `noProductChangeMs=259200000`.
Tranche 8 has `kind="evaluation"`, `implementationRounds=10`,
`correctionRounds=5`,
`auditRounds=10`, `councilRounds=5`, `providerRetries=8`,
`resumeAttempts=5`, `verificationRunsPerCandidate=3`,
`evaluationRuns=2000`, `totalActions=2048`,
`wallTimeMs=3888000000`, and `noProgressMs=3600000`. The evaluation child does
not contain `noProductChangeMs`; `noProgressMs` replaces that timer for all
evaluation-child activity. The decoder requires standard limits when tranche
is not 8 and evaluation limits when tranche is 8. Every child wall-time counter
starts at its first accepted action, including a pre-evaluation action. Before
that event, dependency wait consumes only the family deadline. Tranche 8 sets
`lastProgressAt` at its first accepted action. Only `ProductChanged`,
`MilestoneRecorded`, or registration of a matching `PASS` action outcome
resets it. Reservation, retry, resume, advice, blocking, and failure events do
not reset progress. An action at or after either exact time boundary refuses
and records `BudgetExhausted`. Every absolute child deadline equals the family
deadline.

After these manifest bytes exist, `ExecutionFamilyAuditReceiptV1` and
`ExecutionFamilyUserApprovalV1` each contain schema, program, family ID,
manifest digest, Track 1 commit and tree, and issue time. The audit receipt also
contains verdict `APPROVED`, an empty finding array, and evidence digest. Before
activation, `register-family-authority` verifies both canonical receipt digests,
the source, and all eight
generated package briefs. It durably copies the canonical source and brief set
to `<state-root>/release-families/<familySha256>/source.json` and
`<state-root>/release-families/<familySha256>/briefs/<packageId>.json` before it
atomically appends one root authority event. It creates a complete temporary
directory, fsyncs its files and directories, and renames it once. An identical
existing directory is reusable. A missing, extra, malformed, or conflicting
entry refuses. A crash before append can leave only an unreferenced directory.
The activation event requires that exact event and contains
the same manifest, source, and receipt digests. The
manifest cannot contain either receipt digest because that would create a
self-referential hash cycle.

Family authority registration is first-write-wins by `rootContractId`. The
first write stores the family, manifest, source, audit-receipt, and user-receipt
digests. An exact replay returns the existing public state and appends nothing.
A different family, manifest, source, or receipt digest for that root refuses and
appends nothing. Concurrent registrations have one winner. An identical loser
is idempotent and a conflicting loser is refused.

The V2 root-journal payload union is exact:

```ts
export type ExecutionV2ChildOperationV1 =
  | {
      readonly _tag: "ReserveAction";
      readonly reservationId: string;
      readonly reservationAction: ReleaseActionV1;
      readonly effectiveAction: ReleaseActionV1;
      readonly originReservationId: string;
      readonly candidate: ReleaseCandidateIdentityV1;
      readonly taskPlanSha256: string;
      readonly authorityBundleSha256: string;
    }
  | {
      readonly _tag: "RecordProductChange";
      readonly reservationId: string;
      readonly originReservationId: string;
      readonly baseCandidate: ReleaseCandidateIdentityV1;
      readonly candidate: ReleaseCandidateIdentityV1;
      readonly allowedPathsSha256: string;
    }
  | {
      readonly _tag: "RecordMilestone";
      readonly milestone: ExecutionMilestone;
      readonly outcomeSha256: string;
      readonly reservationId: string;
      readonly originReservationId: string;
      readonly candidateSha256: string;
    }
  | {
      readonly _tag: "RecordBlockingOutcome" | "RecordExternalFailure";
      readonly outcomeSha256: string;
      readonly reservationId: string;
      readonly originReservationId: string;
      readonly candidateSha256: string;
    }
  | {
      readonly _tag: "Cancel";
      readonly approvalSha256: string;
      readonly reasonSha256: string;
    }
  | {
      readonly _tag: "Invalidate";
      readonly approvalSha256: string;
      readonly observedFamilySha256: string;
      readonly reasonSha256: string;
    };

export type ExecutionV2Event =
  | (Omit<Extract<ExecutionEvent, { readonly _tag: "ActionReserved" }>, "action"> & {
      readonly action: ReleaseActionV1;
    })
  | Exclude<ExecutionEvent, { readonly _tag: "ActionReserved" }>;

export type ExecutionV2JournalPayload =
  | {
      readonly _tag: "ExecutionFamilyAuthorityRegistered";
      readonly rootContractId: string;
      readonly rootContractSha256: string;
      readonly familySha256: string;
      readonly sourceSha256: string;
      readonly auditReceiptSha256: string;
      readonly userReceiptSha256: string;
      readonly registeredAt: string;
    }
  | {
      readonly _tag: "EndstopFamilyActivated";
      readonly familySha256: string;
      readonly sourceSha256: string;
      readonly auditReceiptSha256: string;
      readonly userReceiptSha256: string;
      readonly activatedAt: string;
    }
  | ({ readonly _tag: "ExecutionChildAuthorityRegistered" } &
      RegisteredReleaseAuthorityV1)
  | ({ readonly _tag: "ExecutionChildOutcomeRegistered" } &
      RegisteredReleaseOutcomeV1)
  | ({ readonly _tag: "ExecutionEvaluationVerdictRegistered" } &
      RegisteredEvaluationVerdictV1)
  | {
      readonly _tag: "EndstopChildDecision";
      readonly familySha256: string;
      readonly childId: string;
      readonly operation: ExecutionV2ChildOperationV1;
      readonly events: readonly ExecutionV2Event[];
    };
```

Replay requires the V1 contract first. Zero or more V1 decisions may follow
until one family-authority event. Exactly one matching activation may follow
that authority event. After activation, child-authority, child-outcome,
evaluation-verdict, and child-decision events may interleave. Each authority event must precede the
matching `ActionReserved`. Each outcome event must follow its exact reservation.
A child operation that references an outcome must follow its registration.
Advice and a matching `PASS` evaluation outcome require no later child
operation. An unused registered outcome is valid history. The operation and
its `ExecutionV2Event` array must describe the same accepted state transition.
An evaluation verdict must follow every run and outcome that contributes to
its run-set digest. It must precede Tranche 8 completion.
Unscoped V1 decisions, a second family event, unknown tags, wrong ordering,
torn payloads, and identity mismatches are corrupt history and fail closed.
Registration replay never creates a second event.

Activation is one `EndstopFamilyActivated` event in the root journal. Replay
requires the original V1 contract event first, permits exactly one family
event, and derives the family count from all V1 and child action reservations.
After activation, the root refuses new unscoped V1 reservations. Existing V1
status remains readable.

`ExecutionV2Event` reuses every V1 non-reservation event byte-for-byte. It
widens only `ActionReserved.action` to `ReleaseActionV1`, so Tranche 8 can store
`evaluate` without changing the V1 `ExecutionActionKind`, `ExecutionEvent`,
counts, decoder, or exported behavior.

Each child reservation is one `EndstopChildDecision` event that carries the
family digest, child ID, and V2 decision events. The transaction replays root,
family, and child state, evaluates dependencies and both budgets, and appends
at most one event. A failed append starts no provider. Unknown crash outcomes
remain spent because reservation precedes dispatch.

The child command union contains `ReserveAction`, `RecordProductChange`,
`RecordMilestone`, `RecordBlockingOutcome`, `RecordExternalFailure`, `Cancel`,
and `Invalidate`. A child completes when its exact required milestones for one
candidate are present. Tranches 2 through 8 require `checks`, `audit`, and
`integrated`; Tranche 9 also requires `published`. The CLI exposes one strict
command for each union member. Therefore a completed predecessor is reachable
and dependency release does not depend on an unplanned caller.

Tranche 8 has one additional completion predicate. It requires one registered
`ReleaseEvaluationVerdictV1` for the current candidate. `PROMOTE`,
`GRAPH_OFF_FAILED`, and `GRAPH_OFF_INCONCLUSIVE` require exactly 2,000 distinct
origin `evaluate` reservations with registered `PASS` outcomes. Retry and
resume may close an origin and do not create another run.
`GRAPH_OFF_UNCOMPUTABLE` permits fewer completed runs only when the registered
report identifies unavailable and unstarted runs without imputation. The three
counts must sum to 2,000. Registration recomputes the canonical sorted origin
and outcome set from the root journal and requires `runSetSha256` equality.
Only `PROMOTE` can enable graph context. Every other result completes Tranche 8
with graph context opt-in or off and permits the non-graph release to continue.

### One TypeScript artifact reaches queue, gate, and merge boundaries

`release-policy.sh`, `gate-eval.sh`, and `merge-gate.sh` become thin
compatibility adapters. Each locates Node, executes only
`dist/release-policy.js`, and forwards exact arguments, environment, status,
and byte streams. They do not source other scripts, parse domain data, read
configuration, inspect receipts, emit events, schedule work, or decide policy.
The compiled TypeScript artifact owns coverage, action admission, registered
authority, Git identity, Endstop lookup, the complete existing gate decision,
merge-base record and freshness behavior, event recording, and output
contracts. Effect owns its bounded file, subprocess, and event-log boundaries.

The installed TypeScript CLI has exactly these modes:

```text
release-policy check RELEASE_BLOCK
release-policy gate-eval TASK_ID RELEASE_BLOCK
release-policy merge-gate record RUN LANE
release-policy merge-gate check RUN LANE BRANCH RELEASE_BLOCK
```

The gate and merge modes preserve all current behavior after it is ported from
shell. `gate-eval` computes and records the complete general result first, then
runs v0.4 policy with non-caller-controlled expected action `integrate`.
`merge-gate check` performs freshness and named-branch checks first, then runs
policy with expected action `integrate`. Both refuse an otherwise valid block
whose action is `verify` or any other action. Publication calls the same core
with expected action `publish`. `merge-gate record` has no release block and
preserves the current V1 and V2 dispatch-time behavior.

The shared fixed release block is:

```text
--endstop-state-root ABS --endstop-contract-id ROOT_ID
--endstop-contract-sha ROOT_SHA --endstop-family-sha FAMILY_SHA
--endstop-child-id CHILD_ID --endstop-action ACTION
--endstop-candidate-sha SHA256 --release-program v040
--release-phase PHASE --release-owner PACKAGE --release-repo ABS
--release-candidate-commit SHA40 --release-register ABS
--release-evidence ABS
```

`PHASE` is `bootstrap`, `lane`, or `release`. The evidence path supplies bytes,
but Endstop supplies the only accepted digest. The TypeScript parser produces
one object for policy and reservation. It requires the root, family, child, and
action to match Endstop and the registered bundle, and it requires the package
to match the child. It also requires `endstop-candidate-sha` to equal SHA-256 of
the ASCII lowercase commit resolved from `release-candidate-commit`. For a
child's first implementation, the resolved identity equals the approved design
base. Each later implementation starts at the exact journaled current identity
and preserves the approved-base lineage and task-plan authority. In `check` mode,
`release-policy.sh` receives the 14 values as
positional arguments in the order shown by the block and adds only the static
`check` mode when it invokes the artifact.

The complete V2 queue grammar is:

```text
lane-queue.sh add GROUP RELEASE_BLOCK -- CMD [ARGS...]
```

`provider_retry` and `resume` add
`--endstop-prior-reservation-id ID` immediately after `GROUP`.
Queue admission invokes TypeScript release policy before one atomic child
reservation. The complete gate forms are `gate-eval.sh TASK_ID RELEASE_BLOCK`
and `merge-gate.sh check RUN LANE BRANCH RELEASE_BLOCK`. Merge resolves
`BRANCH^{commit}` and requires it to equal `--release-candidate-commit`; release
admission never inspects caller `HEAD`. Gate captures the policy result in its
decision evidence. Merge suppresses policy JSON from stdout and keeps exactly
one `MERGEABLE` or `NOT_MERGEABLE` line. The unchanged V1 bootstrap queue form
remains valid only before family activation. Adapter tests cover only literal
forwarding and byte preservation. TypeScript tests own every gate and merge
behavior case that the former Bats suites covered.

The host receipt producer forms are:

```text
release-authority build-family --program v040 --contract-id ROOT_ID --contract-sha ROOT_SHA --track1-repo ABS --track1-commit SHA40 --source ABS --out ABS --source-out ABS --briefs-out ABS
release-authority issue-design --program v040 --package PACKAGE --repo ABS --design-commit SHA40 --statement ABS --out ABS
release-authority issue-checks --program v040 --package PACKAGE --repo ABS --candidate-commit SHA40 --checks ABS --out ABS
release-authority issue-audit --program v040 --package PACKAGE --repo ABS --candidate-commit SHA40 --audit-verdict ABS --out ABS
release-authority issue-council-request --program v040 --package PACKAGE --candidate-sha SHA256 --question ABS --constraints ABS --options ABS --out ABS
release-authority issue-action-outcome --program v040 --contract-id ROOT_ID --contract-sha ROOT_SHA --family-sha FAMILY_SHA --child-id ID --package PACKAGE --reservation-action RESERVED_ACTION --effective-action EFFECTIVE_ACTION --reservation-id ID --origin-reservation-id ID --candidate-sha SHA256 --status OUTCOME_STATUS --evidence ABS --out ABS
release-authority issue-council-outcome --program v040 --contract-id ROOT_ID --contract-sha ROOT_SHA --family-sha FAMILY_SHA --child-id ID --package PACKAGE --reservation-action COUNCIL_RESERVATION_ACTION --reservation-id ID --origin-reservation-id ID --candidate-sha SHA256 --request ABS --decision ABS --status COUNCIL_STATUS --out ABS
release-authority issue-child-terminal --program v040 --contract-id ROOT_ID --contract-sha ROOT_SHA --family-sha FAMILY_SHA --child-id ID --terminal TERMINAL --reason ABS [--observed-family-sha SHA256] --out ABS
release-authority issue-evaluation --program v040 --manifest ABS --out ABS
release-authority issue-evaluation-verdict --program v040 --contract-id ROOT_ID --contract-sha ROOT_SHA --family-sha FAMILY_SHA --child-id v040-t8-evaluation --candidate-sha SHA256 --authority ABS --report ABS --out ABS
release-authority issue-family-audit --program v040 --manifest ABS --track1-repo ABS --track1-commit SHA40 --audit-verdict ABS --out ABS
release-authority issue-family-approval --program v040 --manifest ABS --track1-repo ABS --track1-commit SHA40 --statement ABS --out ABS
release-authority bundle --program v040 --contract-id ROOT_ID --contract-sha ROOT_SHA --family-sha FAMILY_SHA --child-id ID --package PACKAGE --action ACTION --repo ABS --candidate-commit SHA40 --receipt ABS [--receipt ABS] [--prior-reservation ABS] --out ABS
release-authority register --state-root ABS --contract-id ROOT_ID --contract-sha ROOT_SHA --family-sha SHA256 --child-id ID --action ACTION --evidence ABS
release-authority register-outcome --state-root ABS --contract-id ROOT_ID --contract-sha ROOT_SHA --family-sha SHA256 --child-id ID --outcome ABS
release-authority register-evaluation-verdict --state-root ABS --contract-id ROOT_ID --contract-sha ROOT_SHA --family-sha SHA256 --child-id v040-t8-evaluation --verdict ABS
```

`build-family` validates the exact child mapping, brief rules, Track 1 commit
and tree, digest preimages, and deadline formula. It writes the canonical
manifest, preserved source, and generated package briefs with the output
contract above. Issuance validates its source and writes by fsync plus atomic
replace. Register verifies the canonical bundle, candidate, and every receipt
digest before one root-journal
append. An ordinary child registration key is
`(familySha256, childId, action, candidateSha256, null)`. A `provider_retry` or
`resume` key replaces null with its exact `priorReservationId`. This permits
chained retries and retries of different effective actions on one candidate
without permitting two authorities for one attempt. The first valid digest for
each key wins.
Register requires the supplied root and family to exist, the child package to
equal the bundle package, and the CLI action to equal the bundle
action. It stores the complete candidate identity that the host-only bundle
command resolved. Release policy resolves that identity again before
reservation. Register also requires the caller root, root digest,
family, and child to equal the corresponding bundle fields.
An identical replay returns the existing state without an append. A different
digest or schema for the same key refuses without an append. Concurrent
registrations have one winner. An identical loser is idempotent and a
conflicting loser is refused. No release command accepts key material.

Bundle creation resolves the complete candidate commit, tree, and digest.
Ordinary authority registration stores `effectiveAction=action` and null prior
and origin IDs. Retry or resume registration stores the immediate prior ID,
the journal-derived first origin ID, and its first non-retry effective action.
Reservation converts an ordinary null origin to its new reservation ID. It
copies retry or resume provenance unchanged into the exact child operation.

`RESERVED_ACTION` is any `ReleaseActionV1`. For an ordinary reservation,
`EFFECTIVE_ACTION` equals `RESERVED_ACTION`, and the origin equals the current
reservation. For `provider_retry` or `resume`, the effective action and origin
must equal the recorded first non-retry reservation. The candidate remains
equal through the complete chain. Council retry and resume use the same origin
rule. `COUNCIL_RESERVATION_ACTION` is `council`, `provider_retry`, or `resume`.
`OUTCOME_STATUS` is `PASS`, `BLOCKING`, or `EXTERNAL_FAILURE`. `PASS` is valid
only when the effective action is verify, audit, integrate, publish, or
evaluate. `BLOCKING` is valid only when the effective action is verify, audit,
or evaluate. `EXTERNAL_FAILURE` is valid for every effective action.
`COUNCIL_STATUS` is `ADVICE` or `BLOCKING`. `TERMINAL` is `cancel` or
`invalidate`. Only invalidate accepts and requires `--observed-family-sha`.
Action-outcome and council-outcome issuance bind one existing reservation.
Outcome registration verifies that binding and is first-write-wins by
reservation ID. It rejects registration before reservation. It rejects a
different second outcome. It rejects a wrong root, family, child, package,
action, candidate, or request. An identical replay is
idempotent. Terminal approval binds the exact root, family, child, terminal,
and reason.

Evaluation-verdict registration is first-write-wins by family, child, and
candidate. It verifies the evaluation-authority manifest, exact registered
evaluation-authority receipt digest, report digest, counts,
result, and journal-derived run-set digest. Both authority values must equal
the journaled evaluate authority. An identical
replay is idempotent. A different verdict or any graph-promotion result with a
missing run refuses without an append.

Family control uses these fixed forms:

```text
execution-guard register-family-authority --state-root ABS --contract-id ROOT_ID --contract-sha ROOT_SHA --manifest ABS --source ABS --briefs ABS --audit-receipt ABS --user-receipt ABS
execution-guard activate-family --state-root ABS --contract-id ROOT_ID --contract-sha ROOT_SHA --manifest ABS
execution-guard family-status --state-root ABS --contract-id ROOT_ID --contract-sha ROOT_SHA --family-sha SHA256
execution-guard child-status --state-root ABS --contract-id ROOT_ID --contract-sha ROOT_SHA --family-sha SHA256 --child-id ID
```

Registration verifies the source, generated briefs, and canonical receipts. It
publishes the content-addressed source set, then appends the four expected
digests. Activation reads the bounded caller manifest and the registered source
set from Endstop state, recomputes every digest, and accepts only the exact prior
authority event. It does not accept caller source or receipt paths.
Status commands are read-only. Every command resolves and verifies the same
root contract ID and digest before it reads or mutates family state.

Child lifecycle uses these fixed `execution-guard` forms:

```text
execution-guard child-record-product-change --state-root ABS --contract-id ROOT_ID --contract-sha ROOT_SHA --family-sha SHA256 --child-id ID --reservation-id ID --repo ABS --candidate-commit SHA40
execution-guard child-record-milestone --state-root ABS --contract-id ROOT_ID --contract-sha ROOT_SHA --family-sha SHA256 --child-id ID --milestone MILESTONE --outcome ABS
execution-guard child-record-blocking --state-root ABS --contract-id ROOT_ID --contract-sha ROOT_SHA --family-sha SHA256 --child-id ID --outcome ABS
execution-guard child-record-external-failure --state-root ABS --contract-id ROOT_ID --contract-sha ROOT_SHA --family-sha SHA256 --child-id ID --outcome ABS
execution-guard child-cancel --state-root ABS --contract-id ROOT_ID --contract-sha ROOT_SHA --family-sha SHA256 --child-id ID --approval ABS
execution-guard child-invalidate --state-root ABS --contract-id ROOT_ID --contract-sha ROOT_SHA --family-sha SHA256 --child-id ID --approval ABS
```

`MILESTONE` is `checks`, `audit`, `integrated`, or `published`. Product change
requires an implement-or-correct-effective reservation. This includes a retry
or resume bound to such an origin. Each reservation accepts one result. The
command resolves the output commit and tree in the named repository and derives
the candidate digest. The reservation stores its complete base identity. The
output must differ from that base and have the base commit as its sole first
parent. The command loads the registered content-addressed family source from
Endstop state, rederives the child's allowed-path digest, and requires it to
equal the manifest. It obtains every changed path from the base-to-output Git
diff with `git -c core.hooksPath=/dev/null diff --name-status -z --no-renames
--no-ext-diff --no-textconv BASE OUTPUT --`. It parses the NUL-delimited status and path fields without a
shell and rejects an absolute, escaping, unparsable, or
out-of-contract path. No caller supplies a candidate or allowed-path digest.
Identical result replay is idempotent. An unrelated commit, merge commit,
missing source, mismatched source digest, or different result refuses. The
first product change sets the current complete candidate identity. A different
later product change advances the direct-parent lineage and clears all
candidate milestones.

Milestones require product change and matching registered `PASS` outcomes in
this order: `verify -> checks`, `audit -> audit`, `integrate -> integrated`, and
`publish -> published`. Each must match the current candidate. A duplicate with
the same outcome is idempotent. A different or out-of-order outcome refuses.
The outcome effective action controls this mapping, including retry and resume.
Blocking requires a registered `BLOCKING` verify or audit outcome, or a
registered `BLOCKING` council outcome. Cancellation and invalidation require
the matching user-approval digest. External failure requires a registered
`EXTERNAL_FAILURE` outcome for the exact reservation. Completion occurs only when one current
candidate has the exact required ordered milestones. A child terminal state
does not reset a sibling. Every mutation is one root-journal transaction. The
journal stores the exact `ExecutionV2ChildOperationV1` with the accepted
`ExecutionV2Event` array. Replay verifies the reservation, origin, outcome or
approval digest, candidate, and operation-specific fields before it applies
the events. A mismatch is corrupt history and fails closed.

### Installed runtime inventory is exact

The runtime builder adds four entry points: `release-coverage`,
`release-admission`, `release-authority`, and `release-policy`. The manifest
decoder and verifier require all four relative paths. The verifier compares two clean builds, each
artifact with tracked bytes, and the sorted `dist` inventory. Copied-install
tests remove or change each artifact and also remove one artifact plus its
manifest row. Every mutation must refuse.

## Risks and trade-offs

- A strict register parser accepts less TOML than a general parser. This is
  intentional; the authored schema uses only strings, integers, and repeated
  tables.
- Root-journal family state increases replay work. The 4,096-action bound keeps
  replay finite, and one transaction remains the authority boundary.
- Release admission depends on external receipt files. The files remain
  outside worker worktrees and are content-addressed in SessionDB and Endstop
  evidence.
- Existing mutable audit policy remains for non-v0.4 work. The new adapter is
  additive and is mandatory only for the v0.4 family.

## Migration plan

1. Build and audit the complete Track 1 candidate under the V1 root.
2. Fast-forward the Track 1 commit onto the release branch.
3. Generate the eight-child family manifest from that exact commit and tree.
4. Obtain exact-byte independent audit and user approval receipts.
5. Activate the family once in the existing root journal.
6. Run all later v0.4 actions through their immutable child contracts.

Rollback before activation is branch reset or candidate rejection. After
activation, the family is immutable. A bad activation terminates the release;
it is not replaced in place.
