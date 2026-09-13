# Return of the ForeDi: Pel plan authoring

The normative interfaces and planned fixture matrix are in [design.md](../../design.md).

## ADDED Requirements

### Requirement: R-M2-001 Source checking

When an operator checks a Pel file, the Foreman authoring service SHALL report source validity against the selected immutable authoring snapshot.

#### Scenario: T-M2-001 Source checking

- WHEN Valid arithmetic source, unmatched delimiter, unknown symbol, mixed argument call, and quoted unknown symbol. Branch-introduced definitions use the T-M2-016 definite-binding matrix.
- AND foreman check <fixture.pel> --context fixtures/authoring-snapshot.json --json.
- THEN Valid and quoted-data fixtures exit 0. Invalid fixtures exit 2 with the expected PEL_PARSE, PEL_UNBOUND_SYMBOL, or PEL_ARGUMENT_MODE span.

#### Scenario: T-M2-016 Source checking

- WHEN Unknown Boolean c with (if c (def x 1) (def x 2)) x, (if c (def x 1) 7) x, and known #t with (if #t (def x 1) 7) x.
- AND checkPel each branch-definition fixture and render its command result.
- THEN Both-branch definitions pass with exit 0 and a numeric summary. A one-branch definition followed by use returns PEL_CONDITIONAL_BINDING and exit 2 with branch spans. A provably selected definition passes with known value 1.

### Requirement: R-M2-002 Source checking

If a selected authoring input is unavailable or invalid, then the Foreman authoring service SHALL return an input diagnostic without probing external services.

#### Scenario: T-M2-002 Source checking

- WHEN Missing source, oversized snapshot, mismatched registry content/digest, missing default snapshot, and unsupported profile with provider/network/process/write spies.
- AND foreman check <fixture.pel> --context <snapshot.json> --json.
- THEN Input failures exit 2 and name the failing input. Full snapshot digest mismatch is rejected. All external probe, provider, process, write, and reservation counts remain zero.

### Requirement: R-M2-003 Pure effect previews

When a Pel file is previewed, the Foreman authoring service SHALL derive host-effect descriptions without executing those effects.

#### Scenario: T-M2-003 Pure effect previews

- WHEN Canonical implement-verify-review.pel with role bindings to grok-4.6/grok-acp and gpt-5.6-sol/codex-app-server, plus an exact-profile call with two transports and no selector. Registry declarations come only from M2 pel-host-descriptors.ts without M4/M5 implementation imports.
- AND foreman plan examples/pel/implement-verify-review.pel --context fixtures/authoring-snapshot.json --json.
- THEN The preview shows three ordered effects, concrete transport IDs, resolved controls, capabilities, and gates. Ambiguous transport selection fails PEL_PROFILE_UNSUPPORTED. All external effect counts remain zero.

### Requirement: R-M2-004 Pure effect previews

When preview values remain unresolved, the Foreman authoring service SHALL preserve native control-flow alternatives and explain their dependencies.

#### Scenario: T-M2-004 Pure effect previews

- WHEN Unknown Boolean verification association with required :passed, list schema maxItems=4, overlapping writes, and a literal case string with admitted gpt-5.6-sol/openai-responses nlConditionProfile.
- AND checkPel then planPel using schema-constrained host descriptors.
- THEN Both conditional branches remain visible. The loop bound is four. Overlapping writes have a serialization edge. The predicate effect shows exact gpt-5.6-sol/openai-responses controls. Missing predicate selection fails PEL_PROFILE_UNSUPPORTED.

### Requirement: R-M2-005 Capability and dynamic-region analysis

If a reachable effect violates the authoring snapshot, then the Foreman authoring service SHALL reject it with the source location and violated constraint.

#### Scenario: T-M2-005 Capability and dynamic-region analysis

- WHEN Calls to known descriptors with denied capability, unsupported effect kind, unavailable exact model/transport pair, and invalid output schema.
- AND checkPel each hostile fixture.
- THEN PEL_CAPABILITY_DENIED, PEL_UNSUPPORTED_EFFECT, PEL_PROFILE_UNSUPPORTED, or PEL_SCHEMA identifies the offending call. No alternate model is substituted.

### Requirement: R-M2-006 Capability and dynamic-region analysis

When future effects depend on unresolved values, the Foreman authoring service SHALL require finite capability, resource, model, and resource-consumption envelopes.

#### Scenario: T-M2-006 Capability and dynamic-region analysis

- WHEN Unknown path constrained to workspace A, list schema maxItems=4, unknown callable with two registered alternatives, and variants missing these content bounds.
- AND checkPel then planPel each dynamic fixture.
- THEN Bounded fixtures derive their envelopes from actual snapshot schemas and policy. The loop bound is four. Missing bounds or arbitrary unknown callables fail PEL_DYNAMIC_EFFECT_UNBOUNDED.

### Requirement: R-M2-007 Exact preview binding

When any source or environment binding changes, the Foreman authoring service SHALL require a newly checked preview.

#### Scenario: T-M2-007 Exact preview binding

- WHEN One checked preview followed by independent changes to whitespace, language, registry, provider controls, role bindings, nlConditionProfile, policy, and artifact digest. Change dependencyMode or effective project selection.
- AND Compute PlanBindingV1 and validate each mutated exported preview against the current snapshot.
- THEN Every content change invalidates snapshot or source binding. Equivalent ASTs with different source bytes have different source digests. Edited capability or profile JSON is rejected. The optionsDigest and effective snapshotDigest change together.

### Requirement: R-M2-008 Bounded natural-language generation

When an operator requests natural-language generation, the Foreman authoring service SHALL produce locally checked Pel through the selected exact model and transport.

#### Scenario: T-M2-008 Bounded natural-language generation

