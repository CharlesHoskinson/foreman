# v0.4 release program specification

## ADDED Requirements

### Requirement: Release baseline and authority

The v0.4 program SHALL use commit
`bb5c8c2345ac5524ebb9c6a7de0fe16b17242195` as its immutable v0.3.1 baseline.
The program SHALL use authority in this order:

1. Git objects and published release records.
2. Approved OpenSpec requirements and design.
3. Current source and deterministic tests.
4. Durable event logs and SessionDB records.
5. Derived graph and evaluation artifacts.
6. Historical notes as discovery input only.

#### Scenario: Baseline identity matches

- **WHEN** the release program starts or resumes
- **THEN** the host verifies the baseline object and its expected tree
- **AND** the host records the identity in SessionDB

#### Scenario: Derived data conflicts with source

- **WHEN** a graph or context artifact conflicts with an authoritative source
- **THEN** the authoritative source wins
- **AND** the host marks the derived artifact stale or corrupt

### Requirement: One active change authority

OpenSpec SHALL own active behavioral requirements, design, task state, and
release status. Superpowers SHALL define the process used to create and execute
that OpenSpec state. The program SHALL NOT create a second active specification
or task tree under `docs/superpowers/`.

#### Scenario: A new tranche starts

- **WHEN** the architect opens a v0.4 implementation tranche
- **THEN** the architect creates or updates one focused OpenSpec package
- **AND** the package contains the approved requirements, design, and task list
- **AND** the Superpowers plan points to that task list

#### Scenario: Human design approval

- **WHEN** the user approves the written release design
- **THEN** the host records an external approval receipt
- **AND** the receipt binds the approved bytes and Git identity by digest
- **AND** no implementation worker creates or edits that receipt

### Requirement: Closed OpenSpec workflows

Each active v0.4 package SHALL declare one of two OpenSpec workflows.
`foreman-bounded` SHALL require proposal, specifications, then tasks.
`foreman-architectural` SHALL require proposal, specifications, design, then
tasks. The approved `tasks.md` SHALL be the only active implementation plan for
its package.

#### Scenario: A bounded change is opened

- **WHEN** the change has no material architecture or security decision
- **THEN** it declares `foreman-bounded`
- **AND** validation requires proposal, specifications, and tasks in order

#### Scenario: An architectural change is opened

- **WHEN** the change changes authority, trust, persistence, protocol, or a
  cross-package interface
- **THEN** it declares `foreman-architectural`
- **AND** validation requires proposal, specifications, design, and tasks in
  order

#### Scenario: A competing plan appears

- **WHEN** an active package also names another active plan file
- **THEN** strict workflow validation fails
- **AND** implementation admission refuses until `tasks.md` is sole authority

### Requirement: Complete release-scope reconciliation

The approved governor SHALL contain the closed coverage register at
`openspec/changes/v040-release-program/coverage.toml`. The register SHALL cover
every active OpenSpec package and each relevant Roadmap assignment. An entry
SHALL NOT disappear because its older package is stale or incomplete.

The register SHALL use schema version 1. Its top level SHALL contain
`baseline_commit`, `active_inventory_sha256`, and `roadmap_sha256`. It SHALL
declare future package owners and contain one or more `entry` tables. Each
future-owner table SHALL contain `name`, `target_release`, and `reason`. Each
entry SHALL have one unique `key`, `source_kind`, `source_path`, `disposition`,
`owner`, `target_release`, `reconcile`, and `reason`. `source_kind` SHALL be
`openspec_change` or `roadmap`. `disposition` SHALL be exactly `v040_owner`,
`v040_dependency`, `released_reference`, `superseded`, or `v050`.
`reconcile` SHALL be exactly `complete`, `required`, or `not_required`.

The register SHALL assign project registry, external MemoryIndex, projection
epochs, live-service tests, Graphify, work DAG, context, evaluation, the
appliance, BW-004, and publication to v0.4. It SHALL assign unrelated Council
runtime, deliberation, MCP transport, and broad dogfood carry-over work to
v0.5.

Track 1 SHALL implement the validator at
`packages/policy/src/release-coverage.ts` and the command
`release-coverage check --register <path>`. The validator SHALL compute the
active inventory by sorting the UTF-8 names from `openspec list --json` and
hashing each name with one trailing LF. It SHALL hash the raw `ROADMAP.md`
bytes. It SHALL reject a wrong schema version, stale digest, missing or
duplicate source, duplicate key, unknown enum, unresolved `required` entry, or
owner that is neither an active package nor a declared future package.

For an OpenSpec source, `key` SHALL equal `change:<package-name>` and
`source_path` SHALL equal `openspec/changes/<package-name>`. For a Roadmap
source, `key` SHALL equal one `Coverage key` in the Roadmap assignment table
and `source_path` SHALL equal `ROADMAP.md`. The validator SHALL require a
bijection between Roadmap table rows and Roadmap register entries. Multiple
Roadmap keys MAY share that path and are not duplicate sources.

The validator SHALL enforce these cross-field rules:

- `v040_owner` and `v040_dependency` require `target_release="v0.4"` and
  `reconcile` of `required` or `complete`.
- `v050` requires `target_release="v0.5"` and
  `reconcile="not_required"`.
- `released_reference` requires `target_release="released"` and
  `reconcile="complete"`.
- `superseded` requires `reconcile="complete"` and an owner different from
  the source package.
- Every Roadmap entry's release and owner SHALL equal its Roadmap table row.

When an approved future package becomes active, the architect SHALL update its
entry and `active_inventory_sha256` in the same design milestone. That changed
design SHALL receive its required exact-byte approval before the package's
implementation lane. Documentation-only reconciliation and register updates
do not count as product implementation lanes.

Only one atomic Track 1 authority bootstrap MAY start before the authorities
exist. Its admission SHALL require the exact approved governor commit, tree,
and digest, content-addressed `APPROVED` receipts with empty findings, the
current V1 root receipt, and exact-byte user approval. It SHALL consume actions
from the V1 root and fit inside its remaining limits. It SHALL implement the two
workflows, both policy checks, and `ExecutionContractV2` family activation in
one candidate. After activation, every lane SHALL require both policy checks
and its listed child contract. A reused package with `reconcile=required` SHALL be
corrected and strict-validated before its implementation lane starts. Those
corrections SHALL remove new shell and Bats implementation where Node 24
TypeScript and TypeScript tests own the behavior, and SHALL resolve conflicting
directed-versus-undirected graph assumptions.
`knowledge-plane-refresh` SHALL remove its `lock-primitive-hardening`
prerequisite during reconciliation and SHALL own its narrow TypeScript and
Effect advisory lock.

#### Scenario: An active package is not part of v0.4

- **WHEN** reconciliation finds an active package outside the approved release
  promise
- **THEN** the register names the package and its v0.5 or later assignment
- **AND** the package is not silently marked complete, deleted, or omitted

#### Scenario: Coverage is incomplete

- **WHEN** any active package or Roadmap v0.4 item lacks one disposition
- **THEN** strict release validation fails
- **AND** no implementation tranche starts

#### Scenario: The Track 1 authorities do not exist yet

- **WHEN** Track 1 has the exact approved governor and Endstop receipt
- **THEN** admission permits only the atomic authority bootstrap
- **AND** that bootstrap implements both policy checks and family activation
- **AND** partial output does not activate the family

#### Scenario: A stale focused ledger is assigned to v0.4

- **WHEN** its coverage entry says `reconcile=required`
- **THEN** release admission fails until the ledger is corrected
- **AND** strict validation of the corrected ledger passes

### Requirement: Bounded Foreman execution loop

The program SHALL run through the Foreman architect, implementer, auditor, and
gate roles. One immutable Endstop contract family SHALL bound all v0.4 actions.
The V1 root contract SHALL have ID `v040-release-20260822-r1`, SHA-256
`ab74dfc946d3bdd6d1ee2d18f739d91bcf812a4719f3fd5bd11a50226354c337`,
and deadline `2026-08-29T18:05:57Z`. A tranche, session, lane, retry, worktree,
or crash SHALL NOT reset a counter or deadline.

Track 1 SHALL implement `ExecutionContractV2` as a one-time family activation.
Activation SHALL append to the root Endstop RunJournal before the V1 deadline.
It SHALL refuse after a root terminal state and SHALL refuse a second
activation. The closed canonical family manifest SHALL receive an exact-byte
`APPROVED` audit and exact-byte user approval. Activation SHALL bind its digest,
the root identity, the Track 1 commit and tree, and both approval digests.

