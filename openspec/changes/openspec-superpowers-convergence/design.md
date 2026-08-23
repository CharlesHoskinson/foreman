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

export function validateReleaseCoverageV1(input: {
  readonly phase: ReleaseCoveragePhaseV1;
  readonly registerText: string;
  readonly roadmapBytes: Uint8Array;
  readonly activeChangeNames: readonly string[];
  readonly roadmapRows: readonly RoadmapAssignmentV1[];
  readonly workflowByChange: Readonly<Record<string, string | null>>;
  readonly changedSuperpowersPaths: readonly string[];
}): ReleaseCoverageResultV1;
```

The CLI has exactly these forms:

```text
release-coverage check --program v040 --phase bootstrap --owner openspec-superpowers-convergence --register ABS
release-coverage check --program v040 --phase lane --owner PACKAGE --register ABS
release-coverage check --program v040 --phase release --register ABS
```

All phases validate the full schema, active inventory, Roadmap, and digests.
Bootstrap requires Track 1 reconciliation and workflow metadata. Lane requires
every v0.4 entry owned by `PACKAGE` to be reconciled. Release requires zero
v0.4 `required` entries and all required workflow metadata. The CLI returns 0
for `Valid`, 1 for an evaluated `Invalid`, and 64 for invalid arguments. It
prints exactly one canonical JSON line and never prints raw exception text.

### Release authority is signed and registered before use

The release pins these immutable Ed25519 SPKI authorities. Values are unpadded
base64url DER. The fingerprint is SHA-256 of the decoded DER bytes.

```text
userApprovalPublicKey=MCowBQYDK2VwAyEAO8-4GwgS_8uYB2jDodT5o_uBbouplzoQ8a-yOnTfk3w
userApprovalKeySha256=00f3a61e60f4e7c066a13b9d8b98617ce015a40a0fd922f0a4af975c03d3ca3b
hostAuditPublicKey=MCowBQYDK2VwAyEAy30qjfPmsvJwWrNR50xAC39DCZUvjJgyg3bMdY84Zko
hostAuditKeySha256=6d6ad713d16b7803dddbe84a449f6df798455e4494b22a9da6bf96d043b42397
```

Private keys stay under host-owned external state and are not copied or mounted
into a worker sandbox. Every authority file is canonical JSON with one trailing
LF. Its `signature` is the unpadded base64url Ed25519 signature over
`UTF8("foreman.release-authority.v1\\n" + canonicalize(unsignedObject))`.
The receipt digest is SHA-256 of the complete canonical file bytes, including
the trailing LF. Decoders reject duplicate or extra keys, control characters,
invalid UTF-8, wrong types, non-canonical bytes, wrong key fingerprints, invalid
signatures, more than 100 findings, and files larger than 1 MiB. Identifiers use
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

export type ReleaseAuthorityReceiptV1 =
  | {
      readonly schema: "foreman.design-approval.v1";
      readonly program: "v040";
      readonly packageId: string;
      readonly designCommit: string;
      readonly designTree: string;
      readonly approvedOpenSpecSha256: string;
      readonly approvalStatementSha256: string;
      readonly issuerKeySha256: string;
      readonly issuedAt: string;
      readonly signature: string;
    }
  | {
      readonly schema: "foreman.checks-evidence.v1";
      readonly program: "v040";
      readonly packageId: string;
      readonly candidate: ReleaseCandidateIdentityV1;
      readonly status: "PASS" | "FAIL";
      readonly checksSha256: string;
      readonly issuerKeySha256: string;
      readonly issuedAt: string;
      readonly signature: string;
    }
  | {
      readonly schema: "foreman.release-audit.v1";
      readonly program: "v040";
      readonly packageId: string;
      readonly candidate: ReleaseCandidateIdentityV1;
      readonly verdict: "APPROVED" | "WARNING" | "BLOCKED" | "UNVERIFIED";
      readonly findings: readonly ReleaseAuditFindingV1[];
      readonly evidenceSha256: string;
      readonly issuerKeySha256: string;
      readonly issuedAt: string;
      readonly signature: string;
    }
  | {
      readonly schema: "foreman.council-evidence.v1";
      readonly program: "v040";
      readonly packageId: string;
      readonly candidateSha256: string;
      readonly decisionSha256: string;
      readonly issuerKeySha256: string;
      readonly issuedAt: string;
      readonly signature: string;
    }
  | {
      readonly schema: "foreman.evaluation-authority.v1";
      readonly program: "v040";
      readonly packageId: "graph-eval-falsification";
      readonly manifestSha256: string;
      readonly issuerKeySha256: string;
      readonly issuedAt: string;
      readonly signature: string;
    };

export type RegisteredReleaseAuthorityV1 = {
  readonly familySha256: string;
  readonly childId: string;
  readonly action: ReleaseActionV1;
  readonly candidateSha256: string;
  readonly bundleSha256: string;
  readonly receiptSchemas: readonly ReleaseAuthorityReceiptV1["schema"][];
  readonly issuerKeySha256s: readonly string[];
  readonly registeredAt: string;
};

export type FailedReservationAuthorityV1 = {
  readonly reservationId: string;
  readonly originalAction: ReleaseActionV1;
  readonly candidateSha256: string;
  readonly failureEvidenceSha256: string;
};

export type ReleaseEvidenceBundleV1 = {
  readonly schema: "foreman.release-evidence-bundle.v1";
  readonly program: "v040";
  readonly packageId: string;
  readonly action: ReleaseActionV1;
  readonly candidateSha256: string;
  readonly taskPlanSha256: string;
  readonly receipts: readonly ReleaseAuthorityReceiptV1[];
  readonly priorReservation?: FailedReservationAuthorityV1;
};
```

