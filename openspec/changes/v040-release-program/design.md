# Design: Foreman v0.4 release program

## Design objective

Foreman v0.4 will make project knowledge useful without making graph state a
new authority. Stable project identity will ensure that cross-repository
references rehydrate from the correct SessionStore. Foreman will also become
installable as a pinned appliance.
The release is successful when a new operator can start Foreman from the
published image, run the same bounded workflow as the reference environment,
and use or disable graph-assisted context without losing core function.

## Authority model

The release uses the authority order in the normative specification. OpenSpec
owns active change truth. Superpowers owns the method used to reach that truth.
The integration rule is simple:

- Brainstorming produces an OpenSpec proposal and design.
- Writing-plans produces the package `tasks.md` file.
- User approval then binds the exact design manifest, task-plan digest,
  implementation-base commit, and implementation-base tree in external state.
- TDD executes the approved tasks.
- Foreman supplies worker isolation, independent audit, and merge gates.
- SessionDB preserves the canonical cross-session state.
- Endstop bounds the complete feedback loop.

No process step creates a competing active plan under
`docs/superpowers/specs/` or `docs/superpowers/plans/`. Existing legacy files
remain historical inputs until a separate approved change moves them.

The convergence package adds two closed workflow schemas:

- `foreman-bounded`: proposal, specifications, and tasks
- `foreman-architectural`: proposal, specifications, design, and tasks

Every active package declares one schema. Strict validation rejects a missing
artifact, an artifact created out of order, or a competing active plan. The
human approval receipt is the Endstop authorization hash plus a SessionDB
record. It binds the exact approved OpenSpec manifest, task plan, and post-plan
implementation base. It is external to the candidate and cannot be
manufactured by an implementation worker.

## Program dependency graph

```text
v0.3.1 baseline and approved v0.4 governor
                    |
       OpenSpec and process convergence
          /              |              \
 project registry    hermetic        Graphify 0.9.48
          |           appliance        qualification
 Qdrant MemoryIndex      |                  |
 and epochs              |          deterministic work DAG
          |              |                  |
          |              |          bounded context packs
          |              |                  |
          +--------------+---------- locked evaluation
                                        |
                         exact-candidate convergence
```

Authority convergence is the first dependency. The project registry,
appliance, and Graphify tracks can then run in parallel. Qdrant depends on
stable project identity. The appliance must join the knowledge track before
the locked evaluation so that the measuring environment is reproducible.
Graphify qualification fixes the graph identity that the projector and context
builder consume. The work DAG must exist before the builder can add
prior-attempt evidence. The builder must be stable before the evaluation can
lock its treatment arms. Final convergence joins all tracks and the Windows
Bats result.

## Package map

The release governor reuses focused packages after it reconciles them:

| Tranche | OpenSpec owner | Main result |
|---|---|---|
| 1 | `openspec-superpowers-convergence` | One active spec and task authority |
| 2 | `project-registry` | Stable project identity and store resolution |
| 3 | `external-memory-index` | Qdrant adapter and isolated projection epochs |
| 4 | `hermetic-foreman-appliance` | Pinned control, toolchain, and worker images |
| 5 | `knowledge-plane-refresh` | Qualified Graphify 0.9.48 and immutable graph metadata |
| 6 | `work-dag-projection` | Deterministic work-lineage artifact |
| 7 | `graph-context-builder` | Bounded, immutable, cited context pack |
| 8 | `graph-eval-falsification` | Locked four-arm evaluation and rollout verdict |
| 9 | `v040-release-program` | Windows Bats, integration, evidence, and publication |

The architect will reconcile an existing package before implementation. A
reconciliation can revise stale assumptions, split an unsafe scope, or mark a
package superseded. It cannot report an unchecked task as complete.

The governor contains the coverage register at
`openspec/changes/v040-release-program/coverage.toml`. It records the baseline,
the SHA-256 digest of the sorted active-package inventory, the SHA-256 digest
of `ROADMAP.md`, declared future package owners, and one keyed entry for every
active package and relevant Roadmap assignment. Entry dispositions are a
closed enum: `v040_owner`, `v040_dependency`, `released_reference`,
`superseded`, or `v050`. Reconciliation is `complete`, `required`, or
`not_required`. Each future-owner table contains `name`, `target_release`, and
`reason`.

Track 1 implements `packages/policy/src/release-coverage.ts`. The command has
three closed forms:

```text
release-coverage check --program v040 --phase bootstrap --owner openspec-superpowers-convergence --register ABS
release-coverage check --program v040 --phase lane --owner PACKAGE --repo ABS --state-root ABS --contract-id ROOT_ID --contract-sha ROOT_SHA --family-sha FAMILY_SHA --register ABS
release-coverage check --program v040 --phase release --repo ABS --state-root ABS --contract-id ROOT_ID --contract-sha ROOT_SHA --family-sha FAMILY_SHA --register ABS
```

The checker recomputes the active
inventory from `openspec list --json` as sorted UTF-8 names with one trailing
LF per name. It hashes the raw `ROADMAP.md` bytes, validates the fixed schema
and unique keys, parses the exact Roadmap assignment table, and verifies that
each owner is an existing package or a declared future package. The entry key
is the source identity. Multiple Roadmap entries intentionally share
`ROADMAP.md` as their source path. A missing key, duplicate key, missing
Roadmap row, stale digest, unknown value, invalid field combination, or
phase-relevant unresolved entry is a failure. Bootstrap requires Track 1 to be
reconciled. Lane admission requires every v0.4 entry owned by `PACKAGE` to be
reconciled. Release admission requires no v0.4 `required` entry. Every phase
checks workflow metadata only for packages that its reconciliation rule
requires to be complete.
Bootstrap accepts no family arguments. Lane and release resolve the registered
family source and exact package briefs through the named root and family state.
A caller-selected source or brief is not coverage authority.

Creating an approved future package changes the active inventory. The
architect must update the register and its inventory digest in the same design
milestone, validate it, and obtain the required exact-byte approval before
that package's implementation lane. Documentation-only reconciliation and
register maintenance are not product implementation lanes.

This bootstrap has one narrow admission exception because its authorities do
not exist yet. The exact approved governor, the current V1 root contract
receipt, and the user's exact-byte approval admit one atomic Track 1 authority
bootstrap. The bootstrap consumes the existing V1 root limits. It implements
the two OpenSpec workflows, `release-coverage check`, `release-admission check`,
and the `ExecutionContractV2` family activation protocol in one candidate.

Release authority uses canonical receipts and complete-file SHA-256 digests.
Endstop records the expected receipt or evidence-bundle digest before an action
can consume it, and SessionDB records the same digest at each human-approved
boundary. A caller-selected receipt path or digest is not authority. Each
receipt uses one closed schema and binds its program, package, action, candidate,
and source digests. Missing, mutated, substituted, or unregistered bytes are
invalid.

The bootstrap path scope is closed to these paths:

- `openspec/changes/openspec-superpowers-convergence/**`
- `openspec/schemas/foreman-bounded/**`
- `openspec/schemas/foreman-architectural/**`
- `packages/policy/src/release-coverage.ts`
- `packages/policy/src/release-coverage.test.ts`
- `packages/policy/src/release-admission.ts`
- `packages/policy/src/release-admission.test.ts`
- `packages/policy/src/release-admission-main.ts`
- `packages/policy/src/release-authority.ts`
- `packages/policy/src/release-authority.test.ts`
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
- `packages/orchestration/src/release-coverage-cli.ts`
- `packages/orchestration/src/release-coverage-cli.test.ts`
- `packages/orchestration/src/release-coverage-main.ts`
- `packages/orchestration/src/queue-admission.ts`
- `packages/orchestration/src/queue-admission.test.ts`
- `packages/orchestration/src/queue-cli.ts`
- `packages/orchestration/src/queue-cli.test.ts`
- `packages/orchestration/src/queue-main.ts`
- `packages/orchestration/src/queue-services.ts`
- `packages/orchestration/src/release-authority-cli.ts`
- `packages/orchestration/src/release-authority-cli.test.ts`
- `packages/orchestration/src/release-authority-main.ts`
- `packages/orchestration/src/release-policy.ts`
- `packages/orchestration/src/release-policy.test.ts`
- `packages/orchestration/src/release-policy-main.ts`
- `packages/orchestration/src/release-boundary.ts`
- `packages/orchestration/src/release-boundary.test.ts`
- `packages/orchestration/src/index.ts`
- `packages/orchestration/src/index.test.ts`
- `scripts/build-runtime.ts`
- `scripts/verify-runtime.ts`
- `scripts/verify-runtime-manifest.ts`
- `scripts/verify-runtime-manifest.test.ts`
- `skills/foreman/scripts/lib/release-policy.sh`
- `skills/foreman/scripts/gate-eval.sh`
- `skills/foreman/scripts/merge-gate.sh`
- `skills/foreman/SKILL.md`
- `tests/release-policy.bats`
- `tests/gate-eval.bats`
- `tests/merge-gate.bats`
- `tests/baseline.tsv`
- `tests/fixtures/release-policy/**`
- `packages/policy/package.json`
- `packages/orchestration/package.json`
- `packages/orchestration/tsconfig.json`
- `package-lock.json`
- `skills/foreman/runtime/dist/**`
- `skills/foreman/runtime/manifest.json`

No other product path is admitted.
The runtime builder emits `release-coverage`, `release-admission`,
`release-authority`, and `release-policy` artifacts. `release-policy.sh` is the
one-artifact adapter for the compiled policy. The established `gate-eval.sh`
and `merge-gate.sh` boundaries retain their general gate, merge-base,
freshness, event, and output behavior, then invoke the compiled release policy.
Gate evaluation runs policy only after the general result. Merge check runs it
against the named branch before it can return `MERGEABLE` and keeps the one-line
contract. Gate and merge require the non-caller-controlled expected action
`integrate`. Publication requires `publish`. Hostile tests prove that a valid registered `verify` downgrade, a
missing artifact, failed coverage, or invalid action evidence fails closed.
The exact runtime verifier and installed-runtime decoder treat all four release
artifacts as required. Their tests compare two clean builds, tracked
bytes, and the exact `dist` inventory. Copied-install controls reject a missing
or changed artifact and reject removal of an artifact together with its
manifest entry.
Hostile tests cover mutable audit policy, stale identity, malformed receipts,
nonempty findings, and partial bootstrap output.

After the bootstrap integrates and activates the family, each later lane must
pass both policy checks. Before a reused v0.4 package enters a lane, the
architect must reconcile every `required` entry and strict-validate the
corrected ledger. The graph ledgers must remove stale shell and Bats
implementation assumptions. They must resolve directed-versus-undirected graph
claims and use the Node 24 TypeScript, Effect, and TypeScript-test boundary.
The `knowledge-plane-refresh` reconciliation must remove its broad
`lock-primitive-hardening` prerequisite. Track 5 owns the narrow TypeScript and
Effect advisory lock that guards its single writer.
Council runtime, deliberation, MCP transport, and broad dogfood carry-over
remain assigned to v0.5.

## Foreman release loop

One immutable Endstop contract family persists outside all worktrees. The
existing V1 root contract is the authority anchor:

- ID `v040-release-20260822-r5`
- SHA-256 `604839a9a3da192138b68ced2019b404c1a079d0dc4548ebcee48ba8bbe220d1`
- deadline `2026-08-31T13:25:38Z`

Track 1 activates `ExecutionContractV2` once before that deadline. Activation
appends one event to the root Endstop RunJournal. It refuses after a root
terminal state and refuses a second activation. The canonical family manifest
binds the root, Track 1 commit and tree, and exactly eight immutable child
contracts for Tranches 2 through 9. The manifest does not contain the digests
of receipts that approve itself. After the manifest bytes exist, one exact-byte
`APPROVED` audit receipt and one exact-byte user approval receipt each bind the
manifest digest. The root Endstop bootstrap record supplies both expected
receipt digests. The atomic activation event binds the manifest, registered
source, and both receipt digests. This order has no self-referential digest and
does not trust caller-selected substitutes.

One canonical external family-source file supplies each child objective,
acceptance list, and allowed-path list. The Track 1 builder derives their exact
component digests, binds the source digest in the manifest, and writes distinct
manifest, source, and eight package-brief outputs. Registration durably stores
the source set by family manifest digest before journal append. Lane and release
coverage require each family package's `release-brief.json` to match that
registered source. The builder gets
`createdAt` from the host clock and sets `deadlineAt` to exactly 60 days later.
Every child absolute deadline equals that value. Activation rejects a future
creation time and requires creation before the V1 root deadline.

Family authority registration is first-write-wins by root contract ID. An
identical replay is idempotent. A different-family or other conflicting loser
appends nothing. Activation reads the caller manifest, registered source set,
and exact prior source-bound registration, not caller-supplied source or receipt
paths. Every family and child command binds the same
root contract ID and digest.
The existing root `RunJournal` stores the exact family-authority, activation,
child-authority, registered-outcome, evaluation-verdict, and child-decision
payload union. It creates no child journal or stream. Authority precedes
reservation. Outcomes follow their exact reservations. A child operation that
uses an outcome follows its registration. An exact V2 operation and matching
`ExecutionV2Event` array make each lifecycle mutation replayable.

The family has a 60-day wall-time limit of `5184000000` milliseconds and a
`4096`-action limit. All actions consumed by the V1 root count against that
limit. Standard children use at most 100 actions and 14 days. Each standard-
child manifest assigns exact positive values to the V1 action-limit fields,
`totalActions`, `wallTimeMs`, and `noProductChangeMs`; it does not inherit a
mutable default. It applies the V1 deadline, no-product-change, action-limit,
verification-per-candidate, and terminal-transition rules. Tranche 8 uses an
evaluation child with exactly 2,000 `evaluate` actions, at most 2,048 total
actions, a 45-day wall time, and a one-hour no-progress limit. Its manifest
also assigns exact limits to every non-evaluation action. The 45-day limit
covers the locked 1,000-hour serialized worst case plus bounded control
overhead. Each child deadline is at or before the family deadline.