The manifest SHALL contain exactly eight child contracts for Tranches 2 through
9. Each child SHALL bind its tranche, package, objective digest, acceptance
digest, allowed-path digest, action limits, and deadline. No later operation
SHALL add or replace a child. The family SHALL use `wallTimeMs=5184000000` and
`totalActions=4096`. Every V1 action consumed before activation SHALL count
against the family total. Each child deadline SHALL be at or before the family
deadline. A family terminal state SHALL terminate all children. A child terminal
state SHALL NOT reset another child.

Tranches 2 through 7 and Tranche 9 SHALL be standard children. Each SHALL allow
at most 100 total actions and at most 14 days. Its manifest SHALL assign exact
positive values to the V1 implementation, correction, audit, council,
provider-retry, resume, and verification-per-candidate limits, and to
`totalActions`, `wallTimeMs`, and `noProductChangeMs`. It SHALL apply the V1
deadline, no-product-change, action-limit, verification-per-candidate, and
terminal-transition rules. It SHALL NOT inherit a mutable default. Tranche 8
SHALL be the evaluation child. It SHALL allow exactly 2,000 `evaluate` actions,
at most 2,048 total actions, `wallTimeMs=3888000000`, and
`noProgressMs=3600000`. Its manifest SHALL assign exact limits to every
non-evaluation action. Two thousand serialized runs at the 30-minute cap
require at most 1,000 hours. The 45-day child limit SHALL cover that worst case
and bounded control overhead.

Every external provider invocation and evaluation run SHALL reserve one typed
action before it starts. One root RunJournal transaction SHALL append that
reservation. Replay SHALL derive child and family counters from the same event.
A reserved action with an unknown crash outcome SHALL remain spent. A retry
SHALL reserve another action. The runtime SHALL NOT hide multiple provider calls
behind one reservation. An unlisted child or action SHALL refuse.

Track 1 SHALL implement `packages/policy/src/release-admission.ts` and the
command `release-admission check --program v040 --verdict <path>
--candidate-sha <sha256> --approval <path>`. It SHALL read the audit artifact
directly and SHALL NOT read or honor `[audit.policy]`. It SHALL admit only a
well-formed `APPROVED` verdict with no findings that binds the exact candidate
commit, tree, and candidate digest. It SHALL refuse `WARNING`, `BLOCKED`,
`UNVERIFIED`, an unknown verdict, a malformed artifact, a nonempty finding set,
or an identity mismatch. Repository and machine configuration SHALL NOT weaken
this v0.4 rule. Every v0.4 lane wrapper, integration gate, and publication gate
SHALL run this check after the general Foreman gate.

Before that command exists, only the atomic authority bootstrap MAY consume
content-addressed governor audit receipts directly. Each receipt SHALL have the
same acceptance rules and exact identity bindings. The bootstrap SHALL also
require the matching V1 root and exact-byte user approval. Its closed scope
SHALL contain only these paths:

- `openspec/changes/openspec-superpowers-convergence/**`
- `openspec/schemas/foreman-bounded/**`
- `openspec/schemas/foreman-architectural/**`
- `packages/policy/src/release-coverage.ts`
- `packages/policy/src/release-coverage.test.ts`
- `packages/policy/src/release-coverage-main.ts`
- `packages/policy/src/release-admission.ts`
- `packages/policy/src/release-admission.test.ts`
- `packages/policy/src/release-admission-main.ts`
- `packages/policy/src/main.ts`
- `packages/policy/src/cli.ts`
- `packages/policy/src/cli.test.ts`
- `packages/policy/src/index.ts`
- `packages/policy/src/install-verify-decode.ts`
- `packages/policy/src/install-verify.test.ts`
- `packages/orchestration/src/execution-contract.ts`
- `packages/orchestration/src/execution-contract.test.ts`
- `packages/orchestration/src/execution-terminal-policy.ts`
- `packages/orchestration/src/execution-terminal-policy.test.ts`
- `packages/orchestration/src/execution-ledger.ts`
- `packages/orchestration/src/execution-ledger.test.ts`
- `packages/orchestration/src/execution-loop-closure.test.ts`
- `packages/orchestration/src/execution-guard-cli.ts`
- `packages/orchestration/src/execution-guard-cli.test.ts`
- `packages/orchestration/src/execution-guard-main.ts`
- `packages/orchestration/src/queue-admission.ts`
- `packages/orchestration/src/queue-admission.test.ts`
- `packages/orchestration/src/queue-cli.ts`
- `packages/orchestration/src/queue-cli.test.ts`
- `packages/orchestration/src/queue-main.ts`
- `packages/orchestration/src/queue-services.ts`
- `packages/orchestration/src/index.ts`
- `packages/orchestration/src/index.test.ts`
- `scripts/build-runtime.ts`
- `scripts/verify-runtime.ts`
- `scripts/verify-runtime-manifest.ts`
- `scripts/verify-runtime-manifest.test.ts`
- `skills/foreman/scripts/lib/release-policy.sh`
- `skills/foreman/scripts/gate-eval.sh`
- `skills/foreman/scripts/merge-gate.sh`
- `tests/release-policy.bats`
- `tests/gate-eval.bats`
- `tests/merge-gate.bats`
- `tests/fixtures/release-policy/**`
- `packages/policy/package.json`
- `packages/orchestration/package.json`
- `package-lock.json`
- `skills/foreman/runtime/dist/**`
- `skills/foreman/runtime/manifest.json`

It SHALL NOT admit another product lane or path.
The runtime builder SHALL emit separate installed `release-coverage` and
`release-admission` artifacts. One shared release-policy adapter SHALL invoke
those exact artifacts. `gate-eval.sh` SHALL call the adapter only after the
general gate result exists. `merge-gate.sh` SHALL call it before it can return
`MERGEABLE`. A missing artifact, failed coverage check, or non-approved
admission verdict SHALL fail closed. Tranche 9 publication tooling SHALL call
the same adapter under the Tranche 9 child allowlist.
The exact runtime verifier and installed-runtime decoder SHALL treat both
release-policy artifacts as required. Tests SHALL compare two clean builds,
tracked bytes, and the exact `dist` inventory. Copied-install controls SHALL
reject a missing or changed artifact and SHALL reject removal of an artifact
together with its manifest entry.

After the atomic candidate integrates and the family activates, every later
lane, integration gate, and publication gate SHALL run both policy checks after
the general Foreman gate. Hostile tests SHALL prove refusal for mutable audit
policy, stale candidate identity, malformed receipts, nonempty findings, and
partial bootstrap output.

#### Scenario: Family activation carries prior work

- **WHEN** Track 1 activates the approved family manifest
- **THEN** every consumed V1 root action counts against the family total
- **AND** replay derives that total from the root RunJournal

#### Scenario: Family activation is repeated

- **WHEN** any process tries to activate a second family
- **THEN** Endstop refuses without changing the first family

#### Scenario: An action outcome is unknown

- **WHEN** a crash occurs after reservation and before a durable outcome
- **THEN** the action remains spent
- **AND** retry requires a new reservation

#### Scenario: A child or action is not listed

- **WHEN** a command names an absent child or unsupported action
- **THEN** Endstop refuses before the provider starts

#### Scenario: The evaluation reaches its action limit

- **WHEN** Tranche 8 has reserved 2,000 `evaluate` actions
- **THEN** another evaluation run refuses
- **AND** no reservation can hide multiple provider runs

#### Scenario: A family or child reaches its deadline

- **WHEN** the applicable absolute deadline passes
- **THEN** Endstop records the applicable terminal state
- **AND** a new session or retry cannot extend that deadline

#### Scenario: A tranche is ready to implement

- **WHEN** its dependencies and approved OpenSpec task list are complete
- **THEN** Grok implements the tranche in an isolated worktree with tests first
- **AND** the host runs focused deterministic checks
- **AND** Codex performs a cold audit of the complete diff
- **AND** the architect resolves every blocking finding before integration

#### Scenario: Mutable audit policy permits a blocked verdict

- **WHEN** the general gate permits `WARNING` or `BLOCKED` through mutable
  policy
- **THEN** v0.4 release admission still refuses the candidate
- **AND** only a new exact `APPROVED` verdict can admit it

#### Scenario: Work repeats without product progress

- **WHEN** the Endstop contract detects a repeated action, exceeded limit, or
  expired no-product-change window
- **THEN** it refuses the action before provider or gate work starts
- **AND** the architect records the terminal reason in SessionDB
- **AND** no new lane or session bypasses the refusal

#### Scenario: A provider is unavailable

- **WHEN** an assigned provider cannot run after the allowed retries
- **THEN** the architect records the failed provider and reason
- **AND** any substitute uses the documented Foreman reroute rule
- **AND** the substitution remains visible in release evidence