The approved OpenSpec digest is SHA-256 of a canonical manifest of sorted
proposal, specification, and design paths and their byte digests. It excludes
`tasks.md`, which Superpowers creates after design approval. A bounded package
has no design path.

The host-only `release-authority` artifact validates source artifacts, creates
signed receipts and one canonical evidence bundle, and appends the bundle's
exact digest to the child Endstop journal before use. The append binds family
digest, child ID, action, candidate digest, bundle digest, receipt schemas,
signer fingerprints, and timestamp.
SessionDB records the same digest for each human design approval. Private-key
paths and expected digests are not accepted by queue or gate callers.

Admission is action-specific:

| Action | Required registered authority |
|---|---|
| `implement` | current signed design approval and exact task-plan digest |
| `verify` | design approval and frozen candidate identity |
| `audit` | design approval and signed checks evidence for that candidate |
| `correct` | signed failed checks or `WARNING`, `BLOCKED`, or `UNVERIFIED` audit for that candidate |
| `council` | signed council decision requirement |
| `provider_retry`, `resume` | recorded failed reservation and the original action authority |
| `integrate`, `publish` | matching signed `APPROVED` audit with zero findings and current design approval |
| `evaluate` | signed locked-evaluation authority and the Tranche 8 child |

Bundle receipt order is exact: implementation and verification contain
`[design]`; audit contains `[design, checks(PASS)]`; correction contains
`[design, checks(FAIL)]` or `[design, audit(blocking)]`; council contains
`[design, council]`; integration and publication contain
`[design, audit(APPROVED)]`; and evaluation contains `[design, evaluation]`.
Retry and resume use the original array plus one `priorReservation` object.

```ts
export type ReleaseAdmissionResultV1 =
  | { readonly schemaVersion: 1; readonly _tag: "Admitted" }
  | { readonly schemaVersion: 1; readonly _tag: "Refused"; readonly reason: ReleaseAdmissionFailureReason };

export function evaluateReleaseAdmissionV1(input: {
  readonly action: ReleaseActionV1;
  readonly packageId: string;
  readonly candidate: ReleaseCandidateIdentityV1;
  readonly approvedOpenSpecBytes: Readonly<Record<string, Uint8Array>>;
  readonly taskPlanBytes: Uint8Array;
  readonly evidenceBytes: Uint8Array;
  readonly registered: RegisteredReleaseAuthorityV1;
}): ReleaseAdmissionResultV1;
```

The standalone admission CLI resolves `CANDIDATE_COMMIT^{commit}` and
`CANDIDATE_COMMIT^{tree}` in `REPO`; it never uses caller `HEAD`. It obtains the
signer from the pinned design constants. The production `release-policy`
composition also obtains the expected receipt digest from Endstop by family and
child identity. No input can substitute another Git object, authority key,
receipt digest, or package approval.

### The V2 family extends the V1 journal instead of replacing it

`ExecutionContractFamilyV2` is a closed canonical manifest. Its eight children
are sorted by tranche and have unique IDs and package IDs. Child dependencies
must refer to an earlier listed child. Standard children use only the V1 action
kinds. The evaluation child also defines `evaluate`.