The child limits are a closed union. Standard limits contain
`kind="standard"` and `noProductChangeMs=259200000` but no `noProgressMs`.
Evaluation limits contain `kind="evaluation"` and `noProgressMs=3600000` but no
`noProductChangeMs`. The evaluation no-progress timer covers all child activity.
Every child clock starts at its first accepted action, including a
pre-evaluation action. Tranche 8 progress resets only on product change,
milestone recording, or a matching registered `PASS` outcome.
Reservation, retry, resume, advice, blocking, and failure do not reset it.

One root RunJournal transaction appends each child action reservation. Replay
derives both child and family counters from that event. An action with an
unknown crash outcome remains spent. A retry consumes another action. The
runtime never hides multiple provider calls behind one reservation. An
unlisted child or action refuses. Family termination terminates all children.
A child terminal state does not reset another child.

Ordinary child authority uses a null retry key. `provider_retry` and `resume`
authority use their immediate prior reservation as part of the registration
key. This permits chained retries and retries of different effective actions on
one candidate without permitting conflicting authority for one retry attempt.

Each tranche follows this state machine:

```text
approved spec
     |
task plan and isolated worktree
     |
Grok test-first implementation
     |
host focused checks
     |
Codex cold diff audit
     |
correction loop, if required
     |
exact-candidate gate
     |
architect integration and SessionDB milestone
```

The cold auditor does not inherit the implementer's conclusions. It receives
the approved requirements, exact base and candidate identities, complete diff,
and deterministic evidence. The model reports `APPROVED`, `WARNING`, or
`BLOCKED`. The harness records a typed `UNVERIFIED` result when no valid model
judgment exists. Only an exact `APPROVED` audit receipt with no findings admits
integration or publication. Earlier actions use a closed action-specific
evidence rule. Design approval admits the first implementation from its exact
base and a later implementation from the exact current lineage. Frozen host
checks admit audit. A registered blocking or unverified result admits correction.
Retry or resume must identify the immediate failed reservation, first
origin, and effective action that it continues.
Invalid or missing action evidence refuses before reservation.

The first implementation also requires the candidate commit and tree to equal
the registered historical design identity and requires the exact task-plan digest.
Each later implementation starts from the complete current journaled candidate
under that same registered plan and direct-parent lineage. A registered
council request admits a council call; its registered outcome is later child
outcome evidence and cannot admit that same call. Every evidence bundle is
canonical and registered by its complete-file digest. The fixed queue, gate,
and merge block contains one copy of
root, family, child, action, and candidate identity. One TypeScript parse drives
both policy and reservation, including candidate-digest-to-commit equality and
package-to-child equality.

Canonical action and Council outcomes bind the root, family, child, package,
candidate, and exact spent reservation. Endstop registers each outcome digest
in the root journal before it can change child state. Product change binds an
implement or correct reservation. Endstop derives the output Git identity,
requires a distinct direct-parent commit, and verifies its base-to-output diff
against allowed paths loaded from the registered family source. Product change
precedes milestones. Matching `PASS`
outcomes record checks, audit, integration, and publication in that order for
one current candidate. Premature, forged, unregistered, wrong-reservation,
out-of-order, and conflicting outcomes refuse. Identical replay is idempotent.
Cancellation and invalidation require an exact registered user approval bound to the root,
family, child, terminal, and reason.

Track 1 implements this rule in `packages/policy/src/release-admission.ts` and
the `release-admission check` command. The command resolves the named candidate
commit and tree in the supplied repository and verifies canonical evidence and
its complete-file digest. Because it has no Endstop identity,
it returns only `EvidenceValid` or `EvidenceInvalid` and cannot authorize an
action. Only composed `release-policy` checks the expected Endstop digest and
returns `Admitted`. Neither reads `[audit.policy]`. Every later v0.4 queue, integration gate, and
publication gate runs phase-aware coverage and the action-specific evidence
policy. Mutable repository or machine configuration cannot weaken this rule.
The standalone and composed boundaries reconstruct the approved OpenSpec
manifest and task plan only from bounded Git blobs in the registered design commit.
They verify its tree and never use candidate, worktree, mutable `HEAD`, or
caller-path bytes as those preimages.
Before the atomic authority bootstrap exists, only its exact candidate can
consume content-addressed `APPROVED` governor receipts. The receipts bind the
exact commit, tree, governor digest, and empty finding set. The V1 root receipt
and the user's exact-byte approval must also match. No other product work uses
this exception.

The architect owns commits, integration, and publication. Workers do not merge,
rewrite release evidence, or mark SessionDB obligations complete.

The Endstop runtime reserves each action before it starts. The root RunJournal
remains authoritative at a tranche boundary. A package, child contract,
worktree, session, retry, or crash cannot reset family counters or deadlines.

## Stable project registry

One SessionStore remains authoritative for one logical project. A separate
machine-local registry maps a port-minted project UUID to the repository Git
common directory, known worktree paths, store backend, and store location.
Linked worktrees that return the same `git --git-common-dir` share one project
identity. The SessionStore project UUID and registration operation UUID form a
durable local marker. The UUID is stored with exported project data, so it
survives an explicit path move and an explicit restore.

The registry never guesses across repositories. It verifies project identity
from the matching store UUID and registration operation UUID, not from commit
history, remote URLs, a directory path, or a display name. A path move needs an
explicit receipt that binds the UUID, prior registry generation, old and new
paths, and store-identity metadata digest. Opening a repository at a new path
does not update the registry. A missing or deleted project is unavailable, not
falsely fresh. Current-project recovery stays exact and offline by default.
Cross-project recovery is an explicit operation.

`EntityRef` gains `project_id`. Existing stores and serialized references use
an explicit migration. A semantic result is rehydrated only through the store
registered for its project UUID. A wrong project, missing project, wrong kind,
missing entity, or superseded entity is discarded or reported unavailable.

Row import and project identity are separate policies. An exact restore into an
unbound empty store needs a source retirement receipt or an explicit recovery
receipt. It adopts the donor UUID, next projection version, per-key current
versions, pending records, and queue order only when no live registry binding
uses the UUID. A same-backend restore preserves opaque receipts and the next
receipt counter. A cross-backend restore mints target receipts for pending
records in queue order and sets the next receipt counter to the first
unallocated value. The restored external adapter starts unqualified and must
build and activate a fresh epoch before recall.

Destructive replacement and additive remap into a registered target keep the
target UUID and allocate fresh target projection versions without reducing its
version counter. Remapped rows become target-project rows. An explicit clone or
fork copies donor entity rows, IDs, and `nextIds`, but it mints a new UUID. In
canonical counted-kind and ID order, it allocates projection versions starting
at 1 and one new upsert receipt for every live projectable row. Its next version
and next target-backend receipt counter are their respective first unallocated
values. An empty clone keeps both counters at their target-backend initial
values. It copies no donor projection version, tombstone, or opaque receipt. A
copied store that claims a UUID already bound to an accessible store is a
conflict; Foreman does not choose one copy automatically.