- WHEN Fixture generation for gpt-6-astra/openai-responses with controls from snapshot, grammar mode auto without qualified grammar, returning {pelSource:"(+ 1 2)"}.
- AND Run plan --prompt with selected credential profile in default and --json modes, and counterfixtures with unknown control keys or unsupported effort.
- THEN Successful default and JSON modes exit 0. Default stdout is exact Pel source. JSON stdout has preview.finalValueSummary.kind="known" and preview.finalValueSummary.value={tag:"number",value:3}. One complete envelope request occurs. Invalid controls fail locally. No execution ledger or generated operation runs.

### Requirement: R-M2-009 Bounded natural-language generation

If three generated candidates fail local validation, then the Foreman authoring service SHALL stop with all attempt diagnostics and no accepted plan.

#### Scenario: T-M2-009 Bounded natural-language generation

- WHEN Fixture provider returns malformed Pel on attempt 0, a forbidden capability on attempt 1, and an unbounded dynamic call on attempt 2.
- AND Run generatePelPlan with maxRepairs=2 and a finite generation budget.
- THEN Exactly three generation calls have attempt IDs 0, 1, and 2. PEL_GENERATION_EXHAUSTED carries all diagnostics and cumulative usage. CLI exits 1 and dispatch count is zero.

### Requirement: R-M2-010 Bounded natural-language generation

If generation exceeds its limits or encounters a fatal provider failure, then the Foreman authoring service SHALL stop without further repair calls.

#### Scenario: T-M2-010 Bounded natural-language generation

- WHEN Fake-clock deadlines, generation budget exhaustion, cancellation, refusal, and one fixture for every canonical ProviderFailure tag. Every tag uses the shared _tag,message,retryClass record and optional requestId,usage,fieldPath,providerIdentity,retryAfterMs fields.
- AND Run generatePelPlan under an Effect scope and advance the fixture clock to each boundary.
- THEN The Effect scope closes with no later request. Exhaustive tag handling preserves typed causes and usage. Fatal failures exit 1, cancellation exits 4, and local invalid selections exit 2.

### Requirement: R-M2-011 Operator diagnostics and draft editing

When an operator receives a diagnostic, the Foreman authoring service SHALL show the source range, cause, and applicable registered usage.

#### Scenario: T-M2-011 Operator diagnostics and draft editing

- WHEN Mixed positional/named fm/task call, unsupported model, unresolved branch, and unknown symbol near a registered function name.
- AND Render human and JSON check/plan output for each fixture.
- THEN Human output includes filename, line, column, caret range, cause, and useful signature. JSON preserves structured fields and unresolved reasons without invented success.

### Requirement: R-M2-012 Operator diagnostics and draft editing

When an operator edits an interactive draft, the Foreman authoring service SHALL preserve bounded revision history and recheck each source revision.

#### Scenario: T-M2-012 Operator diagnostics and draft editing

- WHEN A draft session uses replace-expression, replace-suffix, replace-program, history, undo, completion, export, abort, and a run-bound continuation input.
- AND Drive pel-draft-session through fixture readline input, including 101 small revisions and a large revision sequence.
- THEN Each replacement creates a new digest, undo restores exact bytes, history stays within 100 revisions and 16 MiB, export writes source, and run-bound input returns PEL_DRAFT_EXECUTED.

### Requirement: R-M2-013 Operator diagnostics and draft editing

When built authoring examples are checked and previewed, the Foreman authoring service SHALL produce their documented native Pel outcomes.

#### Scenario: T-M2-013 Operator diagnostics and draft editing

- WHEN M2-built checkout foreman.js and generated snapshot assets, implement-verify-review.pel, conditional.pel, parallel-read.pel, repair.pel, and separate repair-invalid.pel. No installer or M4/M5/M6 implementation is present.
- AND Build M1/M2 and run node skills/foreman/runtime/dist/foreman.js check and plan for each checkout example.
- THEN Valid examples exit 0 using the M2 declaration module. The negative repair fixture exits 2 with PEL_ARGUMENT_MODE. No provider or host handler executes, and installation is not required.

### Requirement: R-M2-014 Exact preview binding

When an authoring snapshot is loaded, the Foreman authoring service SHALL validate its full content and exact model selections against their canonical digests.

#### Scenario: T-M2-014 Exact preview binding

- WHEN Installed default snapshot with complete registry/schema/provider/policy content, roleBindings, nlConditionProfile, and one altered content field without a changed digest. The effective selection overrides base role/predicate defaults within admitted bounds, and a mismatch counterfixture uses a different effective digest.
- AND buildEffectiveAuthoringSnapshotV1, regenerate default snapshot from pel-host-descriptors.ts, and check role and predicate examples.
- THEN Valid snapshot resolves exact profile, transport, controls, account reference, and finite schemas. Altered content fails with exit 2 before any provider or execution action. Generated snapshot bytes match the packaged asset. Configured check and run use one effective digest, while mismatched selections fail exit 2 before dispatch. Narrowed limits are identical in check, plan, and run, and attempted widening is rejected.

### Requirement: R-M2-015 Bounded natural-language generation

When a generation attempt is admitted, the Foreman authoring service SHALL supply a complete provider request context within its separate generation budget.

#### Scenario: T-M2-015 Bounded natural-language generation

- WHEN Prompt digest, snapshot digest, session nonce, attempt 1, account:test, no-tools policy, artifact references, and a GenerationBudgetPort reservation.
- AND Construct GenerationRequest and lower through the fixture ProviderGenerationPort.
- THEN Effect ID ends /attempt/1. Exact controls, credential reference, pinned template, artifacts, token/deadline limits, and generation reservation are present. Execution ledger call count is zero.