### Requirement: Durable milestone state

The architect SHALL save canonical SessionDB state after each approved design,
accepted implementation tranche, focused verification, audit verdict,
integration, evaluation decision, and publication event.

#### Scenario: A milestone passes

- **WHEN** a milestone produces stable facts or fresh measurements
- **THEN** the architect records facts, scoped measurements, decisions, and
  remaining obligations in SessionDB
- **AND** each perishable result includes its command, candidate, and scope

#### Scenario: The release resumes

- **WHEN** a later session resumes the v0.4 program
- **THEN** it reads the canonical SessionDB record
- **AND** it rechecks stale measurements before it relies on them
- **AND** it continues from the last accepted milestone

### Requirement: Dependency-bound release tranches

The program SHALL execute these tranches under the declared dependency graph:

1. OpenSpec and Superpowers convergence.
2. Stable project registry and project-aware references.
3. Qdrant `MemoryIndex`, projection epochs, and live-service tests.
4. Hermetic Foreman appliance.
5. Graphify 0.9.48 qualification.
6. Deterministic work-DAG projection.
7. Bounded immutable context packs.
8. Locked evaluation and rollout.
9. Exact-candidate release and publication.

#### Scenario: A dependency is incomplete

- **WHEN** a tranche dependency has no accepted candidate
- **THEN** later dependent implementation SHALL NOT start
- **AND** independent research or test-fixture preparation MAY continue without
  creating a completion claim

#### Scenario: Independent foundation tracks are ready

- **WHEN** authority convergence is accepted
- **THEN** the project registry, appliance, and Graphify qualification tracks
  MAY run in parallel worktrees
- **AND** each track receives its own candidate and cold-audit verdict

#### Scenario: A focused package already exists

- **WHEN** an existing OpenSpec package covers a tranche
- **THEN** the program reconciles and reuses it
- **AND** it does not create a competing package for the same behavior

### Requirement: Stable project registry

The release SHALL keep one authoritative `SessionStore` per logical project
and a machine-local registry that resolves stable project identifiers to those
stores. A linked Git worktree SHALL share a project identity with every
worktree that has the same Git common directory. The stable identifier SHALL
survive store export, an explicit restore, and repository path moves.

`EntityRef` and every external projection identity SHALL include
`project_id`. The registry and all existing stores SHALL have an explicit,
tested migration. Semantic recall SHALL rehydrate a reference only through the
matching registered store.

Snapshot row-import policy and project-identity policy SHALL be separate:

- An exact restore into an unbound empty store preserves the donor project UUID
  and its projection-version state only when the registry has no live binding
  for that UUID and the import has the source retirement or recovery receipt.
  It preserves the donor next projection version, per-key current versions,
  pending records, and queue order. A same-backend restore preserves opaque
  receipts and its next receipt counter. A cross-backend restore mints target
  receipts for the pending records in queue order and sets the target next
  receipt counter to the first unallocated value. It marks external recall
  unqualified until a fresh epoch rebuild passes.
- An import into a registered target, including destructive `force+refuse` and
  additive `force+remap`, preserves the target project UUID.
- Additive remap treats imported rows as target-project rows and queues their
  projections under the target UUID with fresh target projection versions.
- Destructive replacement queues its target-project delta with fresh target
  projection versions and does not reduce the target version counter.
- An explicit clone or fork preserves donor entity rows, IDs, and `nextIds`,
  mints a new project UUID, and initializes new projection-version state. In
  canonical counted-kind and ID order, it allocates versions starting at 1 and
  one fresh target-backend opaque upsert receipt for each live projectable row.
  The next projection version and next receipt counter are their respective
  first unallocated values. An empty clone keeps both counters at their target-
  backend initial values. It does not copy donor projection versions,
  tombstones, or opaque outbox receipts.
- A second live store that claims an existing UUID is refused until the
  operator selects move, restore, or clone. Foreman SHALL NOT choose one by
  path order or timestamp.

A registry-changing operation SHALL use one durable operation identifier and
an idempotent reserve, store-publish, then registry-finalize protocol. The
reservation SHALL record the exact predecessor operation identifier, including
an explicit empty predecessor. Startup recovery SHALL inspect the predecessor
and proposed identifiers in both authorities and use the exact recovery matrix
in this requirement. Every restore and clone state transition SHALL publish
entity, identity, counter, per-key version, and outbox state in one SessionStore
transaction or one paired files-only generation.

Each registry authority SHALL mint one UUID and Ed25519 identity key. The key
fingerprint SHALL be SHA-256 of the raw 32-byte public key. Its private key
SHALL use mode `0600` runtime state or an equivalent Windows ACL and SHALL NOT
enter an image, project export, log, or release artifact. The destination SHALL
sign an offer that binds its registry authority UUID, proposed operation
identifier, project UUID, canonical Git common directory, selected store
backend, and target store locator digest.

Registry initialization SHALL also pin one immutable operator
approval-authority UUID, literal key generation `1`, and Ed25519 public-key
fingerprint. This one-shot pin SHALL occur before the first project
registration. A second pin or a pin after project registration SHALL refuse.
The approval key SHALL be distinct from the source registry, destination
registry, and project recovery keys. A normal transfer SHALL require the same
immutable identity and literal generation `1` in both registries. A recovery
transfer SHALL require that identity and generation in the destination registry
and project registration record.

A migrated registry without this record SHALL refuse transfer, exact project
import, and project restore. One explicit operator command MAY add the missing
generation-1 record before any project registration. A transfer bundle, import,
restore, migration, or recovery receipt SHALL NOT create, replace, or downgrade
the record. Loss or compromise of the approval key SHALL block normal and
recovery transfer. v0.4 SHALL have no bypass or in-place rotation.

A source retirement receipt SHALL bind one unique transfer nonce, the signed
destination-offer digest, destination authority UUID, project UUID, export
digest, source store operation identifier, source registry generation,
retirement disposition, and external approval digest. The source registry
SHALL sign it. The external approval SHALL bind the destination-offer digest,
transfer nonce, source and destination registry-key fingerprints, recovery-key
fingerprint, destination authority, project UUID, export digest, and proposed
operation identifier. The separately held operator approval key SHALL sign it.

The source SHALL atomically store the complete signed receipt bytes with the
SessionStore transfer marker that disables later writes. Receipt emission
SHALL be an idempotent read of those durable bytes. A crash before the atomic
store publication SHALL leave the source writable and no usable receipt. A
crash after it SHALL leave a durable receipt that recovery re-emits and uses to
retire the registry binding. Rollback SHALL be allowed only before that atomic
publication. A later reverse move SHALL be a new signed transfer.

At registration, the SessionStore SHALL record the fingerprint of an
operator-held Ed25519 recovery key and the approval-authority UUID, literal
generation `1`,
and fingerprint. If the source is unavailable, a recovery receipt SHALL be
signed by the recovery key and SHALL bind a unique transfer nonce, the signed
destination offer, project UUID, export digest, last-known store operation
identifier, last-known registry generation, operator assertion, and external
approval digest. It SHALL use explicit `unknown` values for unavailable
identities and SHALL NOT omit them. Release evidence SHALL label this path as
operator-attested recovery.

Each receipt SHALL bind one destination registry authority and one proposed
operation. The destination reservation SHALL bind the complete receipt digest
and transfer nonce. Finalization SHALL mark it consumed within that authority.
A retry with the same receipt, destination, and operation SHALL be idempotent.
Another authority, binding, nonce, or operation SHALL refuse before mutation.
v0.4 SHALL claim single consumption inside one registry authority and SHALL
NOT claim global exactly-once receipt consumption. A copied live registry
authority SHALL be an identity conflict.

#### Scenario: A project first registers

- **WHEN** an unbound project opens through explicit registration
- **THEN** the registry and SessionStore publish the same project and operation
  identifiers through the reserve, store-publish, and finalize protocol
- **AND** a crash resumes from the exact predecessor and proposed identifiers

### Requirement: Versioned project transfer envelope

Exact project export SHALL use a `SessionTransferEnvelopeV1` separate from the
row-only `SessionSnapshot` and `importSnapshot` APIs. The envelope SHALL use
RFC 8785 canonical JSON. It SHALL be at most 256 MiB and contain at most
1,000,000 entity rows and 100,000 pending entries. The complete bundle SHALL be
at most 257 MiB. Each non-snapshot string SHALL be at most 64 KiB of UTF-8. The
envelope SHALL have only these top-level fields:

- `schema`, with literal value `foreman.session-transfer.v1`
- `source_backend`, with `sqlite` or `files-only`
- `project`, with the project UUID, source registry authority UUID, unpadded
  base64url raw 32-byte public key, recovery-key fingerprint, approval-authority
  UUID, literal approval-key generation `1`, approval-key fingerprint, source
  store operation identifier, and nonnegative safe-integer source registry
  generation
- `snapshot`, with the complete `SessionSnapshot`
- `projection`, with a positive safe-integer `next_version`, unique
  projection-key/version rows in lexical key order, a positive safe-integer
  `next_receipt`, and pending `OutboxEntry` values in durable queue order

Each projection version SHALL be a positive safe integer. Projection keys and
opaque receipts SHALL be unique. Each next counter SHALL be greater than every
allocated value that it governs.

`ExternalTransferApprovalV1` SHALL be a closed, signed RFC 8785 object. It SHALL
have schema `foreman.external-transfer-approval.v1`, approval UUID, operator
approval-authority UUID, literal key generation `1`, raw public key,
destination-offer digest, transfer nonce, source and destination registry-key
fingerprints, recovery-key fingerprint, destination authority UUID, project
UUID, export digest, proposed operation UUID, and signature. Its SHA-256 digest
SHALL be the external approval digest.

The other signed authorization object schemas SHALL be:

- `DestinationOfferV1` SHALL have schema `foreman.destination-offer.v1`,
  destination authority UUID, destination raw public key, proposed operation
  UUID, project UUID, canonical Git common directory, store backend, target
  store locator digest, and signature.
- `RetirementReceiptV1` SHALL have schema
  `foreman.retirement-receipt.v1`, destination offer digest, destination
  authority and operation UUIDs, transfer nonce, project UUID, export digest,
  source store operation UUID, source registry generation, `retired`
  disposition, external approval digest, and signature.
- `RecoveryReceiptV1` SHALL have schema `foreman.recovery-receipt.v1`,
  destination offer digest, destination authority and operation UUIDs,
  transfer nonce, project UUID, export digest, last-known source store
  operation and registry generation or literal `unknown`, operator assertion,
  external approval digest, raw recovery public key, and signature.

Public keys and 64-byte Ed25519 signatures SHALL use unpadded base64url. Each
signature SHALL cover the canonical object with its `signature` field omitted.
Verification SHALL reject an extra, missing, duplicate, wrongly encoded, or
wrong-type field before signature verification.

The export digest SHALL be SHA-256 of the canonical envelope bytes. The
transfer bundle SHALL contain the envelope, signed destination offer, signed
external approval, and exactly one signed retirement or recovery receipt.
These three authorization artifacts SHALL be outside the envelope digest.
Validation SHALL run in this order:

1. Apply parse and size limits, exact schemas and closed fields, canonical-byte
   reproduction, and digest checks.
2. Compute each raw public-key fingerprint. Match the destination key to the
   named destination registry, the approval key to the pinned operator
   authority, the source key to the source registry when available, and the
   recovery key to the project registration record.
3. Verify the offer with the destination key, the approval with the operator
   key, a retirement receipt with the source key, and a recovery receipt with
   the recovery key.
4. Compare every offer, nonce, authority, project, operation, export,
   key-generation, and approval-digest binding across the artifacts.
5. Validate safe integers, receipt invariants, SessionSnapshot integrity, and
   registry admission, then publish the target atomically.

An unknown version or backend, non-canonical encoding, duplicate projection key
or receipt, unknown or mismatched authority, invalid signature, counter
mismatch, or malformed row SHALL refuse before source retirement or target
mutation. Same-backend restore SHALL preserve opaque receipts. Cross-backend
restore SHALL remint them in queue order.

A writable registry migration SHALL create its authority UUID and identity
key. One explicit operator action MAY add a missing immutable approval authority
before any project registration. An explicit writable project migration SHALL
record the project UUID, operation identifier, recovery public-key fingerprint,
and immutable approval-authority identity. A read-only open that needs any
migration SHALL refuse without changing registry or SessionStore bytes.

#### Scenario: Approval authority mutation is attempted

- **WHEN** an operation attempts a second pin, downgrade, replacement, mismatch,
  or a pin after project registration
- **THEN** the registry and SessionStore remain unchanged
- **AND** transfer and recovery transfer remain blocked

#### Scenario: A project export is used as a row import

- **WHEN** an operator calls `importSnapshot` with project transfer intent
- **THEN** Foreman reports that row import cannot restore project identity or
  projection bookkeeping
- **AND** exact restore requires the versioned transfer bundle

#### Scenario: A transfer bundle is malformed

- **WHEN** any validation stage rejects its bytes or authority
- **THEN** the registry and target SessionStore remain unchanged
- **AND** the failure identifies the first failed validation stage

#### Scenario: The source crashes before transfer publication

- **WHEN** receipt construction starts but the atomic source transfer marker
  does not commit
- **THEN** startup leaves the source writable and cancels the transfer intent
- **AND** no receipt is usable

#### Scenario: The source crashes after transfer publication

- **WHEN** the source marker and receipt bytes commit before registry retirement
- **THEN** startup retires the matching registry binding
- **AND** it re-emits the identical durable receipt bytes

#### Scenario: The destination crashes before store publication

- **WHEN** its registry reservation exists and its store remains at the exact
  predecessor operation
- **THEN** startup cancels the reservation without consuming the receipt
- **AND** retry can reserve the same receipt and operation again

#### Scenario: The destination crashes after store publication

- **WHEN** the store records the proposed operation and matching receipt digest
- **THEN** startup finalizes the registry binding and consumes that receipt
- **AND** a conflicting operation, digest, nonce, authority, or destination
  refuses without mutation

The SessionStore project UUID and registration operation identifier SHALL be
the durable local project marker. The marker is not derived from commit
history, remote URLs, a directory path, or a display name. An automatic open at
a new path SHALL NOT rewrite registry state. A move SHALL require an explicit,
receipt-bound operation that names the project UUID, prior registry generation,
old path, new canonical Git common directory, and store-identity metadata
digest.

#### Scenario: A repository has linked worktrees

- **WHEN** two worktree paths report the same `git --git-common-dir`
- **THEN** the registry assigns them one stable project identifier
- **AND** each path resolves to the same authoritative project store

#### Scenario: A project moves

- **WHEN** the operator submits a move receipt for a registered project at a
  new path
- **THEN** the registry preserves its stable project identifier
- **AND** it updates path metadata only after the store UUID, registration
  operation identifier, prior registry generation, and receipt all match

#### Scenario: A moved project opens without a receipt

- **WHEN** a SessionStore project UUID appears at an unregistered path
  without an accepted move receipt
- **THEN** Foreman reports the project moved but unverified
- **AND** it does not update the registry or claim the project fresh

#### Scenario: An empty destination restores a project

- **WHEN** an unbound empty destination imports an exact project export
- **THEN** it preserves the donor project UUID only if no live registry binding
  uses that UUID and the transfer has a source retirement or recovery receipt
- **AND** it preserves the next projection version, per-key versions, pending
  records, and queue order
- **AND** it preserves same-backend receipts or deterministically mints
  cross-backend receipts in that order
- **AND** it marks external recall unqualified until rebuild activation passes
- **AND** a duplicate live binding refuses before the store changes

#### Scenario: A registered target imports rows

- **WHEN** a registered target uses destructive replacement or additive remap
- **THEN** the target project UUID does not change
- **AND** every resulting projection uses the target project UUID

#### Scenario: An operator clones a project

- **WHEN** the operator explicitly selects clone or fork
- **THEN** Foreman mints a new project UUID before it registers the copy
- **AND** it allocates new versions and live upsert receipts in canonical order
- **AND** the version and receipt counters are the first unallocated values
  after those rows
- **AND** the new and donor stores cannot project to the same project identity

#### Scenario: Registration crashes after store publication

- **WHEN** the store contains the reserved operation identifier but the
  registry still records that operation as pending
- **THEN** startup recovery finalizes the matching registry operation
- **AND** retry produces one active binding

#### Scenario: Registration crashes before store publication

- **WHEN** the registry reserves operation B with predecessor A and the store
  still contains A
- **THEN** startup recovery cancels B without changing the store
- **AND** retry can reserve a new operation from A

#### Scenario: Registration state is ambiguous

- **WHEN** a pending reservation proposes B from predecessor A and the store
  contains neither A nor B, or two accessible stores claim one UUID
- **THEN** Foreman marks the project binding conflicted and refuses recall,
  projection, import, and freshness claims for that project
- **AND** it prints an explicit operator recovery action

#### Scenario: A pending registration cannot reach its store

- **WHEN** startup recovery cannot read the store for a pending reservation
- **THEN** it refuses without changing the registry or another store
- **AND** retry uses the same pending operation identifier

