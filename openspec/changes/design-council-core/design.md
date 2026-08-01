## Context

Council is a greenfield, local-first plugin and MCP service that coordinates Claude Code, Codex, Gemini CLI, and Grok Build through their installed subscription sessions. Each CLI has different invocation flags, event formats, authentication precedence, schema support, resume behavior, cancellation behavior, usage telemetry, and native plugin packaging. Council must not make one provider's behavior its internal contract.

The research corpus also establishes four constraints:

- Independent model-family diversity is useful, but debate can amplify bias and cost. Round-zero voting is the baseline, critique is selective, and decisive judging needs identity and order controls.
- Web, file, multimodal, graph, tool, and model content is untrusted data. Model instructions and classifiers are not an authorization boundary.
- Durable orchestration needs append-before-publish events, checkpoints, bounded concurrency, cancellation, retry ownership, and explicit ambiguous outcomes.
- Provenance describes lineage, not truth or authority. Claims need exact support and candidate lineage.

The repository starts with OpenSpec planning artifacts only. Implementation tasks will be created after this design is reviewed.

## Goals / Non-Goals

**Goals:**

- Build the core in strongly typed TypeScript with immutable functional domain values.
- Keep domain decisions deterministic, replayable, and independent of Effect runtime execution.
- Use stable Effect 3 for typed application effects, service requirements, Layers, streams, scopes, structured concurrency, retries, scheduling, and telemetry.
- Provide one durable, provider-neutral run model and one public API across four native host wrappers.
- Use installed subscription authentication by default and diagnose readiness before run admission.
- Enforce least authority around workers, research tools, network egress, credentials, approvals, and side effects.
- Preserve raw evidence, provider observations, claims, dissent, and audit history without making them authoritative.
- Support safe checkpointed recovery on Windows, WSL, Linux, and macOS.
- Make adapter, domain, security, replay, and deliberation behavior testable without live provider calls.

**Non-Goals:**

- Hosted multi-tenant orchestration, distributed consensus, or a mandatory external workflow service in v1.
- Reattaching to a provider process that survived a Council runtime crash.
- Exactly-once external side effects; ambiguous outcomes remain explicit and require reconciliation.
- Unbounded debate, automatic use of every installed provider, or raw-agent-count quorum.
- Treating provenance, signatures, source reputation, or model confidence as proof of truth or authority.
- Allowing provider workers to invoke Council control operations recursively.
- Depending on Effect 4 beta, Effect Cluster, or experimental workflow packages for v1 correctness.
- Implementing host-specific copies of core policy.

## Decisions

### 1. Use a functional core with an Effect shell

The domain core will consist of immutable values and total functions:

```ts
type Decision<E, R> =
  | { readonly _tag: "Accepted"; readonly events: readonly [E, ...E[]] }
  | { readonly _tag: "Rejected"; readonly error: R }

declare const decide: (
  state: RunState,
  command: DomainCommand
) => Decision<DomainEvent, DomainRejection>

declare const evolve: (
  state: RunState,
  event: DomainEvent
) => RunState

declare const replay: (
  events: ReadonlyArray<DomainEvent>
) => RunState
```

`decide`, `evolve`, and `replay` perform no I/O, read no clock, generate no identifier, allocate no authoritative mutable state, and return no `Effect`. Time, randomness, identifiers, policy results, and artifact references enter as validated command data.

The application shell uses `Effect.Effect<Success, Error, Requirements>`, `Context.Tag` service algebras, `Layer` interpreters, `Stream` for event feeds, and `Scope` for resource ownership. Only executable entry points call `Effect.run*`.

**Alternatives considered:**

- A fully Effect-native reducer was rejected because replay and policy decisions would become runtime-coupled.
- A Promise-based shell was rejected because it would recreate typed failure, resource, concurrency, retry, and dependency-management behavior.
- Mutable object aggregates were rejected because they weaken replay determinism and property testing.

### 2. Use Effect Schema as the serialized contract boundary

`@council/schema` owns all encoded contracts and may import Effect Schema, branding, and JSON Schema generation. It must not import Effect runtime services, Layers, Streams, Scopes, Node APIs, or platform packages.

Every external and persisted value decodes exactly once through a versioned schema. Core objects reject unknown properties except inside a versioned extension namespace. Distinct schema brands cover run, branch, step, attempt, command, event, provider session, approval, capability, artifact, claim, candidate, ballot, and policy identifiers.

Recoverable errors use narrow `Schema.TaggedError` classes or equivalent closed tagged values. Public errors expose only safe encoded fields. Raw provider data, secrets, stack traces, and unrestricted causes are stored only through protected diagnostic references.