```ts
export type ExecutionChildLimitsV2 = ExecutionLimitsV1 & {
  readonly evaluationRuns?: 2000;
  readonly noProgressMs?: 3600000;
};

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
  readonly familyId: string;
  readonly rootContractId: string;
  readonly rootContractSha256: string;
  readonly track1Commit: string;
  readonly track1Tree: string;
  readonly createdAt: string;
  readonly deadlineAt: string;
  readonly wallTimeMs: 5184000000;
  readonly totalActions: 4096;
  readonly userApprovalPublicKey: "MCowBQYDK2VwAyEAO8-4GwgS_8uYB2jDodT5o_uBbouplzoQ8a-yOnTfk3w";
  readonly userApprovalKeySha256: "00f3a61e60f4e7c066a13b9d8b98617ce015a40a0fd922f0a4af975c03d3ca3b";
  readonly hostAuditPublicKey: "MCowBQYDK2VwAyEAy30qjfPmsvJwWrNR50xAC39DCZUvjJgyg3bMdY84Zko";
  readonly hostAuditKeySha256: "6d6ad713d16b7803dddbe84a449f6df798455e4494b22a9da6bf96d043b42397";
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
  readonly issuerKeySha256: "6d6ad713d16b7803dddbe84a449f6df798455e4494b22a9da6bf96d043b42397";
  readonly issuedAt: string;
  readonly signature: string;
};

export type ExecutionFamilyUserApprovalV1 = {
  readonly schema: "foreman.execution-family-user-approval.v1";
  readonly program: "v040";
  readonly familyId: string;
  readonly manifestSha256: string;
  readonly track1Commit: string;
  readonly track1Tree: string;
  readonly approvalStatementSha256: string;
  readonly issuerKeySha256: "00f3a61e60f4e7c066a13b9d8b98617ce015a40a0fd922f0a4af975c03d3ca3b";
  readonly issuedAt: string;
  readonly signature: string;
};
```

The family uses `sha256Hex(canonicalize(decodedManifest))`. Its file is exactly
that canonical JSON plus one LF. All digests are lowercase 64-digit SHA-256;
Git commits are lowercase 40-digit object IDs; timestamps are UTC seconds; and
unknown fields, duplicate keys, coercions, out-of-range integers, and
non-canonical bytes refuse.

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

Every standard child has exact limits `implementationRounds=30`,
`correctionRounds=20`, `auditRounds=20`, `councilRounds=10`,
`providerRetries=10`, `resumeAttempts=10`,
`verificationRunsPerCandidate=5`, `totalActions=100`,
`wallTimeMs=1209600000`, and `noProductChangeMs=259200000`.
Tranche 8 has `implementationRounds=10`, `correctionRounds=5`,
`auditRounds=10`, `councilRounds=5`, `providerRetries=8`,
`resumeAttempts=5`, `verificationRunsPerCandidate=3`,
`evaluationRuns=2000`, `totalActions=2048`,
`wallTimeMs=3888000000`, and `noProgressMs=3600000`. Standard child wall time
starts at its first accepted action. Tranche 8 wall time starts at its first
accepted `evaluate` action. Dependency wait time consumes only the family
deadline. Every absolute child deadline equals the family deadline.

After these manifest bytes exist, `ExecutionFamilyAuditReceiptV1` and
`ExecutionFamilyUserApprovalV1` each contain schema, program, family ID,
manifest digest, Track 1 commit and tree, issuer-key fingerprint, issue time,
and signature. The audit receipt also contains verdict `APPROVED`, an empty
finding array, and evidence digest. Before activation,
`register-family-authority` verifies both signatures and atomically appends one
root authority event with the manifest and receipt digests. The activation
event requires that exact event and contains the same three digests. The
manifest cannot contain either receipt digest because that would create a
self-referential hash cycle.

Activation is one `EndstopFamilyActivated` event in the root journal. Replay
requires the original V1 contract event first, permits exactly one family
event, and derives the family count from all V1 and child action reservations.
After activation, the root refuses new unscoped V1 reservations. Existing V1
status remains readable.

Each child reservation is one `EndstopChildDecision` event that carries the
family digest, child ID, and decision events. The transaction replays root,
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

### One adapter reaches queue, gate, and merge boundaries

`release-policy.sh` is a thin compatibility adapter. It checks only that its
required positional arguments exist, locates Node and `dist/release-policy.js`,
and forwards exact arguments, environment, status, and byte streams. It does
not use `jq`, read TOML, inspect receipts, or decide policy. TypeScript composes
coverage, action admission, signed authority, Git identity, and Endstop lookup.

The shared fixed release block is:

```text
--release-program v040 --release-phase PHASE --release-action ACTION
--release-owner PACKAGE --release-repo ABS --release-candidate-commit SHA40
--release-register ABS --release-evidence ABS --release-state-root ABS
--release-family-sha SHA256 --release-child-id ID
```