#### Scenario: A referenced project is unavailable

- **WHEN** recall returns a reference for a deleted, moved-but-unverified, or
  unregistered project
- **THEN** Foreman reports the reference unavailable or unknown
- **AND** Foreman does not report it fresh and does not open another store

#### Scenario: Current-project recovery runs

- **WHEN** the operator uses the default recovery command
- **THEN** it remains exact, offline, and limited to the current project
- **AND** cross-project recovery requires an explicit command or option

### Requirement: Qdrant MemoryIndex adapter

The release SHALL ship the first external `MemoryIndex` adapter against Qdrant
1.19.0. `NullMemoryIndex` SHALL remain the default. No `SessionStore` operation
or core CLI command SHALL require Qdrant, its network, or its credentials.

The reference manifest SHALL pin Qdrant source commit
`74f3e85b9473c62560006c043e13737ce6b48412`, the multi-platform image index
digest `sha256:057ee3a8da769fe7310dd3537b4dc7583bf87a95ce8ac43c0af5a46bc580d1fc`,
the `linux/amd64` manifest
`sha256:6c0652f8d6925b22f2f6f0e0a5365a6c9dbc8768bd6e70ccc1cdc14847e452a0`,
the `linux/arm64` manifest
`sha256:139bbec1a1e6c0f04c978c96b5359568e72e60ae6abc9db0ab4b7643a8cd957f`,
and `@qdrant/js-client-rest` 1.19.0 with npm integrity
`sha512-1+QLUHsWp+WV4PE35FLnH2ckxotWrQEqi/F3t4goF3cCThR0ZxLVtOC4OoOi/E1iyj/iIYBdbuACWMuQ15NAnA==`.

The v0.4 adapter SHALL support exactly one Qdrant node, one collection shard,
`replication_factor=1`, and `write_consistency_factor=1`. Every conditional
mutation SHALL use `ordering=strong` and `wait=true`. Every point read, recall,
scroll, and rebuild verification read SHALL use consistency `all`. Adapter
startup and `foreman doctor` SHALL inspect the live collection and refuse the
semantic-memory profile when topology or consistency differs. Multi-node and
multi-replica Qdrant operation is outside the v0.4 support boundary.

Every active and candidate collection SHALL enable strict mode with unindexed
filtering refused for retrieval and updates. Before its first point mutation,
Foreman SHALL create and await these payload indexes:

- integer range on `projection_version`
- boolean on `live`
- keyword on `project_id`, `kind`, `epoch_id`, and `model_id`

Adapter startup and `foreman doctor` SHALL inspect the live index schemas,
build status, and strict-mode settings. A missing, pending, wrong-type, or
unexpected index contract SHALL refuse semantic mode before mutation.

#### Scenario: The external adapter is selected

- **WHEN** the focused adapter package is approved
- **THEN** it uses the Qdrant version, source revision, image manifests, client,
  and credential boundary from this requirement
- **AND** `env/reference-manifest.toml` pins every service and client identity

#### Scenario: A desired-state key is encoded

- **WHEN** Foreman projects one counted entity
- **THEN** it derives a Qdrant UUID point identifier from a fixed Foreman
  namespace plus `project_id`, entity kind, and entity ID
- **AND** retrying the same desired state addresses the same point
- **AND** a different project, kind, or entity ID addresses a different point

#### Scenario: A Qdrant deployment has an unsupported topology

- **WHEN** Qdrant reports more than one node, shard, or replica, or reports a
  different write consistency factor
- **THEN** adapter qualification and semantic projection refuse before mutation
- **AND** core Foreman operation continues through `NullMemoryIndex`

#### Scenario: A mutation returns before completion

- **WHEN** a Qdrant response is only acknowledged and is not completed
- **THEN** Foreman does not acknowledge the local outbox receipt
- **AND** it retries through the version-fenced path

#### Scenario: A payload index is missing

- **WHEN** collection qualification finds a missing, pending, or wrong-type
  required payload index or an incompatible strict-mode value
- **THEN** semantic projection and recall refuse before point mutation
- **AND** core operation remains available through `NullMemoryIndex`

### Requirement: Externally fenced projection mutations

Every project SHALL allocate a durable, monotonically increasing safe-integer
`projection_version` for each new desired-state mutation. A version SHALL never
be reused, including after acknowledgement, import, reopen, failed rebuild, or
registry recovery. The SessionStore SHALL retain the current version for each
projection key and include it in every `ProjectionRecord`. The local opaque
outbox receipt SHALL remain a separate compare-and-delete identity.

Writable migration SHALL allocate retained current versions for legacy live
entities in canonical counted-kind and ID order and queue their upserts. A
read-only open SHALL refuse when that migration is required. Migration and
import SHALL preserve atomic entity, counter, version, and outbox state on
failure.

The Qdrant adapter SHALL store `projection_version` and `live` in the point
payload. Upsert and retract SHALL both use the same deterministic point UUID
and one atomic conditional upsert that can replace only a lower version. A
retract SHALL write a `live=false` tombstone instead of deleting the point.
Recall SHALL filter for `live=true` before top-k selection. Equal-version retry
SHALL be an idempotent no-op. A lower late mutation SHALL be a no-op.

A projection-drainer lease and rebuild lease SHALL carry a durable fencing
token. Loss or takeover of a lease SHALL stop new dispatch by the old owner.
External version conditions SHALL preserve desired-state order even if an old
request was already accepted by Qdrant and settles after takeover.

#### Scenario: An old upsert settles last

- **WHEN** upsert version N times out, retract version N+1 applies and is
  acknowledged, and version N then settles
- **THEN** the point remains a version N+1 `live=false` tombstone
- **AND** the stale point cannot consume a recall result slot

#### Scenario: An old retract settles last

- **WHEN** retract version N times out, upsert version N+1 applies and is
  acknowledged, and version N then settles
- **THEN** the point remains the version N+1 live representation
- **AND** recall can return only the current representation

#### Scenario: A drainer lease is taken over

- **WHEN** a new drainer takes over after the prior owner stops renewing its
  lease
- **THEN** the new owner obtains a greater fencing token
- **AND** adversarial live tests prove that requests from the old owner cannot
  overwrite a greater desired-state version

#### Scenario: Projection version allocation would overflow

- **WHEN** the next project projection version is not a safe integer
- **THEN** the SessionStore mutation refuses before it changes entity or outbox
  state
- **AND** the existing counter and desired state remain unchanged

#### Scenario: Desired state is retried

- **WHEN** an external apply succeeds but the local acknowledgement fails
- **THEN** retrying the stable desired-state key is idempotent
- **AND** the live service contains one current representation of that key
- **AND** the local opaque receipt still protects a newer queued operation

#### Scenario: Recall returns a result

- **WHEN** the adapter returns semantic matches
- **THEN** it returns only bounded `EntityRef` values
- **AND** the consumer rehydrates current truth from `SessionStore`
- **AND** a missing, superseded, wrong-kind, or unknown reference is discarded

#### Scenario: The service fails

- **WHEN** the external service is absent, rejects, hangs, or returns plausible
  garbage
- **THEN** all system-of-record and core CLI results remain byte-identical to
  the `NullMemoryIndex` path
- **AND** pending projection work remains durable

### Requirement: Hermetic local embeddings

The external adapter SHALL generate embeddings inside `foreman-control`. It
SHALL use `@huggingface/transformers` 4.2.0 with npm integrity
`sha512-8BRCoBMH0XsWaEIamuR0LrJGAfftgHAfb2Vrffy0VKlSAE/MnUJ5/h/zTfEP3fDIft+nk7TqB8xXEyABGitBjQ==`
and
`onnx-community/all-MiniLM-L6-v2-ONNX` at revision
`aff7a1dc4e8a1ea593e6ea21e95c22ef0a25966f`. The model bytes SHALL include the
ONNX graph object with SHA-256
`2f019cf6217537cc4bfc7f5192f21dea1e18445177edaab0bc6163a813e5c7a1` and
the ONNX data object with SHA-256
`60c758432aa596c30a122942dfe594c457d4d713f890926f1c5f920bd496c8de`.
The embedding contract SHALL use mean pooling, normalization, 384 dimensions,
and cosine distance.

Foreman SHALL send Qdrant the vector and project-bound reference metadata. It
SHALL NOT send source text, repository paths, or SessionDB note bodies as
Qdrant payload fields. Runtime embedding SHALL require no external network,
model download, or model-service credential.

#### Scenario: The appliance runs offline

- **WHEN** the pinned model is present and external network access is denied
- **THEN** equal sanitized text produces equal normalized vectors
- **AND** semantic projection and recall remain available

