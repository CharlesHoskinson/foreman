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

export function validateReleaseCoverageV1(input: {
  readonly registerText: string;
  readonly roadmapBytes: Uint8Array;
  readonly activeChangeNames: readonly string[];
  readonly roadmapRows: readonly RoadmapAssignmentV1[];
  readonly workflowByChange: Readonly<Record<string, string | null>>;
  readonly changedSuperpowersPaths: readonly string[];
}): ReleaseCoverageResultV1;
```

The CLI returns 0 for `Valid`, 1 for an evaluated `Invalid`, and 64 for invalid
arguments. It prints exactly one canonical JSON line and never prints raw
exception text.

### Release receipts are canonical closed JSON

`ReleaseAuditReceiptV1` contains schema, program, package ID, candidate commit,
tree, candidate digest, verdict, findings, summary, and audit timestamp.
`ReleaseDesignApprovalV1` contains schema, program, package ID, the Git commit
and tree at the design milestone, the approved OpenSpec-byte digest, the
approval-statement digest, and approval timestamp. The approved byte digest is
SHA-256 of a canonical manifest of the package's sorted proposal,
specification, and design paths and their byte digests. It excludes `tasks.md`,
which Superpowers creates after design approval. A bounded package has no
design path. Each receipt file is canonical JSON with one trailing LF.
Duplicate keys, extra keys, control characters, invalid UTF-8, wrong types,
and non-canonical bytes refuse before Git inspection.

The pure admission interface is:

```ts
export type ReleaseCandidateIdentityV1 = {
  readonly commit: string;
  readonly tree: string;
  readonly candidateSha256: string;
};

export type ReleaseAdmissionResultV1 =
  | { readonly schemaVersion: 1; readonly _tag: "Admitted" }
  | {
      readonly schemaVersion: 1;
      readonly _tag: "Refused";
      readonly reason: ReleaseAdmissionFailureReason;
    };

export function evaluateReleaseAdmissionV1(input: {
  readonly program: "v040";
  readonly expectedCandidateSha256: string;
  readonly actual: ReleaseCandidateIdentityV1;
  readonly approvedOpenSpecBytes: Readonly<Record<string, Uint8Array>>;
  readonly verdictBytes: Uint8Array;
  readonly approvalBytes: Uint8Array;
}): ReleaseAdmissionResultV1;
```

The CLI uses current `HEAD` and `HEAD^{tree}`. It recomputes
`SHA-256(ASCII(lowercase HEAD))`. The audit receipt must match that current
candidate. The approval receipt instead must match the current bytes of the
approved proposal, specifications, and design and its recorded historical
design commit and tree. Both receipts must name the same program and package.
No input can substitute another Git object or another package's approval.

### The V2 family extends the V1 journal instead of replacing it

`ExecutionContractFamilyV2` is a closed canonical manifest. Its eight children
are sorted by tranche and have unique IDs and package IDs. Child dependencies
must refer to an earlier listed child. Standard children use only the V1 action
kinds. The evaluation child also defines `evaluate`.

```ts
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
  readonly children: readonly ExecutionChildContractV2[];
};
```

After these manifest bytes exist, `ExecutionFamilyAuditReceiptV1` and
`ExecutionFamilyUserApprovalV1` each contain the manifest digest. The audit
receipt also requires `APPROVED` and an empty finding set. The activation event
contains the family digest, audit-receipt digest, and user-receipt digest. The
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

### One adapter reaches queue, gate, and merge boundaries

`release-policy.sh` is a thin compatibility adapter. It checks only that its
required positional arguments exist, locates Node and the two installed
artifacts, invokes coverage, then invokes admission with exact arguments, and
preserves the first nonzero status and byte streams. It does not use `jq`, read
TOML, inspect verdicts, or decide policy.

V2 queue syntax adds a fixed-order child and policy block. The queue invokes
the adapter before it reserves a child action. `gate-eval.sh` invokes it only
after the general gate result is known. `merge-gate.sh check` invokes it after
all merge-freshness checks and before it prints `MERGEABLE`. The unchanged V1
bootstrap form remains valid only before family activation.

### Installed runtime inventory is exact

The runtime builder adds two entry points. The manifest decoder and verifier
require both relative paths. The verifier compares two clean builds, each
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