Each registry authority has a UUID and an Ed25519 identity key. The key
fingerprint is SHA-256 of the raw 32-byte public key. The private key is runtime
state with mode `0600` or an equivalent Windows ACL. It is never in an image,
project export, or release artifact. Registry initialization pins one immutable
operator approval-authority UUID, literal generation `1`, and Ed25519
public-key fingerprint. This one-shot pin occurs before the first project
registration. The operator approval key is distinct from the source registry,
destination registry, and project recovery keys.

A migrated registry without this record refuses transfer, exact project import,
and project restore. One explicit operator command can add the generation-1
record before any project registration. A second pin or a pin after project
registration refuses. A bundle, import, restore, migration, or recovery receipt
cannot create, replace, or downgrade the record. A lost or compromised approval
key blocks normal and recovery transfer in v0.4. v0.4 has no bypass or in-place
rotation. A later approved protocol can define replacement.

A destination first signs an offer that binds its registry authority UUID,
proposed operation UUID, project UUID, canonical Git common directory, selected
store backend, and target store locator digest. A retirement receipt binds that
complete offer digest, destination authority, transfer nonce, project UUID,
export digest, source store operation UUID, source registry generation,
retirement disposition, and exact external approval digest. The source
registry signs it. The operator approval binds the offer digest, transfer
nonce, source and destination registry-key fingerprints, operator approval-
authority identity and literal generation `1`, the recovery-key fingerprint, destination
authority, project UUID, export digest, and proposed operation UUID. The
separately held operator approval key signs it. A normal transfer
requires the same approval-authority identity and literal generation `1` in both
registries. Recovery requires that identity in the destination registry and in
the project registration record.

The source computes the signed receipt before mutation, but it makes the bytes
usable only by storing the complete receipt in the same SessionStore
transaction or paired generation that marks the source transferred and refuses
later writes. Receipt emission is an idempotent read of those durable bytes. A
crash before that store commit leaves the source writable and no usable
receipt. A crash after it leaves a durable receipt that startup re-emits and
uses to finish registry retirement. There is no rollback after the retirement
commit. Failure at the destination retries the same receipt. Moving the project
back is a new signed transfer.

At project registration, the SessionStore also records the fingerprint of an
operator-held Ed25519 recovery key and the approval-authority UUID, literal generation `1`,
and fingerprint. If the source no longer exists, a recovery receipt uses the
recovery key and binds a unique transfer nonce, the destination offer, the same
project and export identities, last-known store operation UUID, last-known
registry generation, operator assertion, and external approval digest. An
unavailable value is the explicit value `unknown`. The recovery path is
operator-attested and release evidence labels it as weaker than source
retirement.

Both receipts bind exactly one destination registry authority and proposed
operation UUID. The destination reservation binds the receipt digest and
nonce. Finalization marks it consumed inside that authority. Retry with the
same receipt, destination, and operation UUID is idempotent. A mismatch or use
under another authority refuses before mutation. v0.4 claims single use inside
one destination registry authority, not global exactly-once consumption. A
copied live registry authority is an identity conflict.

Exact project export uses a new `SessionTransferEnvelopeV1`; it does not change
the row-only `SessionSnapshot` contract. The envelope is RFC 8785 canonical
JSON, is at most 256 MiB, and contains at most 1,000,000 entity rows and 100,000
pending entries. The complete bundle is at most 257 MiB, and each non-snapshot
string is at most 64 KiB of UTF-8. The envelope has only these top-level fields:

- `schema`, with the literal value `foreman.session-transfer.v1`
- `source_backend`, with `sqlite` or `files-only`
- `project`, with the project UUID, source registry authority UUID, unpadded
  base64url raw 32-byte public key, recovery-key fingerprint, approval-authority
  UUID, literal approval-key generation `1`, approval-key fingerprint, source
  store operation UUID, and nonnegative safe-integer source registry generation
- `snapshot`, with the complete `SessionSnapshot`
- `projection`, with a positive safe-integer `next_version`, unique
  projection-key/version rows in lexical key order, a positive safe-integer
  `next_receipt`, and pending `OutboxEntry` values in durable queue order

Each projection version is a positive safe integer. Projection keys and opaque
receipts are unique. The next counters are greater than every allocated value
that they govern.

`ExternalTransferApprovalV1` is a closed, signed RFC 8785 object. It has schema
`foreman.external-transfer-approval.v1`, approval UUID, operator approval-
authority UUID, literal key generation `1`, raw public key, destination-offer
digest, transfer nonce, source and destination registry-key fingerprints,
recovery-key fingerprint, destination authority UUID, project UUID, export
digest, proposed operation UUID, and signature. Its SHA-256 digest is the
external approval digest.

The other signed authorization object schemas are:

- `DestinationOfferV1` has schema `foreman.destination-offer.v1`, destination
  authority UUID, destination raw public key, proposed operation UUID, project
  UUID, canonical Git common directory, store backend, target store locator
  digest, and signature.
- `RetirementReceiptV1` has schema `foreman.retirement-receipt.v1`, destination
  offer digest, destination authority and operation UUIDs, transfer nonce,
  project UUID, export digest, source store operation UUID, source registry
  generation, `retired` disposition, external approval digest, and signature.
- `RecoveryReceiptV1` has schema `foreman.recovery-receipt.v1`, destination
  offer digest, destination authority and operation UUIDs, transfer nonce,
  project UUID, export digest, last-known source store operation and registry
  generation or literal `unknown`, operator assertion, external approval
  digest, raw recovery public key, and signature.

Public keys and 64-byte Ed25519 signatures use unpadded base64url. Each
signature covers the canonical object with its `signature` field omitted. The
verifier rejects an extra, missing, duplicate, wrongly encoded, or wrong-type
field before signature verification.

SHA-256 of the canonical envelope bytes is the export digest. A transfer bundle
contains the envelope, signed destination offer, signed external approval, and
exactly one signed retirement or recovery receipt. These three authorization
artifacts are not inside the envelope digest. Validation first applies parse,
size, schema, closed-field, canonical-byte, and digest checks. It then computes
each raw public-key fingerprint and compares it with its registered identity.
It checks the destination key against the named destination registry, the
approval key against the pinned operator authority, the source key against the
source registry when available, and the recovery key against the project
registration record. It verifies the offer with the destination key, the
approval with the operator key, a retirement receipt with the source key, and a
recovery receipt with the recovery key. It then compares every offer, nonce,
authority, project, operation, export, key-generation, and approval-digest
binding across the artifacts. Only after these checks does it validate safe
integers, receipt invariants, SessionSnapshot integrity, and registry
admission, then perform one atomic target publication. An unknown version,
unknown backend, non-canonical encoding, duplicate key or receipt, unknown or
mismatched authority, invalid signature, counter mismatch, or malformed row
refuses before source retirement or target mutation. Same-backend restore
preserves opaque receipts. Cross-backend restore remints them in queue order.
`importSnapshot` remains row import and cannot perform exact project restore.

A writable registry migration creates its authority UUID and identity key. One
explicit operator action can add the missing immutable approval authority before
any project registration. An explicit writable project migration records the
project UUID, operation UUID, recovery public-key fingerprint, and immutable
approval-authority identity. A read-only open that needs any migration refuses
without changing registry or store bytes.