#### Scenario: The embedding identity changes

- **WHEN** the model revision or embedding contract changes
- **THEN** Foreman requires a new projection epoch
- **AND** a live negative control proves the old and new identities do not mix

### Requirement: Projection epoch isolation

The external adapter SHALL map each project epoch to one Qdrant collection and
each project's active epoch to one stable Qdrant alias. A rebuild SHALL write
to a new collection, keep the current alias queryable, and make the new epoch
visible only after complete projection and catch-up. One atomic alias change
SHALL activate the new collection. The focused package SHALL define how a
single projection-drainer lease preserves concurrent writes and outbox draining
during rebuild. The complete snapshot SHALL use the current retained
`projection_version` for each key. Catch-up SHALL use the same version-fenced
conditional mutations in the active and candidate collections.

#### Scenario: A rebuild succeeds

- **WHEN** every live projectable row and every concurrent desired-state change
  is present in the new epoch
- **THEN** one activation changes recall to the new epoch
- **AND** queries exclude prior and abandoned epochs
- **AND** activation does not mutate `SessionStore`

#### Scenario: A rebuild fails before activation

- **WHEN** projection, catch-up, or activation fails
- **THEN** the current epoch remains active
- **AND** the incomplete epoch is never returned by recall
- **AND** the operator can retry or remove it without system-of-record loss

#### Scenario: Writes race with rebuild

- **WHEN** a session entity changes during a live rebuild
- **THEN** the protocol proves that the activated epoch contains the final
  desired state or refuses activation
- **AND** a live-service concurrency test exercises that race

#### Scenario: Recall races with activation

- **WHEN** concurrent clients hammer recall while the alias changes
- **THEN** each result comes entirely from the old or the new epoch
- **AND** no result is empty because of the switch and no result mixes epochs

#### Scenario: A projection is retracted twice

- **WHEN** Foreman applies a retract for an unknown point and then retries the
  same version or applies a greater retract version
- **THEN** the first operation creates a `live=false` tombstone
- **AND** the equal-version retry is a no-op
- **AND** a greater retract updates only the tombstone version
- **AND** no operation creates a searchable point

### Requirement: Hermetic Foreman appliance

The appliance SHALL use one pinned multi-stage OCI build graph. It SHALL expose
the role targets `foreman-toolchain`, `foreman-control`, and `foreman-worker`.
The current `sandbox/Dockerfile` SHALL remain the minimal untrusted-worker
boundary until an approved package replaces it.

#### Scenario: A new operator bootstraps Foreman

- **WHEN** the operator has a supported container engine and a repository
- **THEN** the documented Compose or Dev Container entry point starts the
  control plane without host language runtimes or global package installs
- **AND** `/workspace` contains the target repository
- **AND** `/state` contains durable Foreman state
- **AND** `foreman doctor` reports exact tool and skill identities

#### Scenario: The appliance builds

- **WHEN** the build resolves a base image, system package, language runtime,
  vendor CLI, skill, or Foreman runtime
- **THEN** it uses the version or digest from `env/reference-manifest.toml`
- **AND** a missing, floating, or mismatched pin causes a refusal

#### Scenario: A skill is installed

- **WHEN** an appliance image installs Foreman or Superpowers skills
- **THEN** immutable skill bytes reside under `/opt/foreman/skills`
- **AND** agent home paths link to those bytes
- **AND** runtime verification checks their manifest digest

#### Scenario: Credentials are needed

- **WHEN** a vendor CLI needs a credential
- **THEN** the operator injects it at runtime through an approved secret or
  credential mount
- **AND** the image, build context, layer history, logs, and attestations do not
  contain the credential

#### Scenario: Semantic memory is enabled

- **WHEN** the operator enables the optional semantic-memory Compose profile
- **THEN** Compose starts Qdrant by the pinned platform digest on a private
  network with a dedicated volume and generated API key
- **AND** Qdrant publishes no host port unless the operator enables the
  documented diagnostic override
- **AND** disabling the profile preserves all core Foreman behavior

### Requirement: Isolated hard-mode engine

The appliance SHALL NOT mount the operator's or default host container-engine
socket. Hard mode SHALL use a dedicated rootless Podman `system service` as its
engine service. The service SHALL run directly on a supported Linux host, not
nested in an OCI container. It SHALL run as the separate non-login account
`foreman-engine` with disjoint subordinate UID and GID ranges, a private runtime
directory, and a private engine-data directory.

At each hard-mode admission, the launcher SHALL inspect the control mounts and
resolve the canonical host realpaths that back `/workspace` and `/state`.
Durable configuration SHALL store the approved realpaths. Admission SHALL
re-derive device and inode identities after reboot or remount and compare them
with the current mount sources. It SHALL NOT freeze those identities at
bootstrap. Doctor SHALL run negative read, write, and target-root traversal
probes as `foreman-engine` against both roots and protected sentinels. Any
successful probe, mount substitution, symbolic-link substitution, or identity
mismatch SHALL refuse. The engine service SHALL NOT start first.

`env/reference-manifest.toml` SHALL name the exact Podman version, API
contract, host package identities, rootless network and storage helpers,
minimum kernel, and supported architectures. The release bundle SHALL contain
the pinned host bootstrap, systemd unit, and configuration templates. The
operator SHALL run the bootstrap explicitly with the authority required to
create the account, subordinate-ID ranges, directories, and unit. The bootstrap
and `foreman doctor` SHALL refuse a wrong, missing, overlapping, mutable, or
inaccessible prerequisite before a worker starts.

Hard mode SHALL support only the manifest-pinned Podman host on Linux. The
operator SHALL run the control appliance with rootless Podman, and the separate
`foreman-engine` account SHALL run the worker service. Docker and other
supported OCI engines MAY run soft mode but SHALL NOT satisfy hard-mode
admission. The bootstrap SHALL create the host-local service address, firewall
rule, and private name that the control resolves. A throwaway control container
SHALL complete an authenticated probe through that exact route before the
profile is enabled.

The service SHALL listen only on a host-local TCP endpoint and SHALL require
mutual TLS through Podman's native `--tls-cert`, `--tls-key`, and
`--tls-client-ca` options. The server key SHALL remain in mode-`0600` engine
runtime state. The client key SHALL enter the control container through a
runtime secret and SHALL exist only in `/run` tmpfs. The control SHALL pin the
private CA and expected server identity. It SHALL NOT mount a Unix socket, host
runtime directory, general engine socket, or other host path. The engine
account, filesystem permissions, host-local endpoint, and mutual TLS SHALL be
the service authority boundary.

The control plane SHALL be the trusted holder of this complete service
authority. Hard mode SHALL contain the untrusted worker and SHALL NOT claim to
contain a compromised control plane, which already has `/workspace` and
`/state` authority. A worker SHALL NOT receive the client certificate or access
to the service endpoint.

For each task, the control container SHALL create an engine-owned staging
volume through the mutual-TLS API. It SHALL send the clean worktree,
prompt, and non-secret task environment as one bounded tar archive through a
staging container archive endpoint. The worker SHALL mount only that volume.
Runtime credentials SHALL use the worker `tmpfs` protocol below and SHALL NOT
enter the archive. The control container SHALL retrieve one bounded result
archive, verify relative paths, entry types, byte and entry counts,
before/after manifest, and content digest, then apply the delete-aware result
to `/workspace`. It SHALL reject absolute paths, `..`, device nodes, sockets,
hard links, escaping symbolic links, duplicate paths, and excess expansion.
Cleanup SHALL remove the worker, staging container, and volume idempotently.
No host bind path SHALL cross the engine-service boundary.

When a task needs credentials, the control container SHALL start the worker
behind the fixed Foreman credential bootstrap with a private `tmpfs` at
`/run/foreman-secrets`. It SHALL send one separately bounded secret-only
archive to that running container through the private archive endpoint. The
bootstrap SHALL accept only manifest-listed filenames, write them with mode
`0400`, verify the secret manifest, and only then start the worker command.

Where a provider supports short-lived credentials, Foreman SHALL supply one
least-privilege task capability with an expiry and hard spend limit. Where a
provider supports only spend-capped sub-keys, Foreman SHALL create one per task
and revoke it during cleanup. Otherwise, only an explicit diagnostic override
MAY supply a long-lived key. Release evidence SHALL record that weaker mode.
Long-lived credentials SHALL NOT enter images, layers, worktree archives,
staging volumes, or container configuration.