The stable dependency range is Effect `>=3.22.1 <4`. A major-version migration is a separate OpenSpec change.

### 3. Enforce a directed workspace architecture

The pnpm workspace has these boundaries:

```text
packages/schema
      ↓
packages/domain
      ↓
packages/application
      ↓
packages/platform-node
      ↓
packages/adapter-{claude,codex,gemini,grok}
      ↓
packages/runtime-node
      ↓
packages/mcp-server

plugins/{claude,codex,gemini,grok}
packages/testing
packages/adapter-conformance
```

- `schema`: serialized contracts and migrations.
- `domain`: pure state, commands, events, policies, ranking, budgets, and invariants.
- `application`: Effect ports, command handlers, reactions, and public Council service.
- `platform-node`: SQLite, artifacts, hashing, process ownership, egress, credentials, redaction, and telemetry Layers.
- `adapter-*`: provider discovery, invocation translation, frame decoding, terminal classification, resume construction, and cancellation declaration.
- `runtime-node`: the production Layer composition root and no domain policy.
- `mcp-server`: MCP transport and mapping to public Council commands.
- `plugins/*`: native manifests, concise skills or commands, portable paths, and MCP registration only.
- `testing`: deterministic test Layers, fixtures, generators, clocks, randomness, and stores.
- `adapter-conformance`: reusable golden and live-canary adapter tests.

Workspace dependency tests prohibit cycles and forbid domain imports from application, runtime, provider, platform, Node, or plugin packages. Provider DTOs cannot appear in public exports.

### 4. Separate authoritative events from evidentiary observations

Each run has one low-volume authoritative domain stream. Domain events are past-tense facts that change aggregate state. The high-volume observation log separately stores normalized provider frames, process output references, usage, tool activity, bounded diagnostics, and raw hashes.

Provider observations and evidence cannot enter `evolve` directly. The application may create a domain command that references validated observation or artifact identifiers only after schema, policy, authority, and capability checks.

The authoritative envelope includes schema and projection versions, event ID, run lineage, strictly increasing run sequence, record time, correlation and causation, actor, authority, redaction summary, prior hash, event hash, and payload. Provider-native sequence and time remain optional observation fields and never replace Council sequence.

Council appends before it publishes, acknowledges, or releases ingest capacity. State-changing reactions use a transactional outbox. Subscribers and projections see only committed events.

### 5. Use SQLite and content-addressed artifacts locally

The default store is SQLite in WAL mode on the runtime's native local filesystem. One run lease prevents two orchestrators from advancing the same run. Appends compare an expected stream version atomically. A non-empty event batch and related outbox or idempotency changes commit in one transaction.

Snapshots are disposable caches containing stream version, last event hash, schema version, and reducer version. Invalid snapshots are discarded and rebuilt by replay. Read models are idempotent projections keyed by event ID and expose projection lag when relevant.

Large bytes live in immutable content-addressed artifact storage. Metadata records hash, media type, size, producer, authority, redaction, validation, parents, and transformation activity. Atomic temporary-write and rename behavior prevents partial publication.

Storage on `/mnt/c` or another WSL boundary is not used for hot SQLite or artifact-write paths when the runtime executes inside WSL. Export bundles may be copied across filesystems after commitment.

### 6. Model lifecycle and failures as closed unions

Run, branch, attempt, approval, side-effect, budget, provenance, claim-support, and deliberation state use discriminated unions. Terminal run states are absorbing. Optional-field bags such as `{status, result?, error?}` are prohibited for lifecycle models.

Expected errors remain typed by boundary: invalid input, schema incompatibility, missing executable, unsupported version, missing capability, authentication, policy denial, launch, transport, protocol, provider, timeout, cancellation, budget, final schema, event store, artifact store, incompatible resume, process ownership, unknown side-effect outcome, evidence validation, and internal defect.

Retryability and safety to retry are independent fields. Exit code alone cannot establish success or retryability. Defects, interruption, cancellation, expected failures, and typed abstention remain separate.

### 7. Use structured concurrency and bounded streams

One root Effect scope owns a run fiber. Nested scopes own stages, branches, attempts, subprocess guards, streams, budget reservations, and telemetry spans. Children cannot outlive their parent. Finalizers close resources in reverse acquisition order on success, failure, or interruption.

The scheduler runs only dependency-ready work, rejects duplicate objectives, serializes shared mutable workspaces unless isolated, and enforces total, per-provider, and per-tool concurrency. The default is at most three advisers in addition to the lead role.

