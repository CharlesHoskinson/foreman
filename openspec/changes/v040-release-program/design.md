# Design: Foreman v0.4 release program

## Design objective

Foreman v0.4 will make project knowledge useful without making graph state a
new authority. It will also make Foreman installable as a pinned appliance.
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
 MemoryIndex and     hermetic        Graphify 0.9.48
 projection epochs  appliance        qualification
          |              |              |
          |              |       deterministic work DAG
          |              |              |
          |              |       bounded context packs
          |              |              |
          |              +---- locked evaluation
          |                             |
          +--------- exact-candidate convergence
```

Authority convergence is the first dependency. The MemoryIndex, appliance, and
Graphify tracks can then run in parallel. The appliance must join the knowledge
track before the locked evaluation so that the measuring environment is
reproducible. Graphify qualification fixes the graph identity that the
projector and context builder consume. The work DAG must exist before the
builder can add prior-attempt evidence. The builder must be stable before the
evaluation can lock its treatment arms. Final convergence joins all tracks and
the Windows Bats result.

## Package map

The release governor reuses focused packages after it reconciles them:

| Tranche | OpenSpec owner | Main result |
|---|---|---|
| 1 | `openspec-superpowers-convergence` | One active spec and task authority |
| 2 | `external-memory-index` | Live external adapter and isolated projection epochs |
| 3 | `hermetic-foreman-appliance` | Pinned control, toolchain, and worker images |
| 4 | `knowledge-plane-refresh` | Qualified Graphify 0.9.48 and immutable graph metadata |
| 5 | `work-dag-projection` | Deterministic work-lineage artifact |
| 6 | `graph-context-builder` | Bounded, immutable, cited context pack |
| 7 | `graph-eval-falsification` | Locked four-arm evaluation and rollout verdict |
| 8 | `v040-release-program` | Windows Bats, integration, evidence, and publication |

The architect will reconcile an existing package before implementation. A
reconciliation can revise stale assumptions, split an unsafe scope, or mark a
package superseded. It cannot report an unchecked task as complete.

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
and deterministic evidence. It reports `APPROVED`, `CHANGES_REQUESTED`, or a
typed abstention. A blocking finding reopens the same bounded package loop.

The architect owns commits, integration, and publication. Workers do not merge,
rewrite release evidence, or mark SessionDB obligations complete.

The Endstop runtime reserves each action before it starts. It remains running at
a tranche boundary and reaches a terminal state only at a contract terminal
condition. This prevents a new package, worktree, or session from resetting the
release budget.

## External MemoryIndex and projection epochs

The release adds one adapter for the external agent-memory service evaluated by
the v0.3.1 storage review. The focused package must name and pin the service
before code starts. The adapter preserves the existing split:

- `SessionStore` remains synchronous, exact, and authoritative.
- `MemoryIndex` remains asynchronous, optional, and derived.
- the durable outbox remains idempotent at-least-once
- recall returns references that are rehydrated from `SessionStore`
- subtractive projection redaction remains in force

The current epoch methods are not enough to prove concurrent rebuild safety.
The focused design must bind each rebuild projection to an explicit epoch and
define the incremental-write catch-up protocol. It must prove that an entity
changed during rebuild is present in the candidate epoch before activation, or
that activation refuses. It must also prove that a failed or abandoned epoch is
not queryable.

The live test stack includes the pinned memory core, hub, proxy, data services,
and both required LLM credential planes. Mocks cover deterministic failure
classes, but they do not satisfy the release predicate. At least one live stack
must demonstrate apply, retry after an ambiguous result, recall, rebuild,
concurrent mutation, activation, abandonment, and destroy-and-rebuild recovery.
`NullMemoryIndex` remains the default configuration after this adapter ships.

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

### Hard-mode topology

The control container has no path to the host engine. The hard-mode
profile starts a rootless daemon sidecar. The control container receives only
the private sidecar socket. The sidecar keeps images, layers, and worker
containers in its own volume and network namespace.

This layout limits the effect of a control-plane compromise. It also makes
cleanup and test evidence independent of the operator's host engine state. The
sidecar is an explicit privilege boundary, not a claim that nested container
execution has no kernel risk. The security tests therefore include socket
discovery, privilege, mount, capability, network, device, and state-volume
negative controls.

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

The evaluation tranche locks at least 30 tasks before treatment results. The
task set balances changed-interface callers and dependents, cross-package
impact, event producer to consumer tracing, and command entry point to
persistence tracing. Every task runs in all four retrieval arms with equal or
recorded budgets. The harness records retrieval recall and precision, context
tokens, citation validity, task quality, elapsed time, cost, failure class, and
graph-mode identity.

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
- hard-mode sidecar isolation and no-host-socket negative controls
- secret-canary scans over build inputs, image outputs, and attestations
- Graphify deterministic rebuild and hostile stale or corrupt fixtures
- external MemoryIndex live-service, epoch isolation, and rebuild-race tests
- work-DAG replay, torn-tail, failed-attempt, and rename fixtures
- context budget, determinism, citation, degraded-mode, and escape-hatch tests
- locked 30-task evaluation with all negative controls
- hosted Linux, WSL, Windows, and supported architecture evidence
- native Windows completion of Bats item BW-004
- one cold audit of the full baseline-to-candidate diff
- one unchanged pushed-candidate release convergence run

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

The release tag and public image require one exact candidate with:

- every v0.4 OpenSpec task complete or explicitly deferred by this design
- no open blocking audit finding
- fresh deterministic and hosted test evidence
- a passing appliance reproducibility and security report
- a passing external MemoryIndex live-service and epoch-isolation report
- a locked evaluation verdict and valid rollout state
- a complete SessionDB milestone record
- completed Windows Bats item BW-004
- completed Endstop milestones for checks, audit, integration, and publication
- a verified tag, release record, image index, SBOM, provenance, and signature

Any byte change after the final audit invalidates the affected evidence. The
architect reruns the required checks and cold audit before publication.

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
files-only GraphStore remains available. A later release can reconsider these
items with a separate measured need and approved OpenSpec package.
