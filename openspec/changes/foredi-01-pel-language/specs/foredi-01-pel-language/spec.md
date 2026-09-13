# Return of the ForeDi: Pel language

The normative interfaces and planned fixture matrix are in [design.md](../../design.md).

## ADDED Requirements

### Requirement: R-M1-001 Published grammar and source locations

When Pel source is parsed, the Foreman Pel parser SHALL produce the profile-defined AST with exact source spans.

#### Scenario: T-M1-001 Published grammar and source locations

- WHEN Calls (+ 1 2), lists [1 (+ 2 3)], nil, pair presence [:x] versus [:x #nil], quoted keys, ASCII |> pipes, corrected PDF KEY characters *, <, >, and escaped Unicode.
- AND parsePel each fixture with pel-paper-v2-foreman-1.
- THEN AST tags and UTF-8 spans match the profile. Pair AST valuePresent distinguishes required parameters from explicit nil defaults. ASCII |> parses and quoted keys remain data. A nonempty program returns its last source top-level expression value, after all required expressions complete.

### Requirement: R-M1-002 Published grammar and source locations

If source violates the lexical or grammar profile, then the Foreman Pel parser SHALL return source-located diagnostics without an executable program.

#### Scenario: T-M1-002 Published grammar and source locations

- WHEN Unmatched call/list delimiters, extracted ^> pipe, malformed escapes, #true, invalid UTF-8, 1e5, out-of-range decimals, a>b, >b, and x U+25B7 (f).
- AND parsePel each invalid lexical or grammar fixture.
- THEN Unmatched delimiters return PEL_PARSE. All listed invalid tokens return PEL_LEX with exact spans. U+25B7 gives the hint use |>. No invalid parse returns a program.

### Requirement: R-M1-003 Values and callable lists

When Pel values are evaluated or formatted, the Foreman Pel evaluator SHALL preserve their profile-defined types and ordered pair structure.

#### Scenario: T-M1-003 Values and callable lists

- WHEN [1 "two" #t #nil :a 1 :flag], quoted symbols and expressions, duplicate keys, Unicode strings, and numeric boundary fixtures.
- AND startPel each fixture and formatPel its result.
- THEN Types and ordered pairs remain distinct. Formatting and JSON encoding round-trip Unicode and nil. Safe integers retain value. Unsafe or nonfinite arithmetic returns PEL_NUMERIC_DOMAIN.

### Requirement: R-M1-004 Values and callable lists

When a list is called, the Foreman Pel evaluator SHALL apply one-based indexing, inclusive slicing, and ordered key selection.

#### Scenario: T-M1-004 Values and callable lists

- WHEN ([5 6 7 8] 1), ([5 6 7 8] () 1 3), ([:a 1 :b 2] :at [':b ':a]), missing keys, zero/fractional/out-of-range indices.
- AND startPel the callable-list fixture matrix.
- THEN Results are 5, [5 6 7], [2 1], and nil respectively. Invalid indices return PEL_INDEX. Mixed at and slice selectors return PEL_ARGUMENT_MODE.

### Requirement: R-M1-005 Closures and argument binding

When a lambda is created or invoked, the Foreman Pel evaluator SHALL preserve lexical capture and profile-defined default evaluation.

#### Scenario: T-M1-005 Closures and argument binding

- WHEN ((lambda [:x] x)), ((lambda [:x #nil] x)), defaults [:x :y 3] and [:x 1 :y], lexical capture, and recursive factorial.
- AND startPel closure fixtures.
- THEN The required-x zero-argument call returns a partial closure. The nil-default call returns nil. The two parameter matrices bind declared defaults and required values exactly. Factorial 5 returns 120.

### Requirement: R-M1-006 Closures and argument binding

When a closure receives arguments, the Foreman Pel evaluator SHALL bind named or positional arguments under its fixed argument specification.

#### Scenario: T-M1-006 Closures and argument binding

- WHEN (def name) partial def, partial lambda, (+ :x 1 :y 2), ((+ 5) 4), (+ [1 2]), ((+ 5) [1 2]), mixed modes, duplicate/unknown names, and excess arguments. Rebinding :x on an already x-bound partial closure.
- AND startPel argument fixtures with a host-call spy.
- THEN Partial constructors do not bind or evaluate missing bodies. Numeric results are 3, 9, and 3. Partial binary plus with list returns PEL_TYPE. Mode/name/count errors are PEL_ARGUMENT_MODE, PEL_ARGUMENT_NAME, and PEL_ARITY. Partial rebinding returns PEL_ARGUMENT_NAME.

### Requirement: R-M1-007 Pipes and native control flow

When a pipe is evaluated, the Foreman Pel evaluator SHALL insert its once-evaluated input at profile-defined caret positions.

#### Scenario: T-M1-007 Pipes and native control flow

- WHEN A once-only host input with repeated carets, the page-17 case pipe chain, 7 |> (case ^ [(gt ^ 5) "big" #t "small"]), an aliased case, and (+ 1 2) |> (def z ^).
- AND startPel and resumePel once with test/once returning 5.
- THEN Repeated insertion emits one host call. The pipe-chain and nested/aliased case fixtures return "big". Def piping returns 3 and binds z. Quotes and nested case scopes retain their declared owners.

### Requirement: R-M1-008 Pipes and native control flow

When native conditional or loop functions are evaluated, the Foreman Pel evaluator SHALL select only required expressions and preserve result order.

#### Scenario: T-M1-008 Pipes and native control flow

- WHEN (if #f (test/denied) 7), (case 7 [(gt ^ 5) "big" #t "small"]), (case (test/once) [(gt 2) 1 #t 0]), a symbol-valued string condition, per-iteration def, and def inside if.
- AND startPel each native-control fixture.
- THEN The false branch emits no request. Case returns "big" and evaluates test/once exactly once. Nonliteral string conditions return PEL_TYPE. Per-iteration definitions return [1 2] without collision. Selected if definitions bind the caller scope.

### Requirement: R-M1-009 Pipes and native control flow

When do or do/async evaluates a sequence, the Foreman Pel evaluator SHALL return the last source expression after required dependencies complete.

#### Scenario: T-M1-009 Pipes and native control flow

- WHEN Sequential do, empty blocks, do/async requests A then B, a forward dependency, and a cycle. Also (test/a) (test/b) without do/async under explicit ordered and automatic PelRunOptionsV1.
- AND startPel with explicit options, then resumePel(program,registry,continuation,[receiptB],options) for the asynchronous fixture, followed by receiptA.
- THEN Initial ready is [A:false,B:false]. After only B returns, suspend.ready is [A:true] with no newly emitted request. After A returns, done contains B value. Source-order dependencies wait and cycles return PEL_DEPENDENCY_CYCLE. Ordered top-level mode initially releases only A, automatic releases both, and both return the last source value after required work completes.

### Requirement: R-M1-010 Diagnostics and evaluation limits

When evaluation fails, the Foreman Pel evaluator SHALL return a stable error code, precise source span, and applicable function signature.

#### Scenario: T-M1-010 Diagnostics and evaluation limits

- WHEN A two-line program with (print ["hello" name] :sep " ") on line 2 and a registered print signature.
- AND startPel then renderPelDiagnostic.
- THEN PEL_ARGUMENT_MODE identifies line 2, marks the complete call, prints the registered signature, and supplies a named-argument example without unrelated environment data.

#### Scenario: T-M1-021 Diagnostics and evaluation limits

- WHEN Parser-valid bare caret, :a^b, lone minus, Infinity, :a>, and every stable diagnostic enum member.
- AND parsePel first, then startPel with default explicit options for parse-valid programs and enumerate diagnostic rendering.
- THEN Parsing accepts standalone caret syntax and symbol tokens. Evaluation raises PEL_CARET_SCOPE for demanded unbound carets, returns a subtraction closure for minus, and raises PEL_UNBOUND_SYMBOL for Infinity. :a> remains a keyword. Stable diagnostics include PEL_HOST_FAILURE and PEL_REGISTRY.

### Requirement: R-M1-011 Diagnostics and evaluation limits

If an evaluation bound would be exceeded, then the Foreman Pel evaluator SHALL stop before the next expression emits a host request.

#### Scenario: T-M1-011 Diagnostics and evaluation limits

- WHEN (for [1 2 3] i (test/echo i)) with maxIterations=2, recursive fuel exhaustion, oversized input, deep nesting, and continuation resumes.
- AND startPel then resume valid receipts until the first bound failure.
- THEN Exactly two loop requests can occur. The third body emits none. PEL_LIMIT names the bound and consumed count. Resume retains previous counters.

### Requirement: R-M1-012 Host suspension and recovery data

When a fully applied host function is reached, the Foreman Pel evaluator SHALL suspend and resume through validated ordinary Pel data.

#### Scenario: T-M1-012 Host suspension and recovery data

- WHEN createHostRegistry fixture descriptors and schemas, then (test/flag) |> (if :cond ^ :then (for [1 2] i (* i 2)) :else []), plus an incomplete host closure.
- AND createPelEnvironment, startPel, then resumePel(program,registry,continuation,[successful Boolean receipt]).
- THEN One ready request appears and true yields [2 4]. The incomplete host closure emits no request. Changed registry content fails PEL_CONTINUATION_MISMATCH and schema-invalid values fail PEL_HOST_RESULT.

### Requirement: R-M1-013 Host suspension and recovery data

When case reaches a literal string condition, the Foreman Pel evaluator SHALL request a typed natural-language predicate result through host suspension.

#### Scenario: T-M1-013 Host suspension and recovery data

- WHEN (case [:tier "premium"] ["is premium" 1 #t 0]) with nlConditionProfile={profileId:"gpt-5.6-sol",transportId:"openai-responses",controls:fixtureControls,credentialProfileRef:"account:test",outputSchemaId:"schema:pel-boolean-v1"}. The selection and its digest are supplied through PelRunOptionsV1, with a null-selection counterfixture.
- AND startPel with explicit options and resumePel with matching options and Boolean or invalid receipts.
- THEN The request carries declared selection and selectionDigest fields plus scrutinee and literal condition. Boolean receipts return 1 or 0. Null selection returns PEL_REGISTRY before release. A string receipt returns PEL_HOST_RESULT.

### Requirement: R-M1-014 Host suspension and recovery data

When a continuation is encoded and restored, the Foreman Pel evaluator SHALL preserve lexical data, pending request identities, and consumed limits.

#### Scenario: T-M1-014 Host suspension and recovery data

- WHEN A partially complete do/async with a captured closure, one completed receipt, pending requests, changed digest, and duplicate receipt. Change dependencyMode, predicate selection, or replay options independently.
- AND Encode/decode PelContinuationV1, resumePel with the supplied program and registry, then try changed source, changed registry, and duplicate receipts.
- THEN Matching restoration returns the same value without repeated calls. Changed source or registry returns PEL_CONTINUATION_MISMATCH. Duplicate and unknown receipts return PEL_HOST_RESULT. Every changed optionsDigest returns PEL_CONTINUATION_MISMATCH.

### Requirement: R-M1-015 Host suspension and recovery data

When a valid host failure receipt arrives, the Foreman Pel evaluator SHALL preserve its typed failure and stop releasing new requests.

#### Scenario: T-M1-015 Host suspension and recovery data

- WHEN do/async with A failing while B remains pending, and a retry child returning a registered provider failure.
- AND resumePel with A failure, inspect failed continuation, then merge the final child failure.
- THEN PelStep.failed contains PEL_HOST_FAILURE and identical hostFailure code/message/cause. B remains pending for host reconciliation. No new request is emitted. Merged child failure preserves counters.

### Requirement: R-M1-016 Host suspension and recovery data

When a host-library closure is evaluated, the Foreman Pel evaluator SHALL bind nested requests and consumed counters to its unique child invocation identity.

#### Scenario: T-M1-016 Host suspension and recovery data

- WHEN The same closure evaluated under parent p at retry attempts 1 and 2, race contenders 1 and 2, and an abandoned losing child. A recursively captured closure whose canonical node table contains a cycle.
- AND extractClosureEnvironment, evaluateClosure per context, then merge counters and try an attempt-1 receipt in attempt 2. Encode/decode HostArgumentsEncodingV1 and hash the whole digest-free environment node/reference table.
- THEN Nested request IDs differ across attempts and contenders. A foreign receipt returns PEL_HOST_RESULT. Winning, failed, and abandoned child counters are charged once. Closure return data is rejected at the host-library boundary. Recursive closure argument bytes and digest remain stable without recursive environment hashing.

### Requirement: R-M1-017 Host suspension and recovery data

When a host registry is constructed, the Foreman Pel evaluator SHALL validate its names, argument specifications, data schemas, and canonical digest.

#### Scenario: T-M1-017 Host suspension and recovery data

- WHEN Duplicate host names, unknown schema references, a maxItems=4 list schema, an association with duplicate keys, and changed descriptor content. Change only the resolverCatalog.
- AND createHostRegistry(descriptors,dataSchemas,failureSchemas,resolverCatalog), then decode fixture receipts.
- THEN Invalid registries return PEL_REGISTRY. The bounded schema permits four values and rejects five. Association duplicates fail PEL_HOST_RESULT. Descriptor changes change the registry digest. Resolver changes alter registryDigest.

### Requirement: R-M1-018 Values and callable lists

When Pel data is encoded, the Foreman Pel evaluator SHALL produce the canonical tagged JSON representation and deterministic source formatting.

#### Scenario: T-M1-018 Values and callable lists

- WHEN Nil, pair :a 1, list [':a 1], negative zero, Unicode string, nested data, and a closure.
- AND Encode, canonicalize, SHA-256 hash, decode, and formatPel each fixture.
- THEN Round-trips preserve data. Equal values have identical digests. Pair and list hashes differ. Negative zero encodes as zero. Closure formatting is explicitly non-executable.

### Requirement: R-M1-019 Published grammar and source locations

When compatibility fixtures are validated, the Foreman Pel conformance suite SHALL cover every classified profile decision with its declared positive and negative cases.

#### Scenario: T-M1-019 Published grammar and source locations

- WHEN The corrected PDF-backed profile matrix with extension rows separate from pure paper baseline rows, positive/negative fixtures through PV2-056, and a deliberately wrong locator/classification.
- AND Run packages/pel/test/profile.test.ts through scripts/run-tests.ts.
- THEN Complete fixtures and exact matrix metadata pass. Missing cases, wrong stored metadata, or unclassified rows fail. PixelRAG page-image spot checks establish p12 nil/pairs, p14 argument modes, p17 if/case, and p11 keyword rules. Print routing is an extension.

### Requirement: R-M1-020 Host suspension and recovery data

When a revised program preserves its completed prefix, the Foreman Pel evaluator SHALL validate old-to-new call mappings before fresh replay.

#### Scenario: T-M1-020 Host suspension and recovery data

- WHEN Two completed host calls, recorded prefix reductions 10, latest durable failed-step reductions 14, and a revised pure suffix consuming 3 reductions. Counterfixtures change a completed argument or lower committedCounters.
- AND validateRevisionPrefix, startPel with completed-prefix replay options containing recordedCounters and committedCounters, then supply mapped receipts.
- THEN Both host results reuse receipts without dispatch. Replay consumes separate bounded fuel. New ordinary reductions total 17, including failed suffix work. Changed completed arguments or reduced committed counters fail before dispatch; original limits remain enforced.
