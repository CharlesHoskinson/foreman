# Return of the ForeDi EARS catalog

Status: M1–M6 implementation candidate, acceptance incomplete. M7 K semantics is planned.

Seven milestones contain 42 features and 146 EARS requirements. Each requirement has at least one test in the [test plan](TEST-PLAN.md).

See the [EARS method](EARS-METHOD.md) for syntax and coverage rules.

## M1: Return of the ForeDi: Pel language

[OpenSpec](../../../openspec/changes/foredi-01-pel-language/specs/foredi-01-pel-language/spec.md) · [Implementation tasks](../../../openspec/changes/foredi-01-pel-language/tasks.md)

### F-M1-01: Published grammar and source locations

Parse the paper syntax with exact source spans.

**R-M1-001** (event). When Pel source is parsed, the Foreman Pel parser SHALL produce the profile-defined AST with exact source spans.

Tests: [T-M1-001](TEST-PLAN.md#t-m1-001).

**R-M1-002** (unwanted). If source violates the lexical or grammar profile, then the Foreman Pel parser SHALL return source-located diagnostics without an executable program.

Tests: [T-M1-002](TEST-PLAN.md#t-m1-002).

**R-M1-019** (event). When compatibility fixtures are validated, the Foreman Pel conformance suite SHALL cover every classified profile decision with its declared positive and negative cases.

Tests: [T-M1-019](TEST-PLAN.md#t-m1-019).

### F-M1-02: Values and callable lists

Preserve Pel values with an explicit one-based list profile.

**R-M1-003** (event). When Pel values are evaluated or formatted, the Foreman Pel evaluator SHALL preserve their profile-defined types and ordered pair structure.

Tests: [T-M1-003](TEST-PLAN.md#t-m1-003).

**R-M1-004** (event). When a list is called, the Foreman Pel evaluator SHALL apply one-based indexing, inclusive slicing, and ordered key selection.

Tests: [T-M1-004](TEST-PLAN.md#t-m1-004).

**R-M1-018** (event). When Pel data is encoded, the Foreman Pel evaluator SHALL produce the canonical tagged JSON representation and deterministic source formatting.

Tests: [T-M1-018](TEST-PLAN.md#t-m1-018).

### F-M1-03: Closures and argument binding

Implement lexical closures, defaults, and partial application.

**R-M1-005** (event). When a lambda is created or invoked, the Foreman Pel evaluator SHALL preserve lexical capture and profile-defined default evaluation.

Tests: [T-M1-005](TEST-PLAN.md#t-m1-005).

**R-M1-006** (event). When a closure receives arguments, the Foreman Pel evaluator SHALL bind named or positional arguments under its fixed argument specification.

Tests: [T-M1-006](TEST-PLAN.md#t-m1-006).

### F-M1-04: Pipes and native control flow

Compose values through native pipes and selective control flow.

**R-M1-007** (event). When a pipe is evaluated, the Foreman Pel evaluator SHALL insert its once-evaluated input at profile-defined caret positions.

Tests: [T-M1-007](TEST-PLAN.md#t-m1-007).

**R-M1-008** (event). When native conditional or loop functions are evaluated, the Foreman Pel evaluator SHALL select only required expressions and preserve result order.

Tests: [T-M1-008](TEST-PLAN.md#t-m1-008).

**R-M1-009** (event). When do or do/async evaluates a sequence, the Foreman Pel evaluator SHALL return the last source expression after required dependencies complete.

Tests: [T-M1-009](TEST-PLAN.md#t-m1-009).

### F-M1-05: Diagnostics and evaluation limits

Report source errors and stop evaluation at finite bounds.

**R-M1-010** (event). When evaluation fails, the Foreman Pel evaluator SHALL return a stable error code, precise source span, and applicable function signature.

Tests: [T-M1-010](TEST-PLAN.md#t-m1-010), [T-M1-021](TEST-PLAN.md#t-m1-021).

**R-M1-011** (unwanted). If an evaluation bound would be exceeded, then the Foreman Pel evaluator SHALL stop before the next expression emits a host request.

Tests: [T-M1-011](TEST-PLAN.md#t-m1-011).

### F-M1-06: Host suspension and recovery data

Suspend host calls and resume with ordinary validated Pel values.

**R-M1-012** (event). When a fully applied host function is reached, the Foreman Pel evaluator SHALL suspend and resume through validated ordinary Pel data.

Tests: [T-M1-012](TEST-PLAN.md#t-m1-012).

**R-M1-013** (event). When case reaches a literal string condition, the Foreman Pel evaluator SHALL request a typed natural-language predicate result through host suspension.

Tests: [T-M1-013](TEST-PLAN.md#t-m1-013).

**R-M1-014** (event). When a continuation is encoded and restored, the Foreman Pel evaluator SHALL preserve lexical data, pending request identities, and consumed limits.

Tests: [T-M1-014](TEST-PLAN.md#t-m1-014).

**R-M1-015** (event). When a valid host failure receipt arrives, the Foreman Pel evaluator SHALL preserve its typed failure and stop releasing new requests.

Tests: [T-M1-015](TEST-PLAN.md#t-m1-015).

**R-M1-016** (event). When a host-library closure is evaluated, the Foreman Pel evaluator SHALL bind nested requests and consumed counters to its unique child invocation identity.

Tests: [T-M1-016](TEST-PLAN.md#t-m1-016).

**R-M1-017** (event). When a host registry is constructed, the Foreman Pel evaluator SHALL validate its names, argument specifications, data schemas, and canonical digest.

Tests: [T-M1-017](TEST-PLAN.md#t-m1-017).

**R-M1-020** (event). When a revised program preserves its completed prefix, the Foreman Pel evaluator SHALL validate old-to-new call mappings before fresh replay.

Tests: [T-M1-020](TEST-PLAN.md#t-m1-020).

## M2: Return of the ForeDi: Pel plan authoring

[OpenSpec](../../../openspec/changes/foredi-02-plan-authoring/specs/foredi-02-plan-authoring/spec.md) · [Implementation tasks](../../../openspec/changes/foredi-02-plan-authoring/tasks.md)

### F-M2-01: Source checking

Check Pel source and surface errors before execution.

**R-M2-001** (event). When an operator checks a Pel file, the Foreman authoring service SHALL report source validity against the selected immutable authoring snapshot.

Tests: [T-M2-001](TEST-PLAN.md#t-m2-001), [T-M2-016](TEST-PLAN.md#t-m2-016).

**R-M2-002** (unwanted). If a selected authoring input is unavailable or invalid, then the Foreman authoring service SHALL return an input diagnostic without probing external services.

Tests: [T-M2-002](TEST-PLAN.md#t-m2-002).

### F-M2-02: Pure effect previews

Explain source behavior without dispatching host effects.

**R-M2-003** (event). When a Pel file is previewed, the Foreman authoring service SHALL derive host-effect descriptions without executing those effects.

Tests: [T-M2-003](TEST-PLAN.md#t-m2-003).

**R-M2-004** (event). When preview values remain unresolved, the Foreman authoring service SHALL preserve native control-flow alternatives and explain their dependencies.

Tests: [T-M2-004](TEST-PLAN.md#t-m2-004).

### F-M2-03: Capability and dynamic-region analysis

Constrain unresolved effects with finite checked envelopes.

**R-M2-005** (unwanted). If a reachable effect violates the authoring snapshot, then the Foreman authoring service SHALL reject it with the source location and violated constraint.

Tests: [T-M2-005](TEST-PLAN.md#t-m2-005).

**R-M2-006** (event). When future effects depend on unresolved values, the Foreman authoring service SHALL require finite capability, resource, model, and resource-consumption envelopes.

Tests: [T-M2-006](TEST-PLAN.md#t-m2-006).

### F-M2-04: Exact preview binding

Bind derived previews to exact source and environment digests.

**R-M2-007** (event). When any source or environment binding changes, the Foreman authoring service SHALL require a newly checked preview.

Tests: [T-M2-007](TEST-PLAN.md#t-m2-007).

**R-M2-014** (event). When an authoring snapshot is loaded, the Foreman authoring service SHALL validate its full content and exact model selections against their canonical digests.

Tests: [T-M2-014](TEST-PLAN.md#t-m2-014).

### F-M2-05: Bounded natural-language generation

Generate locally checked Pel through an explicit capped repair loop.

**R-M2-008** (event). When an operator requests natural-language generation, the Foreman authoring service SHALL produce locally checked Pel through the selected exact model and transport.

Tests: [T-M2-008](TEST-PLAN.md#t-m2-008).

**R-M2-009** (unwanted). If three generated candidates fail local validation, then the Foreman authoring service SHALL stop with all attempt diagnostics and no accepted plan.

Tests: [T-M2-009](TEST-PLAN.md#t-m2-009).

**R-M2-010** (unwanted). If generation exceeds its limits or encounters a fatal provider failure, then the Foreman authoring service SHALL stop without further repair calls.

Tests: [T-M2-010](TEST-PLAN.md#t-m2-010).

**R-M2-015** (event). When a generation attempt is admitted, the Foreman authoring service SHALL supply a complete provider request context within its separate generation budget.

Tests: [T-M2-015](TEST-PLAN.md#t-m2-015).

### F-M2-06: Operator diagnostics and draft editing

Provide useful examples, precise diagnostics, and bounded draft revision tools.

**R-M2-011** (event). When an operator receives a diagnostic, the Foreman authoring service SHALL show the source range, cause, and applicable registered usage.

Tests: [T-M2-011](TEST-PLAN.md#t-m2-011).

**R-M2-012** (event). When an operator edits an interactive draft, the Foreman authoring service SHALL preserve bounded revision history and recheck each source revision.

Tests: [T-M2-012](TEST-PLAN.md#t-m2-012).

**R-M2-013** (event). When built authoring examples are checked and previewed, the Foreman authoring service SHALL produce their documented native Pel outcomes.

Tests: [T-M2-013](TEST-PLAN.md#t-m2-013).

## M3: Exact model profiles and shared provider adapters

[OpenSpec](../../../openspec/changes/foredi-03-model-adapters/specs/foredi-03-model-adapters/spec.md) · [Implementation tasks](../../../openspec/changes/foredi-03-model-adapters/tasks.md)

### F-M3-01: Exact model profiles

Resolve six exact profiles across four provider families without silent substitution.

**R-M3-001** (ubiquitous). The Foreman provider registry SHALL define the six exact model profiles and four provider families listed in the design.

Tests: [T-M3-001](TEST-PLAN.md#t-m3-001).

**R-M3-002** (unwanted). If requested reasoning controls violate a model profile, then the Foreman provider adapter SHALL return UnsupportedCapability before transport dispatch.

Tests: [T-M3-002](TEST-PLAN.md#t-m3-002).

**R-M3-003** (event). When a provider request resolves, the Foreman provider registry SHALL bind its profile hash, transport version, source manifest hash and capability evidence.

Tests: [T-M3-003](TEST-PLAN.md#t-m3-003).

**R-M3-021** (event). When provider controls resolve, the Foreman provider adapter SHALL validate closed typed controls and preserve the exact admitted defaults or explicit values.

Tests: [T-M3-021](TEST-PLAN.md#t-m3-021).

**R-M3-025** (ubiquitous). The Foreman provider contract SHALL expose one exhaustive failure union with a fixed retry classification for every tag.

Tests: [T-M3-025](TEST-PLAN.md#t-m3-025).

### F-M3-02: API and native coding transports

Encode direct inference and native coding requests through explicit transport capabilities.

**R-M3-004** (ubiquitous). The Foreman provider adapter SHALL keep API request identities separate from native coding session identities.

Tests: [T-M3-004](TEST-PLAN.md#t-m3-004).

**R-M3-005** (event). When a native transport receives a prompt, the Foreman provider adapter SHALL deliver its exact bytes through a declared prompt channel.

Tests: [T-M3-005](TEST-PLAN.md#t-m3-005).

**R-M3-006** (unwanted). If a transport lacks a requested capability, then the Foreman provider adapter SHALL reject dispatch without changing model, permissions or output behavior.

Tests: [T-M3-006](TEST-PLAN.md#t-m3-006).

**R-M3-019** (event). When Pel generation is requested, the Foreman provider adapter SHALL perform one exact-profile generation attempt using the selected grammar capability or structured envelope.

Tests: [T-M3-019](TEST-PLAN.md#t-m3-019).

**R-M3-024** (event). When a task transport resolves, the Foreman provider registry SHALL select one admitted transport and require native coding capability for file-writing tasks.

Tests: [T-M3-024](TEST-PLAN.md#t-m3-024).

**R-M3-027** (ubiquitous). The Foreman provider package SHALL resolve opaque credential references through an injected port without importing orchestration.

Tests: [T-M3-027](TEST-PLAN.md#t-m3-027).

### F-M3-03: Semantic events and tool exchange

Preserve event meaning and validate tool and final results before host use.

**R-M3-007** (event). When a provider event arrives, the Foreman provider adapter SHALL emit a normalized event with its provider identity and original semantic status.

Tests: [T-M3-007](TEST-PLAN.md#t-m3-007).

**R-M3-008** (event). When a provider requests a tool, the Foreman provider adapter SHALL preserve its call identifier and submit the bounded host-resolved result payload.

Tests: [T-M3-008](TEST-PLAN.md#t-m3-008).

**R-M3-009** (unwanted). If final output violates the host schema, then the Foreman provider adapter SHALL return OutputInvalid without producing a completed result.

Tests: [T-M3-009](TEST-PLAN.md#t-m3-009).

**R-M3-020** (event). When usage or a request limit is observed, the Foreman provider adapter SHALL preserve accounting dimensions and enforce the stricter admitted limit.

Tests: [T-M3-020](TEST-PLAN.md#t-m3-020).

**R-M3-028** (event). When provider JSON is decoded, the Foreman provider adapter SHALL construct schema-ordered Pel values before validating the original output schema.

Tests: [T-M3-028](TEST-PLAN.md#t-m3-028).

### F-M3-04: Continuation and lifecycle

Preserve opaque provider state and report cancellation and resume outcomes truthfully.

**R-M3-010** (event). When a continuation is emitted or resumed, the Foreman provider adapter SHALL preserve opaque reasoning bytes and their originating model, transport and prefix binding.

Tests: [T-M3-010](TEST-PLAN.md#t-m3-010).

**R-M3-011** (event). When cancellation is requested, the Foreman provider adapter SHALL report request, acknowledgement, local cleanup and observed remote outcome separately.

Tests: [T-M3-011](TEST-PLAN.md#t-m3-011).

**R-M3-012** (unwanted). If continuation retention expired or remote outcome is unknown, then the Foreman provider adapter SHALL return ResumeUnavailable or OutcomeUnknown without automatic redispatch.

Tests: [T-M3-012](TEST-PLAN.md#t-m3-012).

**R-M3-022** (event). When remote work is observed, the Foreman provider adapter SHALL return a typed observation for the existing identity without redispatch.

Tests: [T-M3-022](TEST-PLAN.md#t-m3-022).

### F-M3-05: Readiness and authentication diagnostics

Distinguish authentication, discovery, model identity and capability evidence.

**R-M3-013** (event). When readiness is inspected, the Foreman provider adapter SHALL report discovery, authentication, currency, model identity and capabilities as separate evidence-bearing facts.

Tests: [T-M3-013](TEST-PLAN.md#t-m3-013).

**R-M3-014** (unwanted). If an authentication probe times out or cannot parse its response, then the Foreman provider adapter SHALL report unknown without a login instruction.

Tests: [T-M3-014](TEST-PLAN.md#t-m3-014).

**R-M3-015** (event). When observed model identity differs from the requested profile, the Foreman provider adapter SHALL return ModelMismatch and retain both identities.

Tests: [T-M3-015](TEST-PLAN.md#t-m3-015).

**R-M3-023** (event). When a product request is admitted, the Foreman provider registry SHALL require current live evidence for every required capability.

Tests: [T-M3-023](TEST-PLAN.md#t-m3-023).

### F-M3-06: Contract fixtures and live qualification

Qualify exact model and transport combinations with reproducible bounded tests.

**R-M3-016** (ubiquitous). The Foreman provider contract suite SHALL exercise each advertised model and transport combination with provider-specific positive and negative fixtures.

Tests: [T-M3-016](TEST-PLAN.md#t-m3-016).

**R-M3-017** (event). When an authorized live qualification runs, the Foreman provider adapter SHALL enforce its explicit account, model, transport, time and spend bounds.

Tests: [T-M3-017](TEST-PLAN.md#t-m3-017).

**R-M3-018** (event). When provider support is displayed, the Foreman provider registry SHALL distinguish documented capabilities from fixture-tested and live-qualified capabilities.

Tests: [T-M3-018](TEST-PLAN.md#t-m3-018).

**R-M3-026** (event). When a provider subcommand terminates, the Foreman CLI SHALL return the exit code assigned to its command outcome in the shared command table.

Tests: [T-M3-026](TEST-PLAN.md#t-m3-026).

**R-M3-029** (event). When an API no-tool request is qualified, the Foreman provider adapter SHALL report its enforced tool policy only from the exact serialized empty tool surface and SHALL reject returned tool activity and unrecognized action-bearing output.

Tests: [T-M3-029](TEST-PLAN.md#t-m3-029).

## M4: Execute and recover Pel programs

[OpenSpec](../../../openspec/changes/foredi-04-durable-execution/specs/foredi-04-durable-execution/spec.md) · [Implementation tasks](../../../openspec/changes/foredi-04-durable-execution/tasks.md)

### F-M4-01: Start and inspect a durable run

Run an admitted Pel program with one Effect owner and truthful status.

**R-M4-001** (event). When an admitted run starts, the Foreman runtime SHALL bind one exclusive Effect owner to its checked program and execution contract.

Tests: [T-M4-001](TEST-PLAN.md#t-m4-001).

**R-M4-002** (unwanted). If a resolved host request exceeds its checked envelope, then the Foreman runtime SHALL reject that request before reservation or dispatch.

Tests: [T-M4-002](TEST-PLAN.md#t-m4-002).

**R-M4-019** (event). When host preparation selects an external operation, the Foreman runtime SHALL reserve its declared ledger action exactly once before dispatch.

Tests: [T-M4-019](TEST-PLAN.md#t-m4-019).

### F-M4-02: Resume recorded host results

Persist suspension and effect receipts in the existing journal and recover without duplicate completed work.

**R-M4-003** (event). When a host call suspends evaluation, the Foreman runtime SHALL persist its bound intent before dispatch and its validated result before continuation.

Tests: [T-M4-003](TEST-PLAN.md#t-m4-003).

**R-M4-004** (unwanted). If execution stops between reservation and result persistence, then the Foreman runtime SHALL recover its existing reservation and classify the external outcome.

Tests: [T-M4-004](TEST-PLAN.md#t-m4-004).

**R-M4-005** (unwanted). If duplicate result receipts conflict, then the Foreman runtime SHALL reject recovery with journal-corrupt and preserve the conflicting evidence.

Tests: [T-M4-005](TEST-PLAN.md#t-m4-005).

**R-M4-017** (event). When a run resumes, the Foreman runtime SHALL reconstruct its checked program from immutable source and snapshot artifacts referenced by its journal.

Tests: [T-M4-017](TEST-PLAN.md#t-m4-017).

**R-M4-018** (event). When a provider repeats a recorded host-tool request, the Foreman runtime SHALL resend its durable result without repeating the tool effect.

Tests: [T-M4-018](TEST-PLAN.md#t-m4-018).

**R-M4-022** (event). When durable Pel payloads exceed journal metadata bounds, the Foreman runtime SHALL persist hash-bound immutable artifacts before appending their journal references.

Tests: [T-M4-022](TEST-PLAN.md#t-m4-022).

### F-M4-03: Execute bounded native concurrency

Use native sequencing and concurrency with host resource conflicts and isolated races.

**R-M4-006** (event). When native do or do/async evaluates host expressions, the Foreman runtime SHALL preserve Pel result semantics within admitted concurrency and resource limits.

Tests: [T-M4-006](TEST-PLAN.md#t-m4-006).

**R-M4-007** (state). While host requests have overlapping write resources, the Foreman runtime SHALL serialize those requests under the same canonical resource identity.

Tests: [T-M4-007](TEST-PLAN.md#t-m4-007).

**R-M4-008** (event). When fm/race selects a winner, the Foreman runtime SHALL preserve isolated contender artifacts and record one winner with truthful loser cancellation.

Tests: [T-M4-008](TEST-PLAN.md#t-m4-008).

### F-M4-04: Control retries and timeouts

Apply declared retry categories, persistent budgets, deadlines, and cancellation confirmation.

**R-M4-009** (event). When fm/retry receives a declared transient failure, the Foreman runtime SHALL reserve each retry within the original action, cost, and deadline limits.

Tests: [T-M4-009](TEST-PLAN.md#t-m4-009).

**R-M4-010** (event). When an effect timeout expires, the Foreman runtime SHALL interrupt local work and record the observed remote cancellation state.

Tests: [T-M4-010](TEST-PLAN.md#t-m4-010).

**R-M4-011** (event). When an operator requests cancellation, the Foreman runtime SHALL persist an idempotent request and report cancelled only after required cancellation confirmation.

Tests: [T-M4-011](TEST-PLAN.md#t-m4-011).

### F-M4-05: Recover unknown outcomes and revisions

Reconcile external uncertainty and validate checkpoints or source revisions against completed work.

**R-M4-012** (event). When fm/checkpoint completes, the Foreman runtime SHALL record a versioned data-only continuation bound to its program, attempt, and consumed limits.

Tests: [T-M4-012](TEST-PLAN.md#t-m4-012).

**R-M4-013** (unwanted). If an external outcome remains unknown, then the Foreman runtime SHALL require bound reconciliation evidence before continuing or repeating that effect.

Tests: [T-M4-013](TEST-PLAN.md#t-m4-013).

**R-M4-014** (event). When an operator submits a source revision, the Foreman runtime SHALL preserve the completed prefix, authority, and consumed limits before resuming.

Tests: [T-M4-014](TEST-PLAN.md#t-m4-014).

### F-M4-06: Explain run outcomes

Provide stable JSON and text results with evidence, unknown cost, and next actions.

**R-M4-015** (event). When an operator requests run status, the Foreman runtime SHALL derive outcome, evidence, usage bounds, and next action from the existing journal.

Tests: [T-M4-015](TEST-PLAN.md#t-m4-015).

**R-M4-016** (unwanted). If recovery history is corrupt, incompatible, or owned by another active process, then the Foreman runtime SHALL refuse continuation with an actionable diagnostic.

Tests: [T-M4-016](TEST-PLAN.md#t-m4-016).

**R-M4-020** (event). When a registered print or natural-language predicate executes, the Foreman runtime SHALL persist its bounded output or Boolean result through the host journal.

Tests: [T-M4-020](TEST-PLAN.md#t-m4-020).

**R-M4-021** (unwanted). If a production invocation supplies fixture-backed binding data, then the Foreman runtime SHALL reject admission without creating live-qualified evidence.

Tests: [T-M4-021](TEST-PLAN.md#t-m4-021).

**R-M4-023** (event). When evaluation returns a final value, the Foreman runtime SHALL validate its bound result contract and host milestones before choosing the run outcome.

Tests: [T-M4-023](TEST-PLAN.md#t-m4-023).

## M5: Deliver verified and reviewed candidates from Pel

[OpenSpec](../../../openspec/changes/foredi-05-task-delivery/specs/foredi-05-task-delivery/spec.md) · [Implementation tasks](../../../openspec/changes/foredi-05-task-delivery/tasks.md)

### F-M5-01: Implement bounded candidate work

Execute fm/task in an admitted workspace and return host-captured candidate artifacts.

**R-M5-001** (event). When an admitted fm/task call completes, the Foreman runtime SHALL return schema-validated Pel data with host-captured candidate and artifact references.

Tests: [T-M5-001](TEST-PLAN.md#t-m5-001).

**R-M5-002** (unwanted). If task output violates its schema or admitted paths, then the Foreman runtime SHALL reject candidate promotion and retain bounded diagnostic evidence.

Tests: [T-M5-002](TEST-PLAN.md#t-m5-002).

**R-M5-016** (event). When a task or review uses a role selector, the Foreman runtime SHALL resolve one exact admitted profile and transport from its bound snapshot.

Tests: [T-M5-016](TEST-PLAN.md#t-m5-016).

### F-M5-02: Verify an exact candidate

Execute host-owned checks and reuse only matching candidate and environment evidence.

**R-M5-003** (event). When fm/verify receives a candidate, the Foreman runtime SHALL execute the registered host check and bind its receipt to the exact candidate and environment.

Tests: [T-M5-003](TEST-PLAN.md#t-m5-003).

**R-M5-004** (event). When matching verification evidence already exists, the Foreman runtime SHALL reuse it only while candidate, gate, environment, policy, and freshness bindings remain unchanged.

Tests: [T-M5-004](TEST-PLAN.md#t-m5-004).

**R-M5-005** (unwanted). If the candidate changes during verification, then the Foreman runtime SHALL invalidate the check result before recording a passing verification receipt.

Tests: [T-M5-005](TEST-PLAN.md#t-m5-005).

### F-M5-03: Obtain independent vendor review

Review the exact candidate through a different observed vendor and preserve current-attempt verdicts.

**R-M5-006** (event). When fm/review records an authorizing review, the Foreman runtime SHALL bind the current candidate to an observed reviewer vendor distinct from its implementer.

Tests: [T-M5-006](TEST-PLAN.md#t-m5-006).

**R-M5-007** (unwanted). If current review evidence is missing, stale, refused, interrupted, or malformed, then the Foreman runtime SHALL report an unverified review.

Tests: [T-M5-007](TEST-PLAN.md#t-m5-007).

### F-M5-04: Deliver and repair a native Pel workflow

Run Grok implementation, host verification, and Sol review with bounded native repair.

**R-M5-008** (event). When the first delivery program runs, the Foreman runtime SHALL compose Grok implementation, host verification, and Sol review through native Pel values.

Tests: [T-M5-008](TEST-PLAN.md#t-m5-008).

**R-M5-009** (event). When review requests a correction, the Foreman runtime SHALL execute native Pel repair within the admitted correction and progress limits.

Tests: [T-M5-009](TEST-PLAN.md#t-m5-009).

**R-M5-010** (event). When delivery resumes after interruption, the Foreman runtime SHALL reuse recorded task results and continue from the first unresolved host effect.

Tests: [T-M5-010](TEST-PLAN.md#t-m5-010).

### F-M5-05: Publish with existing explicit authority

Prepare and execute a bound publication only when existing host authority permits its exact destination.

**R-M5-011** (unwanted). If publication lacks matching explicit host authority, then the Foreman runtime SHALL return needs-action without changing the publication destination.

Tests: [T-M5-011](TEST-PLAN.md#t-m5-011).

**R-M5-012** (event). When publication has matching authority and evidence, the Foreman runtime SHALL revalidate the exact candidate and destination before executing the admitted publication action.

Tests: [T-M5-012](TEST-PLAN.md#t-m5-012).

**R-M5-013** (unwanted). If publication acknowledgement is lost, then the Foreman runtime SHALL record an unknown external outcome and reconcile before any repeat publication.

Tests: [T-M5-013](TEST-PLAN.md#t-m5-013).

### F-M5-06: Return actionable delivery results

Expose real candidate artifacts, checks, review, publication, and next actions through consistent operator views.

**R-M5-014** (event). When delivery ends, the Foreman runtime SHALL expose candidate artifacts, check results, review findings, publication state, and a concrete next action.

Tests: [T-M5-014](TEST-PLAN.md#t-m5-014).

**R-M5-015** (unwanted). If a requested provider profile is unqualified, then the Foreman runtime SHALL report its unavailable capability without substituting another model.

Tests: [T-M5-015](TEST-PLAN.md#t-m5-015).

## M6: Install, migrate and use Return of the ForeDi

[OpenSpec](../../../openspec/changes/foredi-06-adoption/specs/foredi-06-adoption/spec.md) · [Implementation tasks](../../../openspec/changes/foredi-06-adoption/tasks.md)

### F-M6-01: Install and first workflow

Install the Node.js 24 product and start a documented admitted Pel workflow.

**R-M6-001** (event). When a clean installation completes, the Foreman installer SHALL provide the compiled Node.js 24 CLI and matching Pel examples.

Tests: [T-M6-001](TEST-PLAN.md#t-m6-001).

**R-M6-002** (event). When the quickstart starts an admitted workflow, the Foreman CLI SHALL execute the supplied Pel file with one foreman run command.

Tests: [T-M6-002](TEST-PLAN.md#t-m6-002).

**R-M6-003** (unwanted). If installation prerequisites are missing, then the Foreman installer SHALL report the missing prerequisite before changing the existing installation.

Tests: [T-M6-003](TEST-PLAN.md#t-m6-003).

**R-M6-019** (event). When a configured project starts a Pel workflow, the Foreman CLI SHALL derive its execution binding from the checked program and stored project configuration.

Tests: [T-M6-019](TEST-PLAN.md#t-m6-019).

### F-M6-02: Runnable examples and model selection

Ship useful examples with all six exact profiles and visible readiness.

**R-M6-004** (ubiquitous). The Foreman example collection SHALL include sequential work, parallel work, bounded rework, review, race cancellation, recovery and research preparation.

Tests: [T-M6-004](TEST-PLAN.md#t-m6-004).

**R-M6-005** (event). When an example selects a model, the Foreman CLI SHALL display the exact profile, transport and readiness evidence before execution.

Tests: [T-M6-005](TEST-PLAN.md#t-m6-005).

**R-M6-006** (unwanted). If an example's required provider is unavailable, then the Foreman CLI SHALL explain the missing capability without starting the workflow.

Tests: [T-M6-006](TEST-PLAN.md#t-m6-006).

### F-M6-03: Legacy workflow migration

Migrate supported workflows to one execution owner while retaining historical decoding.

**R-M6-007** (event). When a registered RoundPlanV1 and ExecutionContractV1 pair is imported, the Foreman migration tool SHALL emit Pel source and a parity report.

Tests: [T-M6-007](TEST-PLAN.md#t-m6-007).

**R-M6-008** (state). While a legacy run remains active, the Foreman migration tool SHALL preserve its current execution owner and durable history.

Tests: [T-M6-008](TEST-PLAN.md#t-m6-008).

**R-M6-009** (event). When legacy scripts are retained under the user-authorized temporary exception, the Foreman CLI SHALL preserve historical record decoding, SHALL keep the retained cohort byte-identical to its historical bodies, and SHALL not route migrated Pel workflows through that cohort. Explicit deletion of the twelve-file cohort is deferred until caller migration and `lane-runtime-typescript` parity are complete. The earlier claim of completed deletion was not sustained.

Tests: [T-M6-009](TEST-PLAN.md#t-m6-009).

### F-M6-04: Measured simplification

Demonstrate scoped deletion and reduced instructions against an immutable baseline.

**R-M6-010** (event). When simplification is measured, the Foreman measurement tool SHALL use the specification-fixed cohort, instruction corpus, tokenizer and counting rules.

Tests: [T-M6-010](TEST-PLAN.md#t-m6-010).

**R-M6-011** (ubiquitous). The Foreman migrated workflow cohort SHALL reduce required instruction tokens by at least 50 percent and report production-code counts under the unchanged frozen measurement contract.

Tests: [T-M6-011](TEST-PLAN.md#t-m6-011).

**R-M6-012** (event). When an unchanged candidate repeats verification, the Foreman execution owner SHALL reuse the matching host receipt and report one full verification execution.

Tests: [T-M6-012](TEST-PLAN.md#t-m6-012).

### F-M6-05: Research and graph usability

Make sourced research navigable and refreshable without a mandatory external vault.

**R-M6-013** (event). When a user requests research context, the Foreman research reader SHALL return bounded source-linked results with claim status and freshness.

Tests: [T-M6-013](TEST-PLAN.md#t-m6-013).

**R-M6-014** (event). When research inputs change, the Foreman research reader SHALL mark derived notes and graphs stale until a matching refresh completes.

Tests: [T-M6-014](TEST-PLAN.md#t-m6-014).

**R-M6-015** (optional). Where an external Obsidian vault is configured, the Foreman research reader SHALL expose its linked context without granting it execution authority.

Tests: [T-M6-015](TEST-PLAN.md#t-m6-015).

**R-M6-022** (event). When a Pel research effect executes, the Foreman host SHALL return bounded source-linked context through the registered read-only research descriptor.

Tests: [T-M6-022](TEST-PLAN.md#t-m6-022).

### F-M6-06: Packaging, support and rollback

Package working features with truthful support and compatible recovery.

**R-M6-016** (event). When a release package is assembled, the Foreman packaging tool SHALL include matching runtime, examples, profile evidence and migration documentation.

Tests: [T-M6-016](TEST-PLAN.md#t-m6-016).

**R-M6-017** (event). When an installed release rolls back, the Foreman rollback tool SHALL check every registered state root before restoring a compatible runtime without rewriting history.

Tests: [T-M6-017](TEST-PLAN.md#t-m6-017).

**R-M6-018** (event). When support diagnostics are exported, the Foreman CLI SHALL report reproducible feature context with secret and reasoning redaction.

Tests: [T-M6-018](TEST-PLAN.md#t-m6-018).

**R-M6-020** (event). When version information is requested, the Foreman CLI SHALL report the release name, build identity and nullable numerical version from its installed manifest.

Tests: [T-M6-020](TEST-PLAN.md#t-m6-020).

**R-M6-021** (event). When a adoption subcommand terminates, the Foreman CLI SHALL return the exit code assigned to its command outcome in the shared command table.

Tests: [T-M6-021](TEST-PLAN.md#t-m6-021).

**R-M6-023** (event). When an archive build is requested, the Foreman packaging tool SHALL emit the manifest-bound installable archive at its declared build-identity path.

Tests: [T-M6-023](TEST-PLAN.md#t-m6-023).

## M7: Executable Pel semantics in K (planned)

[OpenSpec](../../../openspec/changes/foredi-07-k-semantics/specs/foredi-07-k-semantics/spec.md) · [Implementation tasks](../../../openspec/changes/foredi-07-k-semantics/tasks.md)

### F-M7-01: Pinned profile and executable syntax

Pinned profile and executable syntax.

**R-M7-001** (event). When the K semantics toolchain is selected, the semantics harness SHALL record its exact K revision, backend, executable hashes and Pel profile digest before compiling.

Tests: [T-M7-001](TEST-PLAN.md#t-m7-001).

**R-M7-002** (event). When Pel source is parsed by the K definition, the definition SHALL produce the selected M1 syntax and source locations independently of the TypeScript parser.

Tests: [T-M7-002](TEST-PLAN.md#t-m7-002).

**R-M7-003** (event). When numeric expressions execute, the K definition SHALL reproduce the finite binary64 and safe-integer restrictions of the selected Pel profile.

Tests: [T-M7-003](TEST-PLAN.md#t-m7-003).

### F-M7-02: Values, closures and native control

Values, closures and native control.

**R-M7-004** (event). When a Pel value or callable list is evaluated, the K definition SHALL preserve M1 tags, pair presence, nil, quoting and one-based selection.

Tests: [T-M7-004](TEST-PLAN.md#t-m7-004).

**R-M7-005** (event). When a closure is called, the K definition SHALL use its captured lexical environment and the selected argument-binding rules.

Tests: [T-M7-005](TEST-PLAN.md#t-m7-005).

**R-M7-006** (event). When native control flow selects work, the K definition SHALL implement M1 non-strict branches, scoped loops, blocks and single-evaluation pipe injection.

Tests: [T-M7-006](TEST-PLAN.md#t-m7-006).

### F-M7-03: Scheduling, bounds and diagnostics

Scheduling, bounds and diagnostics.

**R-M7-007** (event). When top-level dependencies become ready, the K definition SHALL reproduce ordered and automatic M1 evaluation with ready/already-emitted batches and the last-source result.

Tests: [T-M7-007](TEST-PLAN.md#t-m7-007).

**R-M7-008** (event). When a Pel semantic limit is reached, the K definition SHALL stop at the same pre-operation boundary and preserve the same counters as M1.

Tests: [T-M7-008](TEST-PLAN.md#t-m7-008).

**R-M7-009** (unwanted). If execution encounters an invalid state or operation, then the K definition SHALL return a located domain diagnostic without inventing a host result.

Tests: [T-M7-009](TEST-PLAN.md#t-m7-009).

### F-M7-04: Abstract host effects

Abstract host effects.

**R-M7-010** (event). When a host expression suspends, the K definition SHALL emit a bounded abstract request and accept only its matching supplied receipt.

Tests: [T-M7-010](TEST-PLAN.md#t-m7-010).

**R-M7-011** (unwanted). If a receipt conflicts with source, registry, schema or request identity, then the K definition SHALL reject it without completing another request.

Tests: [T-M7-011](TEST-PLAN.md#t-m7-011).

**R-M7-012** (ubiquitous). The K host model SHALL treat provider behavior, resource grants and publication authority as explicit external assumptions rather than derived language facts.

Tests: [T-M7-012](TEST-PLAN.md#t-m7-012).

### F-M7-05: Continuations and replay

Continuations and replay.

**R-M7-013** (event). When a suspended configuration is serialized and restored, the K definition SHALL preserve lexical values, pending identities, selected options and consumed counters.

Tests: [T-M7-013](TEST-PLAN.md#t-m7-013).

**R-M7-014** (event). When completed-prefix replay or a source revision is modeled, the K definition SHALL preserve completed receipt bindings and the selected M1 replay boundary.

Tests: [T-M7-014](TEST-PLAN.md#t-m7-014).

**R-M7-015** (event). When an M1 child continuation is allocated or merged, the K definition SHALL preserve one-based child identity and charge child counters exactly once.

Tests: [T-M7-015](TEST-PLAN.md#t-m7-015).

### F-M7-06: Differential evidence and proof status

Differential evidence and proof status.

**R-M7-016** (event). When differential conformance runs, the TypeScript harness SHALL compare independently specified expected observations, K execution and the existing M1 engine for every mapped fixture.

Tests: [T-M7-016](TEST-PLAN.md#t-m7-016).

**R-M7-017** (event). When conformance evidence is recorded, the TypeScript harness SHALL bind source, K definition, toolchain, runtime, corpus and comparator digests to executed case counts.

Tests: [T-M7-017](TEST-PLAN.md#t-m7-017).

**R-M7-018** (event). When a semantic mutation changes a required rule, the conformance suite SHALL detect the changed observable behavior.

Tests: [T-M7-018](TEST-PLAN.md#t-m7-018).

**R-M7-019** (event). When a mechanized claim is assessed, its claim record SHALL name its domain, assumptions, exact semantics digest, backend and checked result separately from differential evidence.

Tests: [T-M7-019](TEST-PLAN.md#t-m7-019).

**R-M7-020** (ubiquitous). The semantics guide SHALL distinguish planned work, executable definitions, conformance evidence, mechanized claims and open correspondence assumptions.

Tests: [T-M7-020](TEST-PLAN.md#t-m7-020).
