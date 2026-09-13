# Return of the ForeDi test plan

Status: M1–M6 have executed implementation tests recorded in their coverage and acceptance reports. M7 tests remain planned.

This plan contains 148 test scenarios for 146 requirements. Each entry states a concrete fixture, action, expected result, and target file.

Run the milestone commands in each OpenSpec `tasks.md` after its implementation exists. Unit and contract fixtures run without provider accounts. Live qualification uses the exact profile and transport combinations stated in M3. Record unsupported or inaccessible combinations as such. Do not substitute a different model to claim a pass.

## M1: Return of the ForeDi: Pel language

[OpenSpec](../../../openspec/changes/foredi-01-pel-language/specs/foredi-01-pel-language/spec.md) · [Implementation tasks](../../../openspec/changes/foredi-01-pel-language/tasks.md)

### T-M1-001

- Requirements: R-M1-001.
- Level: unit.
- Target: `packages/pel/test/syntax.test.ts`.
- Fixture: Calls (+ 1 2), lists [1 (+ 2 3)], nil, pair presence [:x] versus [:x #nil], quoted keys, ASCII |> pipes, corrected PDF KEY characters *, <, >, and escaped Unicode.
- Action: parsePel each fixture with pel-paper-v2-foreman-1.
- Expected: AST tags and UTF-8 spans match the profile. Pair AST valuePresent distinguishes required parameters from explicit nil defaults. ASCII |> parses and quoted keys remain data. A nonempty program returns its last source top-level expression value, after all required expressions complete.

### T-M1-002

- Requirements: R-M1-002.
- Level: unit.
- Target: `packages/pel/test/syntax.test.ts`.
- Fixture: Unmatched call/list delimiters, extracted ^> pipe, malformed escapes, #true, invalid UTF-8, 1e5, out-of-range decimals, a>b, >b, and x U+25B7 (f).
- Action: parsePel each invalid lexical or grammar fixture.
- Expected: Unmatched delimiters return PEL_PARSE. All listed invalid tokens return PEL_LEX with exact spans. U+25B7 gives the hint use |>. No invalid parse returns a program.

### T-M1-003

- Requirements: R-M1-003.
- Level: unit.
- Target: `packages/pel/test/values.test.ts`.
- Fixture: [1 "two" #t #nil :a 1 :flag], quoted symbols and expressions, duplicate keys, Unicode strings, and numeric boundary fixtures.
- Action: startPel each fixture and formatPel its result.
- Expected: Types and ordered pairs remain distinct. Formatting and JSON encoding round-trip Unicode and nil. Safe integers retain value. Unsafe or nonfinite arithmetic returns PEL_NUMERIC_DOMAIN.

### T-M1-004

- Requirements: R-M1-004.
- Level: unit.
- Target: `packages/pel/test/values.test.ts`.
- Fixture: ([5 6 7 8] 1), ([5 6 7 8] () 1 3), ([:a 1 :b 2] :at [':b ':a]), missing keys, zero/fractional/out-of-range indices.
- Action: startPel the callable-list fixture matrix.
- Expected: Results are 5, [5 6 7], [2 1], and nil respectively. Invalid indices return PEL_INDEX. Mixed at and slice selectors return PEL_ARGUMENT_MODE.

### T-M1-005

- Requirements: R-M1-005.
- Level: unit.
- Target: `packages/pel/test/closures.test.ts`.
- Fixture: ((lambda [:x] x)), ((lambda [:x #nil] x)), defaults [:x :y 3] and [:x 1 :y], lexical capture, and recursive factorial.
- Action: startPel closure fixtures.
- Expected: The required-x zero-argument call returns a partial closure. The nil-default call returns nil. The two parameter matrices bind declared defaults and required values exactly. Factorial 5 returns 120.

### T-M1-006

- Requirements: R-M1-006.
- Level: unit.
- Target: `packages/pel/test/closures.test.ts`.
- Fixture: (def name) partial def, partial lambda, (+ :x 1 :y 2), ((+ 5) 4), (+ [1 2]), ((+ 5) [1 2]), mixed modes, duplicate/unknown names, and excess arguments. Rebinding :x on an already x-bound partial closure.
- Action: startPel argument fixtures with a host-call spy.
- Expected: Partial constructors do not bind or evaluate missing bodies. Numeric results are 3, 9, and 3. Partial binary plus with list returns PEL_TYPE. Mode/name/count errors are PEL_ARGUMENT_MODE, PEL_ARGUMENT_NAME, and PEL_ARITY. Partial rebinding returns PEL_ARGUMENT_NAME.

### T-M1-007

- Requirements: R-M1-007.
- Level: contract.
- Target: `packages/pel/test/control.test.ts`.
- Fixture: A once-only host input with repeated carets, the page-17 case pipe chain, 7 |> (case ^ [(gt ^ 5) "big" #t "small"]), an aliased case, and (+ 1 2) |> (def z ^).
- Action: startPel and resumePel once with test/once returning 5.
- Expected: Repeated insertion emits one host call. The pipe-chain and nested/aliased case fixtures return "big". Def piping returns 3 and binds z. Quotes and nested case scopes retain their declared owners.

### T-M1-008

- Requirements: R-M1-008.
- Level: unit.
- Target: `packages/pel/test/control.test.ts`.
- Fixture: (if #f (test/denied) 7), (case 7 [(gt ^ 5) "big" #t "small"]), (case (test/once) [(gt 2) 1 #t 0]), a symbol-valued string condition, per-iteration def, and def inside if.
- Action: startPel each native-control fixture.
- Expected: The false branch emits no request. Case returns "big" and evaluates test/once exactly once. Nonliteral string conditions return PEL_TYPE. Per-iteration definitions return [1 2] without collision. Selected if definitions bind the caller scope.

### T-M1-009

- Requirements: R-M1-009.
- Level: contract.
- Target: `packages/pel/test/control.test.ts`.
- Fixture: Sequential do, empty blocks, do/async requests A then B, a forward dependency, and a cycle. Also (test/a) (test/b) without do/async under explicit ordered and automatic PelRunOptionsV1.
- Action: startPel with explicit options, then resumePel(program,registry,continuation,[receiptB],options) for the asynchronous fixture, followed by receiptA.
- Expected: Initial ready is [A:false,B:false]. After only B returns, suspend.ready is [A:true] with no newly emitted request. After A returns, done contains B value. Source-order dependencies wait and cycles return PEL_DEPENDENCY_CYCLE. Ordered top-level mode initially releases only A, automatic releases both, and both return the last source value after required work completes.

### T-M1-010

- Requirements: R-M1-010.
- Level: unit.
- Target: `packages/pel/test/limits.test.ts`.
- Fixture: A two-line program with (print ["hello" name] :sep " ") on line 2 and a registered print signature.
- Action: startPel then renderPelDiagnostic.
- Expected: PEL_ARGUMENT_MODE identifies line 2, marks the complete call, prints the registered signature, and supplies a named-argument example without unrelated environment data.

### T-M1-011

- Requirements: R-M1-011.
- Level: contract.
- Target: `packages/pel/test/limits.test.ts`.
- Fixture: (for [1 2 3] i (test/echo i)) with maxIterations=2, recursive fuel exhaustion, oversized input, deep nesting, and continuation resumes.
- Action: startPel then resume valid receipts until the first bound failure.
- Expected: Exactly two loop requests can occur. The third body emits none. PEL_LIMIT names the bound and consumed count. Resume retains previous counters.

### T-M1-012

- Requirements: R-M1-012.
- Level: contract.
- Target: `packages/pel/test/host-contract.test.ts`.
- Fixture: createHostRegistry fixture descriptors and schemas, then (test/flag) |> (if :cond ^ :then (for [1 2] i (* i 2)) :else []), plus an incomplete host closure.
- Action: createPelEnvironment, startPel, then resumePel(program,registry,continuation,[successful Boolean receipt]).
- Expected: One ready request appears and true yields [2 4]. The incomplete host closure emits no request. Changed registry content fails PEL_CONTINUATION_MISMATCH and schema-invalid values fail PEL_HOST_RESULT.

### T-M1-013

- Requirements: R-M1-013.
- Level: contract.
- Target: `packages/pel/test/host-contract.test.ts`.
- Fixture: (case [:tier "premium"] ["is premium" 1 #t 0]) with nlConditionProfile={profileId:"gpt-5.6-sol",transportId:"openai-responses",controls:fixtureControls,credentialProfileRef:"account:test",outputSchemaId:"schema:pel-boolean-v1"}. The selection and its digest are supplied through PelRunOptionsV1, with a null-selection counterfixture.
- Action: startPel with explicit options and resumePel with matching options and Boolean or invalid receipts.
- Expected: The request carries declared selection and selectionDigest fields plus scrutinee and literal condition. Boolean receipts return 1 or 0. Null selection returns PEL_REGISTRY before release. A string receipt returns PEL_HOST_RESULT.

### T-M1-014

- Requirements: R-M1-014.
- Level: contract.
- Target: `packages/pel/test/host-contract.test.ts`.
- Fixture: A partially complete do/async with a captured closure, one completed receipt, pending requests, changed digest, and duplicate receipt. Change dependencyMode, predicate selection, or replay options independently.
- Action: Encode/decode PelContinuationV1, resumePel with the supplied program and registry, then try changed source, changed registry, and duplicate receipts.
- Expected: Matching restoration returns the same value without repeated calls. Changed source or registry returns PEL_CONTINUATION_MISMATCH. Duplicate and unknown receipts return PEL_HOST_RESULT. Every changed optionsDigest returns PEL_CONTINUATION_MISMATCH.

### T-M1-015

- Requirements: R-M1-015.
- Level: contract.
- Target: `packages/pel/test/host-contract.test.ts`.
- Fixture: do/async with A failing while B remains pending, and a retry child returning a registered provider failure.
- Action: resumePel with A failure, inspect failed continuation, then merge the final child failure.
- Expected: PelStep.failed contains PEL_HOST_FAILURE and identical hostFailure code/message/cause. B remains pending for host reconciliation. No new request is emitted. Merged child failure preserves counters.

### T-M1-016

- Requirements: R-M1-016.
- Level: contract.
- Target: `packages/pel/test/host-contract.test.ts`.
- Fixture: The same closure evaluated under parent p at retry attempts 1 and 2, race contenders 1 and 2, and an abandoned losing child. A recursively captured closure whose canonical node table contains a cycle.
- Action: extractClosureEnvironment, evaluateClosure per context, then merge counters and try an attempt-1 receipt in attempt 2. Encode/decode HostArgumentsEncodingV1 and hash the whole digest-free environment node/reference table.
- Expected: Nested request IDs differ across attempts and contenders. A foreign receipt returns PEL_HOST_RESULT. Winning, failed, and abandoned child counters are charged once. Closure return data is rejected at the host-library boundary. Recursive closure argument bytes and digest remain stable without recursive environment hashing.

### T-M1-017

- Requirements: R-M1-017.
- Level: contract.
- Target: `packages/pel/test/host-contract.test.ts`.
- Fixture: Duplicate host names, unknown schema references, a maxItems=4 list schema, an association with duplicate keys, and changed descriptor content. Change only the resolverCatalog.
- Action: createHostRegistry(descriptors,dataSchemas,failureSchemas,resolverCatalog), then decode fixture receipts.
- Expected: Invalid registries return PEL_REGISTRY. The bounded schema permits four values and rejects five. Association duplicates fail PEL_HOST_RESULT. Descriptor changes change the registry digest. Resolver changes alter registryDigest.

### T-M1-018

- Requirements: R-M1-018.
- Level: property.
- Target: `packages/pel/test/values.test.ts`.
- Fixture: Nil, pair :a 1, list [':a 1], negative zero, Unicode string, nested data, and a closure.
- Action: Encode, canonicalize, SHA-256 hash, decode, and formatPel each fixture.
- Expected: Round-trips preserve data. Equal values have identical digests. Pair and list hashes differ. Negative zero encodes as zero. Closure formatting is explicitly non-executable.

### T-M1-019

- Requirements: R-M1-019.
- Level: contract.
- Target: `packages/pel/test/profile.test.ts`.
- Fixture: The corrected PDF-backed profile matrix with extension rows separate from pure paper baseline rows, positive/negative fixtures through PV2-056, and a deliberately wrong locator/classification.
- Action: Run packages/pel/test/profile.test.ts through scripts/run-tests.ts.
- Expected: Complete fixtures and exact matrix metadata pass. Missing cases, wrong stored metadata, or unclassified rows fail. PixelRAG page-image spot checks establish p12 nil/pairs, p14 argument modes, p17 if/case, and p11 keyword rules. Print routing is an extension.

### T-M1-020

- Requirements: R-M1-020.
- Level: contract.
- Target: `packages/pel/test/host-contract.test.ts`.
- Fixture: Two completed host calls, recorded prefix reductions 10, latest durable failed-step reductions 14, and a revised pure suffix consuming 3 reductions. Counterfixtures change a completed argument or lower committedCounters.
- Action: validateRevisionPrefix, startPel with completed-prefix replay options containing recordedCounters and committedCounters, then supply mapped receipts.
- Expected: Both host results reuse receipts without dispatch. Replay consumes separate bounded fuel. New ordinary reductions total 17, including failed suffix work. Changed completed arguments or reduced committed counters fail before dispatch; original limits remain enforced.

### T-M1-021

- Requirements: R-M1-010.
- Level: unit.
- Target: `packages/pel/test/limits.test.ts`.
- Fixture: Parser-valid bare caret, :a^b, lone minus, Infinity, :a>, and every stable diagnostic enum member.
- Action: parsePel first, then startPel with default explicit options for parse-valid programs and enumerate diagnostic rendering.
- Expected: Parsing accepts standalone caret syntax and symbol tokens. Evaluation raises PEL_CARET_SCOPE for demanded unbound carets, returns a subtraction closure for minus, and raises PEL_UNBOUND_SYMBOL for Infinity. :a> remains a keyword. Stable diagnostics include PEL_HOST_FAILURE and PEL_REGISTRY.

## M2: Return of the ForeDi: Pel plan authoring

[OpenSpec](../../../openspec/changes/foredi-02-plan-authoring/specs/foredi-02-plan-authoring/spec.md) · [Implementation tasks](../../../openspec/changes/foredi-02-plan-authoring/tasks.md)

### T-M2-001

- Requirements: R-M2-001.
- Level: acceptance.
- Target: `packages/orchestration/src/pel-authoring-cli.test.ts`.
- Fixture: Valid arithmetic source, unmatched delimiter, unknown symbol, mixed argument call, and quoted unknown symbol. Branch-introduced definitions use the T-M2-016 definite-binding matrix.
- Action: foreman check <fixture.pel> --context fixtures/authoring-snapshot.json --json.
- Expected: Valid and quoted-data fixtures exit 0. Invalid fixtures exit 2 with the expected PEL_PARSE, PEL_UNBOUND_SYMBOL, or PEL_ARGUMENT_MODE span.

### T-M2-002

- Requirements: R-M2-002.
- Level: acceptance.
- Target: `packages/orchestration/src/pel-authoring-cli.test.ts`.
- Fixture: Missing source, oversized snapshot, mismatched registry content/digest, missing default snapshot, and unsupported profile with provider/network/process/write spies.
- Action: foreman check <fixture.pel> --context <snapshot.json> --json.
- Expected: Input failures exit 2 and name the failing input. Full snapshot digest mismatch is rejected. All external probe, provider, process, write, and reservation counts remain zero.

### T-M2-003

- Requirements: R-M2-003.
- Level: acceptance.
- Target: `packages/orchestration/src/pel-authoring-cli.test.ts`.
- Fixture: Canonical implement-verify-review.pel with role bindings to grok-4.6/grok-acp and gpt-5.6-sol/codex-app-server, plus an exact-profile call with two transports and no selector. Registry declarations come only from M2 pel-host-descriptors.ts without M4/M5 implementation imports.
- Action: foreman plan examples/pel/implement-verify-review.pel --context fixtures/authoring-snapshot.json --json.
- Expected: The preview shows three ordered effects, concrete transport IDs, resolved controls, capabilities, and gates. Ambiguous transport selection fails PEL_PROFILE_UNSUPPORTED. All external effect counts remain zero.

### T-M2-004

- Requirements: R-M2-004.
- Level: unit.
- Target: `packages/pel/test/preview.test.ts`.
- Fixture: Unknown Boolean verification association with required :passed, list schema maxItems=4, overlapping writes, and a literal case string with admitted gpt-5.6-sol/openai-responses nlConditionProfile.
- Action: checkPel then planPel using schema-constrained host descriptors.
- Expected: Both conditional branches remain visible. The loop bound is four. Overlapping writes have a serialization edge. The predicate effect shows exact gpt-5.6-sol/openai-responses controls. Missing predicate selection fails PEL_PROFILE_UNSUPPORTED.

### T-M2-005

- Requirements: R-M2-005.
- Level: unit.
- Target: `packages/pel/test/analysis.test.ts`.
- Fixture: Calls to known descriptors with denied capability, unsupported effect kind, unavailable exact model/transport pair, and invalid output schema.
- Action: checkPel each hostile fixture.
- Expected: PEL_CAPABILITY_DENIED, PEL_UNSUPPORTED_EFFECT, PEL_PROFILE_UNSUPPORTED, or PEL_SCHEMA identifies the offending call. No alternate model is substituted.

### T-M2-006

- Requirements: R-M2-006.
- Level: unit.
- Target: `packages/pel/test/analysis.test.ts`.
- Fixture: Unknown path constrained to workspace A, list schema maxItems=4, unknown callable with two registered alternatives, and variants missing these content bounds.
- Action: checkPel then planPel each dynamic fixture.
- Expected: Bounded fixtures derive their envelopes from actual snapshot schemas and policy. The loop bound is four. Missing bounds or arbitrary unknown callables fail PEL_DYNAMIC_EFFECT_UNBOUNDED.

### T-M2-007

- Requirements: R-M2-007.
- Level: contract.
- Target: `packages/pel/test/binding.test.ts`.
- Fixture: One checked preview followed by independent changes to whitespace, language, registry, provider controls, role bindings, nlConditionProfile, policy, and artifact digest. Change dependencyMode or effective project selection.
- Action: Compute PlanBindingV1 and validate each mutated exported preview against the current snapshot.
- Expected: Every content change invalidates snapshot or source binding. Equivalent ASTs with different source bytes have different source digests. Edited capability or profile JSON is rejected. The optionsDigest and effective snapshotDigest change together.

### T-M2-008

- Requirements: R-M2-008.
- Level: integration.
- Target: `packages/orchestration/src/pel-generation.test.ts`.
- Fixture: Fixture generation for gpt-6-astra/openai-responses with controls from snapshot, grammar mode auto without qualified grammar, returning {pelSource:"(+ 1 2)"}.
- Action: Run plan --prompt with selected credential profile in default and --json modes, and counterfixtures with unknown control keys or unsupported effort.
- Expected: Successful default and JSON modes exit 0. Default stdout is exact Pel source. JSON stdout has preview.finalValueSummary.kind="known" and preview.finalValueSummary.value={tag:"number",value:3}. One complete envelope request occurs. Invalid controls fail locally. No execution ledger or generated operation runs.

### T-M2-009

- Requirements: R-M2-009.
- Level: integration.
- Target: `packages/orchestration/src/pel-generation.test.ts`.
- Fixture: Fixture provider returns malformed Pel on attempt 0, a forbidden capability on attempt 1, and an unbounded dynamic call on attempt 2.
- Action: Run generatePelPlan with maxRepairs=2 and a finite generation budget.
- Expected: Exactly three generation calls have attempt IDs 0, 1, and 2. PEL_GENERATION_EXHAUSTED carries all diagnostics and cumulative usage. CLI exits 1 and dispatch count is zero.

### T-M2-010

- Requirements: R-M2-010.
- Level: integration.
- Target: `packages/orchestration/src/pel-generation.test.ts`.
- Fixture: Fake-clock deadlines, generation budget exhaustion, cancellation, refusal, and one fixture for every canonical ProviderFailure tag. Every tag uses the shared _tag,message,retryClass record and optional requestId,usage,fieldPath,providerIdentity,retryAfterMs fields.
- Action: Run generatePelPlan under an Effect scope and advance the fixture clock to each boundary.
- Expected: The Effect scope closes with no later request. Exhaustive tag handling preserves typed causes and usage. Fatal failures exit 1, cancellation exits 4, and local invalid selections exit 2.

### T-M2-011

- Requirements: R-M2-011.
- Level: acceptance.
- Target: `packages/orchestration/src/pel-authoring-cli.test.ts`.
- Fixture: Mixed positional/named fm/task call, unsupported model, unresolved branch, and unknown symbol near a registered function name.
- Action: Render human and JSON check/plan output for each fixture.
- Expected: Human output includes filename, line, column, caret range, cause, and useful signature. JSON preserves structured fields and unresolved reasons without invented success.

### T-M2-012

- Requirements: R-M2-012.
- Level: integration.
- Target: `packages/orchestration/src/pel-draft-session.test.ts`.
- Fixture: A draft session uses replace-expression, replace-suffix, replace-program, history, undo, completion, export, abort, and a run-bound continuation input.
- Action: Drive pel-draft-session through fixture readline input, including 101 small revisions and a large revision sequence.
- Expected: Each replacement creates a new digest, undo restores exact bytes, history stays within 100 revisions and 16 MiB, export writes source, and run-bound input returns PEL_DRAFT_EXECUTED.

### T-M2-013

- Requirements: R-M2-013.
- Level: acceptance.
- Target: `packages/orchestration/src/pel-authoring-cli.test.ts`.
- Fixture: M2-built checkout foreman.js and generated snapshot assets, implement-verify-review.pel, conditional.pel, parallel-read.pel, repair.pel, and separate repair-invalid.pel. No installer or M4/M5/M6 implementation is present.
- Action: Build M1/M2 and run node skills/foreman/runtime/dist/foreman.js check and plan for each checkout example.
- Expected: Valid examples exit 0 using the M2 declaration module. The negative repair fixture exits 2 with PEL_ARGUMENT_MODE. No provider or host handler executes, and installation is not required.

### T-M2-014

- Requirements: R-M2-014.
- Level: contract.
- Target: `packages/orchestration/src/pel-authoring-cli.test.ts`.
- Fixture: Installed default snapshot with complete registry/schema/provider/policy content, roleBindings, nlConditionProfile, and one altered content field without a changed digest. The effective selection overrides base role/predicate defaults within admitted bounds, and a mismatch counterfixture uses a different effective digest.
- Action: buildEffectiveAuthoringSnapshotV1, regenerate default snapshot from pel-host-descriptors.ts, and check role and predicate examples.
- Expected: Valid snapshot resolves exact profile, transport, controls, account reference, and finite schemas. Altered content fails with exit 2 before any provider or execution action. Generated snapshot bytes match the packaged asset. Configured check and run use one effective digest, while mismatched selections fail exit 2 before dispatch. Narrowed limits are identical in check, plan, and run, and attempted widening is rejected.

### T-M2-015

- Requirements: R-M2-015.
- Level: contract.
- Target: `packages/orchestration/src/pel-generation.test.ts`.
- Fixture: Prompt digest, snapshot digest, session nonce, attempt 1, account:test, no-tools policy, artifact references, and a GenerationBudgetPort reservation.
- Action: Construct GenerationRequest and lower through the fixture ProviderGenerationPort.
- Expected: Effect ID ends /attempt/1. Exact controls, credential reference, pinned template, artifacts, token/deadline limits, and generation reservation are present. Execution ledger call count is zero.

### T-M2-016

- Requirements: R-M2-001.
- Level: unit.
- Target: `packages/pel/test/analysis.test.ts`.
- Fixture: Unknown Boolean c with (if c (def x 1) (def x 2)) x, (if c (def x 1) 7) x, and known #t with (if #t (def x 1) 7) x.
- Action: checkPel each branch-definition fixture and render its command result.
- Expected: Both-branch definitions pass with exit 0 and a numeric summary. A one-branch definition followed by use returns PEL_CONDITIONAL_BINDING and exit 2 with branch spans. A provably selected definition passes with known value 1.

## M3: Exact model profiles and shared provider adapters

[OpenSpec](../../../openspec/changes/foredi-03-model-adapters/specs/foredi-03-model-adapters/spec.md) · [Implementation tasks](../../../openspec/changes/foredi-03-model-adapters/tasks.md)

### T-M3-001

- Requirements: R-M3-001.
- Level: unit.
- Target: `packages/providers/src/profiles.test.ts`.
- Fixture: Six-profile registry fixture and an unrecognized model alias.
- Action: resolveProfile for every declared ID and the alias.
- Expected: Exactly six profiles map to xai, anthropic, openai or google. The alias returns ModelUnavailable without dispatch.

### T-M3-002

- Requirements: R-M3-002.
- Level: unit.
- Target: `packages/providers/src/profiles.test.ts`.
- Fixture: Each declared effort outside the profile allowed set: Grok none/max, Opus none, Fable none, Astra none, Gemini none/xhigh/max. Sol accepts all declared efforts. Gemini minimal is an invalid enum decode case. Add prior thinking/sampling/tool-choice restrictions and nested unknown keys.
- Action: validateRequest for each invalid request and valid adjacent controls.
- Expected: Each rejected field returns UnsupportedCapability with exact fieldPath and zero dispatch. Minimal/unknown fields report decode stage in the safe message; valid-enum profile rejections report profile-validation. Defaults and explicit valid controls stay unchanged.

### T-M3-003

- Requirements: R-M3-003.
- Level: unit.
- Target: `packages/providers/src/registry.test.ts`.
- Fixture: A sourced profile with supported, unsupported, unknown and verified capability fields.
- Action: resolveRequest for an explicit model and transport.
- Expected: Resolved request retains all evidence identities and unknown fields. Unverified required capabilities return CapabilityUnverified.

### T-M3-004

- Requirements: R-M3-004.
- Level: contract.
- Target: `packages/providers/src/transport-contract.test.ts`.
- Fixture: All four API and four native transport fixtures, including an equal textual response ID and session ID.
- Action: encodeRequest and decodeIdentity for each fixture.
- Expected: Discriminated identities retain provider, exact model, transport and API revision or CLI version. Equal strings do not compare as equal identities.

### T-M3-005

- Requirements: R-M3-005.
- Level: contract.
- Target: `packages/providers/src/native-prompt.test.ts`.
- Fixture: UTF-8 prompt containing newlines, quotes, dollar signs and 128 KiB content. Fixtures declare stdin, file or protocol input.
- Action: start each native fake process or protocol peer and capture delivered bytes.
- Expected: Prompt hashes match for each channel. Stdin bytes reach the launcher. An unsupported channel returns PromptChannelUnsupported before spawn.

### T-M3-006

- Requirements: R-M3-006.
- Level: contract.
- Target: `packages/providers/src/transport-contract.test.ts`.
- Fixture: Native fixture lacks permission round trips or schema output. API fixture lacks grammar support.
- Action: start with each required capability and inspect captured process/API calls.
- Expected: UnsupportedCapability reports the missing field and zero dispatches. No headless, weaker schema or alternate model fallback occurs.

### T-M3-007

- Requirements: R-M3-007.
- Level: contract.
- Target: `packages/providers/src/events.test.ts`.
- Fixture: Per-transport started, text, tool, usage, checkpoint, completion, refusal, truncation, malformed and duplicate event fixtures.
- Action: decodeEvents with fragmented byte chunks and repeated cursors.
- Expected: Events use the shared vocabulary. Refusal remains refused, truncation becomes failed/OutputIncomplete, and duplicates retain deduplication identity without another tool dispatch.

### T-M3-008

- Requirements: R-M3-008.
- Level: contract.
- Target: `packages/providers/src/tools.test.ts`.
- Fixture: Host journal fixtures pel.tool.intent.v1/result.v1 and provider.cursor.v1 keyed by effectId, full identity and callId; two calls, denied/invalid calls and crash after result append.
- Action: Decode tool requests, persist bounded result payload, crash, load recorded cursor and resend ToolResultV1 content through sendToolResult.
- Expected: One committed tool effect occurs. The recorded payload is resent with its exact callId/content hash. Invalid and denied calls perform zero effects. Adapter storage I/O count is zero.

### T-M3-009

- Requirements: R-M3-009.
- Level: contract.
- Target: `packages/providers/src/output.test.ts`.
- Fixture: OutputSchemaV1 with immutable id and PelDataSchemaV1 content, reversed JSON field order, duplicate/unknown keys, missing required fields, null, numeric bounds and union variants. Include pelSource association and Boolean value envelope.
- Action: lowerProviderSchema for each profile subset, parse duplicate-aware raw JSON, decode in schema field order and validate against original Pel schema.
- Expected: Reversed JSON keys yield identical canonical association order and pass. Duplicate/unknown keys and invalid numbers fail OutputInvalid with fieldPath. Null becomes nil. Generation and Boolean envelopes round-trip. Unsupported required schema structure fails before dispatch.

### T-M3-010

- Requirements: R-M3-010.
- Level: contract.
- Target: `packages/providers/src/continuation.test.ts`.
- Fixture: OpenAI reasoning items, xAI encrypted thinking, Fable thinking blocks and Gemini Interactions thought steps with exact byte hashes.
- Action: encodeContinuation then resume with matching and changed model, transport and prefix.
- Expected: Matching round trips preserve hashes and tool IDs. Changed bindings return ContinuationMismatch. No opaque reasoning appears in text events or research exports. Opaque checkpoints emit bounded bytes/cursor to M4 and perform zero direct storage I/O.

### T-M3-011

- Requirements: R-M3-011.
- Level: contract.
- Target: `packages/providers/src/lifecycle.test.ts`.
- Fixture: OpenAI and Gemini asynchronous cancellation, xAI unverified remote cancellation, Claude SIGTERM versus interrupt, and a native process tree.
- Action: cancel under Effect scope with a fake clock, then observe terminal events.
- Expected: Local children exit within the configured cleanup bound. Remote outcome remains pending, unknown or unsupported until observed. No local signal fabricates remote cancelled.

### T-M3-012

- Requirements: R-M3-012.
- Level: contract.
- Target: `packages/providers/src/lifecycle.test.ts`.
- Fixture: Expired API ID, interrupted stream before receipt, Gemini in_progress interaction, and missing native session.
- Action: Observe existing identities, then resume only supported pending streams with their journal cursors.
- Expected: Expired state returns ResumeUnavailable. Completed observation carries validated result and terminal cursor. Not-found and unsupported remain OutcomeUnknown to the host. In-progress Google work is observed before chaining. New dispatch count is zero.

### T-M3-013

- Requirements: R-M3-013.
- Level: contract.
- Target: `packages/providers/src/readiness.test.ts`.
- Fixture: Installed old CLI, authenticated account, unavailable exact model and unknown permission capability.
- Action: probe using read-only fake commands and metadata endpoints.
- Expected: Each fact has independent value, evidence kind, observation time and safe diagnostic. No update, login or model workload runs in a metadata-only probe.

### T-M3-014

- Requirements: R-M3-014.
- Level: contract.
- Target: `packages/providers/src/readiness.test.ts`.
- Fixture: Timeout, network failure, changed banner, explicit signed-out response and explicit signed-in response.
- Action: probe and render diagnostic for each fixture.
- Expected: Uncertain responses report unknown. Only explicit signed-out evidence reports not-authenticated and login remediation. Secrets are absent from diagnostics.

### T-M3-015

- Requirements: R-M3-015.
- Level: contract.
- Target: `packages/providers/src/readiness.test.ts`.
- Fixture: A native CLI routes gpt-6-astra to another model, or provides no trustworthy identity metadata.
- Action: qualifyIdentity using protocol metadata rather than generated answer text.
- Expected: Mismatch returns ModelMismatch. Missing metadata remains unknown and unusable for exact-model qualification. No self-reported answer establishes identity.

### T-M3-016

- Requirements: R-M3-016.
- Level: contract.
- Target: `packages/providers/src/conformance.test.ts`.
- Fixture: Six profiles on each family API/native protocol, with codingTask unsupported on APIs and explicit negative fixtures for unsupported cells.
- Action: npm run test:providers after wiring the planned script to scripts/run-tests.ts.
- Expected: Fixture report covers every declared cell, chunk boundaries, limits, tools, refusal, malformed output, continuity and cancellation. Unsupported cells have negative tests. Typechecking and dependency lint assert no providers-to-orchestration or Pel-to-providers import. CLI tests reside in orchestration.

### T-M3-017

- Requirements: R-M3-017.
- Level: acceptance.
- Target: `packages/orchestration/src/pel-provider-qualification.test.ts`.
- Fixture: M2 fixture manifest template packages/providers/src/fixtures/qualification/fixture-manifest.json copied to temporary storage with assetRoot/assetManifestSha256, fake credential port, protocol peers and qualification bounds. No live account is selected.
- Action: node packages/orchestration/dist-test/pel-cli-fixture.js --fixture-manifest <manifest.json> providers qualify --profile <exact-id> --transport <id> --limits qualification.json
- Expected: Report records observed identity, versions, source/profile hashes, requested and observed lifecycle outcomes, usage and failures. Cap exhaustion stops the cell without widening limits. Successful qualification exits 0. Invalid selected account/profile/controls/limits exits 2. A completed failed capability check exits 1. Admitted remote uncertainty exits 3. Confirmed cancellation exits 4. Every credential access uses the injected fake port. Any network or live-account access fails the deterministic test. Real qualification is outside npm test.

### T-M3-018

- Requirements: R-M3-018.
- Level: contract.
- Target: `packages/orchestration/src/pel-provider-list.test.ts`.
- Fixture: Documented-only, fixture-only, current live-qualified, expired and changed-version evidence records.
- Action: node packages/orchestration/dist-test/pel-cli-fixture.js --fixture-manifest <manifest.json> providers list --json, then admitCell through injected services
- Expected: Only exact current live evidence labels a product capability live-qualified. Documented-only, fixture-only, expired and mismatched evidence fail product admission. Test-layer cells display test-fixture, never live-qualified. Successful listing exits 0 even when it displays unavailable or stale cells. Invalid registry schema exits 2 and registry read/output failure exits 1.

### T-M3-019

- Requirements: R-M3-019.
- Level: contract.
- Target: `packages/providers/src/generation.test.ts`.
- Fixture: M2 GenerationRequest with generationId, attempt, credentialProfileRef, generationBudgetReservationRef, exact modelProfileId/transportId/controls, grammar selection, pinned prompt template, catalog and bounded artifacts.
- Action: ProviderGenerationPort.generate with supported grammar, envelope-only, invalid envelope and 1 MiB overflow fixtures.
- Expected: One request per call uses effectId generationId/attempt/attempt-index, original reservation, toolPolicy/toolChoice none and validated envelope. No adapter repair/execution occurs. Unsupported grammar fails explicitly. ProviderRequestV1 includes opaque credentialProfileRef and outputSchema {id,content}; no secret bytes or execution-ledger call occurs.

### T-M3-020

- Requirements: R-M3-020.
- Level: contract.
- Target: `packages/providers/src/usage.test.ts`.
- Fixture: Each profile has cache-read/write counters, dated pricing metadata, long-context thresholds and missing cost fields. Requests exhaust tokens, time and tool bounds.
- Action: Normalize usage and run each bounded stream under a fake clock and recording host reservation port.
- Expected: Observed counters and price identity survive normalization. Unknown cost remains unknown with conservative reservation. Limits stop the stream without widening budget or silently retrying.

### T-M3-021

- Requirements: R-M3-021.
- Level: contract.
- Target: `packages/providers/src/controls.test.ts`.
- Fixture: Every profile with omitted controls and explicit overrides, invalid nested keys, and unsupported background/store settings.
- Action: resolveControls then encodeRequest and inspect preview/request bindings.
- Expected: Resolved controls contain all five closed fields. Defaults match design.md. Invalid combinations fail before dispatch and controls cannot silently change.

### T-M3-022

- Requirements: R-M3-022.
- Level: contract.
- Target: `packages/providers/src/observation.test.ts`.
- Fixture: OpenAI background completion, pending Google interaction, cancelled native turn, missing identity and unsupported xAI reconcile fixtures.
- Action: observe(identity), then deliver resulting events to a recording host.
- Expected: Results are pending, completed with validated payload, cancelled, not-found or unsupported. Late cancellation can be observed. No start call occurs.

### T-M3-023

- Requirements: R-M3-023.
- Level: contract.
- Target: `packages/providers/src/admission.test.ts`.
- Fixture: Required identity/tool/schema/cancellation capability set with documented-only, fixture-only, matching live, expired live and test-fixture evidence.
- Action: admitCell under product and TestFixtureProviderLayer bindings.
- Expected: Product admission accepts only matching current live evidence. Explicit test bindings may accept matching fixtures but never emit live-qualified evidence or product authority.

### T-M3-024

- Requirements: R-M3-024.
- Level: contract.
- Target: `packages/providers/src/transport-selection.test.ts`.
- Fixture: Eight canonical transport IDs, one profile with two allowed mappings, an explicit selector, API coding request and native review lacking tool denial.
- Action: resolveTransport and validate ToolPolicyV1 before task/review dispatch.
- Expected: Unselected ambiguous mapping fails. Explicit mapping stays exact. API coding and unenforceable native review fail without fallback. Native coding carries workspace and permission grants.

### T-M3-025

- Requirements: R-M3-025.
- Level: contract.
- Target: `packages/providers/src/errors.test.ts`.
- Fixture: M2 generation and provider retry consumers compile against one ProviderFailure record: required _tag/message/retryClass and optional requestId/usage/fieldPath/providerIdentity/retryAfterMs. Retry arguments include quoted data keys, quoted whole-list syntax and unquoted nil-pair lists.
- Action: Compile shared error-record fixtures, exhaustively classify tags and decode :on [':rate-limited ':transport-disconnected].
- Expected: Only RateLimited and TransportDisconnected are transient. Quoted key values decode correctly; whole-list syntax and nil-pair lists fail before retry-body evaluation. M2 alone creates errors.ts, all consumers use the same optional fields.

### T-M3-026

- Requirements: R-M3-026.
- Level: acceptance.
- Target: `packages/orchestration/src/pel-provider-cli.test.ts`.
- Fixture: Table-driven provider list and qualification cases from design.md Command outcomes, with recorded services, invalid inputs, failed assertions, remote uncertainty and confirmed cancellation.
- Action: node packages/orchestration/dist-test/pel-cli-fixture.js --fixture-manifest <manifest.json> providers <list-or-qualify> with injected recorded services for every outcome
- Expected: List with unavailable rows exits 0. Invalid input exits 2, failed qualification 1, uncertain admitted remote work 3 and confirmed cancellation 4. No final pending 5 or fabricated live evidence appears.

### T-M3-027

- Requirements: R-M3-027.
- Level: contract.
- Target: `packages/providers/src/credentials.test.ts`.
- Fixture: Fake CredentialPort with scoped redacted material and exact credentialProfileRef on start/resume/observe identities.
- Action: Run credential-port fixtures, source dependency lint and npm run typecheck.
- Expected: All requests use the selected reference without secret serialization. Credential scopes release leases. Providers never imports orchestration and Pel never imports providers.

### T-M3-028

- Requirements: R-M3-028.
- Level: contract.
- Target: `packages/providers/src/output-codec.test.ts`.
- Fixture: Immutable schema ID/content pairs, provider subset fixtures and reordered/duplicate/malformed output envelopes.
- Action: lowerProviderSchema then decodeProviderOutput and validateFinal.
- Expected: Canonical schema order is stable across JSON key order. Invalid keys/types/bounds fail with field paths. Unsupported required schema structure performs zero dispatch.

### T-M3-029

- Requirements: R-M3-029.
- Level: integration.
- Target: `packages/providers/src/transports/api-transports.test.ts`.
- Fixture: Each admitted API dialect with its exact controls, an admitted none tool policy, injected fixture credentials and protocol peers that produce complete, refused, incomplete, mismatched-identity, tool and unrecognized-output exchanges.
- Action: Start each dialect, inspect the serialized request body and started event, and run the live qualification assessment over the observed events in packages/orchestration/src/pel-provider-live.test.ts.
- Expected: The started event reports observedToolPolicy none only after an empty or omitted serialized tool surface and an exact established response identity. Automatic tool choice, cursor replay, refusal, incomplete output, identity mismatch, tool activity and an unknown outcome produce no no-tool evidence. Both the streaming and complete-response decoders reject function, tool and server-tool activity and fail closed on unrecognized action-bearing output. Request-side enforcement never substitutes for the separate native empty-catalog observation.

## M4: Execute and recover Pel programs

[OpenSpec](../../../openspec/changes/foredi-04-durable-execution/specs/foredi-04-durable-execution/spec.md) · [Implementation tasks](../../../openspec/changes/foredi-04-durable-execution/tasks.md)

### T-M4-001

- Requirements: R-M4-001.
- Level: integration.
- Target: `packages/orchestration/src/pel-runner.test.ts`.
- Fixture: A configured temporary Git repository has Git-common-dir/foreman/project.json with existing fixture authority, exact role pairs, finite limits, and a deterministic host program. The checkout has no installation prefix. Variants change project role/predicate selections, provide a stale checked effective snapshot, alter one executable descriptor, or supply an unregistered --state-root.
- Action: Invoke node packages/orchestration/dist-test/pel-cli-fixture.js --fixture-manifest fixture-manifest.json run fixture.pel --json without --binding or --state-root. Start a competing owner for its emitted run ID. Repeat with missing and invalid settings.
- Expected: Derived binding matches project, repository, snapshot, authority, paths, limits, gates, roles, and required milestones. One owner dispatches once. Competing owner and missing/invalid settings exit 2 with zero competing dispatch. The attached run emits run-started on stderr before dispatch and one final result on stdout. Check/plan/run derive one effective snapshot from the same base and project selection. Exact roles, predicate and narrowing limits agree. Stale contexts or descriptor digest mismatches exit 2 before dispatch. Configure requires no M6 prefix. Unregistered run/resume root overrides exit 2.

### T-M4-002

- Requirements: R-M4-002.
- Level: integration.
- Target: `packages/orchestration/src/pel-effects.test.ts`.
- Fixture: A checked conditional supplies a path whose resolveResources output escapes its finite admitted workspace, despite a valid static descriptor.
- Action: Resume the evaluator and inspect ledger and provider invocation spies.
- Expected: resource-denied identifies the source span and actual canonical resolver output. No action reservation or provider call occurs. Symlink alias and replaced-parent variants also fail containment.

### T-M4-003

- Requirements: R-M4-003.
- Level: integration.
- Target: `packages/orchestration/src/pel-journal.test.ts`.
- Fixture: A host result is an association list. Automatic pel.suspension.v1 persisted its continuation and counters before dispatch, without an explicit fm/checkpoint. Stop after result append.
- Action: Execute, restart from the same journal, and evaluate the next native pipe expression.
- Expected: Pel records are suspension, combined intent containing preparation digest and existing reservation reference, observation, result. The existing ledger reservation precedes intent but is not a separate Pel record. Read-only reuse has suspension/result. Recoverable needs-action has suspension/observation and remains pending. Decoder enumerates all declared types including output and child records. Recovery returns identical Pel data with one dispatch and unchanged committed counters.

### T-M4-004

- Requirements: R-M4-004.
- Level: integration.
- Target: `packages/orchestration/src/pel-recovery.test.ts`.
- Fixture: Table fixtures stop before reservation, after reservation, after dispatch without provider ID, after external completion, during fake verification, and during cleanup.
- Action: For each fixture run resumeProgram with observed-complete, confirmed-no-dispatch, or unavailable provider reconciliation.
- Expected: Budgets never increase. No completed receipt is re-executed. Reservation-without-intent reuses its stable key. Missing external evidence yields needs-action with unknown outcome, even without provider identity. Saved reduction/iteration counters restore exactly at the durable boundary.

### T-M4-005

- Requirements: R-M4-005.
- Level: unit.
- Target: `packages/orchestration/src/pel-journal.test.ts`.
- Fixture: One journal repeats an identical result. Another repeats its effect identity with a different canonical result hash.
- Action: Call replayPelRun on both journals.
- Expected: Identical delivery yields one result. Conflicting delivery returns journal-corrupt before continuation or provider dispatch.

### T-M4-006

- Requirements: R-M4-006.
- Level: integration.
- Target: `packages/orchestration/src/pel-resource-scope.test.ts`.
- Fixture: Source order contains three do/async expressions with completion barriers in reverse order and a concurrency limit of two. A second program uses do.
- Action: Evaluate both programs with the instrumented host registry.
- Expected: do dispatches in source order. do/async never exceeds two active effects and returns the last source expression result. After a partial receipt, alreadyEmitted requests join pending effects without duplicate dispatch. Aggregate counters include all child work.

### T-M4-007

- Requirements: R-M4-007.
- Level: integration.
- Target: `packages/orchestration/src/pel-resource-scope.test.ts`.
- Fixture: Independent symbols write one worktree through its real path and a symlink alias. Additional requests declare read/read and unknown resources.
- Action: Evaluate native do/async and record acquisition intervals.
- Expected: Conflicting writes and unknown workspace effects never overlap. Independent reads can overlap. All permits release after failure.

### T-M4-008

- Requirements: R-M4-008.
- Level: integration.
- Target: `packages/orchestration/src/pel-control-functions.test.ts`.
- Fixture: Two fm/task closures have finite M2 effect envelopes and a workspace pool with two grants. They complete on one clock tick. A loser reports unsupported remote cancellation. A negative fixture writes a shared external path. Crash while a contender is suspended, and again after contender one completes but before winner decision. Run another variant with maxConcurrentEffects equal to one.
- Action: Invoke fm/race with first-valid policy through the fixture host registry. Inspect resolver output, allocation events, result value, child counters, and cancellation after its observation window.
- Expected: Both canonical worktree IDs are distinct before provider dispatch. Ties select source index one. Result keys are exactly winner-index,value,losers with no duplicates. Each child request includes parent/race/index. Losing counters are charged once. Shared external writes reject before provider calls. Unknown loser outcome remains visible and its artifacts cannot become winner inputs. Child continuation, worktree grant, tranche/debit, canonical closure-argument digest and pending receipt IDs restore exactly. Resume allocates zero replacement worktrees, does not repeat completed effects, and commits one durable race decision. Wrapper holds no concurrency permit while children run, so concurrency one terminates.

### T-M4-009

- Requirements: R-M4-009.
- Level: integration.
- Target: `packages/orchestration/src/pel-control-functions.test.ts`.
- Fixture: The canonical ProviderFailure union is table-driven. RateLimited fails first and succeeds next under fm/retry :attempts 2 :on [':rate-limited ':transport-disconnected]. Restart after attempt one. Counterfixtures exhaust the bound, report AuthenticationRequired, or fail with an ordinary Pel diagnostic. Add two nested effects, crash during attempt two suspension, and pass syntax-valued and nil-pair :on lists to the host decoder.
- Action: Evaluate the retry closure and inspect child request IDs, effect IDs, tagged PEL_HOST_FAILURE causes, reservation action kinds, and cumulative counters. Compile exhaustive union switches.
- Expected: Only RateLimited and safely reconcilable TransportDisconnected can retry. Child IDs parent/retry/1 and parent/retry/2 and their nested effect IDs differ. Attempt one receipt cannot complete attempt two. Retry charges provider_retry once and does not recharge implement. Authentication and language failures get zero retries. Exhaustion is failed exit 1 with original deadlines/counters preserved. Accepted selectors are evaluated lists of quoted keys. Syntax and nil-pair lists return capability-denied before body execution. RetryContext carries attempt index and a logical key excluding the parent /retry/N segment. Each matching nested key charges provider_retry on attempt two only. Child continuation, pending requests, tranches and stable closure digest recover without duplicate dispatch.

### T-M4-010

- Requirements: R-M4-010.
- Level: integration.
- Target: `packages/orchestration/src/pel-runner.test.ts`.
- Fixture: A scoped child process stalls. Its provider accepts cancellation but reports no terminal outcome.
- Action: Advance the injected clock beyond the admitted timeout and await local cleanup.
- Expected: After finite observation-window expiry and confirmed local cleanup, state is exactly needs-action, exit 3, with externalOutcome unknown. Unsupported xAI-style cancellation has the same result and cannot remain pending indefinitely. A local-only cancellation confirms cancelled after cleanup.

### T-M4-011

- Requirements: R-M4-011.
- Level: acceptance.
- Target: `packages/orchestration/src/pel-authoring-cli.test.ts`.
- Fixture: An attached fixture run emits its run-started stderr event before provider work completes. The provider yields requested, acknowledged, then confirmed-cancelled under barriers. A second provider remains unsupported through the finite observation window.
- Action: Read runId from the startup event, invoke the compiled fixture cancel command twice and status concurrently, then release confirmation or advance the observation clock.
- Expected: The attached run remains active until the result. One cancellation intent exists. Pending status/cancel exit 5. Confirmed cleanup/cancellation exits 4. Unsupported outcome after the window exits 3 with unknown outcome. Final stdout is one JSON result containing the same runId.

### T-M4-012

- Requirements: R-M4-012.
- Level: integration.
- Target: `packages/orchestration/src/pel-recovery.test.ts`.
- Fixture: A closure captures a list, completes one host effect, checkpoints, and stops before the next expression.
- Action: Decode the stored checkpoint and call resumeProgram using the same runtime and profile.
- Expected: The list and closure capture survive as AST/environment data. Prior receipts replay without calls. All budget counters match their previous values.

### T-M4-013

- Requirements: R-M4-013.
- Level: integration.
- Target: `packages/orchestration/src/pel-recovery.test.ts`.
- Fixture: A fake OpenAI background response completes before receipt append. observe returns completed with validated content. A second xAI fixture returns unsupported and a third returns not-found.
- Action: Resume with ProviderTransport.observe using the existing identity only. For unsupported and not-found cases submit matching and mismatching PelRecoveryDecisionV1 evidence.
- Expected: Completed observation records one result receipt with zero redispatch. Unsupported and not-found stay needs-action exit 3 without inferring no dispatch. Mismatched evidence fails. Valid bound evidence resolves only its effect and preserves reservations. Unknown outcomes never supply a terminal M1 receipt. The request remains pending. accept-result drives the evaluator to done with zero redispatch; confirm-no-dispatch uses its existing reservation; abandon supplies a terminal reconciliation-abandoned receipt.

### T-M4-014

- Requirements: R-M4-014.
- Level: integration.
- Target: `packages/orchestration/src/pel-recovery.test.ts`.
- Fixture: Immutable source has one completed whole top-level form and one unexecuted suffix. Revision variants change only the suffix, change completed arguments, or edit inside a partially completed form. A pure failed suffix consumes four reductions after a completed prefix consuming ten, and its failed-step record is durable.
- Action: Validate PelRevisionDecisionV1 and PelRevisionMappingV1, then re-evaluate revised immutable source from the start and supply mapped old receipts under new request IDs.
- Expected: Valid suffix revision persists old-to-new request/node aliases while retaining parent effect IDs and reservations. Completed dispatch count stays one and prefix counters match the recorded boundary. New suffix gets new IDs. Changed completed arguments or partial-form edits fail continuation-incompatible, exit 2, before dispatch. PelRunOptions carries prefix recordedCounters and total committedCounters. Replay validates the prefix separately, then starts revised suffix charged fourteen reductions, including the failed work. New suffix work adds to that total under original limits. A failed form without completed external effects can be replaced; a form with completed effects cannot.

### T-M4-015

- Requirements: R-M4-015.
- Level: acceptance.
- Target: `packages/orchestration/src/pel-authoring-cli.test.ts`.
- Fixture: Table journals cover every M4 base and registered M5 failure code, every M3 provider failure tag, all ordinary needs-action results, missing admission inputs, and pending/confirmed cancellation. Delivery result-contract cases include valid correction-limit data without audit/publication milestones, malformed duplicate/extra-key lookalikes, approved data with missing host evidence, and a generic-bound status-like list.
- Action: Run product-router status text/JSON projections with provider calls forbidden and table-test run/resume admission plus post-admission mapping.
- Expected: Each state and exact exit matches the normative failure tables: 0 success,1 failed,2 invalid,3 needs-action,4 cancelled,5 pending. Text/JSON agree on source span, evidence, reserved usage, unknown cost, and next action. No provider call or secret disclosure occurs. Valid delivery-needs-action exits 3 even without audit/publication milestones. Malformed bound final values fail final-result-invalid exit 1. Approved data with an unmet host milestone exits 3. Generic-bound data is not classified by a status-like key.

### T-M4-016

- Requirements: R-M4-016.
- Level: integration.
- Target: `packages/orchestration/src/pel-recovery.test.ts`.
- Fixture: Fixtures contain unordered sequence, wrong attempt, changed runtime profile, incompatible continuation, and live foreign owner lease.
- Action: Call resumeProgram for each fixture and collect result diagnostics.
- Expected: Each fails before host dispatch with journal-corrupt, binding-mismatch, continuation-incompatible, or owner-busy and a source or evidence reference.

### T-M4-017

- Requirements: R-M4-017.
- Level: integration.
- Target: `packages/orchestration/src/pel-recovery.test.ts`.
- Fixture: Start a fixture run, then edit its source file and replace the installed default snapshot. Other variants remove or alter the journal-bound source or registry artifact.
- Action: Resume without an explicit checkpoint using saved pel.suspension.v1 and later result receipts.
- Expected: Working-file and default-snapshot edits do not change the resumed program. Missing or mismatched bound artifacts return binding-mismatch exit 2 before dispatch. Saved counters match the durable boundary. Snapshot optionsDigest matches dependency mode, exact predicate selection, effective narrowed limits, and replay options. An executable registry differing from the stored effective snapshot fails binding-mismatch before dispatch.

### T-M4-018

- Requirements: R-M4-018.
- Level: integration.
- Target: `packages/orchestration/src/pel-provider-tools.test.ts`.
- Fixture: A provider requests one allowed tool. Crash after pel.tool.result.v1 append and before sendToolResult. The stream restarts from the saved cursor and repeats the call ID. A negative variant changes arguments under that key.
- Action: Resume the provider using pel.provider.cursor.v1, resolve recorded ToolResultV1 content, and feed duplicate tool events.
- Expected: Tool execution count stays one. Recorded content/hash and authority are resent. Cursor advances only after durable tool/result/checkpoint state. Changed arguments yield journal-corrupt. Checkpoint bytes are persisted by M4, never by the adapter.

### T-M4-019

- Requirements: R-M4-019.
- Level: integration.
- Target: `packages/orchestration/src/pel-effects.test.ts`.
- Fixture: Preparation variants select verification reuse, missing publication grant, task dispatch, authorized publication, and transient retry. Each operation exposes ledger and handler spies. Add a fresh bounded research-style read-result without a prior receipt and V1/V2 natural-language predicate authority fixtures.
- Action: Call prepareHostEffect then the M4 dispatcher for all variants.
- Expected: Reuse and missing grants add zero reservations. Task and authorized publication add exactly one matching action. Retry adds one provider_retry without a second implement charge. Handlers cannot reserve again or dispatch with a mismatched token. Fresh read-result validates and journals data with zero reservation and no required prior receipt. Stable IDs use existing ReserveAction.reservationId, not a new ledger key. A V2 evaluation child reserves evaluate; a V1-only predicate binding exits 2 before dispatch.

### T-M4-020

- Requirements: R-M4-020.
- Level: integration.
- Target: `packages/orchestration/src/pel-native-host.test.ts`.
- Fixture: A native case uses a string condition under the bound nlConditionProfile, then print emits its selected result. Stop after receipt append and run with --json.
- Action: Execute and resume through the compiled fixture CLI with the exact registered bounded-data/Boolean schemas.
- Expected: The selected predicate profile/transport appears in the request. One predicate result and one output event persist. Replay makes zero repeated provider calls or print events. Stdout contains one final JSON object. Predicate output cannot authorize publication. Print with vals [1 2] returns [1 2], and recovery returns the identical value without another output event.

### T-M4-021

- Requirements: R-M4-021.
- Level: acceptance.
- Target: `packages/orchestration/src/pel-cli-fixture.test.ts`.
- Fixture: The M2-owned fixture main is side-effect-free in pel-cli-fixture-main.ts, invoked only by test/pel-cli-fixture-entry.ts. Real assertions live in pel-cli-fixture.test.ts. A manifest binds copied assetRoot and assetManifestSha256.
- Action: From a clean checkout run npm run verify, whose pretest builds the fixture bundle. Run the fixture CLI with mandatory --fixture-manifest, then product foreman.js with the same flag and fixture binding. Run a copied-asset variant.
- Expected: Test globs select the real test, never a CLI entry. Fixture build completes before dependent tests. Copied assets resolve below manifest assetRoot with matching hashes. Missing manifest or wrong asset hash exits 2. Production rejects fixture flag/binding with zero dispatch. No fixture entry or recorded Layer appears in installation assets or live-qualified evidence.

### T-M4-022

- Requirements: R-M4-022.
- Level: integration.
- Target: `packages/orchestration/src/pel-journal.test.ts`.
- Fixture: A valid nested Pel result has depth 65 and a valid continuation exceeds one physical journal line. Tool content reaches its admitted limit. Faults stop after blob flush, corrupt a referenced blob, or remove a child continuation blob.
- Action: Persist through existing artifact storage and unchanged RunJournal bounds, then resume from each fault boundary.
- Expected: All journal records remain within 1048576 bytes, depth 64, 100000 nodes, and the 64 MiB replay budget. Deep values use references. Unreferenced blobs do not commit results. Missing/corrupt referenced blobs yield binding-mismatch and zero dispatch.

### T-M4-023

- Requirements: R-M4-023.
- Level: integration.
- Target: `packages/orchestration/src/pel-run-result.test.ts`.
- Fixture: A delivery-final schema binding receives valid needs-action, approved, duplicate-key, extra-key, and unknown-status results. A generic binding receives a status-like list.
- Action: Call the final-result projector against each result and matching or missing milestone receipts.
- Expected: Valid delivery-needs-action is exit 3 independently of milestone selection. Malformed typed results fail final-result-invalid exit 1. Unmet host milestones prevent success. Generic data is not interpreted as a delivery discriminator.

## M5: Deliver verified and reviewed candidates from Pel

[OpenSpec](../../../openspec/changes/foredi-05-task-delivery/specs/foredi-05-task-delivery/spec.md) · [Implementation tasks](../../../openspec/changes/foredi-05-task-delivery/tasks.md)

### T-M5-001

- Requirements: R-M5-001.
- Level: integration.
- Target: `packages/orchestration/src/pel-host-task.test.ts`.
- Fixture: A recorded test-fixture Grok native transport writes one allowed TypeScript file in a distinct admitted worktree and supplies candidate-v1 structured output.
- Action: Execute fm/task through runProgram and pass its result into a native Pel lookup.
- Expected: The request resolves grok-4.6 plus grok-acp, exact admitted controls, credential reference, and path/tool policy. The host result has the ordered unique task schema keys and real manifest hashes. Native lookup returns the correct status. An API-only task pair fails admission before file work. The handler registry imports M2 pel-host-descriptors.ts; any altered ArgSpec/schema/resolver digest causes binding-mismatch exit 2. Provider candidate-v1 contains only untrusted summary, claimedPaths and findings; host capture supplies authoritative candidate identity. Reversed provider JSON key order decodes through the M3 schema codec into the same canonical Pel association. Unknown/duplicate fields fail. The exact opaque credentialProfileRef reaches the injected CredentialPort without secret bytes in receipts.

### T-M5-002

- Requirements: R-M5-002.
- Level: integration.
- Target: `packages/orchestration/src/pel-host-task.test.ts`.
- Fixture: Three providers return malformed structured output, claim nonexistent artifacts, or modify a path outside the admitted set.
- Action: Execute fm/task for each fixture and inspect recorded results and artifact reads.
- Expected: task-output-invalid, artifact-missing, or candidate-out-of-scope identifies the source call. No verification or release milestone is registered.

### T-M5-003

- Requirements: R-M5-003.
- Level: integration.
- Target: `packages/orchestration/src/pel-host-verify.test.ts`.
- Fixture: An immutable candidate C has a registered argv gate and environment digest E. Provider text falsely claims all checks pass.
- Action: Invoke fm/verify with gate outcomes pass and fail, then decode both receipts.
- Expected: The host gate determines pass and fail, never provider prose. Each receipt binds exact candidate/environment/gate/attempt/report. Failed result lookup :status is verification-failed and :passed is #f. Passing :passed is #t. The association schema rejects duplicate/additional keys. Nested prior evidence cannot shadow status or findings.

### T-M5-004

- Requirements: R-M5-004.
- Level: integration.
- Target: `packages/orchestration/src/pel-host-verify.test.ts`.
- Fixture: Candidate C has one valid verification receipt. Table variants change C, environment, gate, policy, or freshness.
- Action: Call fm/verify twice unchanged, then call each changed fixture with an admitted verification allowance.
- Expected: Unchanged call reuses one receipt with one gate execution and zero additional verification reservations. Each changed binding requires one fresh verify reservation and cannot reuse the old pass. Candidate-result receipt replay itself never adds another reservation.

### T-M5-005

- Requirements: R-M5-005.
- Level: integration.
- Target: `packages/orchestration/src/pel-host-verify.test.ts`.
- Fixture: A gate mutates a candidate file during its run. A second fixture crashes after check execution but before receipt persistence.
- Action: Invoke fm/verify, then resume the interrupted run with M4 recovery.
- Expected: Mutation returns candidate-changed. Interrupted verification yields recovered host evidence or needs-action, never an inferred pass or duplicated completed provider implementation.

### T-M5-006

- Requirements: R-M5-006.
- Level: integration.
- Target: `packages/orchestration/src/pel-host-review.test.ts`.
- Fixture: Candidate C records xAI implementation. Sol reports observed OpenAI identity. A counterfixture requests another xAI model for review.
- Action: Invoke fm/review using independent-review policy for both fixtures.
- Expected: Sol review binds the exact candidate and verification result to observed OpenAI identity and enforced toolPolicy none. Same-vendor review returns review-not-independent with no audit milestone. Result fields are unique and approved is Boolean. Failed incoming verification returns unverified without reserving an audit.

### T-M5-007

- Requirements: R-M5-007.
- Level: integration.
- Target: `packages/orchestration/src/pel-host-review.test.ts`.
- Fixture: An old approved report exists before a new review attempt. New variants refuse, stop, return malformed output, or reference another candidate.
- Action: Start fm/review, inspect in-progress state, then complete or interrupt each variant.
- Expected: The old approval cannot authorize the new attempt. Each variant yields unverified with current attempt evidence and no publication eligibility.

### T-M5-008

- Requirements: R-M5-008.
- Level: acceptance.
- Target: `packages/orchestration/src/pel-delivery.test.ts`.
- Fixture: examples/pel/implement-verify-review.pel uses role:implementer and role:reviewer. packages/orchestration/src/fixtures/pel-adoption/project-settings.json configures Grok grok-4.6/grok-acp and Sol gpt-5.6-sol/openai-responses in an injected test-fixture Layer. The packaged examples/pel/project-settings.json remains an operator placeholder template. The fixture manifest explicitly binds its checkout or copied-install asset root.
- Action: Configure the temporary project once, then run node packages/orchestration/dist-test/pel-cli-fixture.js --fixture-manifest fixture-manifest.json run examples/pel/implement-verify-review.pel --json without binding overrides. Repeat after changing only roleBindings to another admitted independent pair.
- Expected: Both runs execute identical source/control flow with changed snapshot/binding digest. Each produces a real candidate, one host verification, independent review, and matching receipt chain. Resolved exact transport/control identities appear in preview/results. Evidence stays test-fixture, never live-qualified. Successful delivery exits 0. Project selection is applied once to the immutable base snapshot by buildEffectiveAuthoringSnapshotV1; preview/run role and predicate identities match the newly derived effective snapshot.

### T-M5-009

- Requirements: R-M5-009.
- Level: acceptance.
- Target: `packages/orchestration/src/pel-delivery.test.ts`.
- Fixture: The exact recursive examples/pel/repair-and-publish.pel source receives correction limit N, one current result, and an explicit round counter. Variants approve after one correction, exhaust N corrections, or make no product change.
- Action: Check the exact source with M2. Execute with the fixture CLI and count task, verify, review, publication, and ledger actions.
- Expected: Approval after one correction executes exactly two tasks and no further correction. Exhaustion executes N+1 tasks including initial implementation. No-change stops immediately after its correction. Both counterfixtures return unique-key delivery-needs-action data and exit 3 before further dispatch. Changed candidates receive fresh evidence. No for loop or private retry loop carries repair state. The binding declares schema:delivery-final-v1. Counterfixtures still exit 3 with no audit/publication milestones. Duplicate/extra-key needs-action lookalikes fail final-result-invalid exit 1 rather than being trusted by string shape.

### T-M5-010

- Requirements: R-M5-010.
- Level: acceptance.
- Target: `packages/orchestration/src/pel-delivery.test.ts`.
- Fixture: The Grok effect has a durable receipt and the process stops before verification or during review.
- Action: Run compiled resume RUN against each fixture journal.
- Expected: Grok dispatch remains one. Completed verification is reused without another reservation. Only unresolved review/effects reconcile or continue. Saved evaluator counters and budgets remain spent. Editing the original source file cannot alter the immutable resumed workflow.

### T-M5-011

- Requirements: R-M5-011.
- Level: integration.
- Target: `packages/orchestration/src/pel-host-publish.test.ts`.
- Fixture: Candidate C has passing checks and independent review. Binding lacks publish permission. A malicious result contains an approved flag and fabricated receipt.
- Action: Invoke fm/publish against a temporary bare remote and inspect its refs. Then register matching existing publication authority for the same admitted envelope and resume the pending request.
- Expected: Status is needs-action, exit 3, with prepared exact evidence and required authority reference. Remote refs and integration state remain unchanged. Ledger spies show zero publish/integrate reservations. Fabricated approval/receipt data cannot grant authority. Initial needs-action is a pending observation, not an M1 result receipt. After matching authority appears, re-preparation adds exactly one publish reservation and publication call, with zero task, verification or review redispatch.

### T-M5-012

- Requirements: R-M5-012.
- Level: integration.
- Target: `packages/orchestration/src/pel-host-publish.test.ts`.
- Fixture: A fixture grant authorizes candidate C to update one bare-remote ref from expected OID B. Variants mutate C, target ref, or evidence before commit.
- Action: Invoke fm/publish with the prepared binding under the destination resource lock.
- Expected: Valid publication adds exactly one publish reservation, updates only the admitted ref, and records the observed receipt. Changed candidate, target, or evidence fails before mutation. Handlers do not reserve a second action or implicitly integrate. Unsupported destination returns its typed failure.

### T-M5-013

- Requirements: R-M5-013.
- Level: integration.
- Target: `packages/orchestration/src/pel-host-publish.test.ts`.
- Fixture: A local bare remote accepts C, then the provider boundary loses acknowledgement before the durable receipt. Observation is available or unavailable by fixture.
- Action: Resume the run with PublicationService.observe and inspect publication command counts.
- Expected: Available observation records confirmed C without republishing. Unavailable observation remains needs-action and unknown. Both execute the publication command once. Unknown publication keeps its evaluator request pending. Completed observation supplies one success receipt and continues to the published final value; it does not attempt to resume an already failed or consumed request.

### T-M5-014

- Requirements: R-M5-014.
- Level: acceptance.
- Target: `packages/orchestration/src/pel-delivery-result.test.ts`.
- Fixture: Fixture journals contain delivered candidate, verification failure, changes-requested review, unauthorized publication, and unknown publication.
- Action: Render compiled status in text and JSON and resolve emitted artifact references.
- Expected: Both views agree on exact identities and lifecycle code. Artifact links resolve, nested evidence preserves unique result fields, and findings/next-action refer to the current stage. Pending required review/publication prevents success. Unknown external outcome stays unknown and secrets never appear.

### T-M5-015

- Requirements: R-M5-015.
- Level: acceptance.
- Target: `packages/orchestration/src/pel-host-preflight.test.ts`.
- Fixture: Production admission sees documented-only and fixture-only evidence for required grok-4.6/grok-acp capabilities. Another fixture allows two transports without a selector. The explicit test Layer supplies fixture evidence separately.
- Action: Run the compiled production command with each invalid admission fixture, and the fixture CLI with its explicitly injected binding.
- Expected: Production exits exactly 2 and names the missing live capability evidence or ambiguous transport, with zero fallback or dispatch. Test injection succeeds only in the test CLI and remains labeled test-fixture. Changed source role mappings resolve exact profiles rather than substituting literal model IDs.

### T-M5-016

- Requirements: R-M5-016.
- Level: integration.
- Target: `packages/orchestration/src/pel-host-task.test.ts`.
- Fixture: One source program uses role:implementer and role:reviewer. Two snapshots provide different exact role pairs. An ambiguous exact-profile fixture supplies no transport selector.
- Action: Check both role-bound programs and inspect prepared ProviderRequestV1 plus resolveResources output.
- Expected: Role changes preserve source bytes but change binding digests and exact preview pairs. Task native transports receive their child-context worktree grants. Ambiguous literal selection fails exit 2 before dispatch. Review uses toolPolicy none and its admitted controls. Both checker and runtime use the same effective snapshot, including predicate selection and narrowed limits. A supplied stale context or handler registry mismatch exits 2 before dispatch.

## M6: Install, migrate and use Return of the ForeDi

[OpenSpec](../../../openspec/changes/foredi-06-adoption/specs/foredi-06-adoption/spec.md) · [Implementation tasks](../../../openspec/changes/foredi-06-adoption/tasks.md)

### T-M6-001

- Requirements: R-M6-001.
- Level: acceptance.
- Target: `packages/orchestration/src/pel-install-cli.test.ts`.
- Fixture: Linux x64 Node24, artifacts/foredi/<buildId>.tar.gz returned by T-M6-016 archive producer, clean /tmp/foredi-unpacked and installation prefix /tmp/foredi-prefix, no checkout/global TS runner/vault.
- Action: Extract artifacts/foredi/<buildId>.tar.gz to /tmp/foredi-unpacked, run node /tmp/foredi-unpacked/runtime/dist/install.js --prefix /tmp/foredi-prefix, then installed foreman --version --json and foreman check <prefix>/current/examples/pel/implement-verify-review.pel.
- Expected: Installed generated Node.js executable works via symlink. Version JSON is {releaseName:"Return of the ForeDi",version:null,buildId:<manifest-build-id>} before version assignment. Snapshot/example hashes match and no provider call occurs. Installation, version display and the successful check each exit 0.

### T-M6-002

- Requirements: R-M6-002.
- Level: acceptance.
- Target: `packages/orchestration/src/pel-adoption-project-cli.test.ts`.
- Fixture: A verified extracted package supplies the exact snapshot and standard example bytes. A separate temporary asset copy retains its original package manifest and a bounded fixture-assets.json sidecar. Explicit test-fixture authority binds the temporary Git repository and state root.
- Action: Run project configure with the concrete manifest-bound settings, then run examples/pel/implement-verify-review.pel without binding or context flags and read status. FOREMAN_PEL_ACCEPTANCE_PACKAGE_ROOT selects the extracted release package for final acceptance.
- Expected: Configuration is stored at git-common-dir/foreman/project.json and registered in the original projects.json. Missing or invalid settings exit 2 with zero action reservations and no program run. The standard workflow succeeds with exact authority, limits, grants and profiles. Output remains test-fixture; the product CLI rejects fixture manifests and fixture authority. Original package bytes and manifest remain unchanged.

### T-M6-003

- Requirements: R-M6-003.
- Level: acceptance.
- Target: `packages/orchestration/src/pel-install.test.ts`.
- Fixture: Node.js 22 fixture, missing archive file, or invalid archive manifest with an existing working installation.
- Action: node <archive>/runtime/dist/install.js --prefix /tmp/foredi-existing for Node22, invalid manifest and missing-asset cases.
- Expected: InstallPrerequisiteMissing or PackageIntegrityMismatch names the cause. Existing installed bytes and executable entry point remain unchanged. Every Node22, missing-asset and invalid-manifest case exits 2 before changing the installation.

### T-M6-004

- Requirements: R-M6-004.
- Level: acceptance.
- Target: `packages/orchestration/src/pel-adoption-examples.test.ts`.
- Fixture: Packaged examples/pel corpus and deterministic fake provider transcripts.
- Action: Product foreman.js check each example using copied installed assets, then node packages/orchestration/dist-test/pel-cli-fixture.js --fixture-manifest <manifest.json> run <assetRoot>/examples/pel/<example>.pel.
- Expected: Every file parses and admits under its documented capabilities. Observable outputs demonstrate its named behavior and contain no implicit publication. research-prepare and parallel-read call registered fm/research with read-result preparation and zero provider/action reservations.

### T-M6-005

- Requirements: R-M6-005.
- Level: acceptance.
- Target: `packages/orchestration/src/pel-model-examples-cli.test.ts`.
- Fixture: Six profile examples selecting grok-4.6, claude-opus-5, claude-fable-5-1, gpt-6-astra, gpt-5.6-sol and gemini-3.8-flash.
- Action: foreman plan each profile example and foreman providers list --json.
- Expected: All six exact IDs and concrete canonical transport IDs remain visible. Product evidence stays unqualified without live observations. Fixture-backed cells are labeled test-fixture, never live-qualified.

### T-M6-006

- Requirements: R-M6-006.
- Level: acceptance.
- Target: `packages/orchestration/src/pel-provider-readiness-live.test.ts`.
- Fixture: Product binding with documented-only, fixture-only, expired or absent exact model/native permission evidence.
- Action: foreman run the example using its documented command.
- Expected: Exit 2 reports ModelUnavailable or CapabilityUnverified with configuration details. No provider call, reservation or worktree is created. Product rejects a test-fixture binding.

### T-M6-007

- Requirements: R-M6-007.
- Level: integration.
- Target: `packages/orchestration/src/pel-migration-live.test.ts`.
- Fixture: packages/orchestration/src/fixtures/pel-migration/{implement-verify-review,bounded-rework}/ each contains round-v1.json, contract-v1.json, registered-command-bindings.json and expected-trace.json. Inputs use RoundPlanV1 and ExecutionContractV1 schemaVersion1.
- Action: foreman migrate <case>/round-v1.json --contract <case>/contract-v1.json --out <file.pel>, then node packages/orchestration/dist-test/pel-cli-fixture.js --fixture-manifest <manifest.json> run <file.pel>.
- Expected: Both known templates preserve required effects, identities, bounds and terminal decisions. Unsupported schema/argv or Council input returns UnsupportedLegacyConstruct. No arbitrary command executes. Supported import exits 0. Unsupported schema/command/template exits 2.

### T-M6-008

- Requirements: R-M6-008.
- Level: integration.
- Target: `packages/orchestration/src/pel-legacy-status.test.ts`.
- Fixture: An active legacy run with a lease, reservations and completed tool receipts.
- Action: Attempt migration and resume through the new CLI.
- Expected: Migration returns ActiveLegacyRun. The existing owner continues. Journal hashes and budgets remain unchanged. No second controller starts. ActiveLegacyRun exits 3 without transferring ownership.

### T-M6-009

- Requirements: R-M6-009.
- Level: integration.
- Target: `packages/orchestration/src/pel-migration.test.ts`.
- Fixture: Historical terminal records and the twelve exact legacy shell cohort paths, with caller migration completed.
- Action: Assert all twelve files are absent; rg full paths and basenames in packages, components/council, skills/foreman, scripts, env and .github; run migrated CLI workflows and retained Council review/preflight fixtures.
- Expected: No legacy shell cohort entry or active caller remains. Historical identities still decode. No compatibility argv parser or second scheduler is introduced. Every live caller scope has zero deleted-entry references, including retained Council callers. Historical records remain separate and runtime manifests are regenerated.

### T-M6-010

- Requirements: R-M6-010.
- Level: integration.
- Target: `packages/orchestration/src/pel-simplification.test.ts`.
- Fixture: Spec-fixed 15-file production cohort and five instruction files at baseline 441c3fb9f6acb2656760d03cc79e7c706fb8b7dd, js-tiktoken1.0.21/cl100k_base and candidate revision. Candidate includes a newly added pel-research-host.ts and surviving full baseline instruction files.
- Action: Collect a candidate-bound standard-start trace, then run node skills/foreman/runtime/dist/pel-simplification.js --baseline <manifest> --candidate <revision> --startup-trace <trace>.
- Expected: Report includes old and replacement production lines, generated/test/archive exclusions, command count, instruction tokens, owners and total production growth with file hashes. Changed cohort membership or tokenizer identity fails comparison. Build manifest contains the named metric bundle. Valid passing comparison exits 0. Changed membership/tokenizer exits 2. A valid report with missed acceptance targets exits 1 and remains available. Research/install/metrics source is included under the exact path-and-change union. Residual instruction files count in full, not selected paragraphs.

### T-M6-011

- Requirements: R-M6-011.
- Level: integration.
- Target: `packages/orchestration/src/pel-simplification.test.ts`.
- Fixture: The frozen implementation cohort, all new replacement glue, and the complete mandatory quickstart instruction corpus.
- Action: Run the simplification measurement against the candidate and compare its acceptance fields.
- Expected: Instruction reduction is at least 0.50. The report retains raw production counts and the original production-target result. Moving code or instructions outside old paths does not remove them from counts.

### T-M6-012

- Requirements: R-M6-012.
- Level: integration.
- Target: `packages/orchestration/src/pel-host-verify.test.ts`.
- Fixture: One admitted Pel owner executes three verification calls against retained candidate artifacts, a real registered Node.js gate, and the existing journal and ledger.
- Action: Execute two identical calls, then change candidate, gate, environment, policy, or freshness. Recover an interrupted freshness recheck from its durable report.
- Expected: Identical calls execute the full gate once and reserve one verify action. Each changed binding executes it again with a distinct reservation. Recovery preserves the refresh reservation and does not execute a third gate. Each run has one event history and at most one active owner.

### T-M6-013

- Requirements: R-M6-013.
- Level: integration.
- Target: `packages/orchestration/src/pel-research-context.test.ts`.
- Fixture: Repository research bundle containing paper claims, adopted decisions, hypotheses, coverage warnings and provider source captures.
- Action: foreman research query "Fable forced tools" --json --limit 5 without a vault path.
- Expected: Results include source locator, source hash, capture time, claim class and freshness. Unsupported extraction remains visible. Hidden reasoning and secrets are absent. Successful query, including no-match or stale results, exits 0. Invalid arguments or required schema exit 2.

### T-M6-014

- Requirements: R-M6-014.
- Level: integration.
- Target: `packages/orchestration/src/pel-research-context.test.ts`.
- Fixture: A copied bundle with one changed source hash, one missing source and interrupted refresh metadata.
- Action: foreman research status --json, then foreman research refresh --bundle <path> against a complete captured bundle.
- Expected: Stale and missing inputs appear explicitly. Refresh atomically publishes matching derived hashes and provenance. Interrupted refresh preserves the previous readable snapshot. Successful status and refresh exit 0. Invalid source provenance exits 2. Explicit interruption exits 4 after preserving the previous snapshot.

### T-M6-015

- Requirements: R-M6-015.
- Level: integration.
- Target: `packages/orchestration/src/pel-research-context.test.ts`.
- Fixture: Optional temporary Obsidian vault with wikilinks, advisory graph nodes and a note containing an execution instruction.
- Action: foreman research query with --vault <path>, then remove the vault and run the standard Pel example.
- Expected: Query preserves note links and provenance. Note instructions cannot grant capabilities. Core workflow still works without the vault and reports optional context absence.

### T-M6-016

- Requirements: R-M6-016.
- Level: acceptance.
- Target: `packages/orchestration/src/pel-package.test.ts`.
- Fixture: Candidate build with generated runtime, source manifest, support matrix and unresolved v0.5 obligation references.
- Action: npm run build, then npm run package:pel -- --candidate <git-commit> --out artifacts/foredi, inspect emitted archivePath/buildId/archiveSha256 and manifest; run candidate static checks.
- Expected: Archive hashes match candidate, metric bundle and assets/pel/default-authoring-snapshot.json. Canonical example paths exist. Support is exact per capability. Unassigned version is null. Unresolved v0.5 obligations retain their original status. ManifestPayloadV1 canonical hash yields buildId without self-reference. Archive path is artifacts/foredi/<buildId>.tar.gz and contains the exact installable layout.

### T-M6-017

- Requirements: R-M6-017.
- Level: acceptance.
- Target: `packages/orchestration/src/pel-adoption.test.ts`.
- Fixture: prefix/versions/<old-build-id> and current manifests plus the existing foremanHome/projects.json registry with two canonical registered state roots, one compatible and one incompatible or unreadable active checkpoint. Include a root created through registered --state-root override and a separate unregistered override.
- Action: foreman install rollback --to <old-build-id> for compatible and incompatible registered-state fixtures.
- Expected: Compatible rollback atomically switches prefix/current and preserves both histories. Any incompatible or unreadable registered root returns RollbackIncompatible before switch. No second scheduler starts. Compatible rollback exits 0. Incompatible or unreadable registered active state exits 3. Unknown build identity exits 2. Installed run/resume reject the unregistered override with exit 2. Rollback checks the registered override root. Checkout/fixture runs need no installation prefix projection.

### T-M6-018

- Requirements: R-M6-018.
- Level: acceptance.
- Target: `packages/orchestration/src/pel-support.test.ts`.
- Fixture: Failed packaged quickstart with a model mismatch, run IDs, provider evidence, source version, secret fixture and opaque reasoning blob.
- Action: foreman support export --run <id> --out <bundle>.
- Expected: Bundle includes version, platform, exact profile/transport, safe failure, relevant event IDs and reproduction command. Secrets, tokens and hidden reasoning are absent. Successful export exits 0. Unknown run exits 2 and write failure exits 1.

### T-M6-019

- Requirements: R-M6-019.
- Level: acceptance.
- Target: `packages/orchestration/src/pel-adoption-project-cli.test.ts`.
- Fixture: Real canonical Git project settings and the original project registry are created by makeLivePelProjectServices under the explicit bounded fixture authority. Missing and malformed stored settings are tested before dispatch.
- Action: Invoke the compiled fixture project configure command, then a bare standard run without --binding, --context, or --state-root. Repeat admission with missing and malformed settings.
- Expected: A valid configured project binds the exact authority, state root, original limits, role mappings and workspace grants. Missing or invalid configuration exits 2 with zero reservations and no provider dispatch. The installed product rejects the fixture authority.

### T-M6-020

- Requirements: R-M6-020.
- Level: acceptance.
- Target: `packages/orchestration/src/pel-package.test.ts`.
- Fixture: Installed manifest with releaseName Return of the ForeDi, version null and known buildId, followed by an explicitly assigned SemVer variant.
- Action: foreman --version --json and foreman --version.
- Expected: JSON has exactly releaseName, version and buildId matching the manifest. Human output says unversioned before assignment and never invents a numerical release. Valid nullable version output exits 0.

### T-M6-021

- Requirements: R-M6-021.
- Level: acceptance.
- Target: `packages/orchestration/src/pel-adoption-cli.test.ts`.
- Fixture: Table-driven installed-asset/filesystem cases for migrate, research query/status/refresh, install, rollback, support, version and metric commands from design.md Command outcomes.
- Action: Invoke product install/version/metric entries or node packages/orchestration/dist-test/pel-cli-fixture.js --fixture-manifest <manifest.json> <adoption-subcommand> for injected filesystem cases, inspecting exact exits and mutations.
- Expected: All command outcomes match the table: success 0, failure 1, invalid input 2, active-legacy/incompatible-state needs-action 3 and confirmed local cancellation 4. Prior data remains intact on failed or interrupted mutations. No final pending 5 appears.

### T-M6-022

- Requirements: R-M6-022.
- Level: acceptance.
- Target: `packages/orchestration/src/pel-research-host.test.ts`.
- Fixture: M2 fm/research descriptor with id/query/bundle/limit, admitted bundle:release-sources and two distinct parallel read bundles.
- Action: Check research-prepare.pel and parallel-read.pel, then node packages/orchestration/dist-test/pel-cli-fixture.js --fixture-manifest <manifest.json> run <assetRoot>/examples/pel/<example>.pel.
- Expected: M6 handler returns schema:research-result-v1 in declared order. Read resources match admitted bundles, writes are empty and fresh read-result preparation needs no prior receipt or external reservation.

### T-M6-023

- Requirements: R-M6-023.
- Level: acceptance.
- Target: `packages/orchestration/src/pel-package.test.ts`.
- Fixture: Compiled Node24 producer, exact candidate revision and runtime/assets/examples/docs payload with invalid-path counterfixtures.
- Action: npm run package:pel -- --candidate <git-commit> --out artifacts/foredi.
- Expected: Successful build emits artifacts/foredi/<buildId>.tar.gz and matching archive hash with exit 0. Invalid paths/options exit 2 and archive I/O fails with exit 1. Payload digest excludes manifest self-reference.

## M7: Executable Pel semantics in K (planned)

[OpenSpec](../../../openspec/changes/foredi-07-k-semantics/specs/foredi-07-k-semantics/spec.md) · [Implementation tasks](../../../openspec/changes/foredi-07-k-semantics/tasks.md)

### T-M7-001

- Status: planned.
- Requirements: R-M7-001.
- Level: conformance.
- Target: `packages/pel/test/k/toolchain.test.ts`.
- Fixture: Pinned K7.1.337 and a mismatched executable hash.
- Action: Compile a closed arithmetic definition, then repeat with the mismatched lock.
- Expected: The matching toolchain executes the example; the mismatch is unavailable, never a passing skipped run.

### T-M7-002

- Status: planned.
- Requirements: R-M7-002.
- Level: conformance.
- Target: `packages/pel/test/k/syntax.test.ts`.
- Fixture: Every lexical and grammar row in paper-v2.json, including escapes, quoted pairs, caret, malformed numbers and Unicode spans.
- Action: Parse with K and TypeScript independently and compare normalized trees or diagnostic locations.
- Expected: All selected syntax cases agree; unsupported syntax is a located rejection, not an assumed AST translation.

### T-M7-003

- Status: planned.
- Requirements: R-M7-003.
- Level: conformance.
- Target: `packages/pel/test/k/values.test.ts`.
- Fixture: Negative zero,0.1+0.2,maximum safe integer,overflow,division by zero and out-of-range literals.
- Action: Execute each expression and compare canonical tagged values or diagnostic codes.
- Expected: Finite values agree bitwise after the profile normalization; invalid numbers reject. Unbounded K integers do not replace Pel numeric behavior.

### T-M7-004

- Status: planned.
- Requirements: R-M7-004.
- Level: conformance.
- Target: `packages/pel/test/k/values.test.ts`.
- Fixture: Nil/empty list,standalone keyword,pair with explicit nil,quoted symbol,multiple indices,slices,index zero and missing key.
- Action: Execute positive and distinguishing negative value fixtures.
- Expected: Exact tagged values and selection errors match M1; syntax and closures cannot become ordinary host data.

### T-M7-005

- Status: planned.
- Requirements: R-M7-005.
- Level: conformance.
- Target: `packages/pel/test/k/closures.test.ts`.
- Fixture: Shadowed capture,partial application,required versus nil-default parameter,strict/syntax arguments,mixed named/positional call and bounded recursion.
- Action: Execute closure fixtures with distinct capture environments and deferred calls.
- Expected: Default timing,capture identity,partial values and call errors match M1 without dynamic scoping.

### T-M7-006

- Status: planned.
- Requirements: R-M7-006.
- Level: conformance.
- Target: `packages/pel/test/k/control.test.ts`.
- Fixture: If/case unselected host branch,for local scope,do/do-async,leading call chains,nested and repeated caret.
- Action: Execute with a finite abstract host script and count emitted requests.
- Expected: Only selected branches execute; pipe operands are evaluated once and source-defined scope is retained.

### T-M7-007

- Status: planned.
- Requirements: R-M7-007.
- Level: conformance.
- Target: `packages/pel/test/k/scheduling.test.ts`.
- Fixture: Independent requests with both receipt orders,dependent definitions,conflicting symbol bindings and a slow first expression.
- Action: Run both M1 options and all bounded receipt schedules.
- Expected: Request identity and ready batches agree; completion order does not change the selected last-source result. Permitted independent interleavings are compared explicitly.

### T-M7-008

- Status: planned.
- Requirements: R-M7-008.
- Level: conformance.
- Target: `packages/pel/test/k/limits.test.ts`.
- Fixture: Source,token,AST,syntax depth,reduction,iteration,call depth and value-byte limits at N-1,N,N+1.
- Action: Run limit boundary fixtures and repeat after serialization.
- Expected: Counters and rejection boundaries agree; administrative K rewrites do not debit Pel counters.

### T-M7-009

- Status: planned.
- Requirements: R-M7-009.
- Level: conformance.
- Target: `packages/pel/test/k/diagnostics.test.ts`.
- Fixture: Unknown symbol,arity/type errors,malformed closure graph,host failure and a deliberately stuck semantics rule.
- Action: Execute invalid fixtures and remove one required rule in a temporary mutation definition.
- Expected: Defined failures agree with M1; stuck/timeout/tool failure is harness failure, distinct from a Pel diagnostic.

### T-M7-010

- Status: planned.
- Requirements: R-M7-010.
- Level: conformance.
- Target: `packages/pel/test/k/host.test.ts`.
- Fixture: Two requests with separate IDs,success and failure receipts,print and natural-language predicate descriptors.
- Action: Supply a finite data-only host script and project ordered boundary observations.
- Expected: No provider or shell runs; requests,receipt consumption,pending sets and output observations match M1.

### T-M7-011

- Status: planned.
- Requirements: R-M7-011.
- Level: conformance.
- Target: `packages/pel/test/k/host.test.ts`.
- Fixture: Wrong request/profile/registry,duplicate conflicting receipt,closure-bearing provider value and missing receipt.
- Action: Inject each invalid receipt at the same suspension boundary.
- Expected: Exact mismatches fail; missing external evidence stays suspended. No fabricated cancellation or authority is accepted.

### T-M7-012

- Status: planned.
- Requirements: R-M7-012.
- Level: conformance.
- Target: `packages/pel/test/k/host.test.ts`.
- Fixture: Abstract retry/race/checkpoint handlers and a publication-shaped ordinary data value.
- Action: Execute request scripts with success,unknown and rejected host responses.
- Expected: Only the supplied abstract response is modeled; no budget authority,remote completion or publication milestone is inferred from source data.

### T-M7-013

- Status: planned.
- Requirements: R-M7-013.
- Level: conformance.
- Target: `packages/pel/test/k/continuation.test.ts`.
- Fixture: Nested closures,syntax arguments,ready/already-emitted effects and malformed environment references.
- Action: Roundtrip K state and the M1 continuation through the declared correspondence projection.
- Expected: Equivalent configurations resume to identical observations; broken graph/profile bindings reject. Raw wire-byte equality is required only where explicitly specified.

### T-M7-014

- Status: planned.
- Requirements: R-M7-014.
- Level: conformance.
- Target: `packages/pel/test/k/replay.test.ts`.
- Fixture: Completed pure prefix,pending suffix,changed executed effect argument,unchanged closure capture and changed options.
- Action: Replay the retained prefix and compare accepted/rejected revisions with M1.
- Expected: No completed host request is emitted twice; invalid revisions reject and original counters remain charged.

### T-M7-015

- Status: planned.
- Requirements: R-M7-015.
- Level: conformance.
- Target: `packages/pel/test/k/children.test.ts`.
- Fixture: Two child closures,duplicate merge,cancelled/failed child and nested child replay.
- Action: Compare start-child and merge-child observations with the M1 public APIs.
- Expected: Child identities,remaining limits and parent charges agree; M4 retry/race policy remains outside this language-model proof domain.

### T-M7-016

- Status: planned.
- Requirements: R-M7-016.
- Level: conformance.
- Target: `packages/pel/test/k/differential.test.ts`.
- Fixture: All paper-v2 rows and current M1 control,closure,limits,host,replay and child regression cases.
- Action: Execute the closed corpus plus fixed-seed bounded programs using the same explicit host schedules.
- Expected: Every included constructor has positive and negative cases; missing rows or mismatches fail and retain a minimal source/receipt counterexample.

### T-M7-017

- Status: planned.
- Requirements: R-M7-017.
- Level: conformance.
- Target: `packages/pel/test/k/harness.test.ts`.
- Fixture: One real execution report,missing K executable,stale source hash and interrupted child process.
- Action: Run and validate reports with finite timeout/output bounds and scoped cleanup.
- Expected: Only actually executed cases count; missing prerequisites are unavailable, interrupted cases incomplete, and stale evidence cannot pass.

### T-M7-018

- Status: planned.
- Requirements: R-M7-018.
- Level: conformance.
- Target: `packages/pel/test/k/mutations.test.ts`.
- Fixture: Mutations make indexing zero-based,evaluate both if branches,recapture closures dynamically,duplicate pipe effects or reset replay counters.
- Action: Run each temporary mutation against its distinguishing unchanged fixture.
- Expected: Every mutation is detected; merely parsing or compiling a definition cannot pass conformance.

### T-M7-019

- Status: planned.
- Requirements: R-M7-019.
- Level: conformance.
- Target: `packages/pel/test/k/claims.test.ts`.
- Fixture: Claims for at-most-once receipt consumption and nondecreasing counters in a finite closed host-script domain,plus a deliberately false invariant.
- Action: Use the pinned proof backend for the selected claims; retain counterexample,timeout or unsupported results.
- Expected: Only discharged scoped claims say proved; the false control is not proved. No full TypeScript/K equivalence,host safety or termination theorem is inferred.

### T-M7-020

- Status: planned.
- Requirements: R-M7-020.
- Level: conformance.
- Target: `packages/pel/test/k/status.test.ts`.
- Fixture: No implementation,trace-only results,scoped proof results and a changed semantics digest.
- Action: Render the status table and verify linked claim/trace artifacts and changed-domain invalidation.
- Expected: PLANNED remains the current sprint state until implementation evidence exists. Changed semantics reopen affected claims; historical evidence remains intact.
