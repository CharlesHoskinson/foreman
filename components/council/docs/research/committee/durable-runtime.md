# Council durable runtime and provider-adapter design

Status: committee draft for OpenSpec proposal, delta specs, and design. This document is not an implementation plan and contains no `tasks.md` content.

Research date: 2026-08-01

## Executive decision

Council should be a local-first, event-sourced TypeScript service on the current stable Effect 3 line, with one scoped fiber tree per Council run, a bounded scheduler, a single transactional event writer, and provider-neutral adapters for Claude Code, Codex, Gemini CLI, and Grok Build. Pin the stable `effect` dependency (3.22.1 was the npm `latest` tag on the research date); do not base v1 on the Effect 4 beta or the experimental Effect workflow/event-log packages.

The durable source of truth is an append-only event log. State tables and checkpoints are rebuildable accelerators. Every provider attempt is owned by a reconnectable attempt supervisor, not by an untracked `child_process`. The supervisor owns the complete process tree, spools stdout/stderr before acknowledgment, and supports a bounded reconnect lease. Effect scopes own supervisors; supervisor processes own operating-system resources.

Provider adapters translate Council requests into argument arrays and provider JSON/JSONL into canonical events. They do not schedule, persist, retry, approve tools, or spawn processes. Native Codex, Claude, Gemini, and Grok plugin/extension wrappers remain thin: they register the same Council control MCP server and skills, but do not copy runtime logic. Research tools are reached through a capability-enforcing Tool Gateway. Provider workers never receive the Council control MCP server, which prevents recursive Council invocation.

The release quorum is both operational and epistemic. A run is admitted only when its required provider capabilities are healthy, and automatic Council closure requires results from at least three advisers across at least two independent model families. A unique evidence-backed dissent prevents automatic closure even when a raw process majority exists.

## OpenSpec proposal draft

### Why

The four subscription CLIs expose different streaming flags, event shapes, authentication precedence, resume semantics, output-schema support, cost telemetry, plugin layouts, and exit behavior. Treating any one CLI as the internal protocol would make cancellation, recovery, budgets, and evaluation provider-dependent. Plain `Promise.all` subprocess orchestration also cannot guarantee bounded concurrency, process-tree cleanup, crash recovery, or append-before-publish durability.

Council needs a deterministic control plane around probabilistic workers. It must preserve independent proposals, enforce shared budgets, classify errors before retry, resume from committed boundaries, and prevent external evidence or provider plugins from widening authority.

### What changes

- Add a stable Effect runtime with scoped structured concurrency and typed service boundaries.
- Add a canonical append-only event model, deterministic projections, checkpoints, artifact references, and side-effect/idempotency ledgers.
- Add provider-neutral CLI adapters with an explicit capability model and pinned conformance profiles.
- Add a reconnectable cross-platform attempt supervisor with POSIX process groups, native Windows Job Objects, and a dual-host WSL launch path.
- Add admission budgets, retry ownership, auth/capability doctoring, provider health quorum, and independent failure-domain quorum.
- Add supervised integrations for Scrapling 0.4.12, PixelRAG 0.4.0, and Graphify, behind a capability broker.
- Add one shared MCP control plane and separate thin native packaging wrappers.

### OpenSpec capabilities

1. `durable-run-lifecycle` — append-only events, projections, checkpoints, resume, approvals, and terminal-state immutability.
2. `effect-orchestration` — scoped fiber ownership, cancellation propagation, bounded fan-out, joins, and deterministic interpreter boundaries.
3. `provider-cli-adapters` — invocation construction, JSONL normalization, terminal classification, resume, and capability negotiation.
4. `process-tree-supervision` — reconnectable attempt ownership on Windows, WSL, Linux, and macOS.
5. `budget-retry-idempotency` — reservations, reconciliation, retry classification, and side-effect outcome safety.
6. `auth-and-quorum-doctor` — subscription-auth checks, capability health, environment precedence warnings, and run admission quorum.
7. `evidence-tool-gateway` — Scrapling, PixelRAG, and Graphify with provenance, quarantine, resource limits, and explicit mutation boundaries.
8. `host-integration-boundaries` — shared MCP core, native wrappers, recursion prevention, and least-authority worker tool exposure.

### Impact

The design introduces a local durable database, immutable artifact storage, a small attempt-supervisor executable/native boundary, adapter conformance fixtures, and per-host packaging. It does not require a hosted workflow service. Provider session state remains provider-owned and is treated as a resumability hint, not Council's source of truth.

## Runtime architecture and data flow

### Control and data planes

The control plane consists of the Council CLI/MCP endpoint, `RunEngine`, policy and approval services, the scheduler, budget ledger, adapter registry, and event store. The data plane consists of attempt supervisors, provider CLIs, bounded stdout/stderr ingestion, artifact files, and optional evidence-tool workers.

The runtime uses these ownership rules:

- One root Effect scope owns one run fiber.
- The run scope owns planning, branch, approval-wait, and synthesis child scopes.
- Each branch scope owns exactly one active attempt scope at a time.
- Each attempt scope owns one attempt supervisor, bounded stream queues, decoder state, budget reservation, and telemetry span.
- `forkScoped`-style children cannot outlive their parent scope. A parent interruption starts the cancellation ladder for every descendant.
- Finalizers close resources in reverse acquisition order. Process-tree termination is a mandatory finalizer and runs even after failure or interruption.

The normal data flow is:

1. The API validates a task contract, provider set, permission policy, output schema, and hard budget.
2. `AuthDoctor` probes executable, version, authentication source, machine mode, and required capabilities without exposing credentials.
3. `EventStore` appends `run.created`, version pins, policy hash, and budget limits in one transaction.
4. `Planner` produces a dependency DAG. `PlanValidator` rejects duplicate objectives and unsafe shared-mutable-state concurrency. The plan is checkpointed before fan-out.
5. `Scheduler` reserves shared budget and semaphore permits before it forks a branch. The default is one lead plus at most three advisers.
6. The adapter builds a shell-free invocation specification. `ProcessTreeSupervisor` starts a helper which owns the provider process and durable output spool.
7. Stdout bytes pass through a maximum-line framing stage and an incremental JSON/JSONL decoder. Stderr is a separate bounded diagnostic stream.
8. The adapter converts a provider frame into zero or more canonical events. Unknown provider fields survive in a versioned extension object.
9. The single event writer validates, redacts, hashes raw provenance, assigns the next run sequence, and commits the event before publishing it to projections or subscribers. Queue capacity is released only after commit.
10. Usage events reconcile budget reservations. A soft limit stops new scheduling; a hard limit requests cancellation.
11. A terminal branch result is schema-validated, stored as an immutable artifact, and checkpointed. Synthesis receives artifact references and compact summaries, not a lossy replacement of raw evidence.
12. The final result is validated locally and appended with exactly one immutable terminal run event.

### Effect version and primitive choices