`PHASE` is `bootstrap`, `lane`, or `release`. The evidence path supplies bytes,
but Endstop supplies the only accepted digest. `release-policy.sh` receives the
11 values as positional arguments in the order shown by the block.

The complete V2 queue grammar is:

```text
lane-queue.sh add GROUP --endstop-state-root ABS --endstop-contract-id ROOT_ID
--endstop-contract-sha ROOT_SHA --endstop-family-sha FAMILY_SHA
--endstop-child-id CHILD_ID --endstop-action ACTION
--endstop-candidate-sha SHA256 RELEASE_BLOCK -- CMD [ARGS...]
```

`provider_retry` and `resume` add
`--endstop-prior-reservation-id ID` immediately before `RELEASE_BLOCK`.
Queue admission invokes TypeScript release policy before one atomic child
reservation. The complete gate forms are `gate-eval.sh TASK_ID RELEASE_BLOCK`
and `merge-gate.sh check RUN LANE BRANCH RELEASE_BLOCK`. Merge resolves
`BRANCH^{commit}` and requires it to equal `--release-candidate-commit`; release
admission never inspects caller `HEAD`. Gate captures the policy result in its
decision evidence. Merge suppresses policy JSON from stdout and keeps exactly
one `MERGEABLE` or `NOT_MERGEABLE` line. The unchanged V1 bootstrap queue form
remains valid only before family activation.

The host receipt producer forms are:

```text
release-authority issue-design --program v040 --package PACKAGE --repo ABS --design-commit SHA40 --statement ABS --key ABS --out ABS
release-authority issue-checks --program v040 --package PACKAGE --repo ABS --candidate-commit SHA40 --checks ABS --key ABS --out ABS
release-authority issue-audit --program v040 --package PACKAGE --repo ABS --candidate-commit SHA40 --audit-verdict ABS --key ABS --out ABS
release-authority issue-council --program v040 --package PACKAGE --candidate-sha SHA256 --decision ABS --key ABS --out ABS
release-authority issue-evaluation --program v040 --manifest ABS --key ABS --out ABS
release-authority bundle --program v040 --package PACKAGE --action ACTION --candidate-sha SHA256 --tasks ABS --receipt ABS [--receipt ABS] [--prior-reservation ABS] --out ABS
release-authority register --state-root ABS --family-sha SHA256 --child-id ID --action ACTION --evidence ABS
```

Issuance validates its source and writes by fsync plus atomic replace. Register
verifies the pinned key, signature, candidate, and receipt digest before one
root-journal append. Private key paths are accepted only by issue commands and
never by queue, gate, or worker commands.

Family control uses these fixed forms:

```text
execution-guard register-family-authority --state-root ABS --contract-id ROOT_ID --contract-sha ROOT_SHA --manifest ABS --audit-receipt ABS --user-receipt ABS
execution-guard activate-family --state-root ABS --contract-id ROOT_ID --contract-sha ROOT_SHA --manifest ABS
execution-guard family-status --state-root ABS --contract-id ROOT_ID --family-sha SHA256
execution-guard child-status --state-root ABS --family-sha SHA256 --child-id ID
```

Registration verifies the pinned signatures and appends the three expected
digests. Activation recomputes the manifest digest and accepts only the prior
registration. Status commands are read-only.

Child lifecycle uses these fixed `execution-guard` forms:

```text
execution-guard child-record-product-change --state-root ABS --family-sha SHA256 --child-id ID --candidate-sha SHA256 --allowed-paths-sha SHA256
execution-guard child-record-milestone --state-root ABS --family-sha SHA256 --child-id ID --milestone MILESTONE --candidate-sha SHA256 --evidence-sha SHA256
execution-guard child-record-blocking --state-root ABS --family-sha SHA256 --child-id ID --source SOURCE --candidate-sha SHA256 --evidence-sha SHA256
execution-guard child-record-external-failure --state-root ABS --family-sha SHA256 --child-id ID --reservation-id ID --evidence-sha SHA256
execution-guard child-cancel --state-root ABS --family-sha SHA256 --child-id ID --approval ABS
execution-guard child-invalidate --state-root ABS --family-sha SHA256 --child-id ID --observed-family-sha SHA256
```

`MILESTONE` is `checks`, `audit`, `integrated`, or `published`; `SOURCE` is
`audit`, `council`, or `verify`. The architect records product changes after
worker completion, checks after the host gate, audit after signed audit receipt
registration, integration after merge, and publication in Tranche 9. Every
mutation is one root-journal transaction.

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