Provider stdout and stderr use separate bounded streams. Stdout is incrementally framed and decoded; stderr is bounded diagnostic data. Maximum bytes, line length, event count, and queue size are contract limits. The runtime durably records an observation before releasing upstream capacity.

Outer retry uses capped exponential full jitter, injected time and randomness, attempt limits, and an overall deadline. Provider-internal retries are observed and charged rather than multiplied.

### 8. Use fail-safe process-tree guards in v1

Every attempt launches through a platform guard that owns the complete tree and spools bounded stdout and stderr. It uses POSIX process groups or sessions on Linux and macOS, a Windows Job Object helper on native Windows, and dual Windows plus in-distribution ownership for Windows-to-WSL launches. Process identity includes start identity, not PID alone.

The guard has a parent-death watchdog and terminates the tree if Council disappears. It does not offer a live reattachment protocol in v1. On restart, Council resumes from committed checkpoints and may create a new attempt only when the prior attempt is confirmed dead and retry policy plus side-effect state permit it.

Cancellation persists intent, stops admission, invokes a documented provider cancellation mechanism when available, requests graceful termination, waits a bounded grace, hard-terminates the tree, drains spooled output, classifies the attempt, and then finalizes the run. Late output becomes late evidence and cannot resurrect a terminal state.

**Alternative considered:** a reconnectable attempt supervisor was deferred because it adds a local control protocol, authentication, lease, spool-offset recovery, and attack surface while the provider CLIs do not expose uniform live-attachment semantics.

### 9. Keep provider adapters narrow and evidence-bearing

An adapter provides identity and supported profiles, executable discovery, a sanitized doctor probe, a shell-free invocation specification, incremental frame decoding, compound terminal classification, optional resume construction, and graceful-cancel capability declaration.

Adapters do not spawn processes, persist data, schedule work, retry, approve calls, spend budget, or create authoritative domain events. Unknown optional provider fields survive in a provider extension namespace. Unknown or incompatible provider versions start degraded until conformance succeeds.

Capability records contain support level (`native`, `emulated`, `unsupported`, or `unknown`), constraints, probe evidence, CLI version, adapter version, and observation time. Planning tests the capabilities required by the task instead of branching on a version string alone.

Doctor verifies executable and version, effective subscription identity, environment credential precedence, machine mode, schema and resume behavior, usage fields, required plugin or MCP inventory, model failure-domain metadata, filesystem readiness, and process-guard readiness. It never persists credential values.

### 10. Compile user intent into a task contract

Before workers see evidence, Council builds a canonical task contract containing roles, allowed outcomes, tool operations, resources, destinations, data classes, budgets, approvals, rubric hash, policy version, expiry, evidence scope, and output schema. Only authenticated user instructions, approved policy, and an approved contract version carry authority.

Evidence may fill declared data slots. It cannot add tools, actions, recipients, destinations, privileges, credentials, or budget. A legitimate scope expansion creates an explicit amendment with parent hash, exact delta, reason, approval, and time.

Every privileged operation passes through a policy engine and capability broker. Capabilities bind run, branch, attempt, tool, operation, resource, destination, data class, limit, expiry, subject, and contract hash. Mutating capabilities are one-time. Each direct and transitive call is authorized independently.

Approval binds exact normalized arguments, destination, policy and contract versions, approver, and expiry. Editing invalidates the previous approval.

### 11. Isolate egress, credentials, and worker authority

Workers receive isolated workspaces, minimal environment allowlists, read-only evidence views, bounded resources, and no ambient credentials. They cannot access sibling scratch state, the audit-signing key, blind identity maps, direct network transports, or the Council control MCP.

Models provide structured destination and path data rather than arbitrary transport URLs. The egress broker validates scheme, port, hostname, every A and AAAA answer, mapped address forms, the pinned connection address, query parameter allowlist, and every redirect hop. Local sockets and special-use IP space are blocked. Automatic redirects are disabled.

The credential broker alone resolves opaque secret references at the final approved connector hop. Secret and restricted-data scans cover prompts, arguments, URLs, headers, output, errors, extracts, images, OCR, logs, artifacts, and final release. A negative scan does not grant authority.

### 12. Run research tools behind a Tool Gateway

Scrapling 0.4.12, PixelRAG 0.4.0, Graphify, and deterministic verifiers run as supervised workers with explicit capabilities, process ownership, budgets, immutable inputs, attempt-specific outputs, provenance, and quarantine.