The stable Effect line provides typed errors and requirements, scoped cleanup, fibers, interruption, bounded queues, semaphores, schedules, schemas, streams, and OpenTelemetry integration. Effect documents that scoped finalizers run on success, failure, or interruption and that forked fibers can be attached to a scope. The design uses stable `effect`, `@effect/platform`, `@effect/platform-node`, `@effect/sql`, a SQLite interpreter, and `@effect/opentelemetry`. It does not use alpha workflow APIs as the durability authority. See [Effect structured concurrency](https://www.effect.website/docs/v3/concurrency/basic-concurrency), [Effect API documentation](https://effect-ts.github.io/effect/effect/Effect.ts.html), and [Effect platform command APIs](https://effect-ts.github.io/effect/docs/platform).

### Durable store

The default local interpreter is SQLite in WAL mode with a single logical event writer. The append transaction allocates `seq`, writes the event, updates idempotency/side-effect rows when applicable, and advances the cached projection version atomically. The store uses an exclusive run lease to prevent two orchestrators from advancing the same run.

The event log is authoritative. Cached run/branch/attempt tables and checkpoints can be deleted and rebuilt by replay. Artifact bytes are content-addressed outside the database; the database stores hashes, media type, size, authority/provenance labels, redaction status, producer, and parent transformations. Database and artifacts must reside on the same native filesystem as the Council runtime; WSL cross-filesystem hot paths are prohibited.

## Effect service boundaries and interpreter responsibilities

| Service | Contract responsibility | Interpreter responsibility / forbidden responsibility |
| --- | --- | --- |
| `RunEngine` | Interpret a validated run plan from admission through terminal state | Own the root scope and stage transitions; MUST NOT parse provider formats or write files directly |
| `PlanValidator` | Validate DAG dependencies, distinct objectives, mutation isolation, and stop conditions | Pure deterministic interpreter; MUST reject concurrent branches sharing mutable state unless isolated |
| `RunScheduler` | Admit ready nodes under branch/provider/tool limits | Use semaphores and scoped fibers; MUST reserve budget before fork and MUST stop admission after soft stop/cancel |
| `EventStore` | Append, stream, replay, lease, snapshot, and verify canonical events | SQLite transaction interpreter; append-before-publish; MUST NOT contain provider-specific logic |
| `ProjectionEngine` | Fold events into run, branch, attempt, budget, approval, and side-effect state | Pure total folds by schema/projection version; terminal states MUST be absorbing |
| `CheckpointStore` | Commit and load restart boundaries referenced to a log sequence | Store projection snapshot plus hashes and pins; MUST verify by replay after `last_seq` |
| `BudgetLedger` | Reserve, reconcile, release, and enforce time/token/cost/tool/turn/retry/artifact limits | Serialize updates through events; MUST distinguish billed, reported, and estimated cost |
| `RetryPolicy` | Classify failures and compute bounded full-jitter delay | Own outer retries only after a CLI stops; MUST observe provider-internal retry events rather than multiplying them |
| `ProviderRegistry` | Select a pinned adapter and conformance profile | Resolve by provider/version/capability; MUST fail incompatible resume instead of silently changing interpretation |
| `ProviderAdapter` | Discover, probe, prepare invocation, decode frames, classify termination, construct resume | Pure translation plus read-only probes; MUST NOT spawn, retry, persist, approve, or spend budget |
| `ProcessTreeSupervisor` | Start, reconnect, signal, drain, wait, and kill one attempt tree | Own OS process-tree primitives and raw spools; MUST use argument arrays and an environment allowlist |
| `JsonlIngestor` | Bound bytes/lines/events and expose decoded frames | Keep stdout protocol-only, stderr diagnostic-only; malformed lines become events, not thrown reader defects |
| `AuthDoctor` | Produce sanitized provider/auth/capability health records | Run status or bounded live probes; MUST NOT read or emit secret values |
| `CapabilityBroker` | Authorize tool/provider operation, resource, destination, and expiry | Fail closed at side-effect boundaries; untrusted evidence cannot mint capabilities |
| `ApprovalService` | Persist exact action hashes and await approve/reject/edit/expiry | Checkpoint before notification and release compute while waiting |
| `ArtifactStore` | Put/get immutable content-addressed bytes and metadata | Atomic write/rename and hash verification; MUST quarantine untrusted evidence |
| `ToolGateway` | Invoke Scrapling, PixelRAG, Graphify, and deterministic verifiers | Supervise each as a bounded child service; MUST emit provenance and budget events |
| `Telemetry` | Traces, metrics, structured redacted logs | One trace per run; telemetry failure MUST NOT corrupt the event log |
| `Clock`, `IdGenerator`, `Random`, `Hasher`, `Redactor` | Deterministic infrastructure effects | Live and test layers; randomness for jitter is injected and recorded sufficiently for deterministic tests |

Expected operational failures use tagged error values. Uncaught defects indicate violated invariants or programmer bugs; the runtime catches them at the attempt/branch/run boundary, appends a sanitized `internal_defect` terminal classification if storage remains available, and never retries them automatically.

## Canonical event, state, and error models

### Event envelope

Every event has this stable core:

| Field | Meaning |
| --- | --- |
| `schema_version`, `projection_version` | Independent event and fold versions |
| `event_id` | Globally unique sortable ID |
| `run_id`, optional `branch_id`, `step_id`, `attempt_id` | Stable lineage; retries get a new attempt ID under the same logical step |
| `attempt_no`, `seq` | Human attempt ordinal and strictly increasing per-run sequence allocated at append |
| `occurred_at`, `recorded_at` | Provider/OS observation time when trustworthy and Council commit time |
| `source` | `council`, `provider`, `process`, `tool`, `approval`, or `recovery` |
| `provider`, `provider_session_id`, `provider_event_id`, `provider_seq` | Optional provider identity without overloading Council sequence |
| `type`, `payload` | Versioned discriminated event and validated payload |
| `authority` | `trusted_instruction`, `user_data`, `tool_metadata`, or `untrusted_evidence` |
| `raw_ref` | Content hash/artifact reference for original frame; bounded redacted excerpt only on parse errors |
| `redaction` | Policy version, transformations, and whether protected raw material exists |
| `late` | True when observed after an absorbing terminal state; late events never change that state |
| `extensions` | Versioned provider/tool namespace; stable core rejects other unknown properties |

Minimum event families are run/plan/branch/attempt lifecycle, process start/output/exit, provider init/message/tool/usage/retry/final, artifact, budget reservation/reconciliation/limit, checkpoint, approval, idempotency/side-effect, cancellation, recovery, security policy, and one terminal run event. Canonical examples include `run.created`, `plan.committed`, `branch.queued`, `attempt.started`, `provider.initialized`, `message.delta`, `tool.started`, `tool.completed`, `usage.observed`, `budget.reconciled`, `checkpoint.committed`, `approval.requested`, `retry.scheduled`, `cancel.requested`, `process.exited`, `branch.completed`, and `run.completed|run.failed|run.cancelled`.

### Projected state

- Run: `queued -> planning -> running -> input_required -> running`, or any nonterminal active state to `completed | failed | cancelled`. Terminal states are absorbing.
- Branch: `queued -> running -> completed | failed | cancelled | skipped`.
- Attempt: `created -> launching -> running -> cancel_requested -> exited -> classified`; recovery may add `orphaned` or `outcome_unknown` classification but cannot rewrite history.
- Approval: `requested -> approved | rejected | edited | expired`; an edit creates a new action hash and approval.
- Budget: immutable limit plus `reserved`, `observed`, `reconciled`, and `remaining` projections for each dimension.
- Side effect: `not_started -> in_flight -> committed | compensated | outcome_unknown`. An ambiguous exit never returns to `not_started`.
- Provider health: `unavailable | unauthenticated | degraded | ready`, with capability evidence and expiry.

### Checkpoint model

A checkpoint records `run_id`, checkpoint kind, `last_seq`, projection version, plan/policy/schema hashes, Council and adapter versions, resolved executable path and CLI version, model and failure-domain identity, provider session IDs, pending DAG nodes, active attempt supervisor endpoints and spool offsets, budget limits/reservations/observations, approval hashes, side-effect ledger, artifact hashes, and creation time. A checkpoint is valid only if its hash verifies and replay from `last_seq + 1` reaches the same state as a full replay.

Mandatory checkpoint boundaries are: validated plan before fan-out; every normalized terminal branch result before synthesis; approval request before notification; side-effect commitment before acknowledgment; and final validated result before terminal event.

### Error taxonomy

| Tag | Typical classification | Retry rule |
| --- | --- | --- |
| `ConfigurationError`, `InputError`, `SchemaCompatibilityError` | deterministic caller/configuration failure | never |
| `ExecutableNotFound`, `UnsupportedVersion`, `MissingCapability` | doctor/admission failure | never until external state changes |
| `AuthenticationError`, `PermissionDenied`, `PolicyDenied` | authority failure | never automatically |
| `LaunchError`, `TransportError` | process/pipe startup or transport | transient subset only |
| `ProtocolError` | malformed/truncated/oversized provider stream | retry only when truncation is demonstrably transient and no side effect is ambiguous |
| `ProviderError` | normalized auth, rate-limit, overload, server, invalid request, model, quota | only explicit transient categories |
| `TimeoutError`, `BudgetExceeded`, `Cancelled` | governed stop | no retry unless a new run/policy explicitly expands authority |
| `FinalSchemaInvalid` | locally invalid final answer | at most one bounded repair attempt, never an unbounded provider retry |
| `EventStoreError`, `ArtifactStoreError` | durability failure | stop admission; retry only under store policy before any acknowledgment |
| `IncompatibleResume` | pins/schema/adapter changed | never silently; migration or operator decision required |
| `ProcessOwnershipError`, `OrphanDetected` | tree ownership invariant failed | cancel/quarantine and require reconciliation |
| `SideEffectOutcomeUnknown` | mutating action may have committed | never replay; reconcile or human decision |
| `ToolIntegrationError`, `EvidenceValidationError` | Scrapling/PixelRAG/Graphify or verifier failure | only idempotent, transient stages |
| `InternalDefect` | runtime invariant/programmer bug | never automatically |

Each error carries phase, provider/tool, retryability, safety-to-retry, redacted diagnostics reference, cause hash, attempt ID, and whether a side effect may have occurred. Exit code alone never determines the error.

## Provider adapter contract and capability matrix

### Adapter contract

An adapter supplies:

1. Identity: provider, adapter version, supported CLI semver/profile range, model/failure-domain metadata.
2. Discovery: executable candidates, resolved real path, version command and parser.
3. Doctor probe: sanitized authentication mode, subscription/API precedence, machine-mode smoke test, and observed capabilities.
4. Invocation preparation: executable, argument array, cwd, allowed environment names, stdin strategy, output limits, expected stream mode, final schema mode, and reproducibility inventory. It never returns a shell string.
5. Incremental decoding: raw line/frame to canonical events, session IDs, usage, tool lineage, provider retries, and final candidates. Unknown fields remain in extensions.
6. Terminal classification: combine exit status/signal, terminal provider event, parser completeness, cancellation state, usage, and side-effect ledger.
7. Resume construction: provider session/thread ID plus pinned cwd/profile, or an explicit unsupported result.
8. Graceful cancellation: an advertised protocol action when documented; otherwise a declaration that the supervisor must use the OS ladder.

Capabilities are evidence-bearing records, not booleans inferred only from a version string. Every capability records support level (`native`, `emulated`, `unsupported`, `unknown`), constraints, probe source, CLI version, and observation time.

### Current capability matrix

| Capability | Codex | Claude Code | Gemini CLI | Grok Build |
| --- | --- | --- | --- | --- |
| Machine launch | `codex exec` | `claude --bare -p` | `gemini -p` / non-TTY | `grok --no-auto-update -p` |
| Streaming | `--json` JSONL | `--output-format stream-json --verbose`; partial tokens optional | `--output-format stream-json` JSONL | `--output-format streaming-json` JSONL; ACP is optional JSON-RPC |
| Provider-enforced final schema | `--output-schema` | `--json-schema` is documented with final `json` mode; do not assume it composes with streaming | Unsupported in selected headless docs; Council validates | Unsupported in selected headless docs; Council validates |
| Resume | `codex exec resume <id>` | `--resume <id>` / `--continue` | `--resume <id|index|latest>` | `--session-id`, `--resume`, `--continue` |
| Cancellation | No documented protocol cancel; OS supervisor | SIGTERM aborts turn, terminates Bash tree, runs end hooks, exits 143 | No documented protocol cancel; OS supervisor | No cancel documented on selected headless/ACP page; OS supervisor unless later negotiated |
| Usage | `turn.completed` token fields | usage metadata | aggregate and per-model token statistics | Adapter profile must probe; selected page does not define a stable usage schema |
| Cost quality | estimated from price table | provider-reported `total_cost_usd` and per-model breakdown | estimated | estimated unless a pinned profile proves reported cost |
| Tool events | item events include commands, file changes, MCP, web, plan | yes | `tool_use`, `tool_result` | incremental events/ACP updates; pin fixtures |
| Subagent lineage | Not documented in selected page | `parent_tool_use_id`, including nested forwarding in current versions | Not documented in selected page | Not documented in selected page |
| Auth status | `codex login status`, distinguish ChatGPT-managed auth | `claude auth status` JSON, exit 0/1 | no documented status command; cached-auth inspection plus bounded read-only live probe | Run Foreman's bounded, tool-free inference canary; accept only its exact token, classify recognized sign-out output as unauthenticated, and classify all other failures as unknown |
| Reproducibility | explicit sandbox; optionally ignore ambient config/rules; record required MCP inventory | `--bare` and explicit settings/MCP/agents/plugins | explicit extension/policy/settings inventory | `--no-auto-update`, explicit config/plugin/MCP inventory |

Primary references: [Codex non-interactive mode](https://developers.openai.com/codex/noninteractive), [Claude programmatic mode](https://code.claude.com/docs/en/headless), [Claude CLI/auth status](https://code.claude.com/docs/en/cli-usage), [Gemini headless mode](https://geminicli.com/docs/cli/headless/), [Gemini CLI reference](https://geminicli.com/docs/cli/cli-reference/), [Gemini session management](https://geminicli.com/docs/cli/session-management/), [Gemini authentication](https://geminicli.com/docs/get-started/authentication/), [Grok headless and ACP](https://docs.x.ai/build/cli/headless-scripting), and [Grok CLI reference](https://docs.x.ai/build/cli/reference).

## Process and process-tree ownership

The attempt supervisor is required for durable mode. It writes an atomic status record and raw stdout/stderr spool, exposes a run-scoped authenticated local control endpoint, and owns a lease. Council can reconnect and drain from the last committed byte offset after a crash. If the lease expires, the supervisor initiates cancellation and tree termination. Provider events are idempotently deduplicated by `(attempt_id, spool, offset/frame hash)`.

- Linux/macOS: create a new session/process group, record PID plus process-start identity to avoid PID reuse, and signal the group. Node documents that `detached` creates a new process group/session on non-Windows, but Council must retain pipes and must not `unref` an unmanaged child. See [Node child processes](https://nodejs.org/api/child_process.html) and [POSIX `setpgid`](https://pubs.opengroup.org/onlinepubs/009604599/functions/setpgid.html).
- Native Windows: a native helper creates a Job Object, assigns the provider before it can escape, enables kill-on-close, and uses `TerminateJobObject` for the hard stop. Standard Node `child_process` is not accepted as a complete Windows tree owner. See [Microsoft Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects) and [`TerminateJobObject`](https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-terminatejobobject).
- Council inside WSL launching Linux tools: use the POSIX path.
- Windows Council launching a WSL tool: the Windows job owns `wsl.exe` while an in-distribution supervisor owns the Linux process group. Cancel the Linux group first, then the Windows job. A Windows job alone is not evidence that the Linux VM process tree stopped.
- WSL launching a Windows executable: require the `.exe` path, translate with `wslpath`, and use the Windows helper for the Windows tree. Probe WSL and registered distributions; never assume availability. Keep file-intensive work on the tool's native filesystem. See [Microsoft WSL interop](https://learn.microsoft.com/en-us/windows/dev-environment/wsl-interop).

Cancellation order is durable `cancel.requested`; stop new scheduling; provider/protocol cancel if supported; close request input and send graceful termination; wait a configured grace bounded by the run deadline; hard-kill the entire tree; drain/spool remaining output; append exit/classification; release reservations; append the absorbing terminal state. Late output is retained as late provenance and cannot resurrect the run.

## Failure recovery, retries, idempotency, and budgets

On startup/resume, Council acquires the run lease, verifies all hashes and version pins, loads the newest valid checkpoint, replays later events, and reconciles each nonterminal attempt with its supervisor endpoint/status. A live supervisor is reattached and drained. An expired/dead supervisor with a confirmed dead tree becomes interrupted and may retry only if classification and the side-effect ledger permit it. A live tree without valid ownership is quarantined, cancelled by a verified PID/start identity, and reported as an orphan. If the process ended after a mutating tool began but before commitment was observed, the step becomes `outcome_unknown` and cannot be replayed automatically.

Retries create a new attempt under the same logical step. Only transient launch, transport, rate-limit, overload, and explicit retryable provider failures qualify. One orchestrator policy owns outer retries; provider-internal retry events are observed and charged to budget. Backoff is capped exponential full jitter with attempt and overall deadlines. Side-effecting steps use a caller-generated idempotency key derived from run plus logical operation, an exact normalized request hash, and an atomic stored outcome. The same key with different parameters is rejected.

Every run has hard limits for wall time, input/output tokens, billed/reported/estimated cost, tool calls, turns, branches, retries, artifact bytes, stdout/stderr bytes, event count, and maximum line size. The ledger reserves before fork, reconciles from observed usage, refuses oversubscription, stops new work at a soft threshold, and cancels at the hard threshold. Missing usage is not zero: it consumes a conservative reservation and marks accuracy `unknown` until reconciled.

## Auth doctor and quorum

The doctor emits sanitized events and never persists credentials. It checks executable real path and version; adapter/profile compatibility; subscription versus API-key precedence; provider login/status or a bounded read-only live probe; machine JSON mode; required schema/resume/tool capabilities; required MCP/plugin inventory; filesystem/WSL/process-supervisor readiness; and model/failure-domain metadata.

When the run requests subscription auth, the child environment allowlist removes API-key variables that would override cached subscription login, unless the task contract explicitly selects API billing. Presence may be reported as `override_present` but values are never read into logs. Claude's documented precedence makes this especially important; Codex status must distinguish ChatGPT login from API key; Gemini cached Google sign-in is verified by a live read-only probe because no official status command is documented; Grok uses a bounded authenticated model-list probe.

Admission requires every mandatory role to have a healthy provider. Optional advisers may be removed only before the plan checkpoint and only if the remaining set still meets the declared minimum. The default operational/epistemic quorum is three successful independent proposals from at least two model families. Same-family replicas count as one failure domain for automatic closure. A high-confidence minority with unique evidence blocks automatic synthesis closure and triggers external verification, a fresh orthogonal provider, or human review. Loss of quorum after launch is an explicit `quorum_unmet` outcome, not a silent downgrade.

## Evidence-tool and MCP/native plugin boundaries

### Scrapling 0.4.12

Scrapling runs as a pinned, isolated Python worker behind `ToolGateway`, preferably local stdio. The gateway supplies validated URLs and selector/crawl policy; the model never passes arbitrary network arguments directly. Apply host allowlists, redirect/DNS revalidation, robots and rate policy, response-size/time/page limits, and evidence quarantine. Version 0.4.12 adds AutoThrottle, authenticated/hostname-restricted HTTP MCP, versioned images, and existing JSON/JSONL export support; remote HTTP MCP is allowed only when explicitly configured with an opaque secret reference. See [Scrapling 0.4.12 release](https://github.com/D4Vinci/Scrapling/releases/tag/v0.4.12) and [Scrapling repository](https://github.com/D4Vinci/Scrapling).

### PixelRAG 0.4.0

PixelRAG is a supervised artifact pipeline, not an always-on provider plugin. `pixelshot`/index stages receive immutable source artifacts and write to an attempt-specific directory. Council verifies exit status, manifest/source hash, tile count, dimensions, nonblank pixel sampling, and atomic completion before accepting output; a successful exit alone is insufficient. Each tile/OCR/VLM derivative remains untrusted evidence with parent lineage. Version 0.4.0 includes atomic manifests with `article_id`, safer incremental reruns, isolated Chrome profiles, path-traversal hardening, local image/Markdown support, and bounded network-idle behavior. See [PixelRAG 0.4.0 release](https://github.com/StarTrail-org/PixelRAG/releases/tag/v0.4.0).

### Graphify

If `graphify-out/graph.json` exists, Council queries it before broad corpus reads and preserves node/edge confidence and source location in evidence records. Build/update is a separate, explicitly budgeted mutation stage; provider workers receive only read-only `query_graph`, node, neighbor, community, stats, and path capabilities. `save-result`, reflect/update/watch, exports, and graph writes require a separate capability. Pin the Graphify package plus installed skill/instruction hash because package/skill drift changes agent behavior. The local MCP server may use stdio or loopback HTTP, but Council proxies it through Tool Gateway for run IDs, budgets, and audit. See [Graphify repository](https://github.com/Graphify-Labs/graphify) and [Graphify MCP](https://graphify.com/mcp).

### Boundary rule

The shared Council MCP server is the host control API: doctor, propose/start, status/events, approve/reject, cancel, resume, and artifact/result reads. Native wrappers contain only host manifest, concise skills/commands, relative paths, and MCP registration. Provider child CLIs do not receive this control server. They receive a per-run research-tool MCP surface containing only capabilities granted by the immutable task contract. A `COUNCIL_RUN_ID`/capability token is metadata, not authority by itself, and recursion depth greater than zero disables Council-start tools.

MCP task states may map to Council states at the API edge, but internal durability does not depend on MCP task support. Stdio stdout is protocol-only and diagnostics go to stderr. Plugin installation never implies tool approval. Codex's current plugin architecture supports skills and MCP packaging, while each other host retains its native manifest and lifecycle; wrappers must be tested separately. See [OpenAI plugin packaging](https://developers.openai.com/plugins/build/plugins), [Claude plugins](https://code.claude.com/docs/en/plugins-reference), [Gemini extensions](https://geminicli.com/docs/extensions/reference/), and [Grok plugins](https://docs.x.ai/build/features/skills-plugins-marketplaces).

## OpenSpec delta-spec draft: normative requirements and scenarios

OpenSpec 1.7.0 is the verified tool version for this design. Artifacts follow `proposal -> specs -> design -> tasks`; this memo stops before tasks. See [OpenSpec concepts](https://openspec.dev/docs/overview) and [OpenSpec 1.7.0 release](https://github.com/Fission-AI/OpenSpec/releases/tag/v1.7.0).

### Capability: `durable-run-lifecycle`

#### Requirement: Append before observation

The runtime SHALL commit every canonical event before it publishes the event, acknowledges provider progress, releases ingest capacity, or derives an externally visible state.

##### Scenario: Crash after provider frame

- **WHEN** a provider frame is decoded and the runtime crashes before the append transaction commits
- **THEN** the frame MUST be replayed from the supervisor spool after resume
- **AND** no subscriber MUST have observed an uncommitted event.

#### Requirement: Absorbing terminal state

The runtime SHALL append exactly one terminal run event, and completed, failed, and cancelled states MUST be absorbing.

##### Scenario: Late output after cancellation

- **WHEN** provider output arrives after `run.cancelled`
- **THEN** it SHALL be stored with `late=true`
- **AND** it MUST NOT change the run or branch terminal state.

#### Requirement: Checkpointed resume

The runtime SHALL checkpoint the plan before fan-out, branch results before synthesis, approvals before notification, and side-effect commitments before acknowledgment.

##### Scenario: Resume after synthesis crash

- **WHEN** all branch result checkpoints exist but synthesis did not commit a terminal result
- **THEN** resume SHALL reuse immutable branch artifacts
- **AND** MUST NOT rerun completed advisers.

### Capability: `effect-orchestration`

#### Requirement: Structured ownership

Every run, branch, attempt, subprocess, stream, and tool worker MUST belong to a nested Effect scope with a mandatory finalizer.

##### Scenario: Parent interruption

- **WHEN** the run fiber is interrupted
- **THEN** all descendant scopes SHALL receive cancellation
- **AND** the runtime SHALL await bounded cleanup before the run terminates.

#### Requirement: Bounded dependency-aware fan-out

The scheduler SHALL run only dependency-ready branches and SHALL enforce declared total, per-provider, and per-tool concurrency limits. The default adviser maximum MUST be three.

##### Scenario: Shared mutable workspace

- **WHEN** two ready branches target the same mutable workspace without isolation
- **THEN** the scheduler SHALL serialize them or reject the plan
- **AND** MUST NOT launch them concurrently.

### Capability: `provider-cli-adapters`

#### Requirement: Provider-neutral translation

Adapters MUST produce shell-free invocation specifications and canonical events, and MUST NOT spawn, persist, retry, approve, or schedule work.

##### Scenario: Unknown provider event field

- **WHEN** a valid provider event includes an unrecognized field
- **THEN** the adapter SHALL retain it under the provider extension namespace
- **AND** SHALL continue processing unless a required invariant is invalid.

#### Requirement: Compound terminal classification

An attempt result MUST be classified from exit status, signal, terminal provider event, parser completeness, cancellation state, and side-effect state; exit code alone SHALL NOT determine success.

##### Scenario: Exit zero with truncated JSON

- **WHEN** the process exits zero without a complete terminal record
- **THEN** the attempt SHALL fail with a protocol classification
- **AND** the raw spool SHALL be retained for diagnosis.

### Capability: `process-tree-supervision`

#### Requirement: Whole-tree ownership

Every durable provider attempt MUST be started by a reconnectable supervisor that owns the whole process tree through a POSIX process group/session, Windows Job Object, or both sides of a Windows-to-WSL launch.

##### Scenario: Orchestrator crash

- **WHEN** the Council process exits while a provider is running
- **THEN** the supervisor SHALL retain bounded output and accept reconnection for the lease duration
- **AND** SHALL terminate the tree when the lease expires.

#### Requirement: Escalating cancellation

Cancellation SHALL persist intent, stop admission, attempt negotiated/graceful termination, wait a bounded grace, and then terminate the full tree.

##### Scenario: Provider ignores graceful signal

- **WHEN** the provider remains live after the grace period
- **THEN** the supervisor MUST hard-terminate the process group or Job Object
- **AND** the orphan-process metric MUST remain zero after reconciliation.

### Capability: `budget-retry-idempotency`

#### Requirement: Reserve before fork

The scheduler MUST atomically reserve shared budget before launching a branch and MUST reconcile the reservation from usage events.

##### Scenario: Concurrent final reservation

- **WHEN** two branches request the last available token or cost reservation concurrently
- **THEN** at most one SHALL be admitted
- **AND** total reservations MUST NOT exceed the hard limit.

#### Requirement: Safe retry ownership

Only the orchestrator SHALL own outer retries, and it SHALL retry only classified transient failures within attempt and run deadlines.

##### Scenario: Provider already retries internally

- **WHEN** an adapter observes provider retry events while the CLI remains running
- **THEN** the runtime SHALL charge and report those retries
- **AND** MUST NOT start an outer attempt concurrently.

#### Requirement: Ambiguous mutation safety

A mutating operation with an unconfirmed outcome MUST become `outcome_unknown` and MUST NOT be replayed automatically.

##### Scenario: Process dies after send

- **WHEN** a provider process dies after a write tool request was sent but before a committed result was observed
- **THEN** resume SHALL require reconciliation or human action
- **AND** MUST NOT reuse the idempotency key with different arguments.

### Capability: `auth-and-quorum-doctor`

#### Requirement: Sanitized subscription doctor

The doctor SHALL verify executable/version, auth mode, environment precedence, machine mode, and required capabilities without logging secret values.

##### Scenario: API key shadows subscription

- **WHEN** a subscription run detects an environment credential that would take precedence
- **THEN** the doctor SHALL warn and remove it from the child allowlist
- **AND** SHALL fail admission if the requested subscription identity cannot be verified.

#### Requirement: Independent failure-domain quorum

Automatic Council closure MUST require the declared count of successful proposals across at least the declared number of model families; the default is three proposals across two families.

##### Scenario: Same-family majority and unique dissent

- **WHEN** two same-family agents agree and a different-family agent provides unique material evidence in dissent
- **THEN** raw process count MUST NOT close the decision
- **AND** the run SHALL seek verification, an orthogonal provider, or human review.

### Capability: `evidence-tool-gateway`

#### Requirement: Tool isolation and provenance

Scrapling, PixelRAG, and Graphify SHALL run under Tool Gateway with explicit capabilities, budgets, process ownership, authority labels, and artifact lineage.

##### Scenario: Evidence contains instructions

- **WHEN** fetched text, OCR, pixels, graph content, or tool output contains instruction-like material
- **THEN** it SHALL remain `untrusted_evidence`
- **AND** MUST NOT alter plan, permissions, destination, or budget.

#### Requirement: Visual capture validation

A successful PixelRAG process exit MUST NOT be treated as a successful capture without validating its manifest and rendered pixels.

##### Scenario: Blank browser viewer

- **WHEN** PixelRAG exits zero but tiles are blank or do not match the source hash
- **THEN** the stage SHALL fail evidence validation
- **AND** downstream claims MUST NOT cite those tiles.

### Capability: `host-integration-boundaries`

#### Requirement: Shared core and thin wrappers

All hosts SHALL use the same Council runtime and schemas through native wrappers; wrappers MUST NOT contain adapter, retry, event-store, or policy logic.

##### Scenario: Host plugin update

- **WHEN** one host wrapper changes without a compatible core/schema version
- **THEN** doctor SHALL report an incompatibility
- **AND** the run MUST NOT silently use mixed semantics.

#### Requirement: No recursive control authority

Provider workers MUST NOT receive Council start/resume/approve control tools.

##### Scenario: Worker calls Council MCP

- **WHEN** a worker attempts to invoke a Council control tool
- **THEN** the capability broker SHALL deny it
- **AND** SHALL append a security-policy event without widening the run.

## Testing and evaluation gates

1. Pure model tests: property-test event decoding, state projection, absorbing terminals, checkpoint/full-replay equivalence, sequence uniqueness, and budget conservation.
2. Crash matrix: inject process death before/after append, checkpoint, approval notification, branch terminal, artifact rename, side-effect send/commit, and final terminal append.
3. Stream fuzzing: split UTF-8 and JSON across arbitrary chunks; malformed, oversized, duplicate, unknown, late, and truncated frames; blocked consumers; stderr floods.
4. Adapter conformance: golden JSONL fixtures captured from each pinned CLI version, plus live canaries for auth, schema, resume, internal retries, cost/usage, and exit classification. Unknown versions start degraded until certified.
5. OS integration: Windows Job Object, Linux/macOS groups, WSL in both launch directions, PID reuse, nested children, background tools, forced parent crash, cancel during generation/tool/subagent/approval/backpressure, and zero orphans.
6. Recovery/idempotency: reconnect spools at every byte offset, duplicate append attempts, lease contention, corrupted newest checkpoint fallback, request-hash mismatch, and `outcome_unknown` reconciliation.
7. Budget tests: concurrent reservations, missing/delayed usage, soft/hard thresholds, provider retries, repair attempts, artifact/output ceilings, and wall-clock deadline races.
8. Tool gates: Scrapling redirect/DNS/size/rate tests; PixelRAG blank/mismatched/path-traversal and atomic-manifest tests; Graphify stale/mismatched skill, confidence/source preservation, and read-only capability tests.
9. Security/eval suite: prompt injection in HTML/PDF/image/OCR/tool/graph content, secret canaries, cross-worker propagation, unauthorized MCP recursion, and fail-closed commitment boundaries.
10. Council quality gates: equal-budget comparison against best single model, independent vote, weighted vote, pairwise rank-then-fuse, one round, and two rounds. Require credible correctness/evidence gain without worse calibration, order bias, provider affinity, latency/cost bounds, or minority wrong-overturn rate.

Release requires schema validity, deterministic replay, zero unauthorized side effects, zero orphan processes across the OS matrix, no budget overshoot beyond an explicitly measured telemetry-lag allowance, and successful cancellation/recovery for every pinned adapter profile.

## Risks and mitigations

- CLI formats and flags evolve quickly. Mitigate with pinned executable paths/versions, capability evidence, golden fixtures, live canaries, and fail-closed unknown profiles.
- Provider session resume is not durable execution. Mitigate by making Council events/artifacts authoritative and treating provider session IDs as optional continuation aids.
- Windows/WSL tree ownership is the highest platform risk. Mitigate with a native Job Object helper, in-distro supervisor, dual-layer cancellation, and mandatory OS CI.
- SQLite/WAL on cross-filesystem or synced folders can be unreliable or slow. Keep the run store on a local native filesystem; export immutable bundles separately.
- A reconnecting supervisor adds complexity and local attack surface. Use run-scoped authenticated endpoints, filesystem ACLs, short leases, signed/versioned helpers, and no network bind by default.
- Cost telemetry is incomplete. Reserve conservatively, label cost quality, and never represent estimates as billed amounts.
- Schema repair can hide provider failures. Permit at most one bounded repair and retain the invalid raw candidate.
- Graph/tool results can be stale, inferred, blank, or poisoned. Preserve confidence and lineage, validate artifacts, and keep all evidence non-authoritative.
- Subscription authentication can be shadowed by environment keys. Use a minimal environment allowlist and doctor the effective identity before admission.
- Parallelism can multiply tokens without value. Default to at most three advisers, require distinct objectives, compare against round-zero and single-model baselines, and stop adaptively.

## Rejected alternatives

- `Promise.all` plus raw `child_process`: rejected because it gives neither bounded structured ownership nor durable reconnect, tree cleanup, or typed retry semantics.
- Provider-native event format as Council API: rejected because event names, schema support, usage, exits, and resumes differ and evolve independently.
- Direct spawn in durable mode: rejected because an orchestrator crash loses pipes and can orphan trees. It may exist only as an explicitly non-resumable diagnostic mode.
- Windows `taskkill`/PID-only cleanup: rejected because PID reuse and incomplete descendant ownership are unsafe; use Job Objects and process-start identity.
- Windows Job Object alone for WSL: rejected because it does not prove the Linux process group inside WSL stopped.
- Provider session history as checkpoint: rejected because it is provider-scoped, mutable/retained differently, and omits Council budgets, approvals, provenance, and side-effect state.
- Event snapshots as source of truth: rejected because snapshot corruption/version drift would make replay unverifiable. Snapshots remain disposable accelerators.
- Effect experimental workflow/event-log packages as v1 durability: rejected because v1 needs a stable pinned substrate and portable explicit data contract.
- Temporal/Restate as a mandatory runtime: rejected for v1 local subscription workflows because it adds deployment and operational dependencies. `EventStore` remains replaceable if hosted execution later requires them.
- Unbounded debate or always asking all providers: rejected because independent voting explains many gains, long debate can regress, and token use grows sharply.
- Direct provider access to Scrapling/PixelRAG/Graphify or Council control MCP: rejected because it bypasses common budgets, provenance, network policy, audit, and recursion prevention.
- One universal plugin manifest: rejected because Codex, Claude, Gemini, and Grok have distinct native packaging and lifecycle semantics. Share schemas/core, generate/test thin wrappers.
- Full raw prompts and secrets in the event log: rejected. Store redacted metadata, hashes, opaque secret references, and separately protected evidence under explicit retention.

## Primary-source index

- Effect: [site](https://www.effect.website/), [v3 concurrency](https://www.effect.website/docs/v3/concurrency/basic-concurrency), [API](https://effect-ts.github.io/effect/effect/Effect.ts.html), [platform](https://effect-ts.github.io/effect/docs/platform)
- OpenSpec: [concept flow](https://openspec.dev/docs/overview), [v1.7.0 release](https://github.com/Fission-AI/OpenSpec/releases/tag/v1.7.0)
- Provider CLIs: [Codex](https://developers.openai.com/codex/noninteractive), [Claude](https://code.claude.com/docs/en/headless), [Gemini](https://geminicli.com/docs/cli/headless/), [Grok](https://docs.x.ai/build/cli/headless-scripting)
- OS ownership: [Windows Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects), [WSL interop](https://learn.microsoft.com/en-us/windows/dev-environment/wsl-interop), [Node child processes](https://nodejs.org/api/child_process.html), [POSIX process groups](https://pubs.opengroup.org/onlinepubs/009604599/functions/setpgid.html)
- Research tools: [Scrapling 0.4.12](https://github.com/D4Vinci/Scrapling/releases/tag/v0.4.12), [PixelRAG 0.4.0](https://github.com/StarTrail-org/PixelRAG/releases/tag/v0.4.0), [Graphify](https://github.com/Graphify-Labs/graphify), [Graphify MCP](https://graphify.com/mcp)
