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

When an approved future package becomes active, the architect SHALL update its
entry and `active_inventory_sha256` in the same design milestone. That changed
design SHALL receive its required exact-byte approval before the package's
implementation lane. Documentation-only reconciliation and register updates
do not count as product implementation lanes.

Only the Track 1 validator bootstrap MAY start before the validator exists. Its
admission SHALL require the exact approved governor digest and the release
Endstop receipt. After Track 1, every implementation lane SHALL require a
passing coverage check. A reused package with `reconcile=required` SHALL be
corrected and strict-validated before its implementation lane starts. Those
corrections SHALL remove new shell and Bats implementation where Node 24
TypeScript and TypeScript tests own the behavior, and SHALL resolve conflicting
directed-versus-undirected graph assumptions.

#### Scenario: An active package is not part of v0.4

- **WHEN** reconciliation finds an active package outside the approved release
  promise
- **THEN** the register names the package and its v0.5 or later assignment
- **AND** the package is not silently marked complete, deleted, or omitted

#### Scenario: Coverage is incomplete

- **WHEN** any active package or Roadmap v0.4 item lacks one disposition
- **THEN** strict release validation fails
- **AND** no implementation tranche starts

#### Scenario: The coverage validator does not exist yet

- **WHEN** Track 1 has the exact approved governor and Endstop receipt
- **THEN** admission permits only the coverage-validator bootstrap
- **AND** it does not admit another product lane

#### Scenario: A stale focused ledger is assigned to v0.4

- **WHEN** its coverage entry says `reconcile=required`
- **THEN** release admission fails until the ledger is corrected
- **AND** strict validation of the corrected ledger passes

### Requirement: Bounded Foreman execution loop

The program SHALL run through the Foreman architect, implementer, auditor, and
gate roles. One persistent Endstop contract SHALL bound all v0.4 actions. A new
tranche, session, lane, retry, or worktree SHALL NOT reset that budget.

#### Scenario: A tranche is ready to implement

- **WHEN** its dependencies and approved OpenSpec task list are complete
- **THEN** Grok implements the tranche in an isolated worktree with tests first
- **AND** the host runs focused deterministic checks
- **AND** Codex performs a cold audit of the complete diff
- **AND** the architect resolves every blocking finding before integration

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

A source retirement receipt SHALL bind one unique transfer nonce, the project
UUID, export digest, source store operation identifier, source registry
generation, retirement disposition, and user authorization digest. The source
SHALL mark its binding retired and its store transferred before it emits the
receipt. A transferred source SHALL refuse later writes.

If the source is unavailable, a recovery receipt SHALL bind a unique transfer
nonce, project UUID, export digest, last-known store operation identifier,
last-known registry generation, operator assertion, and user authorization
digest. It SHALL use explicit `unknown` values for unavailable identities and
SHALL NOT omit them. The destination reservation SHALL bind the complete
receipt digest and transfer nonce. Finalization SHALL mark that receipt
consumed for one destination binding. A retry with the same receipt,
destination, and operation identifier SHALL be idempotent. Reuse with any
different binding or operation SHALL refuse before mutation. Transfer rollback
SHALL be explicit, receipt-bound, and tested.

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

The appliance SHALL NOT mount the host container-engine socket. Hard mode SHALL
use an isolated rootless daemon sidecar with a private socket and a dedicated
state volume.

#### Scenario: Hard mode starts

- **WHEN** the operator enables the hard-mode Compose profile
- **THEN** the control container connects only to the sidecar socket
- **AND** the sidecar runs without host root privileges
- **AND** worker containers cannot access the host engine socket
- **AND** hosted CI executes a real worker through this sidecar path

#### Scenario: The sidecar is unavailable

- **WHEN** hard mode cannot reach or qualify the rootless sidecar
- **THEN** hard-mode lane admission refuses before a worker starts
- **AND** soft-mode diagnostics remain available
- **AND** Foreman does not fall back to the host socket

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

The program SHALL commit a corpus of at least 30 representative Foreman tasks
before it measures the graph-assisted arms. The corpus SHALL balance callers
and dependents of a changed interface, cross-package impact, event producer to
consumer tracing, and command entry point to persistence tracing. Each task
SHALL run against these locked arms:

- A: direct source.
- B: lexical retrieval.
- C: static graph retrieval.
- D: hybrid lexical and graph retrieval.

The corpus, prompts, scoring rules, budgets, candidate identities, and random
seeds SHALL be content-addressed and locked before treatment results are read.

The only promotion contrast SHALL be hybrid arm D minus lexical arm B. The
report SHALL also publish A-to-B, A-to-C, B-to-C, and C-to-D contrasts as
diagnostics, but no diagnostic contrast can promote graph context. Each task
and arm SHALL run at least three repeats under the same locked seed schedule.
The harness SHALL compute each task's repeat mean first and then compute the
macro mean across tasks for recall, precision, citation validity, and task
quality. It SHALL compute token and elapsed-time effects as the median paired
per-task D-to-B ratio. It SHALL define token reduction as one minus the token
ratio.

The statistical plan SHALL lock before the first C or D corpus run. It SHALL
use a paired task-level percentile bootstrap with 10,000 resamples, the seed
`foreman-v040-eval-bootstrap-v1`, and two-sided 95 percent confidence intervals.
The minimum completed sample SHALL be 30 tasks and three repeats per arm. The
minimum detectable promoted recall effect SHALL be 8 percentage points. The
non-inferiority or efficiency margins SHALL be 2 points for recall, 3 points
for precision, 2 points for task quality, 10 percent for elapsed time, and 20
percent for context tokens. A confidence interval that crosses its applicable
margin SHALL produce `uncomputable` for promotion. The program SHALL NOT add
tasks, repeats, or alternate contrasts after any C or D corpus result is read.

#### Scenario: An evaluation starts

- **WHEN** the corpus lock and baseline-arm receipts are incomplete
- **THEN** graph-arm measurement refuses
- **AND** no partial result can change the corpus or scoring rule

#### Scenario: One arm is unavailable

- **WHEN** an arm cannot run on a task
- **THEN** the result records `uncomputable` with its reason
- **AND** the missing value is not counted as a pass or silently imputed

#### Scenario: A diagnostic contrast looks favorable

- **WHEN** A-to-C or another diagnostic contrast passes a threshold but D-to-B
  does not
- **THEN** graph context does not advance to default-on
- **AND** the report publishes the diagnostic result without using it for
  promotion

#### Scenario: The confidence interval crosses a margin

- **WHEN** a primary D-to-B confidence interval crosses its registered
  superiority, non-inferiority, or efficiency margin
- **THEN** that promotion criterion is `uncomputable`
- **AND** the point estimate cannot override the interval

### Requirement: Promotion thresholds

Graph-assisted context SHALL remain non-default unless the locked D-to-B
evaluation meets all applicable confidence-bound thresholds:

- The lower confidence bound for retrieval recall is at least 8 percentage
  points, or its lower bound is at least -2 points while the lower confidence
  bound for token reduction is at least 20 percent. The latter is equivalent
  to an upper token-ratio bound of 0.80.
- The lower confidence bound for retrieval precision is at least -3 percentage
  points.
- The lower confidence bound for citation validity is at least 99 percent.
- The lower confidence bound for task quality is at least -2 percentage points.
- The upper confidence bound for the median elapsed-time ratio is at most 1.10,
  unless the recall lower bound is at least 8 percentage points.
- Missing, stale, wrong-version, corrupt, and unknown graph controls are
  detected in 100 percent of registered cases.
- Core operation passes with graph use disabled.

#### Scenario: Every threshold passes

- **WHEN** the locked report and independent audit confirm every threshold
- **THEN** graph-assisted context MAY advance from opt-in to default-on
- **AND** the graph-off path remains tested and supported

#### Scenario: Any threshold fails or is uncomputable

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
earlier commit SHALL NOT satisfy a later candidate.

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

#### Scenario: Candidate bytes change after a pass

- **WHEN** any tracked product, test, generated runtime, specification, release
  note, image input, or evidence byte changes
- **THEN** affected checks and the final cold audit become stale
- **AND** publication waits for fresh results on the new candidate

#### Scenario: Publication succeeds

- **WHEN** all required Endstop milestones are complete on the exact candidate
- **THEN** the architect merges or fast-forwards the reviewed commit
- **AND** creates the signed release tag and release record
- **AND** publishes the verified multi-platform image and attestations
- **AND** saves the final SessionDB release state

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
