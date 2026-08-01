# Council functional core and Effect architecture memo

Status: committee recommendation for OpenSpec `proposal`, capability `specs`, and `design` inputs. This memo does not define implementation tasks.

## Executive recommendation

Build Council as a functional core with an Effect shell.

The core consists of versioned Schema contracts and pure aggregate functions. The core accepts decoded commands, returns immutable domain events, and folds events into immutable state. It does not launch processes, read clocks, generate identifiers, persist data, use mutable references, or return `Effect` values.

The shell consists of Effect application programs, service algebras declared with `Context.Tag`, and implementations supplied as `Layer` values. The shell loads event history, supplies time and identifiers to commands, invokes the pure decision function, appends events with optimistic concurrency, and interprets durable reactions. Concrete layers own subprocesses, files, databases, network access, approvals, and telemetry.

Use the current stable Effect v3 vocabulary in this design. The official documentation defines services through tags and `Context`, implementations through `Layer`, branded schemas through `Schema.brand`, serializable tagged errors through `Schema.TaggedError`, and event feeds through `Stream<A, E, R>`. [Managing Services](https://www.effect.website/docs/v3/requirements-management/services), [Managing Layers](https://www.effect.website/docs/v3/requirements-management/layers), [Schema advanced usage](https://www.effect.website/docs/v3/schema/advanced-usage), [Schema class APIs](https://www.effect.website/docs/v3/schema/classes), [Streams](https://www.effect.website/docs/v3/stream/introduction).

This split supports the research corpus:

- A durable provider-neutral orchestrator needs a canonical append-only event stream.
- A secure Council needs an immutable task contract and an external capability boundary.
- A reliable Council needs independent proposals, a round-zero baseline, selective deliberation, and bias-checked synthesis.
- Provider observations need durable provenance, but untrusted provider data must not become authority by entering the reducer.

### Rejected alternatives

| Alternative | Decision and reason |
| --- | --- |
| Mutable object-oriented aggregate | Reject. Hidden mutation makes replay, property testing, and transition auditing difficult. |
| `Effect`-returning domain reducer | Reject. It couples business rules to the runtime and permits time, randomness, storage, or process access during replay. |
| Snapshot-only CRUD state | Reject. It loses causation, audit history, deterministic recovery, and a safe resume boundary. |
| Provider JSONL as the domain event log | Reject. Provider records are unstable, untrusted, high volume, and different across CLIs. |
| In-memory event bus as the source of truth | Reject. A process crash can lose acknowledged state. Publish only after durable append. |
| One large `CouncilService` with one `AppError` | Reject. It hides dependencies and removes precise failure handling. |
| A service tag for every configured model | Reject. Models and adapters are runtime data. Use one typed adapter registry service. |
| Promises in service algebras | Reject. Promises erase typed errors, requirements, interruption, and scoped resource lifetimes. |
| Effect `Ref` as authoritative run state | Reject. A `Ref` can cache a projection, but replayed persisted events remain authoritative. |
| Experimental Effect Workflow or Cluster APIs in v1 | Reject. Pin stable Effect primitives until the project separately accepts an experimental dependency. |
| A single package for domain, adapters, and plugin manifests | Reject. It makes provider formats and host packaging part of the core API. |

## Package and module boundaries

Use a workspace with directed dependencies. Cycles are prohibited.

```text
@council/schema
    ^
    |
@council/domain
    ^
    |
@council/application <---------------- @council/testing
    ^                ^
    |                |
@council/platform-node              @council/adapter-spi-tests
    ^                ^
    |                |
@council/adapter-{codex,claude,gemini,grok}
    ^
    |
@council/runtime-node
    ^
    |
@council/mcp-server
    ^
    |
@council/plugin-{codex,claude,gemini,grok}
```

| Package | Allowed workspace dependencies |
| --- | --- |
| `@council/schema` | none |
| `@council/domain` | `@council/schema` |
| `@council/application` | `@council/schema`, `@council/domain` |
| `@council/platform-node` | `@council/schema`, `@council/application` |
| `@council/adapter-*` | `@council/schema`, `@council/application`, `@council/platform-node` |
| `@council/runtime-node` | application, platform, and selected adapter packages |
| `@council/mcp-server` | schema, application, and runtime composition packages |
| `@council/plugin-*` | packaged MCP server artifacts only |
| `@council/testing` | schema, domain, and application packages |

### `@council/schema`

Own the stable, serializable language of Council.

It SHALL contain:

- branded identifiers and constrained scalar values
- commands, domain events, event envelopes, snapshots, and public result schemas
- provider-neutral observation schemas
- adapter capability schemas
- authority, provenance, redaction, budget, approval, and artifact-reference schemas
- schema-version constants and migrations between supported encoded versions
- JSON Schema generation for CLI output constraints

It MAY import `Schema` and JSON Schema utilities from `effect`. It MUST NOT import `Effect`, `Context`, `Layer`, `Stream`, `Ref`, `Queue`, `Scope`, platform modules, or Node APIs.

`Schema` is the edge parser and encoder. Decode `unknown` once at each boundary. Do not allow an `unknown`, provider DTO, or unbranded identifier past that boundary. The official Effect documentation supports deriving branded types with `Schema.brand` and generating JSON Schema with `JSONSchema.make`. [Schema branding](https://www.effect.website/docs/v3/schema/advanced-usage), [Schema to JSON Schema](https://www.effect.website/docs/v3/schema/json-schema).

### `@council/domain`

Own pure policy and state transitions.

It SHALL contain:

- aggregate state unions
- domain commands and domain-event aliases imported from `@council/schema`
- total `decide`, `evolve`, `replay`, and invariant-check functions
- quorum, stop, admissibility, ranking, and minority-guard policies
- pure budget arithmetic and dependency-graph validation
- pure domain rejections as discriminated values

It MUST NOT import any Effect runtime module. It MUST NOT perform I/O, allocate global mutable state, read time, generate random values, or inspect environment variables. Every nondeterministic value enters as a validated command field.

### `@council/application`

Own use cases and Effect service algebras.

It SHALL contain:

- `Context.Tag` declarations for ports
- command handlers that load, decide, and append
- orchestration programs that interpret durable reactions
- typed application and port errors
- the public `Council` service algebra
- no concrete provider, database, filesystem, process, MCP, or plugin implementation

This package may import `Effect`, `Context`, `Layer`, `Stream`, `Scope`, and stable Effect utilities. It depends only on `@council/schema` and `@council/domain`.

### `@council/adapter-*`

Each adapter owns one external CLI protocol. An adapter translates provider events into provider-neutral observations. It does not create domain events directly.

Each adapter SHALL:

- resolve its executable and report capabilities
- launch without shell interpolation
- parse the pinned provider protocol
- retain bounded diagnostic excerpts
- classify exit, terminal record, and parse state together
- implement cancellation and scoped cleanup
- validate the normalized final result locally
- preserve unknown provider fields in a versioned extension field

The adapter package depends on `@council/schema` and `@council/application`. Adapter packages MUST NOT depend on each other.

### `@council/platform-node`

Own reusable Node and operating-system layers. Examples include SQLite event storage, filesystem artifact storage, process-tree ownership, network brokering, hashing, secret scanning, and OpenTelemetry export.

All acquired resources require scoped layers. Effect `Scope` represents a resource lifetime and guarantees finalizer execution when the scope closes. [Effect Scope](https://www.effect.website/docs/v3/resource-management/scope).

### `@council/runtime-node`

Own only the production composition root. It selects configured adapter layers, supplies platform layers, verifies required capabilities, and exports a complete `Council` layer. It contains no domain policy. Nothing below this package depends on it.

### `@council/mcp-server`

Own the MCP transport, request decoding, response encoding, tool descriptions, and mapping from MCP task vocabulary to Council public commands. It depends on the public application API. It does not contain domain rules.

### `@council/plugin-*`

Each host wrapper owns only its native manifest, host-specific skill text, portable path substitution, and bootstrap command. A wrapper MUST NOT fork the core schemas or behavior.

### `@council/testing`

Own in-memory test layers, deterministic ID supplies, fixtures, schema generators, event-history builders, and provider conformance harnesses. Production packages MUST NOT depend on it.

`@council/adapter-spi-tests` owns the reusable black-box adapter conformance suite. Adapter packages use it only as a development dependency.

## Key type shapes

These signatures are illustrative. They define intended boundaries, not implementation.

### Branded values and versioned contracts

```ts
import { Schema } from "effect"

export const RunId = Schema.String.pipe(Schema.brand("Council/RunId"))
export type RunId = typeof RunId.Type

export const BranchId = Schema.String.pipe(Schema.brand("Council/BranchId"))
export type BranchId = typeof BranchId.Type

export const EventId = Schema.String.pipe(Schema.brand("Council/EventId"))
export type EventId = typeof EventId.Type

export const StreamVersion = Schema.Number.pipe(
  Schema.int(),
  Schema.nonNegative(),
  Schema.brand("Council/StreamVersion")
)
export type StreamVersion = typeof StreamVersion.Type

export const Sha256 = Schema.String.pipe(Schema.brand("Council/Sha256"))
export type Sha256 = typeof Sha256.Type

export type SchemaVersion = "1"
export type Authority =
  | "trusted_instruction"
  | "user_data"
  | "tool_metadata"
  | "untrusted_evidence"
```

Brands distinguish values at compile time without changing their runtime representation. [Effect branded types](https://www.effect.website/docs/v3/code-style/branded-types).

### Aggregate state

```ts
export type RunState =
  | { readonly _tag: "NotCreated" }
  | { readonly _tag: "Queued"; readonly run: RunRecord }
  | { readonly _tag: "Running"; readonly run: ActiveRun }
  | { readonly _tag: "InputRequired"; readonly run: PausedRun }
  | { readonly _tag: "Completed"; readonly result: ResultRef }
  | { readonly _tag: "Failed"; readonly failure: FailureRecord }
  | { readonly _tag: "Cancelled"; readonly reason: CancelReason }

export type DeliberationPhase =
  | { readonly _tag: "CollectingIndependent" }
  | { readonly _tag: "Verifying" }
  | { readonly _tag: "RoundZeroAggregated"; readonly baseline: Aggregate }
  | { readonly _tag: "Deliberating"; readonly round: 1 | 2 }
  | { readonly _tag: "Adjudicating" }
  | { readonly _tag: "Synthesizing" }
  | { readonly _tag: "Decided"; readonly decision: DecisionRef }
  | { readonly _tag: "Escalated"; readonly reasons: ReadonlyArray<EscalationReason> }

export type AttemptState =
  | { readonly _tag: "NotStarted" }
  | { readonly _tag: "Running"; readonly attempt: AttemptId }
  | { readonly _tag: "Completed"; readonly output: ArtifactRef }
  | { readonly _tag: "Failed"; readonly failure: AttemptFailure }
  | { readonly _tag: "Cancelled"; readonly reason: CancelReason }
  | { readonly _tag: "OutcomeUnknown"; readonly reconciliation: ReconciliationRef }
```

Do not represent state with optional-field bags such as `{ status, result?, error?, approval? }`. Discriminated unions make illegal combinations unrepresentable.

### Pure decision and evolution functions

```ts
export type NonEmptyReadonlyArray<A> = readonly [A, ...ReadonlyArray<A>]

export type Decision<E, R> =
  | { readonly _tag: "Accepted"; readonly events: NonEmptyReadonlyArray<E> }
  | { readonly _tag: "Rejected"; readonly error: R }

export type DomainRejection =
  | { readonly _tag: "IllegalTransition"; readonly state: RunState["_tag"]; readonly command: string }
  | { readonly _tag: "TerminalState"; readonly state: "Completed" | "Failed" | "Cancelled" }
  | { readonly _tag: "QuorumNotMet"; readonly distinctFamilies: number }
  | { readonly _tag: "RoundLimitReached"; readonly configuredLimit: number }
  | { readonly _tag: "EvidenceBackedDissent"; readonly proposal: ProposalId }
  | { readonly _tag: "ApprovalHashMismatch"; readonly approval: ApprovalId }
  | { readonly _tag: "BudgetReservationDenied"; readonly dimension: BudgetDimension }

export declare const decide: (
  state: RunState,
  command: DomainCommand
) => Decision<DomainEvent, DomainRejection>

export declare const evolve: (
  state: RunState,
  event: DomainEvent
) => RunState

export declare const replay: (
  events: ReadonlyArray<DomainEvent>
) => RunState
```

`decide` and `evolve` are synchronous, total, and referentially transparent. A rejected command emits no events. `evolve` never makes authorization decisions and never performs validation of external data. Schemas validate the data before replay.

### Domain events and stored envelopes

```ts
export type DomainEvent =
  | RunCreated
  | RunStarted
  | PlanCommitted
  | ProposalRecorded
  | CandidateVerified
  | RoundZeroRecorded
  | DeliberationRoundOpened
  | PrivateBallotRecorded
  | DeliberationStopped
  | ApprovalRequested
  | ApprovalResolved
  | CapabilityIssued
  | SideEffectOutcomeRecorded
  | CancellationRequested
  | RunCompleted
  | RunFailed
  | RunCancelled

export interface EventEnvelope<P extends DomainEvent = DomainEvent> {
  readonly schemaVersion: SchemaVersion
  readonly eventId: EventId
  readonly streamId: RunId
  readonly streamVersion: StreamVersion
  readonly occurredAt: UtcInstant
  readonly correlationId: CorrelationId
  readonly causationId: CommandId | EventId
  readonly actor: ActorRef
  readonly authority: "trusted_instruction" | "tool_metadata"
  readonly previousHash: Sha256 | null
  readonly eventHash: Sha256
  readonly payload: P
  readonly redaction: RedactionSummary
}
```

Domain events record facts in past tense. Commands use imperative names. Provider records such as `message.delta` are `ProviderObservation` values. They are not members of `DomainEvent`.

### Serializable tagged errors

```ts
import { Schema } from "effect"

export class ExpectedVersionConflict extends Schema.TaggedError<ExpectedVersionConflict>()(
  "ExpectedVersionConflict",
  {
    streamId: RunId,
    expected: StreamVersion,
    actual: StreamVersion
  }
) {}

export class ProviderProtocolError extends Schema.TaggedError<ProviderProtocolError>()(
  "ProviderProtocolError",
  {
    provider: ProviderId,
    phase: Schema.Literal("startup", "stream", "terminal"),
    safeExcerpt: Schema.String
  }
) {}
```

Use a separate tagged class for each recoverable category. Keep error unions precise on every method. Never expose raw secrets, complete provider output, or an unrestricted `cause` through an encoded error. The official documentation defines tagged expected errors as discriminated values and shows `Schema.TaggedError` for schema-backed errors. [Expected errors](https://www.effect.website/docs/v3/error-management/expected-errors), [Schema tagged errors](https://www.effect.website/docs/v3/schema/classes).

### Service algebras

```ts
import { Context, Effect, Stream } from "effect"

export interface AppendRequest {
  readonly streamId: RunId
  readonly expectedVersion: StreamVersion
  readonly events: NonEmptyReadonlyArray<UnstoredEvent>
}

export interface EventStoreService {
  readonly read: (
    streamId: RunId,
    after?: StreamVersion
  ) => Stream.Stream<EventEnvelope, EventStoreReadError>

  readonly append: (
    request: AppendRequest
  ) => Effect.Effect<AppendReceipt, ExpectedVersionConflict | EventStoreWriteError>
}

export class EventStore extends Context.Tag("@council/EventStore")<
  EventStore,
  EventStoreService
>() {}

export interface ArtifactStoreService {
  readonly put: (
    artifact: SanitizedArtifact
  ) => Effect.Effect<ArtifactRef, ArtifactStoreError>

  readonly get: (
    ref: ArtifactRef
  ) => Effect.Effect<SanitizedArtifact, ArtifactNotFound | ArtifactStoreError>
}

export interface AdapterRegistryService {
  readonly capabilities: (
    provider: ProviderId
  ) => Effect.Effect<AdapterCapabilities, AdapterUnavailable>

  readonly execute: (
    request: ProviderRequest
  ) => Stream.Stream<ProviderObservation, AdapterLaunchError | ProviderProtocolError>

  readonly cancel: (
    session: ProviderSessionId
  ) => Effect.Effect<void, AdapterCancelError>
}

export interface PolicyEngineService {
  readonly authorize: (
    request: PolicyRequest
  ) => Effect.Effect<PolicyPermit, PolicyDenied | ApprovalRequired>
}

export interface CapabilityBrokerService {
  readonly issue: (
    permit: PolicyPermit
  ) => Effect.Effect<Capability, CapabilityIssueError>

  readonly consume: (
    capability: Capability,
    operation: Operation
  ) => Effect.Effect<CapabilityReceipt, CapabilityDenied>
}

export interface IdGeneratorService {
  readonly nextRunId: Effect.Effect<RunId, IdGenerationError>
  readonly nextEventId: Effect.Effect<EventId, IdGenerationError>
  readonly nextCommandId: Effect.Effect<CommandId, IdGenerationError>
}
```

Other narrow services are `SnapshotStore`, `ObservationStore`, `ApprovalGateway`, `BudgetLedger`, `Hashing`, `SecretScanner`, `ProcessSupervisor`, and `TelemetryExporter`. Do not merge these services only to shorten an Effect requirements type.

### Public API

```ts
export interface CouncilService {
  readonly submit: (
    input: unknown
  ) => Effect.Effect<RunHandle, InvalidRequest | AdmissionDenied>

  readonly status: (
    runId: RunId
  ) => Effect.Effect<RunView, RunNotFound | QueryUnavailable>

  readonly events: (
    runId: RunId,
    cursor?: EventCursor
  ) => Stream.Stream<PublicCouncilEvent, RunNotFound | QueryUnavailable>

  readonly awaitResult: (
    runId: RunId
  ) => Effect.Effect<CouncilResult, RunNotFound | RunFailed | RunCancelled>

  readonly resolveApproval: (
    command: ResolveApproval
  ) => Effect.Effect<ApprovalView, ApprovalNotCurrent | PolicyDenied>

  readonly cancel: (
    runId: RunId,
    reason: CancelReason
  ) => Effect.Effect<RunView, RunNotFound | TerminalStateError>
}

export class Council extends Context.Tag("@council/Council")<Council, CouncilService>() {}
```

Expose service accessors and schemas. Do not expose live layers from the root export. Publish implementations from explicit paths such as `@council/platform-node/sqlite`. This prevents accidental I/O dependencies in library consumers.

## Event-sourcing design

### Authoritative and observational streams

Keep two append-only records with different authority:

1. The domain event stream is authoritative. It contains low-volume facts that change aggregate state.
2. The provider observation log is evidentiary. It contains normalized provider events, raw hashes, usage records, and bounded diagnostics.

A validated application decision can reference an observation by artifact hash. A provider observation cannot enter `evolve` directly. This rule prevents untrusted model output from changing control flow without an application command and policy check.

### Command transaction

For each domain command, the application SHALL use this sequence:

1. Decode the command with its versioned Schema.
2. Load the latest valid snapshot, if one exists.
3. Verify the snapshot sequence and event hash.
4. Replay subsequent domain events with `evolve`.
5. Invoke `decide` with all time, identifiers, and policy results already present.
6. Atomically append returned events with the loaded stream version.
7. Commit an outbox record in the same transaction when an event requires a reaction.
8. Publish public events only after the append commits.

On `ExpectedVersionConflict`, reload and re-decide only commands declared safe to retry. Bound the retry count. Never repeat an external side effect as part of conflict recovery.

### Reactions and side effects

An event such as `BranchLaunchRequested` expresses durable intent. A reaction worker claims the outbox item, obtains policy authorization, consumes an exact capability, performs the operation, and appends the outcome. The provider process does not run inside the event-store transaction.

Side-effecting operations use a stable idempotency key based on run and logical step. A retry creates a new attempt ID but reuses the logical idempotency key. An ambiguous process exit creates `OutcomeUnknown`. The system MUST reconcile that outcome before it retries or compensates the operation.

### Snapshots and projections

Snapshots are caches. Each snapshot contains the stream version, last event hash, reducer version, and schema version. A failed check discards the snapshot and replays from events.

Read models are asynchronous, disposable projections. Projectors are idempotent by event ID and record their last processed stream version. Query lag can be visible, but a projection can never overwrite domain history.

## State-machine rules and invariants

### Universal invariants

1. Every identifier type is branded. Identifiers from different concepts are not assignable.
2. Every persisted value decodes under a declared schema version.
3. Stream versions increase by one with no duplicates inside one stream.
4. An append compares the expected version atomically.
5. Terminal run states are absorbing.
6. A command rejection appends no events.
7. Replay is deterministic and performs no I/O.
8. A snapshot is never authoritative.
9. Domain arrays, records, and state values are readonly.
10. Provider observations and evidence always retain non-authoritative labels.
11. Provenance, source quality, factual support, and instruction authority remain separate dimensions.
12. Every material result claim references exact evidence spans or records an explicit unsupported status.

W3C PROV-O defines provenance through entities, activities, agents, generation, derivation, and attribution. It does not define truth or authorization. [W3C PROV-O](https://www.w3.org/TR/prov-o/).

### Run lifecycle

- `NotCreated -> Queued` only through `CreateRun`.
- `Queued -> Running` only after plan and version metadata commit.
- `Running -> InputRequired` only after the approval request and checkpoint commit.
- `InputRequired -> Running` only through a current approve or edit resolution.
- A rejected or expired approval follows the action-specific failure or cancellation policy. It is never retried as a transient error.
- `Queued`, `Running`, or `InputRequired` can accept `RequestCancellation`.
- A cancellation request stops new scheduling before process termination begins.
- Late provider observations remain stored as late evidence. They cannot change a terminal run.
- `Completed`, `Failed`, and `Cancelled` accept no state-changing command.

This vocabulary aligns with the durable MCP task model while remaining an internal contract. [MCP Tasks](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks).

### Deliberation lifecycle

- The independent phase records at least three proposals from at least two distinct model families by default.
- A proposal is immutable after its independent ballot commits.
- No member receives peer content before all eligible independent proposals close or time out.
- Verification excludes invalid candidates with machine-readable reasons.
- Round-zero aggregation commits before any critique begins.
- Deliberation opens only for material disagreement, low calibrated confidence, unresolved evidence, or high consequence.
- The default critique limit is two rounds.
- A critique must add new evidence or a falsifiable objection. Restatement does not extend a round.
- Ballots remain private until the round closes.
- A judge cannot score its own proposal.
- Pairwise evaluation runs both candidate orders. An order reversal causes a tie or escalation.
- A unique, evidence-backed, high-confidence dissent blocks automatic closure.
- Synthesis uses only top admissible candidates. It preserves claim attribution and unresolved dissent.

The evidence for independent initialization, bounded discussion, and bias checks comes from ReConcile and subsequent multi-agent debate studies. [ReConcile](https://aclanthology.org/2024.acl-long.381/), [Demystifying Multi-Agent Debate](https://aclanthology.org/2026.findings-acl.1694/), [Debate or Vote](https://arxiv.org/abs/2508.17536).

### Approval and capability lifecycle

- An approval binds to the hash of normalized action arguments, destination, policy version, and expiry.
- Editing an action supersedes the old approval and creates a new approval ID and hash.
- A capability binds to one run, worker, tool, operation, resource, destination, and short validity period.
- Every tool call rechecks policy and consumes or validates its capability.
- Unknown provenance, capability, destination, citation support, or secret-scan status MUST fail closed at a commitment boundary.
- Evidence can fill declared data slots. Evidence cannot add actions, tools, recipients, or privileges.

### Budget lifecycle

- Admission records hard limits for time, tokens, cost, turns, tool calls, retries, concurrency, and artifact bytes.
- Scheduling reserves budget before branch launch.
- Reconciliation releases unused reservation or charges actual reported usage.
- Concurrent branches cannot reserve the same remaining budget.
- The soft threshold prevents new work. The hard threshold requests cancellation.

## Effect shell rules

1. Declare each port as a small `Context.Tag` service.
2. Keep service methods as data-first functions returning `Effect` or `Stream`.
3. Use `Layer.succeed` for pure implementations.
4. Use `Layer.effect` for fallible acquisition without a resource lifetime.
5. Use `Layer.scoped` for subprocess supervisors, database pools, file watchers, and network resources.
6. Compose one application layer at each executable entry point.
7. Do not call `Effect.run*` below an entry point.
8. Do not scatter `Effect.provide` through business programs.
9. Keep expected failures in the typed error channel.
10. Treat interruption, defects, and expected domain failures as different outcomes.
11. Use Effect structured concurrency for fibers. Do not create detached background Promises.
12. Use bounded streams or queues at process boundaries. Persist an observation before releasing upstream capacity.
13. Derive logs, metrics, and spans from stable run, branch, step, and attempt identifiers.
14. Redact content by default before logging or encoding errors.

Effect documents the requirements type as the service dependencies of an `Effect`, and Layers as reusable dependency graphs. [Managing Services](https://www.effect.website/docs/v3/requirements-management/services), [Managing Layers](https://www.effect.website/docs/v3/requirements-management/layers).

## OpenSpec capabilities and normative requirements

The OpenSpec 1.7.0 change should keep the required order: `proposal -> specs -> design -> tasks`. This committee recommends the following capabilities for proposal and spec work. Task files remain out of scope.

### Capability: `typed-core-contracts`

**CORE-001 — Boundary decoding.** Every external input SHALL decode through a versioned Schema before application or domain use.

Scenario:

- Given a provider returns an object with an unrecognized core field
- When the adapter decodes the object
- Then Council rejects or quarantines the object with a typed schema error
- And no domain command is created

**CORE-002 — Runtime-free domain.** The domain package MUST contain no Effect runtime, platform, or Node dependency.

Scenario:

- Given the workspace dependency rules run in CI
- When a domain module imports `Effect`, `Context`, `Layer`, `Stream`, `Ref`, `Scope`, or a platform module
- Then CI fails with the offending import path

**CORE-003 — Branded identity.** All aggregate, command, event, branch, step, attempt, approval, capability, and artifact identifiers SHALL use distinct Schema brands.

Scenario:

- Given a function requires a `RunId`
- When TypeScript receives a `BranchId`
- Then type checking fails without an explicit boundary decode

### Capability: `durable-event-sourcing`

**EVT-001 — Atomic append.** The event store SHALL append a non-empty batch only when the expected stream version matches.

Scenario:

- Given two handlers load stream version 12
- When both append against version 12
- Then exactly one append commits
- And the other returns `ExpectedVersionConflict`

**EVT-002 — Deterministic replay.** Replaying the same valid event sequence MUST produce the same state without external access.

Scenario:

- Given a persisted event sequence and two clean processes
- When both processes replay the sequence
- Then their encoded aggregate states are equal

**EVT-003 — Observation separation.** Provider observations MUST NOT enter the domain reducer directly.

Scenario:

- Given a provider emits text that requests a new privileged tool
- When the observation is stored
- Then its authority remains `untrusted_evidence`
- And the run plan and capability set remain unchanged

**EVT-004 — Commit before publish.** Council SHALL publish no state transition before its event append commits.

Scenario:

- Given an event-store write fails
- When the command handler attempts a transition
- Then subscribers receive no transition event
- And the command returns a typed persistence error

### Capability: `effect-application-shell`

**APP-001 — Explicit services.** Each external capability SHALL have a typed service algebra and replaceable Layer.

Scenario:

- Given a command handler requires storage, policy, and identifiers
- When its type is inspected
- Then the Effect requirements contain only those service tags

**APP-002 — Scoped resources.** Every acquired process, database connection, and long-lived stream MUST belong to an Effect scope.

Scenario:

- Given a branch fiber is interrupted
- When its scope closes
- Then the adapter cancellation finalizer runs
- And the process-tree conformance check reports no orphan

**APP-003 — Precise errors.** Public and port methods SHALL expose only errors that callers can handle at that boundary.

Scenario:

- Given a status query cannot launch a provider
- When its declared error union is inspected
- Then provider launch errors are absent from that query type

### Capability: `provider-neutral-cli-adapters`

**CLI-001 — Protocol isolation.** Provider event names and fields MUST remain inside their adapter package.

Scenario:

- Given a provider changes an optional stream field
- When its adapter updates
- Then domain and public event schemas do not change

**CLI-002 — Capability discovery.** An adapter SHALL report streaming, schema output, resume, interrupt, usage, cost, tool-event, and lineage capabilities.

Scenario:

- Given a provider lacks schema-constrained output
- When Council plans a request
- Then local final-result validation remains enabled
- And the capability report records schema output as unavailable

**CLI-003 — Bounded protocol failure.** A malformed provider record SHALL produce a typed protocol error with a bounded sanitized excerpt.

Scenario:

- Given stdout contains a malformed JSONL line larger than the excerpt limit
- When the adapter parses the stream
- Then it stores the raw content hash
- And it returns a bounded `ProviderProtocolError`
- And it exposes no secret-bearing full line

### Capability: `bounded-deliberation`

**DEL-001 — Independent baseline.** Council SHALL commit independent proposals and a round-zero aggregate before critique.

Scenario:

- Given three eligible advisers
- When only two independent proposals have committed
- Then peer content remains unavailable
- And deliberation cannot open

**DEL-002 — Failure-domain quorum.** Automatic closure MUST require the configured count of distinct model families, not raw worker count.

Scenario:

- Given three agreeing workers share one model family
- And one evidence-backed dissent uses another family
- When Council evaluates quorum
- Then worker count alone cannot close the decision

**DEL-003 — Bounded rounds.** Council SHALL stop after the configured critique limit unless a separately approved policy raises it.

Scenario:

- Given the default limit is two rounds
- When round two closes with unresolved disagreement
- Then Council escalates or synthesizes with recorded dissent
- And it does not open round three automatically

**DEL-004 — Bias-checked adjudication.** Council MUST blind authorship and reject self-authored judging.

Scenario:

- Given the selected judge authored candidate A
- When adjudication is scheduled
- Then the scheduler rejects that assignment
- And it selects a non-author or escalates

### Capability: `commitment-security`

**SEC-001 — Immutable task contract.** Untrusted evidence MUST NOT add actions, tools, recipients, destinations, or privileges.

Scenario:

- Given retrieved content instructs a worker to upload repository data
- When the worker proposes that operation
- Then the policy engine denies it as undeclared
- And no capability is issued

**SEC-002 — Exact approval.** Approval SHALL authorize only the normalized action hash that the user reviewed.

Scenario:

- Given the user approved a message to destination A
- When a worker changes the destination to B
- Then approval validation fails
- And Council requests a new approval

**SEC-003 — Fail-closed commitment.** Unknown policy, provenance, destination, or secret status MUST block a side effect.

Scenario:

- Given a network destination resolves to an unclassified address
- When a worker requests a write
- Then the commitment gate stops the operation
- And Council records the denial reason

### Capability: `public-council-api`

**API-001 — Stable provider-neutral API.** Public commands, events, views, and results SHALL contain no provider wire type.

Scenario:

- Given callers use the public event stream
- When the configured provider changes from Codex to Gemini
- Then callers receive the same public schema version

**API-002 — Durable pause and resume.** An approval wait SHALL persist its request and checkpoint before notifying the user.

Scenario:

- Given Council requests approval and the server exits
- When the server restarts
- Then the same run resumes in `InputRequired`
- And the same unexpired approval hash remains current

**API-003 — Terminal immutability.** No late event or repeated command SHALL change a completed, failed, or cancelled run.

Scenario:

- Given a run is cancelled
- When a provider emits a late successful terminal record
- Then Council stores it as late evidence
- And the run remains cancelled

## Risks and open decisions

### Mandatory architectural decisions

These decisions are not product tuning parameters. The OpenSpec design must preserve them.

1. Use versioned Schema contracts at every external and persisted boundary.
2. Keep `decide`, `evolve`, and replay free of the Effect runtime and all I/O.
3. Use one authoritative domain stream per run in v1.
4. Store high-volume provider observations separately from authoritative domain events.
5. Declare application ports with `Context.Tag` and supply implementations with Layers.
6. Run external reactions only after durable intent commits through an outbox.
7. Treat provider output and retrieved evidence as non-authoritative data.
8. Expose one provider-neutral public API and separate native plugin wrappers.
9. Register the supported v1 adapters explicitly at the runtime composition root.
10. Exclude experimental Effect Workflow and Cluster APIs from the v1 correctness boundary.

### Risks

- **Effect major-version movement.** The official stable documentation currently uses v3 paths while Effect 4 is announced. Pin a supported major. Treat migration as a separate design change.
- **Event-volume pressure.** Provider deltas can dwarf domain events. Separate observation storage, retention, and compaction prevent reducer and snapshot growth.
- **Cross-stream atomicity.** Multiple aggregates can create distributed consistency problems. Prefer one authoritative run stream in v1. Use outbox reactions instead of cross-stream transactions.
- **Schema evolution.** Long-running tasks can cross software upgrades. Record decoder, reducer, policy, and adapter versions at run creation.
- **Exactly-once assumptions.** Subprocess and external tool outcomes can remain ambiguous after crashes. Expose `OutcomeUnknown` and require reconciliation.
- **Layer graph complexity.** Large Layer graphs can obscure ownership. Keep tags narrow, name live layers by implementation, and compose once at entry points.
- **Secret-bearing failures.** Typed errors can still leak sensitive fields. Define safe encoded fields separately from internal diagnostic causes.
- **False confidence in provenance.** Signed or complete lineage does not prove truth, safety, or authority.
- **Dynamic adapter loading.** Plugin discovery can bypass compile-time Layer composition. Keep registration explicit and schema-validated.

### Open decisions before design approval

1. Select the stable Effect major and exact minimum version.
2. Select the v1 event store and transaction boundary. SQLite is the local-first default candidate.
3. Decide whether one process can write a run stream or whether multi-process optimistic concurrency is required at launch.
4. Set observation retention, compression, and artifact-size limits.
5. Select the snapshot cadence and supported reducer-migration window.
6. Decide whether edited approval creates `Superseded` or records rejection followed by a new request.
7. Select the public event cursor semantics and projection-lag behavior.
8. Define model-family identity and calibration data ownership.
9. Define the exact high-confidence minority threshold per task class.
10. Select which Schema-generated JSON Schema target each CLI accepts.
11. Decide whether provider adapters are statically registered or loaded from a signed registry.

## Acceptance tests for the future implementation

These are acceptance criteria. They are not an implementation task list.

### Compile-time architecture tests

- A `BranchId` cannot satisfy a `RunId` parameter.
- `@council/schema` and `@council/domain` fail dependency checks on forbidden runtime imports.
- Provider DTO types are absent from public package exports.
- Each use case exposes a narrow Effect requirements and error type.
- Concrete live layers are absent from the root public API.

### Schema contract tests

- Every public command, event, error, and result round-trips through encode and decode.
- Generated JSON Schema snapshots are versioned and checked for unexpected changes.
- Unknown core properties fail unless they occur inside the versioned extension object.
- Older supported encodings migrate deterministically to the current decoded type.
- Redacted values never encode their plaintext source.

### Property tests for the domain

- `replay(events)` equals repeated `evolve` for every generated valid history.
- Replaying the same history twice produces byte-equivalent encoded state.
- Terminal states remain unchanged for every generated late command.
- A rejected command produces no events.
- Stream versions remain monotonic.
- Budget reservation never makes any dimension negative.
- The round count never exceeds policy.
- Peer content never appears in an independent proposal command.
- An evidence-backed minority blocks automatic closure under the configured rule.

### Event-store and recovery tests

- Two concurrent expected-version appends allow one winner.
- A crash after append but before publish does not lose the transition.
- A crash after outbox claim resumes without duplicating a committed side effect.
- A corrupt snapshot causes verified replay from the event log.
- A projection rebuild from an empty store matches the existing projection.
- A tampered event or broken hash chain fails verification and stops commitment.

### Effect and resource tests

- Test layers replace every live port without changing use-case code.
- Interruption closes scopes and terminates owned process trees.
- Bounded streams apply backpressure without unbounded memory growth.
- Retry schedules apply only to declared transient errors.
- Test time advances deterministically without wall-clock delay.
- No inner module invokes `Effect.run*`.

### Adapter conformance tests

- Pinned CLI fixtures normalize to the same provider-neutral observation schema.
- Schema-invalid final output receives at most the configured repair attempt.
- Malformed, truncated, and oversized JSONL records return typed errors.
- Exit code, terminal record, and parse state produce the expected classification matrix.
- Cancellation works during generation, tool use, backpressure, and approval wait.
- Capabilities reflect actual pinned CLI behavior, not only version strings.

### Security and deliberation tests

- Prompt-injection fixtures cannot alter the task contract or capability set.
- A changed approval destination invalidates the approval.
- Unknown destination or secret-scan status blocks commitment.
- Same-family replicas do not inflate failure-domain quorum.
- Self-authored judges are rejected.
- Pairwise order reversal causes tie or escalation.
- Round-zero results remain immutable after deliberation.
- Final material claims resolve to stored evidence spans or explicit unsupported markers.

## Primary references

- Effect documentation: [Managing Services](https://www.effect.website/docs/v3/requirements-management/services), [Managing Layers](https://www.effect.website/docs/v3/requirements-management/layers), [Schema advanced usage](https://www.effect.website/docs/v3/schema/advanced-usage), [Schema class APIs](https://www.effect.website/docs/v3/schema/classes), [Schema to JSON Schema](https://www.effect.website/docs/v3/schema/json-schema), [Expected Errors](https://www.effect.website/docs/v3/error-management/expected-errors), [Streams](https://www.effect.website/docs/v3/stream/introduction), [Scope](https://www.effect.website/docs/v3/resource-management/scope).
- Model Context Protocol: [Tasks specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks).
- Provenance: [W3C PROV-O](https://www.w3.org/TR/prov-o/).
- Deliberation: [ReConcile](https://aclanthology.org/2024.acl-long.381/), [Demystifying Multi-Agent Debate](https://aclanthology.org/2026.findings-acl.1694/), [Debate or Vote](https://arxiv.org/abs/2508.17536), [LLM-Blender](https://aclanthology.org/2023.acl-long.792/).
- Security: [CaMeL](https://arxiv.org/abs/2503.18813), [AgentDojo](https://proceedings.nips.cc/paper_files/paper/2024/hash/97091a5177d8dc64b1da8bf3e1f6fb54-Abstract-Datasets_and_Benchmarks_Track.html), [OWASP SSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html).