- Scrapling receives gateway-validated destinations, selector or crawl policy, robots and rate rules, and page, redirect, time, and byte limits. Targeted extraction is mandatory for model-bound output.
- PixelRAG capture requires source binding, atomic manifest, tile count and dimensions, nonblank pixel sampling, and output-hash validation. Exit zero alone is insufficient.
- Existing Graphify graphs are queried before broad corpus reads. Query expansion is constrained to graph vocabulary and recorded. Read-only queries do not imply permission to build, update, watch, reflect, save, or export.

All raw and derived text, pixels, OCR, metadata, graph content, and tool output remains `untrusted_evidence` regardless of source reputation or signatures.

### 13. Preserve provenance and claim support separately

Artifacts are PROV-compatible entities, transformations are activities, and tools or workers are agents. Council records generation, use, derivation, attribution, association, and primary-source relationships where applicable.

Every transformation records tool and version, configuration and policy hashes, input and output artifacts, and deterministic seed when relevant. Typed status distinguishes valid, invalid, untrusted, unknown, inaccessible, and incomplete lineage.

Lineage validity, signer trust, source quality, factual support, and instruction authority are independent fields. A valid C2PA record does not establish truth or authority.

Every material claim maps to exact artifact spans, pages, timestamps, image regions, or graph source locations and states whether evidence supports, contradicts, contextualizes, or leaves it unresolved. A separate verifier checks resolution, hash, quoted fidelity, and semantic support. Synthesis also records candidate lineage for each claim, recommendation, objection, and dissent.

### 14. Use independent-propose, selective-deliberate, rank-then-synthesize

The same task contract, rubric, output schema, and approved evidence scope goes to each proposer. Initial proposals, assumptions, failure modes, evidence maps, and confidence are sealed before peer exposure.

Blinding removes direct identity only. It does not summarize, truncate, or stylistically normalize substance. Oversized or invalid candidates become inadmissible with typed reasons.

Deterministic schema, policy, citation, test, and reference checks precede aggregation. Council then commits round-zero vote, calibrated vote, disagreement, evidence conflicts, admissible count, independent-domain count, and stop eligibility.

Confidence has bounded weight only under a current model-task calibration record. Automatic closure requires three admissible proposals from at least two registered failure domains by default. Unknown lineage counts as one common domain.

Critique opens only for material disagreement, low calibrated confidence, unresolved evidence, minority guard, or high consequence. It is limited to two rounds. Each accepted critique adds a falsifiable objection, failed rubric item, or new admissible evidence. Ballots and tallies remain sealed until round closure.

Judges cannot score their own candidate. Decisive pairwise comparisons run A/B and B/A with identical rubric, evidence, and judge configuration. An order reversal is a tie or escalation. A minority with unresolved admissible contradictory evidence blocks automatic closure.

Only admissible top-ranked candidates reach synthesis. The synthesizer receives candidate artifacts, claim maps, rubric results, and dissent. It cannot manufacture consensus. Typed abstention and escalation outcomes identify the unmet condition and available next action.

### 15. Provide tamper-evident audit and honest replay

The audit ledger records every authorization, capability, approval, provider, tool, provenance, ballot, judge, aggregation, stop, recovery, and terminal decision through a secret-safe canonical envelope. Events are hash-chained and periodic checkpoints are protected by authority unavailable to workers.

Audit storage contains typed redacted metadata, hashes, opaque secret references, and protected artifact references rather than unrestricted prompts or credentials. Audit integrity is verified before final approval or replay. Failure stops finalization and privileged continuation.

Replay modes are explicit:

- `structural_replay` verifies schema, hashes, versions, and state evolution.
- `recorded_input_replay` replaces clock, randomness, DNS, transport, model, policy inputs, and tool results with recorded Layers and requires deterministic decisions.
- `live_replay` may refetch and rerun, records new artifacts and divergence, and never claims exact reproduction.

Security incidents quarantine affected artifacts, revoke capabilities, stop new privileged work, and preserve sanitized evidence.

### 16. Expose one MCP control plane and four native wrappers

The public Council service exposes doctor, start, status, events, approval resolution, cancel, resume, artifact reads, and result reads with provider-neutral schemas. MCP task vocabulary may map at the edge, but internal durability does not depend on host task support.

The MCP stdio server reserves stdout for protocol frames and stderr for bounded redacted diagnostics. Provider workers receive only a per-run research-tool facade and never the Council control server. Recursion depth greater than zero disables Council-start operations.

Each host wrapper follows its native manifest and lifecycle but contains no core policy. Paths resolve relative to the installed wrapper root. Installation never grants tools, hooks, network, credentials, writes, or side effects. Doctor detects wrapper/core/schema incompatibility and stale cached integrations.

Grok will receive a tested native wrapper and a separately tested Claude-compatibility lane; compatibility is not assumed to mean identical policy or lifecycle behavior.

