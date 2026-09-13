# Pel profile extensions

The profile identifier is `pel-paper-v2-foreman-1`. The [compatibility matrix](compatibility.md) separates paper rules, errata, and extensions. These classifications apply to the complete row.

The language package owns deterministic parsing, values, argument binding, and evaluation. The execution owner controls providers, credentials, subprocesses, filesystem access, timeouts, and cancellation.

## Source and values

Source input is UTF-8. Byte offsets are zero-based and half-open. Lines and Unicode scalar columns are one-based. CRLF counts as one newline.

Symbols retain their original Unicode spelling. The parser does not normalize Unicode. Source identity includes every byte, including whitespace and comments. Node identity combines that digest with a child-index path.

ASCII `|>` is the accepted pipe spelling. The parser rejects `^>` and the printed triangle. Caret is a separate token. Quotes contain complete expressions and prevent nested pair formation.

A pair records whether its source value was present. A required parameter `:x` therefore differs from the nil default `:x #nil`. Duplicate data keys remain ordered entries. Lookup returns the first match.

Nil has two source forms, `#nil` and `()`. An empty list remains `[]`. Nil is not a Boolean condition.

Numbers use finite JavaScript numbers within the profile range. Integer results must remain safe integers. The parser rejects malformed numbers and out-of-range decimal literals before rounding. Negative zero becomes zero.

Canonical host data uses tagged JSON values. The permitted tags are number, string, boolean, nil, key, pair, and list. Provider results cannot inject symbols, syntax, closures, descriptors, or source code.

Quoted symbols and syntax remain language values. There is no implicit `eval` function. Generated source must enter a new checked draft through M2.

## Arguments and pure functions

User lambdas have fixed argument specifications. Parameters can be required or have defaults. Defaults evaluate once when the lambda forms. Required parameters can follow defaults.

Calls use positional arguments or named arguments. A call cannot mix both modes. Unknown names, duplicate names, and partial-closure rebinding fail. Missing required parameters produce partial closures.

Lambdas capture their definition environment. Each invocation creates a child scope. Definitions are immutable within their scope. A later definition does not repair an earlier unbound capture.

The pure function signatures are fixed:

| Function | Arguments |
| --- | --- |
| `+`, `-`, `*`, `/`, `pow`, `gt`, `lt`, `eq`, `concat` | `:x :y` |
| `sqrt`, `not` | `:x` |
| `len` | `:value` |
| Callable list | `:at #nil :from #nil :to #nil` |

`+` also accepts one numeric list. This overload does not permit arbitrary argument counts. A partially applied binary `+` keeps its binary signature.

List positions are one-based. Slices include both bounds. Reversed valid bounds return an empty list. Explicit invalid bounds fail. Multi-selection preserves order and duplicates.

## Native control flow

The evaluator resolves non-strict builtins by callable identity. Aliases therefore retain the same behavior.

| Function | Arguments | Scope |
| --- | --- | --- |
| `def` | `:name :value` | Caller scope |
| `lambda` | `:params :body` | Definition environment, then child invocation scope |
| `if` | `:cond :then :else #nil` | Selected branch uses caller scope |
| `case` | `:scrut :body` | Each condition owns its scrutinee carets |
| `for` | `:coll :iterator :body` | Fresh child scope per iteration |
| `do` | Expression sequence or one bracket sequence | One child scope |
| `do/async` | Expression sequence or one bracket sequence | One child scope with dependency analysis |

Only `do` and `do/async` accept sequence argument specifications. Empty sequences return nil. Nonempty programs and blocks return the last source expression's value after required work completes.

A pipe evaluates its input once. A right-side call without a free caret receives that input first. The nearest pipe or case condition owns each unquoted caret. A lambda formed within a pipe captures its bound caret value.

Case evaluates its scrutinee once. It checks conditions in source order. A no-caret call chain receives the scrutinee at its first primary. Nonliteral conditions must produce Booleans.

A literal string condition requests `pel/nl-condition`. The execution options must supply an admitted predicate selection and its canonical digest. Missing selection fails before request release. The returned value must satisfy `schema:pel-boolean-v1`.

Ordered top-level execution is the default. Automatic mode releases dependency-ready expressions. Resource conflicts still require host checks. Dependency cycles fail with `PEL_DEPENDENCY_CYCLE`.

## Host contract

Only a validated immutable host registry creates callable host descriptors. A pair with descriptor-like fields remains data. Registry identity includes descriptors, schemas, resolver catalog, and profile identity.

A fully applied host closure suspends evaluation. A partial host closure emits no request. Each request records source identity, AST identity, invocation identity, bound arguments, and expected result schema.

The host returns receipts by request ID. It can return any pending subset in any completion order. Evaluation checks the whole supplied subset before changing continuation data.

Every suspension lists released requests that lack receipts. `alreadyEmitted` is false only on the first exposure. This field reports evaluator delivery. It does not prove external dispatch.

Valid failure receipts return `PEL_HOST_FAILURE`. The diagnostic preserves the declared failure code, message, and structured cause. Invalid receipts instead return `PEL_HOST_RESULT`.

The print signature is `:vals :sep "" :nl #f`. Multiple printed values use one list. Journal and stderr routing are Foreman extensions. Pel evaluation itself performs no output operation.

## Limits

The profile supplies finite defaults. A host can lower them. Admission can explicitly supply larger finite bounds.

| Bound | Default |
| --- | ---: |
| Source bytes | 1,048,576 |
| Tokens | 100,000 |
| AST nodes | 50,000 |
| Syntax depth | 256 |
| Reductions | 100,000 |
| Aggregate loop iterations | 10,000 |
| Call depth | 256 |
| Encoded value bytes | 16,777,216 |

A reduction consumes fuel before execution. A loop iteration consumes its allowance before its body. Limit failures occur before an over-limit expression can emit a host request. Resumption preserves consumed counters.

Diagnostics contain a stable code, primary span, related spans, message, and expected forms. Applicable errors also include a signature or help. Limit errors identify the bound and consumed count.

## Continuations and restart ownership

Continuations contain serializable frames, environments, closures, pending requests, completed values, and counters. Restoration checks source, profile, registry, and options identities. Changed identities fail with `PEL_CONTINUATION_MISMATCH`.

The execution owner controls abort, expression replacement, suffix replacement, program replacement, and helper repair. Replacement creates a new source revision. An old continuation cannot resume under the new source digest.

M4 validates any completed-prefix reuse before fresh replay. Mapped receipts preserve completed effects through journal aliases. Replay uses separate bounded counters. Ordinary execution retains the latest committed totals, including failed suffix work.

Retry attempts and race contenders have distinct child invocation identities. Nested request identities include those child identities. Failed and abandoned child work remains charged to the aggregate limits.

Provider calls, durable journals, reconciliation, and restart approval belong to the execution owner. The language package does not confer capabilities or infer successful external outcomes.
