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
- User approval binds the exact design digest in external state.
- Writing-plans produces the package `tasks.md` file.
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
record that binds the exact approved OpenSpec bytes. It is external to the
candidate and cannot be manufactured by an implementation worker.

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

Track 1 implements `packages/policy/src/release-coverage.ts` and exposes
`release-coverage check --register <path>`. The checker recomputes the active
inventory from `openspec list --json` as sorted UTF-8 names with one trailing
LF per name. It hashes the raw `ROADMAP.md` bytes, validates the fixed schema
and unique keys, parses the exact Roadmap assignment table, and verifies that
each owner is an existing package or a declared future package. The entry key
is the source identity. Multiple Roadmap entries intentionally share
`ROADMAP.md` as their source path. A missing key, duplicate key, missing
Roadmap row, stale digest, unknown value, invalid field combination, or
unresolved entry is a failure.

Creating an approved future package changes the active inventory. The
architect must update the register and its inventory digest in the same design
milestone, validate it, and obtain the required exact-byte approval before
that package's implementation lane. Documentation-only reconciliation and
register maintenance are not product implementation lanes.

This bootstrap has one narrow admission exception because its checker does not
exist yet: the exact approved governor and the release Endstop receipt admit
only the Track 1 checker implementation. After that checker exists, no other
product lane can start until it passes. Before a reused v0.4 package enters a
lane, the architect must reconcile every `required` entry and strict-validate
the corrected ledger. In particular, the graph ledgers must remove stale shell
and Bats implementation assumptions, resolve directed-versus-undirected graph
claims, and use the Node 24 TypeScript, Effect, and TypeScript-test boundary.
The `knowledge-plane-refresh` reconciliation must remove its broad
`lock-primitive-hardening` prerequisite. Track 5 owns the narrow TypeScript and
Effect advisory lock that guards its single writer.
Council runtime, deliberation, MCP transport, and broad dogfood carry-over
remain assigned to v0.5.

## Foreman release loop

One release-level Endstop contract persists outside all worktrees. The complete
v0.4 release is the authorized workstream. A tranche is a milestone inside that
workstream and does not receive a replacement contract. The contract binds the
baseline, objective, acceptance set, allowed paths, user authorization, action
limits, and required milestones. Each tranche follows this state machine:

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
judgment exists. `BLOCKED`, an unresolved medium-or-higher `WARNING`, and
`UNVERIFIED` fail closed. A blocking finding reopens the same bounded package
loop.

The architect owns commits, integration, and publication. Workers do not merge,
rewrite release evidence, or mark SessionDB obligations complete.

The Endstop runtime reserves each action before it starts. It remains running at
a tranche boundary and reaches a terminal state only at a contract terminal
condition. This prevents a new package, worktree, or session from resetting the
release budget.

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
state with mode `0600` or an equivalent Windows ACL; it is never in an image,
project export, or release artifact. A destination first signs an offer that
binds its registry authority UUID, proposed operation UUID, project UUID,
canonical Git common directory, selected store backend, and target store
locator digest. A retirement receipt binds that complete offer digest,
destination authority, transfer nonce, project UUID, export digest, source
store operation UUID, source registry generation, retirement disposition, and
exact external approval digest. The source registry signs it. The external
approval pins the source, destination, and recovery-key fingerprints,
destination authority, project UUID, export digest, and proposed operation
UUID.

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
operator-held Ed25519 recovery key. If the source no longer exists, a recovery
receipt uses that key and binds a unique transfer nonce, the destination offer,
the same project and export identities, last-known store operation UUID,
last-known registry generation, operator assertion, and external approval
digest. An unavailable value is the explicit value `unknown`. The recovery
path is operator-attested and release evidence labels it as weaker than source
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
  base64url raw 32-byte public key, recovery-key fingerprint, source store
  operation UUID, and nonnegative safe-integer source registry generation
- `snapshot`, with the complete `SessionSnapshot`
- `projection`, with a positive safe-integer `next_version`, unique
  projection-key/version rows in lexical key order, a positive safe-integer
  `next_receipt`, and pending `OutboxEntry` values in durable queue order

Each projection version is a positive safe integer. Projection keys and opaque
receipts are unique. The next counters are greater than every allocated value
that they govern.

`ExternalTransferApprovalV1` is a closed RFC 8785 object with schema
`foreman.external-transfer-approval.v1`, approval UUID, source, destination,
and recovery-key fingerprints, destination authority UUID, project UUID,
export digest, and proposed operation UUID. Its SHA-256 digest is the external
approval digest.

The three signed objects are also closed RFC 8785 values:

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
contains the envelope, signed destination offer, exact external approval
artifact, and exactly one signed retirement or recovery receipt. These three
artifacts are not inside the envelope digest. Validation is parse and size
bounds, exact schema and closed fields, canonical-byte reproduction and digest,
signature and approval,
safe-integer and receipt invariants, SessionSnapshot integrity, registry
admission, then one atomic target publication. An unknown version, unknown
backend, non-canonical encoding, duplicate key or receipt, invalid signature,
counter mismatch, or malformed row refuses before target mutation. Same-backend
restore preserves opaque receipts. Cross-backend restore remints them in queue
order. `importSnapshot` remains row import and cannot perform exact project
restore.

A writable registry migration creates its authority UUID and identity key, and
an explicit writable project migration records the project UUID, operation
UUID, and operator-supplied recovery public-key fingerprint. A read-only open
that needs either migration refuses without changing registry or store bytes.

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

The control container has no path to the host engine. The hard-mode
profile starts a rootless daemon sidecar. The control container receives only
the private sidecar socket. The sidecar keeps images, layers, and worker
containers in its own volume and network namespace.