Registry-changing operations use an idempotent three-step protocol:

1. The registry reserves the project UUID, canonical Git identity, target path,
   exact predecessor operation UUID, and one proposed operation UUID in a
   transaction. An initial store uses an explicit empty predecessor.
2. The SessionStore atomically publishes its project UUID and the same
   operation UUID.
3. The registry verifies the store metadata and marks the reservation active.

Startup recovery uses this matrix for pending operation B with predecessor A:

- A store at B finalizes B.
- A store still at A cancels B.
- A store at any other value is a conflict.
- An inaccessible store causes refusal without mutation.

Transfer recovery adds these exact cases:

- An active source store with no durable receipt cancels its uncommitted
  transfer intent.
- A transferred source store with matching durable receipt bytes retires its
  registry binding and re-emits the same receipt.
- A destination reservation whose store remains at predecessor A cancels the
  reservation without consuming the receipt.
- A destination store at B with the matching receipt digest finalizes B and
  marks that receipt consumed.
- Any other store operation, receipt digest, nonce, authority, or destination
  binding is a conflict and mutates nothing.

The complete restore or clone store publication includes entity, identity,
counter, per-key version, and outbox state in one SQLite transaction or one
paired files-only generation. Registry uniqueness on project UUID and Git
common directory prevents two active local bindings. This protocol cannot make
two databases one transaction; it makes every crash boundary explicit and
idempotently recoverable. Fault injection covers every boundary in the source
receipt commit and destination reserve, publish, and finalize protocols.

## Qdrant MemoryIndex and projection epochs

The release uses Qdrant 1.19.0 for the first external adapter. Qdrant points
support caller-owned UUIDs and idempotent upsert. Qdrant collection aliases can
change atomically. These properties fit Foreman's durable desired-state outbox
and isolated epoch contract without an upstream fork. The reference manifest
pins the source revision, multi-platform image index, platform manifests, and
`@qdrant/js-client-rest` 1.19.0.

The v0.4 support boundary is one Qdrant node with one shard, one replica, and a
write-consistency factor of one. Each conditional mutation uses strong write
ordering and waits for completion. Each point read, semantic query, scroll, and
rebuild verification uses read consistency `all`. Startup and `foreman doctor`
read the live topology and refuse semantic mode if any setting differs. This
boundary avoids claiming distributed consistency that v0.4 does not test.
Multi-node and multi-replica support needs a later package with its own failure
and split-brain model.

Every active and candidate collection enables strict mode with unindexed
filtering refused for retrieval and updates. Before the first point mutation,
Foreman creates and waits for an integer range index on
`projection_version`, a boolean index on `live`, and keyword indexes on
`project_id`, `kind`, `epoch_id`, and `model_id`. Startup and `foreman doctor`
inspect the exact index schemas and strict-mode values. A missing, pending,
wrong-type, or unexpected index contract refuses semantic mode.

The adapter preserves the existing split:

- `SessionStore` remains synchronous, exact, and authoritative.
- `MemoryIndex` remains asynchronous, optional, and derived.
- the durable outbox remains idempotent at-least-once
- recall returns project-bound references for SessionStore rehydration
- subtractive projection redaction remains in force

A deterministic UUID point ID derives from a fixed Foreman namespace,
`project_id`, counted kind, and entity ID. The Qdrant payload contains only the
schema, project, entity, epoch, model, desired-state version, and live-state
fields. It does not contain source text, repository paths, or SessionDB note
bodies.

Stable point IDs alone do not fence late requests. The SessionStore therefore
allocates a never-reused, monotonically increasing `projection_version` in the
same atomic entity and outbox mutation. It retains the current version after
acknowledgement. A `ProjectionRecord` carries this version separately from its
opaque local receipt.

Writable migration assigns versions to legacy live entities in canonical kind
and ID order and queues their upserts in the same transaction or paired
generation. Read-only open refuses when migration is required. A failed
migration or import leaves entity, counter, version, and outbox state unchanged.

Qdrant stores `projection_version` and `live` with the point. Each upsert and
retract is one conditional upsert that applies only when the stored version is
lower. A missing point accepts the first mutation. An equal-version retry and
a lower late mutation are no-ops. Retract writes a `live=false` tombstone with
the same deterministic point ID and a placeholder vector. Recall filters
`live=true` before top-k selection. The tombstone prevents a late old upsert
from recreating a searchable point.

The drainer and rebuild lease also has a monotonically increasing fencing
token. A prior owner stops new dispatch when it loses the lease. The Qdrant
version condition remains the final fence for a request that the server already
accepted. The live test will delay version N, apply and acknowledge N+1, then
release N. It will run this sequence for upsert followed by retract, retract
followed by upsert, and lease takeover.

Each project epoch is one Qdrant collection. A stable per-project alias names
the active collection. A rebuild acquires the single projection-drainer lease,
creates a candidate collection, projects the complete validated snapshot,
applies concurrent desired-state changes to the required collections, catches
up, and then changes the alias atomically. A failed rebuild leaves the old
alias active. An abandoned collection remains unqueried and can be removed or
rebuilt. Snapshot projection uses the retained current version for every key;
catch-up uses the same conditional mutation protocol in both collections.

The appliance generates embeddings locally with
`@huggingface/transformers` 4.2.0 and
`onnx-community/all-MiniLM-L6-v2-ONNX` revision
`aff7a1dc4e8a1ea593e6ea21e95c22ef0a25966f`. Mean pooling and normalization
produce 384-dimensional cosine vectors. The model bytes are pinned by content
digest and present in the control image. Runtime projection needs no external
model endpoint, credential, or download.

Mock tests cover deterministic failures. Live Qdrant tests must also prove:

- retry idempotency and a distinct-key negative control
- repeated and unknown-point retraction
- delayed old-upsert and old-retract settlement after a newer acknowledged
  mutation
- drainer-lease takeover while an old external request remains in flight
- inactive-epoch poison isolation
- concurrent recall during atomic alias activation without an empty or mixed
  result
- failed-epoch abandonment and destroy-and-rebuild recovery
- stable top-k recall for the pinned embedding and a changed-model negative
  control
- refusal of weak-ordering, non-completed writes, and unsupported topology
- refusal of missing or wrong payload indexes and changed strict-mode settings
- the existing fault-injection conformance suite against the live adapter

`NullMemoryIndex` remains the default after this adapter ships.

The adapter decision uses these primary sources:

- [Qdrant points](https://qdrant.tech/documentation/manage-data/points/)
  documents caller-owned UUIDs, idempotent loading operations, and conditional
  updates for optimistic concurrency control.
- [Qdrant collections](https://qdrant.tech/documentation/manage-data/collections/)
  documents background collection builds and atomic alias changes.
- [Qdrant 1.19.0](https://github.com/qdrant/qdrant/releases/tag/v1.19.0)
  identifies the selected stable release.
- [TencentDB-Agent-Memory 2.0.0](https://github.com/TencentCloud/TencentDB-Agent-Memory/tree/v2.0.0)
  is the historical service candidate whose public create path does not accept
  a caller-owned message ID.

## Milestone records

Every accepted boundary writes a SessionDB record against the common database.
Stable architectural or release identities are facts. Perishable commands and
test results are measurements with exact scope. Audit findings and unfinished
work are obligations. Decisions record the chosen option and rejected options.

Each tranche milestone binds:

- release and tranche name
- base and candidate Git identities
- approved OpenSpec digest
- implementation commit and tree
- focused-check commands and result digests
- auditor identity, verdict, and report digest
- correction identity when applicable
- integration identity
- remaining obligations

The session closes with a checkpoint when work pauses. Resume reads SessionDB
first and treats an old measurement as stale until the command passes again on
the current candidate.

## Hermetic appliance

### Build graph

The appliance adds one multi-stage OCI build graph. It does not expand the
purpose of the existing `sandbox/Dockerfile`.

- `foreman-toolchain` installs the pinned operating-system packages, Node.js,
  package managers, Git, shell tools, container client, vendor CLIs, Graphify,
  and deterministic verification tools.
- `foreman-control` adds the Foreman source, compiled runtime, immutable skills,
  nonroot control user, entry point, doctor command, and state layout.
- `foreman-worker` contains only the tools allowed inside an untrusted hard-mode
  task. It preserves the current sandbox security boundary.

`env/reference-manifest.toml` becomes the sole lock authority for base image
digests, tool versions, vendor CLI versions, skill revisions, Graphify version,
and builder version. The build has no `latest`, unbounded range, or mutable
branch input. A generated lock projection is allowed only when a test proves it
is a pure representation of the manifest.

The filesystem contract is:

```text
/opt/foreman/bin       compiled Foreman entry points
/opt/foreman/skills    immutable installed skill trees
/workspace             operator repository mount
/state                 durable SessionDB, Endstop, queues, and run artifacts
/run/foreman           ephemeral sockets and process state
```

The container runs as a nonroot user. Compose and the Dev Container definition
use the same image and mounts. They do not build different products.

The optional semantic-memory Compose profile starts Qdrant by the pinned
platform manifest. It uses a private network, a dedicated state volume, and a
generated API key. It publishes no host port unless the operator enables the
documented diagnostic override. Disabling the profile restores the
`NullMemoryIndex` path without changing core behavior.

### Hard-mode topology

The control container has no path to the operator's general container engine.
Hard mode uses a dedicated rootless Podman `system service` as its engine
service. The service is not nested in an OCI container. It runs as the separate
non-login Linux account `foreman-engine`, with disjoint subordinate UID and GID
ranges, a private runtime directory, and a private engine-data directory.

At each admission, the launcher inspects the control mounts and resolves the
canonical host realpaths that back `/workspace` and `/state`. Durable
configuration stores the approved realpaths. Admission re-derives device and
inode identities after a reboot or remount and compares them with the current
mount sources. It does not freeze those identities at bootstrap. Doctor runs
negative read, write, and target-root traversal probes as `foreman-engine`
against both host roots and protected sentinels. Any successful probe, mount
substitution, symbolic-link substitution, or path-identity mismatch refuses.
The engine service does not start before these checks pass.

`env/reference-manifest.toml` names the exact Podman version, API contract,
host package identities, rootless network and storage helpers, minimum kernel,
and supported Linux architectures. The published bundle contains the pinned
host bootstrap, systemd unit, and configuration templates. The operator runs
that bootstrap explicitly with the authority needed to create the account,
subordinate-ID ranges, directories, and unit. No host language runtime is
required. A wrong, missing, overlapping, or mutable prerequisite refuses hard
mode.

The hard-mode profile supports only the manifest-pinned Podman host on Linux.
The operator runs the control appliance with rootless Podman, and the separate
`foreman-engine` account runs the worker service. Docker and other supported OCI
engines can run soft mode but do not satisfy hard-mode admission. The bootstrap
creates the host-local service address, firewall rule, and private name that the
control resolves. A throwaway control container must complete an authenticated
probe through that exact route before the profile is enabled.

The Podman service listens only on a host-local TCP endpoint and requires
mutual TLS through its native `--tls-cert`, `--tls-key`, and `--tls-client-ca`
options. The server key stays in the engine account's mode-`0600` runtime state.
The client key enters the control container through a runtime secret and exists
only in its `/run` tmpfs. The control pins the private CA and expected server
identity. It does not mount a Unix socket, the host runtime directory, the
operator's engine socket, or another host path. The service API grants complete
authority as `foreman-engine`; therefore the dedicated account, filesystem
permissions, mutual TLS, and host-local endpoint form the security boundary.
The control plane is trusted and intentionally holds this authority. Hard mode
contains the untrusted worker; it does not claim to contain a compromised
control plane, which already has `/workspace` and `/state` authority. The
worker never receives the client certificate or access to the service endpoint.
The upstream Podman service contract documents both the Docker-compatible API
and these TLS options at
<https://docs.podman.io/en/latest/markdown/podman-system-service.1.html>.

Control-local paths are not valid engine mount sources. For each task, the
control container therefore creates an engine-owned staging volume through the
mutual-TLS API. It sends the clean worktree, prompt, and non-secret task
environment as one bounded tar archive through a staging container's archive
endpoint. The worker mounts only that volume. Runtime credentials use the
worker `tmpfs` protocol below and do not enter the archive. After execution, the
control container retrieves one result archive through the same API, verifies
its byte and entry limits, relative paths, file types, before/after manifest,
and content digest, then applies the delete-aware result to `/workspace`.
When a task needs credentials, the control container starts the worker behind
the fixed Foreman credential bootstrap with a private `tmpfs` at
`/run/foreman-secrets`. It sends one separately bounded secret-only archive to
that running container through the private archive endpoint. The bootstrap
accepts only manifest-listed filenames, writes them with mode `0400`, and
starts the worker command after it verifies the secret manifest.

Where a provider supports short-lived credentials, Foreman supplies one
least-privilege task capability with an expiry and hard spend limit. Where a
provider supports only spend-capped sub-keys, Foreman creates one per task and
revokes it during cleanup. Otherwise, an explicit diagnostic override can
supply a long-lived key and records the weaker mode in release evidence.
Long-lived credentials do not enter images, layers, worktree archives, staging
volumes, or container configuration.

A malicious worker can read, copy, encode, log, return, or send any credential
material that it receives. It can use an allowed provider connection. Hard mode
contains host and engine authority. It does not claim to contain malicious use
of worker-readable credentials. Foreman scans stdout, stderr, and result
archives for exact canaries. It redacts a detected value and marks the task
compromised. Network policy blocks non-allowlisted destinations. These controls
detect disclosure and limit its effect. They do not prevent disclosure.
Cleanup revokes task credentials and destroys the worker and its `tmpfs`.
Absolute paths, `..`, device nodes, sockets, hard links, escaping symbolic
links, duplicate paths, and expansion beyond the bound refuse. Cleanup removes
the worker, staging container, and volume idempotently. No host bind path
crosses the engine boundary.

This layout limits the untrusted worker to the dedicated engine account and
makes cleanup and test evidence independent of the operator's general engine
state. The service is an explicit privilege boundary, not a claim that rootless
containers have no kernel risk. The security tests therefore inspect the host
account, subordinate IDs, unit, endpoint, certificates, service and worker
settings. They include general-socket discovery, archive escape, mutual-TLS,
worker-to-service access, filesystem access, privilege, mount, capability,
network, device, host-backing-path, and state-volume negative controls. They
also cover plain and encoded log disclosure, result disclosure, allowed and
blocked network exfiltration, credential expiry, spend limits, revocation, and
the weaker credential override.

Track 4 qualifies the pinned Podman Docker-compatibility endpoints used for
image, container, volume, archive, tmpfs, inspect, wait, and cleanup operations.
The service's version handling is not accepted as proof of compatibility. Each
endpoint receives a live positive test and a discriminating negative control.
Hosted Linux CI executes a real worker through the complete service path.
Windows uses the appliance and service through WSL2, but BW-004 still runs
natively as a separate release predicate. The program does not report a native
Windows Podman service.

Soft mode does not require the engine service and remains the turnkey path on
any supported OCI host. If the dedicated service fails qualification, hard
mode refuses. It never discovers or uses the operator's engine socket as a
fallback.

### Reproducibility and supply chain

BuildKit builds each supported platform from an exact base digest. The build
uses the candidate commit time as `SOURCE_DATE_EPOCH`. It normalizes generated
file order, ownership, permission, and timestamps. The gate performs two clean
builds per platform with the locked builder. A digest mismatch is a release
failure and not an allowed warning.

The release uses OCI provenance and SBOM attestations. The publication step
signs the multi-platform image index and records the image, source commit,
reference manifest, SBOM, provenance, and signature identities in release
evidence. Runtime credentials enter only through declared runtime mounts or
secret providers. Tests scan the build context, image history, image
filesystem, logs, and attestations for registered canary secrets.

## Graphify qualification

The qualification tranche treats Graphify 0.9.48 as an untrusted version
candidate. It installs the exact package in the appliance, runs its supported
code-only extraction against fixed fixtures and the repository, and compares
two clean results after normalization. It also verifies the current source
graph contracts:

- producer and skill versions agree
- the graph binds its source commit and configuration
- file and symbol nodes keep exact source locations
- ordered endpoints can reconstruct direction
- rename lineage is explicit
- missing, duplicate, dangling, and collapsed records are reported
- the merge cadence consumes zero semantic-model tokens
- a reader can detect stale, wrong-version, corrupt, and unknown artifacts

Qualification does not mutate the released knowledge path until all checks
pass. A failure leaves graph support disabled or on the last qualified version.

## Work-DAG projection

The projector reads durable event-log records, run artifacts, source graph
identity, and rename metadata. It writes a separate ordered work-lineage
artifact. It never inserts lineage into `graph.json`, and it never becomes an
event-log writer.

Records cover tasks, specs, source objects, attempts, implementers, auditors,
findings, checks, gates, candidates, and integration decisions. Edges cover
modification, production, evaluation, gating, descent, subject, and
supersession. Each attempt remains visible, including rejected and abandoned
attempts. Incomplete evidence yields an incomplete record with a source-located
reason.

The projector has a check mode that builds to a temporary destination and
compares the result with the tracked or run-bound artifact. Byte identity is
the correctness predicate for equal inputs.

## Context packs

The builder reads source, the qualified static graph when available, the work
DAG, and run evidence. It selects a bounded evidence set before dispatch. It
does not let the worker walk an unbounded graph. It does not require a graph
database.

Each pack has a canonical header, task restatement, graph and work identities,
retrieval mode, budget, ordered cited evidence, contradiction section, and
closing task restatement. Stable aliases refer only to records included in the
pack. The pack digest covers every byte.

The implementer pack is immutable. The auditor receives the same core bytes.
An auditor-specific extension is separate and has its own digest. This rule
allows role-specific evidence without hiding a difference in what the two
roles saw.

The primary modes are direct source, lexical, static graph, and hybrid. Missing
or invalid graph state selects direct source or lexical mode and records the
reason. The optional dynamic query path is read-only, vocabulary-expanded,
bounded, structured, logged, and cited. An empty query is explicit.

## Evaluation and rollout

The evaluation tranche locks a canonical pool of 50 tasks before any arm
result. The confirmatory analysis always uses all 50 tasks. No result, variance
estimate, budget observation, or interim statistic can select a prefix or drop
a task. The set balances changed-interface callers and dependents, cross-
package impact, event producer to consumer tracing, and command entry point to
persistence tracing. Every task runs in all four retrieval arms with the same
model, tools, prompt, token cap, monetary cap, elapsed-time cap, and seed
schedule. Runs are serialized on one qualified appliance host in one locked
balanced order. The harness records retrieval recall and precision, context
tokens, citation validity, task quality, elapsed time, cost, failure class, and
graph-mode identity.

The sole promotion contrast is D hybrid minus B lexical. A-to-B, A-to-C,
B-to-C, and C-to-D remain published diagnostics. They cannot select a release
verdict. Every task and arm runs ten times on one locked paired seed schedule.
The harness averages repeats within a task and then macro-averages task
metrics. It reports token, cost, and elapsed-time changes as median paired
per-task D-to-B ratios. Token reduction is one minus the token ratio, so a
20-percent reduction is equivalent to an upper token-ratio bound of 0.80.

Elapsed time is monotonic wall time from task admission through the persisted
scored verdict. Each task-run has an absolute ceiling of 30 minutes and USD
4.50 under the locked price table. The 2,000 confirmatory task-runs therefore
reserve at most USD 9,000. The complete evaluation has an absolute USD 10,000
ceiling, including scoring and control overhead. Admission reserves the full
budget before the first arm starts. A missing reservation or exhausted ceiling
makes promotion `uncomputable`. A relative recall exception can waive only the
10-percent latency comparison. It cannot waive an absolute latency or cost
ceiling.

The release does not use observed outcomes to choose sample size and does not
claim post-hoc power. The report publishes the fixed design and the registered
confidence intervals. No additional sensitivity result can change the corpus,
repeats, thresholds, promotion decision, or release admission.

The program then locks a paired hierarchical percentile bootstrap with 10,000
resamples, the seed `foreman-v040-eval-bootstrap-v1`, and two-sided 95-percent
intervals. Each resample selects tasks with replacement and then selects the
paired B/D repeat indices within each selected task with replacement. This
preserves treatment pairing while propagating task and repeat uncertainty. The
required completed design is exactly 50 tasks by ten repeats by four arms. A
missing arm or repeat makes the complete promotion analysis `uncomputable`; no
task is dropped and no value is imputed.

Citation validity is not bootstrapped. It is a deterministic safety gate over
every emitted citation: promotion requires zero invalid citations, and the
report records both the citation count and task-run count. The release makes no
99-percent population lower-bound claim from that zero-defect result. No
optional stopping, post-result task or repeat addition, alternate contrast, or
population change is valid.

The preregistered thresholds in the specification decide promotion. The report
can return a negative result. A failed graph treatment does not block the core
release when direct-source operation and all other release requirements pass.
It blocks default-on graph context.

Rollout proceeds through shadow, locked evaluation, and opt-in. Default-on is a
later state transition that requires all thresholds and an independent audit.
The graph-off switch remains a permanent tested path.

## Testing strategy

Each focused package uses test-driven development and contains unit, contract,
integration, and hostile negative-control tests in proportion to risk.

The final testing round includes:

- clean dependency install and lock verification
- TypeScript type checks and package tests
- full Node and Bats suites in the serialized gate lane
- generated-runtime byte checks and copied-install smoke tests
- strict validation of every active OpenSpec package
- documentation, link, spelling, and reference-manifest checks
- two clean appliance builds for each supported platform
- appliance bootstrap, restart, state persistence, upgrade, and rollback tests
- hard-mode rootless-service identity, mutual-TLS, archive data-plane,
  host-backing-path identity, path-escape, delete-aware result, and
  no-host-socket negative controls
- malicious worker credential disclosure, encoding, egress, expiry, spend,
  revocation, redaction, and diagnostic-override controls
- secret-canary scans over build inputs, image outputs, and attestations
- project-registry migration, linked-worktree, moved-project, restore,
  move-receipt, replacement, additive-remap, clone, signed destination-bound
  transfer and recovery receipts, envelope validation, cross-authority replay,
  receipt re-emission, duplicate-binding, every crash boundary,
  wrong-repository, and unavailable-project controls
- Graphify deterministic rebuild and hostile stale or corrupt fixtures
- live Qdrant idempotency, poison isolation, atomic alias activation,
  delayed stale mutation, lease takeover, embedding identity, epoch isolation,
  strict-mode and payload-index refusal, and rebuild-race tests
- work-DAG replay, torn-tail, failed-attempt, and rename fixtures
- context budget, determinism, citation, degraded-mode, and escape-hatch tests
- locked evaluation of exactly 50 tasks and ten repeats per arm, including
  fixed-sample, missing-arm, zero-invalid-citation, absolute budget, and cost
  controls
- hosted Linux, WSL, Windows, and supported architecture evidence
- native Windows completion of Bats item BW-004
- one cold audit of the full baseline-to-candidate diff
- one unchanged pushed-candidate release convergence run
- fast-forward integration plus interrupted-publication recovery at every
  journal transition

Auditors do not run the full Bats suite directly. The host gate owns that
serialized evidence. The auditor can request a missing deterministic check and
must cite the exact gap.

## Failure and rollback behavior

Each tranche has a stop boundary. A failed tranche does not permit a dependent
tranche to start. A correction stays within the same Endstop budget. An
Endstop refusal terminates the loop and writes the reason to SessionDB.

The appliance keeps the prior signed image tag available until the new image
passes startup and state-compatibility checks. Graph support has a runtime off
switch. Context artifacts are immutable and can be replayed. The work DAG is
derived and can be rebuilt. SessionDB and event logs remain authoritative and
are not rolled back through graph cleanup.

## Release predicates

The pre-publication gate binds the candidate as its lowercase 40-character Git
commit ID, tree ID, and SHA-256 of the commit ID's ASCII bytes without a
trailing LF. A pushed review branch can exist before this gate. One exact
candidate requires:

- every tracked v0.4 OpenSpec task checkbox complete in the frozen candidate
- no open blocking audit finding
- fresh deterministic and hosted test evidence
- a passing appliance reproducibility and security report
- a passing project-registry identity and migration report
- a passing live Qdrant and epoch-isolation report
- a locked evaluation verdict and valid rollout state
- a complete SessionDB milestone record
- completed Windows Bats item BW-004
- completed Endstop check and audit milestones
- a locally verified OCI image index, SBOM, provenance, and signature bundle

Cold audit, integration, family activation, and publication evidence are
external release predicates. They do not remain as unchecked OpenSpec tasks,
and no tracked completion edit occurs after the candidate freezes.

Any byte change after the final audit invalidates the affected evidence. The
architect reruns the required checks and cold audit before publication.

A public release object is remote `main`, a public OCI reference, a signed
release tag, or a release record. A review branch is not a public release object
under this term. The durable publication journal enters `prepared` before local
integration. It binds the expected old remote `main` tip, candidate commit,
candidate tree, candidate digest, local artifacts, intended tag, and intended
release identity.

Integration is fast-forward only. Local `main` advances after `prepared`.
Remote `main` is the first public release mutation. Its push compares and sets
the expected old tip to the audited candidate. An unexpected old tip, advanced
remote branch, or required merge commit refuses or creates a new candidate.
Tree equality cannot substitute for commit identity.

The journal advances through `local_integrated`, `main_published`,
`image_pushed`, `tag_pushed`, `release_created`, and `verified`. Each transition
compares and sets the prior state and binds exact remote object identities. If
execution stops before `prepared`, no remote `main` mutation exists. After
`prepared`, recovery queries the exact object. It retries a missing object,
accepts a matching object as idempotent, and refuses a divergent object. It
does not roll back, overwrite, or silently delete a public release object. If a
later object fails after remote `main` publishes, recovery resumes from
`main_published` and keeps the release incomplete.

The post-publication gate verifies that `main` and the signed tag equal the
audited commit, the release record names that tag, the public multi-platform
index equals the prepared digest, signatures and attestations verify, and a
clean client can pull and smoke-test the public image. Only then does Endstop
record publication complete and SessionDB record the release.

## Rejected alternatives

### Expand the current sandbox image into the complete appliance

Rejected. It would mix the untrusted worker boundary with the privileged
control-plane toolchain and make the security contract unclear.

### Mount the host Docker socket

Rejected. Socket access gives the control container authority over the host
engine. The dedicated rootless service is larger, but its authority and state
are bounded.

### Use mutable image and CLI tags

Rejected. A turnkey environment without exact identity cannot produce
reproducible release evidence.

### Extend or fork TencentDB-Agent-Memory

Rejected. The v2.0.0 public API can update only an existing caller-supplied
record ID. Its create path mints a random message ID. It therefore cannot
implement Foreman's caller-keyed desired-state upsert without a permanent
gateway fork. Qdrant supplies idempotent caller-owned point IDs and atomic
collection aliases through its stable public API.

### Make Graphify or GraphStore mandatory

Rejected. Derived graph availability must not control core Foreman execution.

### Serve an unbounded graph neighborhood

Rejected. It breaks the context budget, changes between runs, and prevents the
auditor from replaying the implementer's evidence.

### Promote graph context before evaluation

Rejected. The release must be able to discover that graph-assisted retrieval
is slower, less precise, or no better than lexical and direct-source baselines.

## Deferred work

SQLite ontology storage, a mandatory remote graph service, semantic extraction
on every change, and unrestricted dynamic graph traversal remain deferred. The
files-only GraphStore remains available. Council runtime, deliberation, MCP
transport, and broad dogfood carry-over work are assigned to v0.5. A later
release can reconsider the other items with a separate measured need and
approved OpenSpec package.