A malicious worker can read, copy, encode, log, return, or send any credential
material that it receives. It can use an allowed provider connection. Hard mode
SHALL contain host and engine authority. It SHALL NOT claim to contain malicious
use of worker-readable credentials. Foreman SHALL scan stdout, stderr, and
result archives for exact canaries. It SHALL redact detected values and mark the
task compromised. Network policy SHALL block non-allowlisted destinations.
These controls SHALL detect disclosure and limit its effect. They SHALL NOT
claim to prevent disclosure. Cleanup SHALL revoke task credentials and destroy
the worker and its `tmpfs`.

#### Scenario: Hard mode starts

- **WHEN** the operator enables the hard-mode Compose profile
- **THEN** the control container connects only to the dedicated mutual-TLS
  Podman service
- **AND** the service runs as `foreman-engine` without host root privileges
- **AND** worker containers cannot access the service endpoint or the
  operator's engine socket
- **AND** hosted CI executes a real worker through this service path

#### Scenario: A host backing path is accessible

- **WHEN** an engine-account probe can read, write, or traverse a protected root
  or sentinel
- **THEN** hard-mode admission refuses before the service starts
- **AND** a reboot, remount, mount substitution, link substitution, or changed
  identity requires fresh derivation and comparison

#### Scenario: A worker discloses credential material

- **WHEN** a worker logs, returns, encodes, or sends credential material
- **THEN** exact canary detection redacts detected values and marks compromise
- **AND** non-allowlisted egress refuses
- **AND** allowed-provider disclosure remains an explicit residual risk
- **AND** expiry, spend limits, cleanup revocation, and the weaker override are
  present in release evidence

#### Scenario: A worker receives and returns task bytes

- **WHEN** hard mode starts a task from the control container
- **THEN** input and output cross the private Engine API as bounded archives
- **AND** no daemon bind mount names a control-local or host path
- **AND** delete-aware sync reproduces the validated result manifest

#### Scenario: A result archive tries to escape

- **WHEN** the worker returns an absolute, parent-relative, duplicate,
  unsupported, or over-budget archive entry
- **THEN** the control container refuses the complete result before workspace
  mutation
- **AND** cleanup removes only that task's engine-service objects

#### Scenario: The engine service is unavailable

- **WHEN** hard mode cannot reach or qualify the rootless Podman service
- **THEN** hard-mode lane admission refuses before a worker starts
- **AND** soft-mode diagnostics remain available
- **AND** Foreman does not fall back to the host socket

#### Scenario: The API reports a compatible version

- **WHEN** the version response passes but an image, container, volume,
  archive, tmpfs, inspect, wait, or cleanup endpoint fails its live probe
- **THEN** hard-mode qualification refuses
- **AND** the service version alone does not satisfy compatibility

### Requirement: Reproducible and attestable appliance

The appliance SHALL support `linux/amd64` and `linux/arm64`. The build SHALL pin
its base by digest, derive `SOURCE_DATE_EPOCH` from the candidate commit, and
emit an SBOM and provenance attestation. The release SHALL publish verification
instructions for the image digest and signature.

#### Scenario: Reproducibility is tested

- **WHEN** two clean builders use the same locked builder version, platform,
  source commit, build arguments, and reference manifest
- **THEN** their platform image digests match
- **AND** the release records both builder receipts

#### Scenario: Supply-chain evidence is checked

- **WHEN** the candidate image reaches the release gate
- **THEN** the host verifies its SBOM, provenance subject, source commit,
  reference-manifest digest, signature, and image digest
- **AND** any mismatch blocks publication

### Requirement: Graphify qualification before adoption

Foreman SHALL pin Graphify 0.9.48 and qualify it in isolation before it changes
the supported knowledge path. The qualification SHALL use code-only extraction
for the merge cadence and SHALL record zero semantic-model usage for that path.

#### Scenario: Graphify passes qualification

- **WHEN** Graphify 0.9.48 produces the candidate graph twice from identical
  source and configuration
- **THEN** the normalized graph bytes and health report match
- **AND** source locations, endpoint order, rename lineage, version identity,
  and freshness checks pass

#### Scenario: The health gate is discriminating

- **WHEN** the qualification suite runs a registered known-good corpus and each
  registered known-bad corpus
- **THEN** it accepts the known-good corpus
- **AND** it rejects every known-bad corpus for the expected reason
- **AND** a mismatched `built_at_commit` fails the freshness gate

#### Scenario: Graphify regresses

- **WHEN** qualification detects nondeterminism, lost source identity, a health
  regression, unexpected model use, or unsupported platform behavior
- **THEN** Foreman keeps the prior supported path or disables graph use
- **AND** later graph-dependent tranches do not claim readiness

### Requirement: Graph-independent operation

Foreman SHALL remain functional when Graphify is missing, stale, disabled,
unknown, or corrupt. Each derived artifact SHALL state its graph mode and graph
identity.

#### Scenario: No qualified graph is available

- **WHEN** a lane needs context and no qualified current graph exists
- **THEN** Foreman uses the direct-source or lexical path
- **AND** it records the degraded mode
- **AND** it does not supply graph claims from memory

#### Scenario: A stale or corrupt graph is present

- **WHEN** freshness, schema, digest, or health validation fails
- **THEN** Foreman rejects that graph before retrieval
- **AND** core lane execution remains available without it

### Requirement: Deterministic work-DAG projection

Foreman SHALL project a work DAG as a pure function of immutable source graph
identity, durable event-log records, run artifacts, and recorded rename maps.
The projector SHALL not modify the event log or the source graph.

#### Scenario: Identical inputs are projected

- **WHEN** the projector runs twice on byte-identical inputs
- **THEN** it emits byte-identical ordered output
- **AND** each record identifies the highest consumed event sequence

#### Scenario: A failed attempt exists

- **WHEN** an attempt timed out, failed, was refused, or was superseded
- **THEN** the work DAG includes the attempt and its recorded outcome
- **AND** it does not rewrite history to show only the successful path

#### Scenario: Evidence is incomplete

- **WHEN** the input has a torn tail, a missing terminal event, or an unknown
  identity
- **THEN** the projector marks the affected record incomplete with the exact
  reason
- **AND** it does not infer or repair the missing value

### Requirement: Bounded immutable context packs

Foreman SHALL build a content-addressed context pack before dispatch. The pack
SHALL bind the task, role, source commit, retrieval mode, source identities,
budget, ordered evidence, citations, and builder version. It SHALL not require
GraphStore.

#### Scenario: A context pack is built

- **WHEN** a task enters a lane
- **THEN** the host selects evidence within the approved token and item bounds
- **AND** it emits exact source locations and stable in-pack citation aliases
- **AND** it stores the immutable bytes and their digest with the run

#### Scenario: Implementer and auditor receive evidence

- **WHEN** the auditor reviews an implementation
- **THEN** the auditor receives the exact implementer pack bytes
- **AND** any auditor-only extension is a separately hashed, bounded artifact
- **AND** the verdict identifies both digests

#### Scenario: Dynamic retrieval is requested

- **WHEN** a lane uses the optional graph query escape hatch
- **THEN** the host applies vocabulary expansion and a strict result budget
- **AND** it returns structured source-cited data
- **AND** it logs the query, graph identity, result digest, and empty result

#### Scenario: A citation is invalid

- **WHEN** output cites an absent item, an item outside the pack, or a source
  location that no longer matches
- **THEN** deterministic verification reports the exact citation failure
- **AND** the gate does not treat the claim as supported

### Requirement: Locked evaluation corpus and arms

The program SHALL commit a canonical pool of exactly 50 representative
Foreman tasks before it measures any arm. The confirmatory analysis SHALL use
all 50 tasks. No result, variance estimate, budget observation, or interim
statistic SHALL select a prefix or remove a task. The corpus SHALL balance
callers and dependents of a changed interface, cross-package impact, event
producer to consumer tracing, and command entry point to persistence tracing.
Each task SHALL run against these locked arms:

- A: direct source.
- B: lexical retrieval.
- C: static graph retrieval.
- D: hybrid lexical and graph retrieval.

The corpus, prompts, scoring rules, budgets, candidate identities, and random
seeds SHALL be content-addressed and locked before any arm starts.

All four arms for one task SHALL use the same model, tools, prompt, token cap,
USD 4.50 monetary cap, 30-minute elapsed-time cap, and paired seed schedule.
The 2,000 task-runs SHALL reserve at most USD 9,000. The complete evaluation,
including scoring and control overhead, SHALL have an absolute USD 10,000
ceiling under one locked price table. Admission SHALL reserve the complete
budget before the first arm starts. Runs SHALL be serialized on one qualified
appliance host in one locked balanced order. Elapsed time SHALL be monotonic
wall time from task admission through the persisted scored verdict.

