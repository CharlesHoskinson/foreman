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
2. External `MemoryIndex`, projection epochs, and live-service tests.
3. Hermetic Foreman appliance.
4. Graphify 0.9.48 qualification.
5. Deterministic work-DAG projection.
6. Bounded immutable context packs.
7. Locked evaluation and rollout.
8. Exact-candidate release and publication.

#### Scenario: A dependency is incomplete

- **WHEN** a tranche dependency has no accepted candidate
- **THEN** later dependent implementation SHALL NOT start
- **AND** independent research or test-fixture preparation MAY continue without
  creating a completion claim

#### Scenario: Independent foundation tracks are ready

- **WHEN** authority convergence is accepted
- **THEN** the MemoryIndex, appliance, and Graphify qualification tracks MAY run
  in parallel worktrees
- **AND** each track receives its own candidate and cold-audit verdict

#### Scenario: A focused package already exists

- **WHEN** an existing OpenSpec package covers a tranche
- **THEN** the program reconciles and reuses it
- **AND** it does not create a competing package for the same behavior

### Requirement: External MemoryIndex adapter

The release SHALL ship the first external `MemoryIndex` adapter against one
exactly pinned agent-memory service and protocol. `NullMemoryIndex` SHALL remain
the default. No `SessionStore` operation or core CLI command SHALL require the
service, its network, or its credentials.

#### Scenario: The external adapter is selected

- **WHEN** the focused adapter package is approved
- **THEN** it names the service source, revision, API contract, container
  images, SDK, and credential boundary
- **AND** `env/reference-manifest.toml` pins every service and client identity

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

### Requirement: Projection epoch isolation

The external adapter SHALL support isolated projection epochs. A rebuild SHALL
write to a new epoch, keep the current epoch queryable, and make the new epoch
visible only after complete projection and catch-up. The focused package SHALL
define how concurrent writes and outbox draining are preserved during rebuild.

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

#### Scenario: An evaluation starts

- **WHEN** the corpus lock and baseline-arm receipts are incomplete
- **THEN** graph-arm measurement refuses
- **AND** no partial result can change the corpus or scoring rule

#### Scenario: One arm is unavailable

- **WHEN** an arm cannot run on a task
- **THEN** the result records `uncomputable` with its reason
- **AND** the missing value is not counted as a pass or silently imputed

### Requirement: Promotion thresholds

Graph-assisted context SHALL remain non-default unless the locked evaluation
meets all applicable thresholds:

- Retrieval recall improves by at least 8 percentage points, or stays within 2
  points while using at least 20 percent fewer context tokens.
- Retrieval precision is no more than 3 percentage points worse.
- Citation validity is at least 99 percent.
- Task quality is no more than 2 percentage points worse.
- Median elapsed time is no more than 10 percent worse unless retrieval recall
  improves by at least 8 percentage points.
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
  graph negative controls, evaluation checks, and hosted platform checks pass
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
storage, and unbounded semantic graph generation deferred. A later release MAY
add them only through a new approved OpenSpec package and measured need.

#### Scenario: A deferred feature appears in an implementation proposal

- **WHEN** a lane attempts to add a deferred feature without a new approval
- **THEN** the architect rejects it as scope expansion
- **AND** the release task remains unchanged