The reference manifest names the exact rootless engine image and platform
digests. The outer sidecar runs with `privileged=false`, a dedicated nonroot
UID and user namespace, all capabilities dropped, no host PID, IPC, or network
namespace, and no host-path mount. It exposes only `/dev/fuse`, when the pinned
storage driver needs it, under pinned seccomp and AppArmor profiles. Its root
filesystem is read-only except for its engine-data volume and runtime tmpfs.
The Unix socket has mode `0660` and is shared only with the control container's
dedicated engine group. The sidecar cannot mount `/workspace` or `/state`.

Control-local paths are not valid daemon mount sources. For each task, the
control container therefore creates a sidecar-owned staging volume through the
private Engine API. It sends the clean worktree, prompt, and non-secret task
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
starts the worker command after it verifies the secret manifest. Secret values
do not enter the worktree archive, container configuration, layer, staging
volume, result archive, or logs. Cleanup destroys the worker and its `tmpfs`.
Absolute paths, `..`, device nodes, sockets, hard links, escaping symbolic
links, duplicate paths, and expansion beyond the bound refuse. Cleanup removes
the worker, staging container, and volume idempotently. No host bind path
crosses the sidecar boundary.

This layout limits the effect of a control-plane compromise. It also makes
cleanup and test evidence independent of the operator's host engine state. The
sidecar is an explicit privilege boundary, not a claim that nested container
execution has no kernel risk. The security tests therefore inspect the outer
sidecar and inner worker settings and include socket discovery, archive escape,
privilege, mount, capability, network, device, and state-volume negative
controls.

Hosted Linux CI must execute the complete rootless-sidecar path. Windows uses
the appliance through WSL2 for that topology, but BW-004 still runs natively as
a separate release predicate. The program does not report a native Windows
rootless daemon that the platform does not provide.

Soft mode does not require the sidecar. If the sidecar fails qualification,
hard mode refuses. It never discovers and uses a host socket as a fallback.

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
result. The final analysis uses the first 30 through 50 tasks in canonical
order. The set balances changed-interface callers and dependents,
cross-package impact, event producer to consumer tracing, and command entry
point to persistence tracing. Every task runs in all four retrieval arms with
the same model, tools, prompt, token cap, monetary cap, elapsed-time cap, and
seed schedule. Runs are serialized on one qualified appliance host in one
locked balanced order. The harness records retrieval recall and precision,
context tokens, citation validity, task quality, elapsed time, cost, failure
class, and graph-mode identity.

The sole promotion contrast is D hybrid minus B lexical. A-to-B, A-to-C,
B-to-C, and C-to-D remain published diagnostics. They cannot select a release
verdict. Every task and arm runs ten times on one locked paired seed schedule.
The harness averages repeats within a task and then macro-averages task
metrics. It reports token, cost, and elapsed-time changes as median paired
per-task D-to-B ratios. Token reduction is one minus the token ratio, so a
20-percent reduction is equivalent to an upper token-ratio bound of 0.80.

Elapsed time is monotonic wall time from task admission through the persisted
scored verdict. Each task-run has an absolute ceiling of 30 minutes and USD 5
under the locked price table. The complete four-arm design has an absolute USD
10,000 ceiling. A relative recall exception can waive only the 10-percent
latency comparison. It cannot waive an absolute latency or cost ceiling.

Before the first C or D result, the program uses only the A and B runs from the
locked pool to register the paired variance assumptions, a simulation-based
power report, and the final canonical prefix length. It selects the smallest
prefix from 30 through 50 tasks that gives at least 80-percent power at
two-sided alpha 0.05 for an 8-percentage-point recall effect and each
registered non-inferiority or efficiency margin. The A and B runs used for
this calculation are the same locked runs used in the final analysis; they are
not repeated. If all 50 tasks do not provide the required power, graph
promotion is `uncomputable` and remains opt-in or off. No C or D result is read
before this decision.

The program then locks a paired hierarchical percentile bootstrap with 10,000
resamples, the seed `foreman-v040-eval-bootstrap-v1`, and two-sided 95-percent
intervals. Each resample selects tasks with replacement and then selects the
paired B/D repeat indices within each selected task with replacement. This
preserves treatment pairing while propagating task and repeat uncertainty. The
minimum completed design is 30 tasks by ten repeats by four arms. A missing arm
or repeat makes the complete promotion analysis `uncomputable`; no task is
dropped and no value is imputed.

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
- hard-mode sidecar outer-isolation, archive data-plane, path-escape,
  delete-aware result, and no-host-socket negative controls
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
- locked evaluation of 30 to 50 tasks and ten repeats per arm, including
  power, missing-arm, zero-invalid-citation, absolute budget, and cost controls
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
trailing LF. Before any public object is created, one exact candidate requires:

- every v0.4 OpenSpec task complete or explicitly deferred by this design
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

Any byte change after the final audit invalidates the affected evidence. The
architect reruns the required checks and cold audit before publication.

Integration is fast-forward only. `main`, the reviewed branch, and the signed
tag must point to the same audited commit object. If `main` advances or a merge
commit would be required, the architect creates a new candidate and reruns the
affected checks and cold audit. Tree equality cannot substitute for commit
identity. A fresh exact-`main` gate then records the Endstop integration
milestone before public objects are created.

Publication uses a durable journal outside the candidate with states
`prepared`, `image_pushed`, `tag_pushed`, `release_created`, and `verified`.
Each state binds the candidate commit and tree, image-index digest, SBOM,
provenance, signature, tag, and release identifier. Each transition is a
compare-and-set and is idempotent. After interruption, the publisher reads the
remote object, accepts only the exact recorded identity, and resumes the next
step. It never rebuilds or retags different bytes under the same journal. A
mismatched public object stops for operator recovery.

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
engine. The rootless sidecar is larger, but its authority and state are bounded.

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