The only promotion contrast SHALL be hybrid arm D minus lexical arm B. The
report SHALL also publish A-to-B, A-to-C, B-to-C, and C-to-D contrasts as
diagnostics, but no diagnostic contrast can promote graph context. Each task
and arm SHALL run ten repeats under the same locked paired seed schedule.
The harness SHALL compute each task's repeat mean first and then compute the
macro mean across tasks for recall, precision, and task quality. It SHALL
compute token, cost, and elapsed-time effects as the median paired per-task
D-to-B ratio. It SHALL define token reduction as one minus the token ratio.

The release SHALL NOT use observed outcomes to choose sample size and SHALL NOT
claim post-hoc power. The report SHALL publish the fixed design and registered
confidence intervals. No additional sensitivity result SHALL change the
corpus, repeats, thresholds, promotion decision, or release admission.

The plan SHALL use a paired hierarchical percentile bootstrap with 10,000
resamples, seed `foreman-v040-eval-bootstrap-v1`, and two-sided 95-percent
confidence intervals. Each resample SHALL select tasks with replacement and
then select paired B/D repeat indices within each selected task with
replacement. The required completed sample SHALL be exactly 50 tasks and ten
repeats per arm. The registered recall-superiority target SHALL be 8 percentage
points.
The registered non-inferiority or efficiency margins SHALL be 2 points for
recall, 3 points for precision, 2 points for task quality, 10 percent for
elapsed time and cost, and 20 percent for context tokens. A confidence interval
that crosses zero for recall superiority or crosses an applicable
non-inferiority or efficiency margin SHALL be `inconclusive` for promotion.

Citation validity SHALL be a deterministic gate across every emitted citation.
Promotion SHALL require zero invalid citations, and the report SHALL record
the citation and task-run counts. It SHALL NOT report a 99-percent population
lower confidence bound from this zero-defect result. The program SHALL NOT add
tasks, repeats, alternate contrasts, or another analysis population after any
C or D result is read.

#### Scenario: An evaluation starts

- **WHEN** the corpus, prompt, score, budget, price, order, or seed lock is
  incomplete
- **THEN** arm measurement refuses
- **AND** no partial result can change the corpus or scoring rule

#### Scenario: One arm is unavailable

- **WHEN** any locked arm or repeat cannot run on any locked task
- **THEN** the complete promotion result records `uncomputable` with its reason
- **AND** no task is dropped and no missing value is imputed

#### Scenario: A diagnostic contrast looks favorable

- **WHEN** A-to-C or another diagnostic contrast passes a threshold but D-to-B
  does not
- **THEN** graph context does not advance to default-on
- **AND** the report publishes the diagnostic result without using it for
  promotion

#### Scenario: The confidence interval crosses a decision boundary

- **WHEN** a primary D-to-B confidence interval crosses its registered
  superiority, non-inferiority, or efficiency decision boundary
- **THEN** that promotion criterion is `inconclusive`
- **AND** the point estimate cannot override the interval

### Requirement: Promotion thresholds

Graph-assisted context SHALL remain non-default unless the locked D-to-B
evaluation meets all applicable thresholds:

- The retrieval recall point estimate is at least 8 percentage points and its
  lower confidence bound is greater than zero, or its lower bound is at least
  -2 points while the lower confidence bound for token reduction is at least
  20 percent. The latter is equivalent to an upper token-ratio bound of 0.80.
- The lower confidence bound for retrieval precision is at least -3 percentage
  points.
- Every emitted citation is valid.
- The lower confidence bound for task quality is at least -2 percentage points.
- The upper confidence bound for the median elapsed-time ratio is at most 1.10,
  unless the recall point estimate is at least 8 points and its lower bound is
  greater than zero.
- The upper confidence bound for the median cost ratio is at most 1.10.
- No task-run exceeds USD 4.50 or 30 minutes, and the complete evaluation does
  not exceed USD 10,000.
- Missing, stale, wrong-version, corrupt, and unknown graph controls are
  detected in 100 percent of registered cases.
- Core operation passes with graph use disabled.

#### Scenario: Every threshold passes

- **WHEN** the locked report and independent audit confirm every threshold
- **THEN** graph-assisted context MAY advance from opt-in to default-on
- **AND** the graph-off path remains tested and supported

#### Scenario: Any threshold fails or is inconclusive or uncomputable

- **WHEN** a required threshold fails or has no valid measurement
- **THEN** graph-assisted context remains opt-in or off
- **AND** the release publishes the negative or inconclusive result
- **AND** core v0.4 release work MAY continue if all non-graph requirements pass

### Requirement: Staged rollout and rollback

The program SHALL use the rollout order shadow, evaluation, opt-in, then
default-on only after threshold acceptance. Every enabled graph-assisted path
SHALL have a documented graph-off switch and rollback test.

#### Scenario: A post-release regression occurs

- **WHEN** graph-assisted context causes a correctness, availability, cost, or
  latency regression
- **THEN** the operator can disable it without changing source authority or
  SessionDB state
- **AND** direct-source execution continues

### Requirement: Exact-candidate release convergence

One unchanged pushed commit SHALL pass all release predicates. Results from an
earlier commit SHALL NOT satisfy a later candidate. The candidate digest SHALL
be SHA-256 of the lowercase 40-character commit ID's ASCII bytes without a
trailing LF. Evidence SHALL also bind its Git tree ID.

#### Scenario: The release candidate is verified

- **WHEN** the candidate reaches the final gate
- **THEN** clean install, type checks, focused tests, full tests, deterministic
  builds, runtime-manifest checks, compatibility checks, strict OpenSpec,
  documentation checks, appliance build and smoke tests, supply-chain checks,
  project-registry migration and wrong-repository controls, live Qdrant
  idempotency and epoch-race controls, graph negative controls, evaluation
  checks, and hosted platform checks pass
- **AND** Windows Bats item BW-004 passes on a native Windows runner
- **AND** a cold Codex audit approves the complete baseline-to-candidate diff
- **AND** every blocking audit finding is closed on the same candidate
- **AND** the locally prepared OCI index, SBOM, provenance, and signature
  bundle verify without requiring a public tag or release record

#### Scenario: Candidate bytes change after a pass

- **WHEN** any tracked product, test, generated runtime, specification, release
  note, image input, or evidence byte changes
- **THEN** affected checks and the final cold audit become stale
- **AND** publication waits for fresh results on the new candidate

#### Scenario: Publication preparation starts

- **WHEN** the pre-publication gate and cold audit pass
- **THEN** a durable external journal enters `prepared` before local integration
- **AND** it binds the expected old remote `main` tip, candidate commit, tree,
  digest, local artifacts, intended tag, and intended release identity
- **AND** a pushed review branch remains permitted before this state

#### Scenario: The candidate integrates and publishes main

- **WHEN** the journal is `prepared`
- **THEN** the architect fast-forwards local `main` to the audited candidate
- **AND** remote `main` is the first public release mutation
- **AND** its push compares and sets the expected old tip to that candidate
- **AND** a required merge commit or advanced remote `main` creates a new
  candidate or refuses
- **AND** tree equality does not substitute for commit identity
- **AND** the journal advances through `local_integrated`, `main_published`,
  `image_pushed`, `tag_pushed`, `release_created`, and `verified`

#### Scenario: Publication is interrupted

- **WHEN** the process stops before or after a journal transition
- **THEN** a stop before `prepared` leaves remote `main` unchanged
- **AND** recovery after `prepared` queries the exact target object
- **AND** a missing object permits the same compare-and-set operation
- **AND** a matching object makes the step idempotent
- **AND** a divergent object refuses without overwrite or deletion
- **AND** a failure after `main_published` resumes from that state and keeps the
  release incomplete

#### Scenario: Publication succeeds

- **WHEN** the post-publication gate runs on the journal's exact identities
- **THEN** `main` and the signed tag equal the audited commit
- **AND** the release record, public image index, SBOM, provenance, and
  signature equal the prepared objects
- **AND** a clean client pulls and smoke-tests the public image
- **AND** Endstop records publication complete
- **AND** the architect saves the final SessionDB release state

### Requirement: Explicit deferrals

The v0.4 release SHALL keep SQLite ontology storage, mandatory remote graph
storage, unbounded semantic graph generation, Council runtime, deliberation,
MCP transport, and broad dogfood carry-over work deferred. The coverage
register SHALL assign the Council and dogfood work to v0.5. A later release MAY
add the other deferred work only through a new approved OpenSpec package and
measured need.

#### Scenario: A deferred feature appears in an implementation proposal

- **WHEN** a lane attempts to add a deferred feature without a new approval
- **THEN** the architect rejects it as scope expansion
- **AND** the release task remains unchanged
