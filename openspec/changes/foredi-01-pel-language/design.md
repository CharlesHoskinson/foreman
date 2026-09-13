# Pel language design

## Decision and source

Implement the published Pel language in strict TypeScript for Node.js 24.
Use `packages/pel/`, as selected by the release design and plan.
This overrides the research review's earlier suggestion to nest the language in orchestration.

The source is [Pel v2](https://arxiv.org/abs/2505.13453v2), sections 4 through 6.
The captured text is `docs/research/pel-release/sources/pel/arxiv-2505.13453v2.txt`.
Use the PDF digest in the adjacent `manifest.json` for fixture attribution.
No verified upstream implementation exists in the reviewed evidence.
Describe compatibility as conformance to this paper profile.

Requirements use [EARS](https://alistairmavin.com/ears/).
The catalog stores each requirement body without alteration.

## Files and boundaries

| Target | Responsibility |
| --- | --- |
| `packages/pel/package.json`, `tsconfig.json`, `tsconfig.test.json` | Strict NodeNext package and compiled test build |
| `packages/pel/src/tokenizer.ts`, `parser.ts`, `ast.ts` | UTF-8 input, tokens, AST, stable locations |
| `packages/pel/src/values.ts`, `arguments.ts`, `builtins.ts` | Values, argument binding, builtin descriptors |
| `packages/pel/src/evaluator.ts`, `continuation.ts` | Pure evaluation machine and serializable frames |
| `packages/pel/src/diagnostics.ts`, `profile.ts` | Typed diagnostics and frozen profile |
| `packages/pel/src/host-contract.ts`, `dependencies.ts` | Host suspension and dependency descriptions |
| `packages/pel/src/index.ts` | Public exports |
| `packages/pel/test/fixtures/paper-v2.json` | Paper, errata, and extension cases |
| `docs/reference/pel/compatibility.md`, `extensions.md` | Semantics, attribution, capability boundary |
| Root `tsconfig.json`, `tsconfig.all.json`, `package.json` | Workspace references and test discovery |

Keep deterministic transforms as ordinary TypeScript functions.
The language machine owns no timers, subprocesses, filesystem handles, or provider requests.
The orchestration Effect scope owns these resources.

## Public interfaces

Export `SourceSpan` with zero-based UTF-8 byte offsets and one-based line and Unicode-scalar columns.
Spans are half-open. CRLF counts as one newline.
AST nodes carry `nodeId`, `kind`, and `span`.
A node ID combines the source SHA-256 digest and child-index path.
The source digest includes the exact bytes, including comments and whitespace.

Export `parsePel(source: Uint8Array, profile: PelProfileV1): Result<PelProgram, readonly PelDiagnostic[]>`.
Export `startPel(program: PelProgram, environment: PelEnvironmentV1, limits: PelLimitsV1, options: PelRunOptionsV1): PelStep`.
Export `resumePel(program: PelProgram, registry: HostRegistryV1, continuation: PelContinuationV1, receipts: readonly HostReceiptV1[], options: PelRunOptionsV1): PelStep`.
Export `analyzeDependencies(program): DependencySummary`.
Export `formatPel(value): string` and `renderPelDiagnostic(source, diagnostic): string`.

`PelStep` is a discriminated union:
- `done`: final `PelValue` and consumed counters.
- `suspend`: nonempty `ready: ReadyHostRequestV1[]`, `PelContinuationV1`, and consumed counters.
- `failed`: `PelDiagnostic`, preserved continuation, and consumed counters.

`PelValue` is a tagged union of finite number, string, Boolean, nil, key, pair, list, symbol, syntax, and closure.
Symbol and syntax values arise through quoting.
A closure contains AST identity, captured environment IDs, remaining ArgSpec, supplied arguments, and strictness.
Builtin closures contain registry IDs, never JavaScript code.
Callable lists keep the list tag and use the closure argument-binding protocol.

`HostFunctionDescriptorV1` contains a registry ID, name, ArgSpec, result schema ID, failure schema ID, effect kind, capability names, and resource declarations.
Resource declarations contain `reads`, `writes`, and `unknown`.
Only the host registry can create descriptors.
A Pel pair that resembles a descriptor remains data.

`HostRequestV1` contains request ID, source digest, node ID, invocation ordinal, registry ID, bound arguments, and expected result schema ID.
Request IDs hash the source digest, registry digest, node ID, and complete logical invocation path.
Loop iteration and nested call positions form the invocation path.
Each fully applied call produces one request.

`HostReceiptV1` has the exact shape `{requestId: string, outcome: {tag: "success", value: PelDataValue} | {tag: "failure", failure: HostEffectFailure}}`.
`PelDataValue` is the host-safe subset of `PelValue` listed below.
`HostEffectFailure` contains `code: string`, `message: string`, and optional structured `cause`.
The decoder accepts only failure codes declared by the immutable host registry's failure schema.
Base codes are `capability-denied`, `resource-denied`, `timeout`, `provider-failure`, `unknown-external-outcome`, and `reconciliation-required`.
M5 registers operation-specific failure codes through that schema without making the language import orchestration.
The structured cause can carry a boundary-specific code and safe detail.
The execution owner validates receipts and records effects.
The evaluator also checks request identity and the declared value schema.
Host values can be numbers, strings, booleans, nil, keys, pairs, or nested lists.
Host results cannot inject syntax, closures, symbols, registry descriptors, or executable source.
Native list lookup, `if`, `case`, `for`, and pipes consume returned values directly.
A valid failure receipt returns `PelStep.failed` with diagnostic code `PEL_HOST_FAILURE`.
Its diagnostic includes `hostFailure: HostEffectFailure` unchanged, the suspended call span, preserved continuation, and consumed counters.
It does not return failure-shaped data to the Pel program.
An invalid receipt instead returns `PEL_HOST_RESULT` and does not masquerade as a legitimate host failure.

## Compatibility profile pel-paper-v2-foreman-1

Create a versioned fixture record with `id`, `class`, `paperSection`, `paperPage`, `sourceDigest`, `input`, `ast`, `resultOrError`, and `effects`.
Classes are `paper`, `erratum`, and `extension`.
Each correction below gets positive and negative fixtures.

| Subject | Deterministic behavior |
| --- | --- |
| Programs, §4.1 | Zero or more expressions. Empty program returns nil. A nonempty program returns its last source expression's value after all required expressions finish. |
| Lexing, §4.1 | Unicode scalar symbols. Preserve spelling without normalization. Whitespace separates tokens. A semicolon starts a comment through newline. |
| Token boundaries | Delimiters are whitespace, parentheses, brackets, quote, double quote, semicolon, caret, vertical bar, and greater-than. Bare vertical bar, greater-than, and U+25B7 fail PEL_LEX. |
| Constants | Recognize complete tokens `#t`, `#f`, and `#nil`. Reject other hash-prefixed tokens. |
| Numbers | Accept `-?digits(.digits)?`. Digit-leading or minus-digit-leading tokens that fail this grammar return PEL_LEX. Reject integer literals outside ±9007199254740991. Normalize negative zero. |
| Strings | Permit raw newlines. Decode \\n, \\r, \\t, \\b, \\f, \\v, \\0, \\\\, \\", \\xHH, \\uHHHH, and \\UHHHHHHHH. Reject malformed escapes and invalid scalar values. |
| Keywords | A colon requires one or more PDF KEY characters: ASCII letters, digits, underscore, minus, plus, asterisk, slash, backslash, question mark, exclamation mark, less-than, greater-than, equals, period. |
| Pair formation | In unquoted list, argument, and top-level sequences, a key consumes the next non-key expression. Otherwise it pairs with nil. |
| Quotes | Quote consumes one full expression, including its pipe chain. Disable pair formation throughout quoted syntax. Return literal key, symbol, or syntax without evaluation. |
| Quoted data | Formatting preserves quoted structure. There is no implicit eval builtin. Quoted `':a` is a key value, not a named argument. |
| Nil, §4.2 | `()` equals `#nil`. Nil is not Boolean and cannot be a condition. `[]` remains an empty callable list. |
| Lists, §4.5 | Use one-based indices and inclusive slices. Reject index zero, negative indices, fractional indices, and indices beyond list length. |
| List calls | Signature is `:at #nil :from #nil :to #nil`. All nil returns the original list. At and non-nil slice bounds together fail. |
| Slices | Missing bounds mean first and last. Valid reversed bounds return an empty list. Empty-list default slicing returns an empty list. Explicit bounds on empty lists fail. |
| Selection | At accepts integer, quoted key, or a list of these. Multi-selection preserves request order and duplicates. Indexing a pair returns the pair. |
| Keys | Lookup returns the first matching pair value. A missing key returns nil. Duplicate keys remain ordered list entries. |
| Index errata | `([5 6 7 8] 1)` returns 5. `([5 6 7 8] () 1 3)` returns `[5 6 7]`. Replace the paper's loop indices `[0 2 4]` with `[1 3 5]`. |
| Definitions, §4.3 | `def` binds its symbol after value evaluation and returns that value. Bindings are immutable within a scope. Duplicate definitions fail. |
| Lexical capture | Lambdas capture their definition environment. Each invocation adds a child scope. A later definition cannot repair an earlier unbound capture. |
| Arguments | Lambdas have fixed ArgSpec. A bare key is required. A key followed by a value supplies a default. Explicit nil is a default, not an absent default. |
| Defaults | Evaluate default expressions once when the lambda forms, left to right, in its defining environment. Required parameters may follow defaults. |
| Binding | Positional arguments bind remaining parameters in declaration order. Named arguments bind by name. Missing required parameters return a partial closure. |
| Errors | Reject mixed modes, unknown names, duplicate names, and excess arguments. Reject rebinding a parameter already supplied to a partial closure. |
| Strictness | User lambdas are strict. Builtins can be non-strict. Partial non-strict closures capture syntax with the caller environment without evaluating it. |
| Pipes, §4.4 | Pipes associate left to right. Evaluate the left expression once. Without an unquoted caret, the right side must be a call and receives the value first. |
| Pipe normalization | Use ASCII `\|>` for the PDF's right-triangle pipe glyph. Reject the extracted caret-plus-greater-than spelling and unnormalized Unicode glyph. Tokenize standalone `^` separately. |
| Caret scope | Evaluation binds carets by the nearest pipe or case-condition scope. Quotes stop binding. Resolved case body syntax excludes the enclosing pipe binding. |
| Lambda pipe scope | Free carets inside a lambda on the right receive the current value. The resulting lambda captures that value. Bare caret outside a pipe fails. |
| `if`, §4.6.1 | Signature `:cond :then :else #nil`. Evaluate one Boolean condition and only its selected branch. |
| `case`, §4.6.2 | Signature `:scrut :body`. Body is an unevaluated bracket sequence of condition and consequence expressions. Reject odd length. |
| Case conditions | Evaluate the scrutinee once. Bind each condition's carets to it. Feed no-caret call chains at their first primary. Other expressions follow the complete case rule below. |
| Natural-language case, §4.7 | A literal string condition suspends with `pel/nl-condition`, scrutinee, and condition text. Nonliteral expressions must produce Boolean values. |
| `for`, §4.6.3 | Signature `:coll :iterator :body`. Require a list and binder symbol. Each iteration receives a fresh child scope. Return the ordered result list. |
| `do`, §4.6.4 | Accept expression arguments or one bracket sequence as unevaluated expressions. Evaluate in one child scope, sequentially. Return last value or nil. |
| `do/async`, §4.6.5 | Same sequence forms. Evaluate dependency-ready children. Wait for all results. Return the last source expression's value, not last completion. |
| Sequence arity correction | Only do and do/async use sequence ArgSpec. Zero expressions return nil. User lambdas and other builtins remain fixed-arity. |
| Dependencies, §5.2 | Top-level execution defaults to source order. Optional automatic mode releases acyclic dependency-ready expressions for host conflict checking. |
| Binding dependencies | In an asynchronous block, references to definitions in that block wait for those definitions. Cycles fail with PEL_DEPENDENCY_CYCLE. |
| Restart, §5.1 | Failures preserve frame/environment data. Restart choices are abort, replace-expression, replace-suffix, replace-program, and helper-repair. |

Recursive self-reference is supported through a reserved immutable environment cell during `def` evaluation.
The cell becomes available only after its closure value is complete.
Non-closure self-reference fails with `PEL_UNINITIALIZED_BINDING`.
Mutual forward references require asynchronous dependency analysis and cyclic definitions still fail.
There is no assignment, dynamic module loading, arbitrary JavaScript, or shell evaluator.

The paper uses arithmetic and utility names without complete signatures.
Freeze this small pure library: binary `+`, `-`, `*`, `/`, `pow`, `gt`, `lt`, `eq`, and `concat`.
Also provide unary `sqrt`, `len`, and `not`.
`+` additionally accepts one numeric list for the paper's vector pipe example.
This is a fixed overload, not general variadic support.
Numeric operations reject nonfinite results and unsafe integer results.
Division by zero returns `PEL_NUMERIC_DOMAIN`.
Equality is structural for data values, compares syntax structurally, and rejects closures with `PEL_TYPE`.
`len` accepts a list or string and counts Unicode scalar values for strings.
`concat` accepts two strings.
`print` is a host descriptor with `:vals :sep "" :nl #f` and returns its input after host output.
Its defaults follow the paper's prose at page 21.
The conflicting signature display becomes an erratum.
`summarize`, `meeting`, and hierarchical agent names are host registry examples, not grammar constructs.

## Bounds and failures

Defaults are 1 MiB source, 100000 tokens, 50000 AST nodes, and 256 syntax nesting levels.
Evaluation defaults are 100000 reductions, 10000 aggregate loop iterations, 256 call frames, and 16 MiB encoded values.
A host can lower bounds. Admission can supply larger finite bounds explicitly.
Every reduction consumes fuel before executing that reduction.
Each iteration consumes one aggregate iteration allowance before its body.
Repeated resume never resets counters.
Value encoding checks the total reachable data size with cycle-safe environment references.
Limit failure occurs before the over-limit expression can emit a host request.

Diagnostics contain code, severity, span, related spans, message, expected forms, and optional signature/help.
Stable codes are `PEL_LEX`, `PEL_PARSE`, `PEL_UNBOUND_SYMBOL`, `PEL_UNINITIALIZED_BINDING`, `PEL_DUPLICATE_BINDING`, `PEL_TYPE`, `PEL_ARGUMENT_MODE`, `PEL_ARGUMENT_NAME`, `PEL_ARITY`, `PEL_INDEX`, `PEL_NUMERIC_DOMAIN`, `PEL_CARET_SCOPE`, `PEL_DEPENDENCY_CYCLE`, `PEL_LIMIT`, `PEL_HOST_RESULT`, `PEL_HOST_FAILURE`, `PEL_REGISTRY`, and `PEL_CONTINUATION_MISMATCH`.
An invalid parse returns no executable program.
A diagnostic never contains credentials, unrelated source files, or an invented successful result.

## Suspension and restart ownership

A fully applied registered host function suspends.
A partial host closure does not dispatch or reserve resources.
Multiple ready requests can appear for asynchronous children.
The host decides admissibility and concurrency using capability and read/write declarations.
An unknown resource set requires conservative serialization.
The host returns receipts by request ID in any completion order.
The evaluator rejects duplicate receipts and receipts for unknown requests.
Resume accepts any subset of pending receipts, including an empty subset.
It validates the whole supplied subset before changing continuation data.
A valid failure receipt removes that request from pending and records its failure before returning the failed step.
`ReadyHostRequestV1` extends `HostRequestV1` with `alreadyEmitted: boolean`.
Every suspension lists all released requests that still lack receipts, in stable invocation-path order.
A request has `alreadyEmitted: false` only in the first step that exposes it.
Later steps retain that request with `alreadyEmitted: true` until its receipt arrives.
After B completes before A, `ready` contains only A with `alreadyEmitted: true`.
Receiving a dependency result can also add newly released requests with `alreadyEmitted: false`.
Restoration preserves the emission flags.
An emission flag reports evaluator-to-host delivery, not proof of external dispatch.
M4 reconciles every request against its journal before dispatch, including restored previously emitted requests.

Export `evaluateClosure(closure: PelClosureValue, args: readonly PelValue[], context: ClosureEvaluationContextV1): PelStep`.
The context fixes source/profile/registry digests, parent request ID, child invocation ID, lexical environment table, and allocated finite remaining limits.
Retry child IDs are `parentRequestId + "/retry/" + attemptIndex`, with one-based attempt indices.
Race child IDs are `parentRequestId + "/race/" + contenderIndex`, with one-based source-order contender indices.
The complete child ID prefixes every nested invocation path and therefore participates in every nested request ID.
Restart preserves these indices. A new retry attempt cannot consume an earlier attempt's receipt.
Export `mergeClosureResult(parent: PelContinuationV1, invocationId: string, receipt: HostReceiptV1, consumed: PelCounters): PelStep`.
This function validates child identity, adds child counters, checks aggregate limits, and resumes the parent.
M4 debits child reductions and iterations against the shared run envelope before granting another allocation.
Concurrent children cannot each receive the whole unused budget.
Trusted host-library arguments can contain internal closure values for retry and race.
Provider return values cannot contain closures.
`evaluateClosure` returns failed child steps to the controlling host-library handler before any parent merge.
`fm/retry` classifies a child diagnostic with `code: "PEL_HOST_FAILURE"` through its unchanged `hostFailure`.
The handler can start the next bounded attempt or merge the final failure into the parent.
It does not classify lexical, argument, type, or limit errors as provider retries.
Each attempt's consumed counters remain charged, including failed attempts.

`PelContinuationV1` stores version, source/profile/registry digests, AST locations, frames, environment graph, pending requests, completed values, and counters.
Encode closures as code references plus lexical data, never native closures.
Round-trip encoding preserves pending identities and counters.
Reject a continuation under different source, profile, or registry digests.
Expression replacement creates a new revision through the execution owner.
Completed effects retain their old identities and receipts.
M4's `PelRevisionMappingV1` permits replay of an unchanged completed top-level prefix after an approved source revision.
The revised source starts fresh evaluation. The old continuation is never decoded under the new source digest.
M4 validates normalized prefix AST, invocation paths, and bound arguments before supplying mapped receipts.
Mapped receipts carry the new request ID and the old recorded result, with a journal alias to the original effect ID.
The original effect ID retains the parent revision binding.
Changed completed arguments or revisions inside a form with completed external effects fail before dispatch.
M1 does not repeat remote work, reset budgets, or choose a recovery authority.

`pel/nl-condition` uses the same host interface as every other model call.
Only its typed Boolean result enters Pel flow.
The immutable M2 authoring snapshot supplies `nlConditionProfile` with exact profile ID, transport ID, and resolved controls.
Its digest participates in the checked binding and the M4 execution admission.
The host request references this admitted selection. Pel strings cannot select another predicate model.
An absent or unsupported selection rejects a reachable string condition before dispatch.
Authorization and host verification do not accept this predicate as evidence.

The paper's REPeL history, highlighting, completion, and interactive terminal interface are tooling.
M2 supplies source diagnostics and helper repair.
Durable restart and expression replacement belong to the execution milestone.
The profile records this allocation without claiming those runtime tools already exist.

## Planned validation

Create `tsconfig.test.json` with `rootDir: "."`, `outDir: "dist-test"`, and NodeNext compilation for source and tests.
Run `npm run typecheck`.
Add `packages/pel/test/**/*.test.ts` to the root `npm test` command's explicit test globs.
Run `npx tsc -p packages/pel/tsconfig.test.json`.
Run `npx tsx scripts/run-tests.ts "packages/pel/dist-test/test/*.test.js"` on Node.js 24.
The catalog names exact planned test files and observable results.
No test implementation or language runtime is part of this drafting change.

## Registry, schemas, and canonical values

Export `createHostRegistry(descriptors, dataSchemas, failureSchemas, resolverCatalog): Result<HostRegistryV1, readonly PelDiagnostic[]>`.
The descriptor input type is `readonly HostFunctionDescriptorSpecV1[]`, which contains untrusted declarative records.
Only successful construction returns branded immutable `HostFunctionDescriptorV1` records.
Registry construction rejects duplicate IDs, duplicate exported names, unknown schema references, and invalid ArgSpec.
`HostRegistryV1` contains `schemaVersion: 1`, sorted descriptors, sorted schema maps, resolverCatalog, and `digest`.
The digest is SHA-256 of UTF-8 `canonicalize` from `packages/core/src/canonical-json.ts`, excluding the digest field.
Canonicalization includes all descriptor fields, schemas, and builtin profile identity.
Add a `@foreman/core` dependency and project reference to the Pel package.

Export `createPelEnvironment(registry, initialBindings): PelEnvironmentV1`.
The environment contains the registry and an immutable lexical binding table.
Host exported names bind to builtin closure references from the registry.
Initial bindings contain Pel data only and cannot replace reserved builtin or host names.
`startPel` receives this environment.
`resumePel` validates the supplied program and registry against continuation digests before evaluating a frame.
Malformed registries return `PEL_REGISTRY`.
Changed program or registry digests return `PEL_CONTINUATION_MISMATCH` before exposing any request.

`PelDataSchemaV1` is a closed tagged union:
- `{type:"number", integer:boolean, minimum:number, maximum:number}`.
- `{type:"string", maxBytes:number, enum?: readonly string[]}`.
- `{type:"boolean"}`, `{type:"nil"}`, and `{type:"key", enum?: readonly string[]}`.
- `{type:"pair", key: string, value: PelDataSchemaV1}`.
- `{type:"list", items: PelDataSchemaV1, minItems:number, maxItems:number}`.
- `{type:"association", fields: readonly {key:string,schema:PelDataSchemaV1,required:boolean}[], additionalKeys:false}`.
- `{type:"union", variants: readonly PelDataSchemaV1[]}`.
- `{type:"data",maxDepth:number,maxBytes:number}` for bounded arbitrary Pel data, excluding syntax and closures.

Schema objects reject unknown fields and nonfinite bounds.
Bounds are required, finite, nonnegative where applicable, and consistent.
A schema has at most 32 nesting levels and 1000 nodes.
An association schema defines canonical field order.
It rejects duplicate keys, missing required keys, unknown keys, and wrong field order.
Generic Pel lists still permit duplicate keys. Strict host association schemas do not.
Schema IDs are immutable registry keys over these structures.
A failure schema is `{codes: readonly string[], maxMessageBytes:number, maxCauseBytes:number, requiredCauseKeys:readonly string[]}`.
A structured cause contains ordinary canonical JSON data with finite numbers and bounded strings, arrays, and objects.
It is not converted into Pel value tags.
Validate required cause keys and canonical byte size through the registry failure schema.
M4 validates its typed provider or policy cause before producing the receipt.
M1 preserves that valid cause unchanged, including the canonical provider failure tag.
Absent causes remain absent.
Required cause keys apply only when a cause exists.

The builtin result schemas include `schema:pel-boolean-v1` for pel/nl-condition and `schema:pel-data-v1` for print.
The latter uses the bounded data schema with maxDepth 256 and maxBytes from the admitted value limit.
M4 registers both executable handlers against these M1 descriptors.

Canonical `PelDataValue` JSON is exactly one of:
`{tag:"number",value:number}`, `{tag:"string",value:string}`, `{tag:"boolean",value:boolean}`, `{tag:"nil"}`,
`{tag:"key",name:string}`, `{tag:"pair",key:string,value:PelDataValue}`, or `{tag:"list",items:readonly PelDataValue[]}`.
Key names omit the leading colon.
Decode rejects unknown fields, invalid Unicode, nonfinite numbers, and unsafe integer values.
Normalize negative zero to zero before encoding.
The encoded-value limit counts the canonical UTF-8 bytes of this representation.
Hash values with SHA-256 over the same bytes.
A pair and a two-element list therefore have different hashes.

`formatPel` prints nil as `#nil`, booleans as `#t/#f`, and keys with their leading colon.
Pairs print as a key, one space, and the formatted value.
Lists use brackets and single spaces with no trailing space.
Numbers print the shortest round-trippable finite decimal without exponent notation.
Strings use double quotes with JSON-style escapes for quote, backslash, newline, carriage return, tab, and control characters.
Other valid Unicode scalars remain literal.
Symbols print with a leading quote.
Syntax prints a leading quote and its normalized AST form.
Closures print `#<closure:nodeId remaining=names>`, which is diagnostic text and cannot be parsed as executable source.

Host descriptors additionally contain `resourceResolverId` and a data-only resource envelope.
M2 resolves abstract resources through the installed resolver catalog.
M4 resolves concrete resources through `resolveResources(descriptor,boundArgs,hostContext)`.
The pure resolver catalog accepts argument-path and admitted-workspace selectors, never source-provided executable code.
Concrete paths must remain within the descriptor's declared envelope and M4 authority.
The resolver catalog and its version participate in the registry digest.

## Complete builtin signatures

`ArgSpecV1` is either `fixed` with ordered parameter records or `sequence` for do and do/async.
Each fixed parameter has `name`, `required`, `evaluation: "strict" | "syntax"`, and an optional default expression.
A required parameter never has a default.
Parser pair nodes retain `valuePresent: boolean` and the original key/value syntax.
Thus `[:x]` differs from `[:x #nil]` before evaluation.
Lambda reads parameter syntax directly. It never evaluates the ArgSpec list as ordinary Pel values.

| Builtin | Ordered ArgSpec | Evaluation |
| --- | --- | --- |
| def | :name required, :value required | Both syntax. Validate binder symbol, then evaluate value at full application. |
| lambda | :params required, :body required | Both syntax. Exactly one body expression. Evaluate defaults at closure formation. |
| + | :x required, :y required | Strict, with the single-list overload below. |
| -, *, /, pow, gt, lt, eq, concat | :x required, :y required | Strict. Arithmetic/comparison requires numbers. Concat requires strings. |
| sqrt, not | :x required | Strict. Sqrt requires number. Not requires Boolean. |
| len | :value required | Strict string or list. |
| if | :cond required, :then required, :else default #nil | Syntax. Evaluate condition, then selected branch. |
| case | :scrut required, :body required | Syntax. Body is a bracket sequence. |
| for | :coll required, :iterator required, :body required | Syntax. Iterator is a binder symbol. |
| do, do/async | expression sequence | Syntax. These alone accept sequence ArgSpec. |
| callable list | :at default #nil, :from default #nil, :to default #nil | Strict. |
| print | :vals required, :sep default "", :nl default #f | Strict, registered host effect. |
| pel/nl-condition | :scrut required, :condition required | Strict, registered host effect. |

All fixed builtins support named arguments and partial application through the same binder.
`(def name)` returns a partial non-strict closure without introducing a binding.
Supplying its remaining value binds the name in the captured original caller scope.
`(lambda [:x])` returns a partial non-strict constructor waiting for its body.
`((lambda [:x] x))` returns a partial closure.
`((lambda [:x #nil] x))` returns nil.
For `[:x :y 3]`, x is required and y defaults to 3.
For `[:x 1 :y]`, x defaults to 1 and y is required.
Positional arguments bind declaration order, including defaulted parameters.

The single-list + overload applies only to a fresh + closure receiving exactly one argument bound to x.
If x is a list, reduce its numeric elements with zero as the empty-list result.
If x is not a list, return the ordinary partial binary closure.
A partially bound binary + never switches overload.
Thus `(+ :x 1 :y 2)` returns 3, `((+ 5) 4)` returns 9, and `(+ [1 2])` returns 3.
`((+ 5) [1 2])` returns `PEL_TYPE`.

Selected if/case branches evaluate in the caller's current scope.
A def inside that branch binds that scope.
For creates a fresh child scope per iteration.
Do creates one child scope for its whole sequence.
Definitions inside do or for do not escape.
Do/async creates a block scope with reserved definition cells and dependency checks.

Case evaluates the scrutinee exactly once.
A literal string condition requests the admitted natural-language predicate.
A symbol or other expression that produces a string returns `PEL_TYPE`, not an implicit model invocation.
An explicit caret condition substitutes the scrutinee in its case-local caret scope.
A no-caret call receives the scrutinee as its first argument.
A Boolean literal stands alone.
`(case 7 [(gt ^ 5) "big" #t "small"])` returns "big".

## Failure, child, and revision details

A failed asynchronous child stops release of new requests.
Already released sibling requests remain in the preserved continuation for M4 cancellation or reconciliation.
Their identities and counters are not discarded.
A parent merge of a final child failure returns failed with the identical host failure and merged counters.
Export `extractClosureEnvironment(parent: PelContinuationV1, closure: PelClosureValue)` to retrieve its validated lexical table.
Unreferenced, mismatched, or inaccessible environment IDs return `PEL_CONTINUATION_MISMATCH`.
Successful child results for retry and race must be `PelDataValue`.
A child returning a closure or syntax returns `PEL_HOST_RESULT` at that host-library boundary.
M4 charges consumed counters from winning, failed, cancelled, and abandoned children exactly once by child invocation ID.
It does not require a winning receipt to charge a losing child's counters.

Export `validateRevisionPrefix(oldProgram,newProgram,completedPrefixCount,recordedCalls): Result<PelRevisionPrefixV1,PelDiagnostic>`.
This pure helper compares normalized completed top-level forms, invocation paths, and recorded bound arguments.
Success returns old/new node-path mappings for M4's journaled `PelRevisionMappingV1`.
A completed-prefix change returns `PEL_CONTINUATION_MISMATCH` before revised evaluation.
It retains no old frames or mutable environments.
M4 replays the new source from the start through mapped recorded values.
Receipts inside a replaced region are never mapped.
Edits inside a top-level form with completed external effects are unsupported. A failed pure suffix with no completed external effects can be replaced.

`PelLimitsV1` fields are maxSourceBytes, maxTokens, maxAstNodes, maxSyntaxDepth, maxReductions, maxIterations, maxCallDepth, and maxValueBytes.
`PelCounters` fields are sourceBytes, tokens, astNodes, syntaxDepthPeak, reductions, iterations, callDepthPeak, and valueBytesPeak.
Work counters add across children. Depth and byte peaks take the maximum.
Live child allocations share an aggregate value-byte allowance enforced before allocation.
This prevents several individually bounded children from exceeding the aggregate value limit.
All counters are nonnegative safe integers.

Diagnostic mapping is exact:
unknown, duplicate, or previously bound partial argument name -> PEL_ARGUMENT_NAME,
excess arguments -> PEL_ARITY,
mixed modes or at-plus-slice -> PEL_ARGUMENT_MODE,
wrong value type -> PEL_TYPE,
invalid index -> PEL_INDEX,
division by zero or nonfinite/unsafe arithmetic -> PEL_NUMERIC_DOMAIN.
Numeric literals outside the profile range return PEL_LEX.
`1e5`, an overlong out-of-range decimal, and a digit-leading malformed token return PEL_LEX.
A lone minus is a symbol bound to subtraction.
`Infinity` and `NaN` are ordinary symbol tokens and subsequently fail with PEL_UNBOUND_SYMBOL unless explicitly bound.
Keyword scanning consumes its allowed characters before ordinary symbol scanning.
Caret is not a keyword character.
`:a^b` tokenizes key :a, caret, symbol b and then fails PEL_CARET_SCOPE outside a pipe.
`:a |> (f)` tokenizes a keyword, pipe, and call.
The pipe token wins over a standalone vertical bar. A standalone vertical bar or greater-than returns PEL_LEX.
The ordinary symbol scanner also excludes quote and caret as explicit profile restrictions.

## PDF and compatibility provenance

The normative glyph evidence is the pinned PDF, visually inspected at pages 11 and 14.
See `docs/research/pel-release/sources/pel/glyph-verification.md` and its page images.
The independent PixelRAG 0.4.0 reread records all 29 pages in `docs/research/pel-release/sources/pel/pixelrag-reading.md`.
The extraction text corrupts mathematical and code glyphs and is not the tokenizer authority.
The PDF KEY class includes asterisk and less-than, excludes caret, and permits greater-than.
The PDF SYMBOL exclusion class includes vertical bar and greater-than.
The visible pipe is a right-pointing triangle.
ASCII `|>` is an explicit normalization inferred from these exclusions and the paper's Elixir comparison.
Do not claim that the PDF reveals original source bytes.
Standalone caret remains injection syntax.

The profile table below classifies every semantics row and supplies planned positive/negative fixture IDs.
The same rows must appear in `docs/reference/pel/compatibility.md`.
Each fixture lives in `packages/pel/test/fixtures/paper-v2.json`.
A conformance test rejects missing fixture IDs or unclassified profile rows.
The frozen builtin signatures, single-list + overload, lexical immutability, scope choices, and safe limits are explicit extensions.
Nested router-generated Pel execution from paper §6 is unsupported.
Router output can enter M2 as a new checked draft but cannot execute through an implicit eval or nested-run function.
The paper's multi-argument print examples are corrected to a list supplied as :vals.
Passing a second positional string still binds :sep under the frozen signature.
Fixture IDs cover this correction and the absence of an implicit eval.

Test build configuration sets `declaration: false` and `declarationMap: false`.
Add `**/dist-test/**` to `tsconfig.all.json` exclusions.
Add the Pel project reference to `packages/orchestration/tsconfig.json`.
Run workspace typecheck again after compiling test output.

## Normative profile classification matrix

The class applies to the complete corresponding profile row, including restrictions.
Each positive and negative ID is a mandatory planned entry in paper-v2.json.
Negative paper fixtures violate the stated rule. Negative extension fixtures exercise its rejected boundary.

| Decision | Class | Paper locator | Positive fixture | Negative fixture | Rationale or conflict |
| --- | --- | --- | --- | --- | --- |
| Programs, §4.1 | extension | §4.1, p10 | PV2-001-P | PV2-001-N | Specify deterministic behavior where the paper is incomplete. |
| Lexing, §4.1 | extension | §4.1, p11 | PV2-002-P | PV2-002-N | Specify deterministic behavior where the paper is incomplete. |
| Token boundaries | extension | §4.1, p11 | PV2-003-P | PV2-003-N | Specify deterministic behavior where the paper is incomplete. |
| Constants | extension | §4.1 p11 and §4.2 p12 | PV2-004-P | PV2-004-N | Specify deterministic behavior where the paper is incomplete. |
| Numbers | extension | §4.1 p11 and §4.2 p12 | PV2-005-P | PV2-005-N | Specify deterministic behavior where the paper is incomplete. |
| Strings | extension | §4.1 p11 and §4.2 p12 | PV2-006-P | PV2-006-N | Specify deterministic behavior where the paper is incomplete. |
| Keywords | extension | §4.1, p11 | PV2-007-P | PV2-007-N | Specify deterministic behavior where the paper is incomplete. |
| Pair formation | extension | §4.2, p12 | PV2-008-P | PV2-008-N | Specify deterministic behavior where the paper is incomplete. |
| Quotes | extension | §4.1, pp10–11 | PV2-009-P | PV2-009-N | The complete profile row adds deterministic restrictions. The pure paper baseline is listed separately below. |
| Quoted data | extension | §4.1, pp10–11 | PV2-010-P | PV2-010-N | Specify deterministic behavior where the paper is incomplete. |
| Nil, §4.2 | extension | §4.2, p12 | PV2-011-P | PV2-011-N | The complete profile row adds deterministic restrictions. The pure paper baseline is listed separately below. |
| Lists, §4.5 | extension | §4.5, pp15–16 | PV2-012-P | PV2-012-N | Specify deterministic behavior where the paper is incomplete. |
| List calls | extension | §4.5, p15 | PV2-013-P | PV2-013-N | Specify deterministic behavior where the paper is incomplete. |
| Slices | extension | §4.5, pp15–16 | PV2-014-P | PV2-014-N | Specify deterministic behavior where the paper is incomplete. |
| Selection | extension | §4.5, pp15–16 | PV2-015-P | PV2-015-N | The complete profile row adds deterministic restrictions. The pure paper baseline is listed separately below. |
| Keys | extension | §4.5, p16 | PV2-016-P | PV2-016-N | Specify deterministic behavior where the paper is incomplete. |
| Index errata | erratum | §4.2 p12 and §4.5 pp15–16 | PV2-017-P | PV2-017-N | One-indexed prose conflicts with later index-1 result 6 and zero-index loop. |
| Definitions, §4.3 | extension | §4.3, p13 | PV2-018-P | PV2-018-N | Specify deterministic behavior where the paper is incomplete. |
| Lexical capture | extension | §4.3, p13 | PV2-019-P | PV2-019-N | The complete profile row adds deterministic restrictions. The pure paper baseline is listed separately below. |
| Arguments | extension | §4.3, pp13–14 | PV2-020-P | PV2-020-N | Specify deterministic behavior where the paper is incomplete. |
| Defaults | extension | §4.3, p14 | PV2-021-P | PV2-021-N | Specify deterministic behavior where the paper is incomplete. |
| Binding | extension | §4.3, pp13–14 | PV2-022-P | PV2-022-N | The complete profile row adds deterministic restrictions. The pure paper baseline is listed separately below. |
| Errors | extension | §4.3, p14 | PV2-023-P | PV2-023-N | The complete profile row adds deterministic restrictions. The pure paper baseline is listed separately below. |
| Strictness | extension | §4.3, p14 | PV2-024-P | PV2-024-N | The complete profile row adds deterministic restrictions. The pure paper baseline is listed separately below. |
| Pipes, §4.4 | extension | §4.4, pp14–15 | PV2-025-P | PV2-025-N | The complete profile row adds deterministic restrictions. The pure paper baseline is listed separately below. |
| Pipe normalization | erratum | §4.1 p11 and §4.4 p14 | PV2-026-P | PV2-026-N | PDF triangle glyph and symbol exclusions support ASCII normalization. Text extraction is corrupt. |
| Caret scope | extension | §4.4 pp14–15 and §4.6.2 p17 | PV2-027-P | PV2-027-N | Specify deterministic behavior where the paper is incomplete. |
| Lambda pipe scope | extension | §4.3 p13 and §4.4 pp14–15 | PV2-028-P | PV2-028-N | Specify deterministic behavior where the paper is incomplete. |
| `if`, §4.6.1 | extension | §4.6.1, p17 | PV2-029-P | PV2-029-N | The complete profile row adds deterministic restrictions. The pure paper baseline is listed separately below. |
| `case`, §4.6.2 | extension | §4.6.2, p17 | PV2-030-P | PV2-030-N | The complete profile row adds deterministic restrictions. The pure paper baseline is listed separately below. |
| Case conditions | extension | §4.6.2, p17 | PV2-031-P | PV2-031-N | Specify deterministic behavior where the paper is incomplete. |
| Natural-language case, §4.7 | extension | §4.7, pp18–19 | PV2-032-P | PV2-032-N | Specify deterministic behavior where the paper is incomplete. |
| `for`, §4.6.3 | extension | §4.6.3, p18 | PV2-033-P | PV2-033-N | Specify deterministic behavior where the paper is incomplete. |
| `do`, §4.6.4 | extension | §4.6.4, p18 | PV2-034-P | PV2-034-N | Specify deterministic behavior where the paper is incomplete. |
| `do/async`, §4.6.5 | extension | §4.6.5, p18 | PV2-035-P | PV2-035-N | Specify deterministic behavior where the paper is incomplete. |
| Sequence arity correction | erratum | §3 p9 and §4.6.4 p18 | PV2-036-P | PV2-036-N | Fixed-arity prose conflicts with do accepting expression sequences. |
| Dependencies, §5.2 | extension | §5.2, p22 | PV2-037-P | PV2-037-N | Specify deterministic behavior where the paper is incomplete. |
| Binding dependencies | extension | §5.2, p22 | PV2-038-P | PV2-038-N | Specify deterministic behavior where the paper is incomplete. |
| Restart, §5.1 | extension | §5.1, pp19–22 | PV2-039-P | PV2-039-N | Specify deterministic behavior where the paper is incomplete. |
| Builtin ArgSpecs and required/default presence | extension | §4.3, pp13–14 | PV2-040-P | PV2-040-N | Specify deterministic behavior where the paper is incomplete. |
| Pure builtin set and single-list + overload | extension | §4.3 p13 and §4.4 p14 | PV2-041-P | PV2-041-N | Specify deterministic behavior where the paper is incomplete. |
| Def/for/if/do scope and recursion restrictions | extension | §4.3 p13 and §4.6 pp17–18 | PV2-042-P | PV2-042-N | Specify deterministic behavior where the paper is incomplete. |
| Canonical wire values and registry schemas | extension | §4.2, p12 | PV2-043-P | PV2-043-N | Specify deterministic behavior where the paper is incomplete. |
| Print list argument and defaults | extension | §4.3 p13 and §5.1 p21 | PV2-044-P | PV2-044-N | Preserve vals. Correct defaults/list usage and explicitly extend stdout to journal plus stderr routing. |
| Nested router generation without implicit eval | extension | §6, pp22–24 | PV2-045-P | PV2-045-N | Restrict nested generated execution to a new M2 checked draft. |
| Keyword precedence and numeric malformed tokens | extension | §4.1, p11 | PV2-046-P | PV2-046-N | Specify deterministic behavior where the paper is incomplete. |
| Bounds, host suspension, and failure receipts | extension | §5.1, pp19–22 | PV2-047-P | PV2-047-N | Specify deterministic behavior where the paper is incomplete. |

### Paper baseline rows separated from profile restrictions

These rows state only the cited paper rule. Restrictions remain in the extension rows above.

| Decision | Class | Paper locator | Positive fixture | Negative fixture | Exact baseline rule |
| --- | --- | --- | --- | --- | --- |
| Nil representations | paper | §4.2, p12 | PV2-048-P | PV2-048-N | Both #nil and () denote absence of a value. |
| Mixed argument prohibition | paper | §4.3, p14 | PV2-049-P | PV2-049-N | A call cannot mix named and positional arguments. |
| Multiple index selection | paper | §4.5, pp15–16 | PV2-050-P | PV2-050-N | A list of indices selects the corresponding list elements. |
| Definition environment capture | paper | §4.3, p13 | PV2-051-P | PV2-051-N | A closure captures the environment in which it is defined. |
| Builtin strictness | paper | §4.3, p14 | PV2-052-P | PV2-052-N | Strict functions evaluate arguments, while non-strict builtins receive expressions. |
| If branch selection | paper | §4.6.1, p17 | PV2-053-P | PV2-053-N | If evaluates its condition and only the selected branch. |
| Case ordering and pipe chain | paper | §4.6.2, p17 | PV2-054-P | PV2-054-N | Case tries conditions in order and pipes its scrutinee into the leading call of a condition chain. |
| Quoted expression grammar | paper | §4.1, pp10–11 | PV2-055-P | PV2-055-N | A quote precedes an expression and disables pair formation within quoted syntax. |
| Literal-list pair formation | paper | §4.2, p12 | PV2-056-P | PV2-056-N | A key followed by a non-keyword value forms a pair, while a standalone key pairs with nil. |

## Evaluation options and final program values

`PelRunOptionsV1` contains:
- `dependencyMode: "ordered" | "automatic"`.
- `nlConditionProfile: null | {profileId:string,transportId:string,controls:JsonValue,credentialProfileRef:string,outputSchemaId:string}`.
- `nlConditionProfileDigest: string | null`.
- `replay: {mode:"none"} | {mode:"completed-prefix",completedPrefixCount:number,prefixDigest:string,recordedCounters:PelCounters,committedCounters:PelCounters,maxReplayReductions:number}`.

Default options use ordered mode, null predicate selection, null selection digest, and replay none.
Controls use validated canonical JSON here, so M1 does not import provider packages.
M2 and M4 validate their concrete ProviderControlsV1 schema.
A nonnull selection digest must equal the SHA-256 of its canonical selection.
A reachable literal-string condition with null selection returns PEL_REGISTRY before releasing its request.
The request carries `selectionDigest` and `selection: {profileId,transportId,controls,credentialProfileRef,outputSchemaId}`.
Only pel/nl-condition requests carry these fields.
The output schema must be schema:pel-boolean-v1.

Compute optionsDigest from the entire canonical PelRunOptionsV1 value.
Continuations record optionsDigest and replayPhase, either prefix or execution.
Both startPel and resumePel receive explicit options.
Resume rejects any changed option with PEL_CONTINUATION_MISMATCH.
ClosureEvaluationContextV1 includes the selected options and optionsDigest.
Ordinary child invocations retain dependency and predicate selection but use replay none with their allocated counters.

Ordered mode releases the next top-level expression only after its predecessor completes.
Automatic mode releases all dependency-ready top-level expressions in source order.
The example `(test/a) (test/b)` initially releases only A in ordered mode and both A and B in automatic mode.
A nonempty program always returns the value of its last source top-level expression.
Automatic mode waits for every required expression before returning that value, regardless of completion order.
An empty program returns nil.

Completed-prefix replay counts reductions and iterations separately as replayReductions and replayIterations.
The maxReplayReductions bound caps replay reductions and also bounds its possible iteration count.
It does not increment ordinary execution reductions or iterations within that completed prefix.
Only M4-approved mapped receipts can satisfy prefix host calls. No unmatched prefix request may dispatch.
At the validated top-level prefix boundary, verify the replay trace against recordedCounters and restore ordinary reductions and iterations from committedCounters exactly.
CommittedCounters is the latest durable failed-step total, including work after the last suspension. It cannot be lower than recordedCounters.
Fresh sourceBytes, tokens, and astNodes describe the revised source. Depth and value peaks retain the greater old or new value.
Enter execution phase after these field-specific checks.
Subsequent work consumes the remaining ordinary limits.
The replay descriptor remains in optionsDigest after the phase transition.
A restored continuation uses its recorded replayPhase and never restores boundary counters twice.
A failed prefix match returns PEL_CONTINUATION_MISMATCH.
Replay fuel exhaustion returns PEL_LIMIT with bound maxReplayReductions.

## Caret ownership and case condition evaluation

Caret tokens are valid parser syntax in every expression position.
The parser does not infer a builtin identity from a symbol's spelling.
The evaluator raises PEL_CARET_SCOPE only when it demands a caret without an active binding.
M2 can report the same code during abstract evaluation of a definitely unbound caret.
An unresolved callable postpones the binding decision within its checked dynamic region.

Pipes bind their evaluated left value in an evaluation context, rather than blindly substituting through all raw argument syntax.
Quotes stop propagation.
A nested pipe owns the binding in its right operand.
When a resolved non-strict builtin is case, its body argument is withheld from the enclosing pipe binding.
Each case condition receives the once-evaluated scrutinee as its nearest caret binding.
This rule uses resolved builtin identity, so aliases and partial case closures behave identically.

For each condition, apply these rules in order:
1. A literal Boolean is used directly.
2. A literal string requests the admitted natural-language predicate.
3. An expression with carets owned by this condition evaluates under the scrutinee binding.
4. A no-caret call receives the scrutinee as its first argument.
5. A no-caret pipe chain receives the scrutinee at its first primary, then evaluates the remaining chain normally.
6. Another expression evaluates normally. A resulting closure is called with the scrutinee. A resulting Boolean is used directly.
7. Any final non-Boolean result returns PEL_TYPE.

Nested-pipe right-operand carets do not count as free carets for rule 3.
A first primary that cannot accept pipe input fails with PEL_TYPE.
Case consequences evaluate only after selection, outside the condition's caret binding.
They retain any enclosing pipe binding that existed at case invocation.

Thus `7 |> (case ^ [(gt ^ 5) "big" #t "small"])` returns "big".
The body caret belongs to case and the scrutinee caret belongs to the outer pipe.
`(case [1 2 3 4 5 6] [(len) |> (gt 5) "big" #t "small"])` returns "big".
`(def c case) (c 7 [(gt ^ 5) "big" #t "small"])` also returns "big".
`(+ 1 2) |> (def z ^)` returns 3 and binds z to 3 in the caller scope.
A quote containing a caret remains data and does not raise a scope error.

The lexer terminates ordinary symbols at greater-than.
For `a>b`, it emits the symbol a, then returns PEL_LEX at the greater-than byte.
For `>b`, it immediately returns PEL_LEX.
The keyword `:a>` remains one valid keyword token.
U+25B7 is a reserved rejected code point outside strings and comments.
For `x ▷ (f)`, return PEL_LEX at that glyph with the hint "use |>".

## Canonical internal host arguments

Export `encodeHostArgumentsV1(boundArguments,environmentTable): HostArgumentsEncodingV1`.
This encoding is for trusted host-library arguments and journal identity, not provider-return data.
HostArgumentsEncodingV1 contains schemaVersion 1, registryDigest, optionsDigest, ordered arguments, a canonical node table, and environmentDigest.
The validated environmentTable header supplies both binding digests.
Data-only arguments retain the existing PelDataValue encoding.

A closure argument is a closure-ref containing sourceDigest, nodeId, environmentId, environmentDigest, argSpecDigest, and boundArguments.
Captured syntax is a syntax-ref containing sourceDigest, nodeId, and environmentId.
Bound argument entries contain data values or table references, never recursively expanded closure objects.
Environment records contain an optional parent reference and sorted lexical-name-to-value references.
Reserved recursive definition cells are explicit node records with a stable reference to the completed closure.
Validate that every reference resolves and no runtime function, address, or object identity appears in the encoding.

Assign canonical IDs n0, n1, and so forth by deterministic traversal.
Seed traversal with bound arguments in declaration order.
Visit an environment's parent first, then lexical bindings sorted by Unicode scalar spelling.
Visit closure bound arguments in ArgSpec declaration order.
Assign an ID on first visit before traversing its edges, so cycles terminate.
Emit records sorted by their assigned numeric IDs.
Compute environmentDigest from the canonical complete node/reference table with all digest fields omitted.
Then fill that digest into closure-ref records.
Hash the canonical final HostArgumentsEncodingV1 for intent and revision argument digests.
Never recursively hash a node's environmentDigest.

The decoder reconstructs references and validates source, registry, options, ArgSpec, and environment bindings.
Repeated encode/decode of recursive closures yields identical bytes and argument digests.
M4 persists child continuations and their optionsDigest alongside this argument digest.
M1 does not create another durable child store.

## Additional classified compatibility decisions

Print retains the supplied :vals under schema:pel-data-v1.
Journaling output and routing human program output to stderr is an explicit Foreman extension from the paper's stdout behavior.
The returned value is unchanged in both human and JSON modes.
The print classification fixtures cover value preservation, journal output, and one JSON object on stdout.