### 17. Gate release on equal-budget evaluation

Evaluation compares the best single model, independent vote, calibrated vote, pairwise rank-and-fuse, one critique round, and two critique rounds under equal budgets. It reports correctness or human preference, evidence quality, schema validity, Brier score and calibration, discrimination, order reversal, provider affinity, minority recovery and wrong-overturn rates, latency, tokens, cost quality, and cancellation or recovery outcomes.

Security evaluation includes adaptive text, HTML, PDF, image, OCR, tool, graph, redirect, DNS, secret-canary, cross-worker, and recursive-control attacks while measuring benign utility. Deterministic authorization and egress property suites permit zero failures. Probabilistic evaluations publish sample count, seed, versions, hashes, confidence intervals, exclusions, and failed attacks.

Release requires strict schema validity, deterministic replay, zero unauthorized side effects, zero owned orphan processes across the supported OS matrix, bounded budget behavior, successful cancellation and checkpoint recovery for every pinned adapter profile, and a credible declared benefit over the round-zero baseline without regression across safety, calibration, and bias gates.

## Risks / Trade-offs

- **Effect learning curve and major-version movement** → Pin stable Effect 3, keep the domain runtime-free, publish architecture rules, and treat Effect 4 migration separately.
- **Large Layer graphs can hide ownership** → Keep service tags narrow, name live Layers by interpreter, compose once at entry points, and test requirements types.
- **Event and observation volume** → Keep the authoritative stream low-volume, store provider deltas separately, bound retention, and use content-addressed artifacts.
- **SQLite contention or unsuitable filesystems** → Use one writer and run lease, store on the runtime's native filesystem, test WAL behavior, and keep the EventStore port replaceable.
- **Council crash interrupts live provider work** → The process guard kills the tree; resume only safe work from checkpoints and expose ambiguous outcomes. Reattachment is a future change.
- **Windows and WSL ownership complexity** → Use a minimal signed/versioned native helper outside the TypeScript core, dual ownership for cross-boundary launches, and mandatory OS integration tests.
- **Provider CLIs and plugin contracts evolve** → Pin versions and profiles, retain golden fixtures, run live canaries, record capabilities, and fail closed on unknown required behavior.
- **Subscription auth can be shadowed** → Use a minimal environment allowlist and verify effective identity before admission.
- **Incomplete usage or cost telemetry** → Reserve conservatively and label cost as billed, reported, estimated, or unknown; never represent missing usage as zero.
- **Security controls can harm benign utility** → Evaluate adaptive attacks and benign tasks together; authority enforcement remains deterministic even when detectors are probabilistic.
- **Blinding can alter substance** → Enforce common schemas and limits before submission and remove direct identity only.
- **Diversity metadata can be uncertain** → Use a versioned failure-domain registry and count unknown entries as one domain.
- **Order reversal doubles decisive judging cost** → Require it only for decisive pairwise comparisons; robust round-zero closure avoids unnecessary judging.
- **Provenance can create false confidence** → Keep lineage, signer trust, quality, support, truth, and authority separate in schemas and presentation.
- **Live replay is inherently nondeterministic** → Guarantee deterministic recorded-input replay and report live divergence honestly.

## Migration Plan

This is a greenfield system, so migration means controlled delivery rather than data conversion.

1. Establish schema and pure domain packages with architecture, schema-roundtrip, property, and replay tests.
2. Add the Effect application shell with in-memory ports and deterministic test Layers.
3. Add SQLite events, observations, artifacts, outbox, checkpoints, redaction, and replay verification.
4. Add process guards and adapter conformance for one read-only provider profile, then certify the remaining providers independently.
5. Add task authorization, capability egress, approval, credential, and worker-isolation boundaries before enabling research tools.
6. Add Scrapling, PixelRAG, and Graphify through the Tool Gateway with lineage and evidence validation.
7. Add independent proposals, round-zero aggregation, deliberation, judging, minority guard, synthesis, and citation verification.
8. Add the provider-neutral MCP server and native host wrappers, keeping all permissions deny-by-default.
9. Run crash, stream-fuzz, OS process-tree, adapter, security, provenance, and equal-budget Council evaluations before release.

Each slice must preserve event and schema compatibility or provide an explicit migration. Rollback uses the prior executable and compatible schema/reducer versions; no release may rewrite authoritative events in place.

## Open Questions

None that can safely change the specifications or architectural approach. Thresholds such as token budgets, calibration freshness, artifact retention, snapshot cadence, and high-confidence display are versioned policy configuration and will receive conservative defaults plus evaluation-derived tuning during implementation planning.
