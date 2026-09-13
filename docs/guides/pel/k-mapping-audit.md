# Pel to K mapping audit

Audit date: 2026-09-13. Profile: `pel-paper-v2-foreman-1`.

**Result: the language inventory is mapped to planned M7 requirements. The K implementation is absent.**
No Pel K definition, K conformance test directory, execution result, or proof was found.
This audit establishes traceability in the sprint plan. It does not establish executable semantic coverage or TypeScript/K equivalence.

## What changed

The existing M7 plan covered broad semantic families but lacked a row-by-row mapping to the current implementation.
This audit supplies that mapping, including pure builtins, internal evaluation operations, diagnostics, and continuation fields.
The [machine-readable inventory](k-mapping-audit.json) records source hashes and exact members.
Source changes require a new comparison. A profile identifier alone cannot establish freshness.

The inventory contains 56 compatibility decisions with 112 fixtures, 12 AST constructors, 22 builtin signatures, 17 evaluation operations, and 18 diagnostic codes.
All listed members have a planned requirement destination. Every implementation and proof obligation remains open.
The inventory also records 22 current TypeScript test files for the future differential corpus.
Those tests are existing TypeScript evidence, not K tests.

## Compatibility decisions

Each row includes both its positive and negative fixture. Requirement identifiers refer to the [M7 specification](../../../openspec/changes/foredi-07-k-semantics/specs/foredi-07-k-semantics/spec.md).
Every row also requires independent differential comparison under R-M7-016 and artifact binding under R-M7-017.
All K destinations below are **planned**.

| Existing profile fixtures and decision | Planned K requirements |
| --- | --- |
| PV2-001-P / -N: Programs, §4.1 | R-M7-002, R-M7-007 |
| PV2-002-P / -N: Lexing, §4.1 | R-M7-002 |
| PV2-003-P / -N: Token boundaries | R-M7-002 |
| PV2-004-P / -N: Constants | R-M7-002, R-M7-004 |
| PV2-005-P / -N: Numbers | R-M7-002, R-M7-003 |
| PV2-006-P / -N: Strings | R-M7-002, R-M7-004 |
| PV2-007-P / -N: Keywords | R-M7-002, R-M7-004 |
| PV2-008-P / -N: Pair formation | R-M7-002, R-M7-004 |
| PV2-009-P / -N: Quotes | R-M7-002, R-M7-004 |
| PV2-010-P / -N: Quoted data | R-M7-002, R-M7-004 |
| PV2-011-P / -N: Nil, §4.2 | R-M7-002, R-M7-004 |
| PV2-012-P / -N: Lists, §4.5 | R-M7-004 |
| PV2-013-P / -N: List calls | R-M7-004 |
| PV2-014-P / -N: Slices | R-M7-004 |
| PV2-015-P / -N: Selection | R-M7-004 |
| PV2-016-P / -N: Keys | R-M7-004 |
| PV2-017-P / -N: Index errata | R-M7-004 |
| PV2-018-P / -N: Definitions, §4.3 | R-M7-005, R-M7-007 |
| PV2-019-P / -N: Lexical capture | R-M7-005 |
| PV2-020-P / -N: Arguments | R-M7-005 |
| PV2-021-P / -N: Defaults | R-M7-005 |
| PV2-022-P / -N: Binding | R-M7-005 |
| PV2-023-P / -N: Errors | R-M7-005, R-M7-009 |
| PV2-024-P / -N: Strictness | R-M7-005, R-M7-006 |
| PV2-025-P / -N: Pipes, §4.4 | R-M7-006 |
| PV2-026-P / -N: Pipe normalization | R-M7-002, R-M7-006 |
| PV2-027-P / -N: Caret scope | R-M7-006 |
| PV2-028-P / -N: Lambda pipe scope | R-M7-005, R-M7-006 |
| PV2-029-P / -N: `if`, §4.6.1 | R-M7-006 |
| PV2-030-P / -N: `case`, §4.6.2 | R-M7-006 |
| PV2-031-P / -N: Case conditions | R-M7-006 |
| PV2-032-P / -N: Natural-language case, §4.7 | R-M7-006, R-M7-010, R-M7-011 |
| PV2-033-P / -N: `for`, §4.6.3 | R-M7-006, R-M7-008 |
| PV2-034-P / -N: `do`, §4.6.4 | R-M7-006 |
| PV2-035-P / -N: `do/async`, §4.6.5 | R-M7-006, R-M7-007 |
| PV2-036-P / -N: Sequence arity correction | R-M7-005, R-M7-006 |
| PV2-037-P / -N: Dependencies, §5.2 | R-M7-007 |
| PV2-038-P / -N: Binding dependencies | R-M7-007 |
| PV2-039-P / -N: Restart, §5.1 | R-M7-013, R-M7-014 |
| PV2-040-P / -N: Builtin ArgSpecs and required/default presence | R-M7-005 |
| PV2-041-P / -N: Pure builtin set and single-list + overload | R-M7-003, R-M7-004, R-M7-005 |
| PV2-042-P / -N: Def/for/if/do scope and recursion restrictions | R-M7-005, R-M7-006 |
| PV2-043-P / -N: Canonical wire values and registry schemas | R-M7-004, R-M7-010, R-M7-011 |
| PV2-044-P / -N: Print list argument and defaults | R-M7-005, R-M7-010 |
| PV2-045-P / -N: Nested router generation without implicit eval | R-M7-004, R-M7-012 |
| PV2-046-P / -N: Keyword precedence and numeric malformed tokens | R-M7-002, R-M7-003 |
| PV2-047-P / -N: Bounds, host suspension, and failure receipts | R-M7-008, R-M7-010, R-M7-011 |
| PV2-048-P / -N: Nil representations | R-M7-002, R-M7-004 |
| PV2-049-P / -N: Mixed argument prohibition | R-M7-005 |
| PV2-050-P / -N: Multiple index selection | R-M7-004 |
| PV2-051-P / -N: Definition environment capture | R-M7-005 |
| PV2-052-P / -N: Builtin strictness | R-M7-005, R-M7-006 |
| PV2-053-P / -N: If branch selection | R-M7-006 |
| PV2-054-P / -N: Case ordering and pipe chain | R-M7-006 |
| PV2-055-P / -N: Quoted expression grammar | R-M7-002, R-M7-004 |
| PV2-056-P / -N: Literal-list pair formation | R-M7-002, R-M7-004 |

## Syntax and values

K must parse source independently. Importing the TypeScript AST cannot validate grammar equivalence.
Lexical coverage includes all 13 token kinds, UTF-8 validation, comments, CRLF, escapes, numeric boundaries, and byte/scalar source locations.
ASCII pipe normalization and rejection of alternate glyphs belong to R-M7-002.

| AST constructor | Planned K requirements |
| --- | --- |
| `number` | R-M7-002, R-M7-003 |
| `string` | R-M7-002, R-M7-004 |
| `boolean` | R-M7-002, R-M7-004 |
| `nil` | R-M7-002, R-M7-004 |
| `key` | R-M7-002, R-M7-004 |
| `symbol` | R-M7-002, R-M7-005 |
| `caret` | R-M7-002, R-M7-006 |
| `pair` | R-M7-002, R-M7-004 |
| `list` | R-M7-002, R-M7-004 |
| `call` | R-M7-002, R-M7-005, R-M7-006, R-M7-010 |
| `quote` | R-M7-002, R-M7-004 |
| `pipe` | R-M7-002, R-M7-006 |

The value domain contains number, string, boolean, nil, key, pair, list, symbol, syntax, and closure tags.
R-M7-003 covers numbers. R-M7-004 covers data and quoted syntax. R-M7-005 covers closures.
Preserve pair presence in syntax, duplicate-key order, first-match lookup, one-based selection, inclusive slices, and the distinction between nil and an empty list.

## Builtin signatures and behavior

The exact argument specifications remain in `packages/pel/src/builtins.ts`.
R-M7-005 applies to argument mode, partial application, defaults, aliases, and strictness for every callable.

| Builtin or callable-list signature | Planned K requirements |
| --- | --- |
| `def` | R-M7-005, R-M7-007 |
| `lambda` | R-M7-005 |
| `+` | R-M7-003, R-M7-005 |
| `-` | R-M7-003, R-M7-005 |
| `*` | R-M7-003, R-M7-005 |
| `/` | R-M7-003, R-M7-005 |
| `pow` | R-M7-003, R-M7-005 |
| `gt` | R-M7-003, R-M7-004 |
| `lt` | R-M7-003, R-M7-004 |
| `eq` | R-M7-004, R-M7-005 |
| `concat` | R-M7-004, R-M7-005 |
| `sqrt` | R-M7-003, R-M7-005 |
| `not` | R-M7-004, R-M7-005 |
| `len` | R-M7-004, R-M7-005 |
| `if` | R-M7-006 |
| `case` | R-M7-006, R-M7-010 |
| `for` | R-M7-006, R-M7-008 |
| `do` | R-M7-006 |
| `do/async` | R-M7-006, R-M7-007 |
| `list` | R-M7-004, R-M7-005 |
| `print` | R-M7-005, R-M7-010 |
| `pel/nl-condition` | R-M7-006, R-M7-010, R-M7-011 |

The planned fixtures must distinguish every pure operation, not merely one representative arithmetic expression.
Include the single-list `+` overload, binary partial application, binary64 rounding, overflow, safe-integer rejection, and negative-zero normalization.
Include Unicode-scalar string length, string concatenation, Boolean-only negation, and structural equality with nested-closure rejection.
Pin the selected `pow` and `sqrt` numerical behavior explicitly. Generic K integer arithmetic cannot stand in for these operations.

## Evaluation and restoration

The evaluator declares these 17 operation variants. Map each to explicit K computation frames and its observable transitions.
Administrative K rewrites do not consume Pel reduction counters.

| TypeScript operation | Planned K requirements |
| --- | --- |
| `eval` | R-M7-004, R-M7-005, R-M7-006 |
| `collect` | R-M7-004, R-M7-005 |
| `pair` | R-M7-004 |
| `pipe` | R-M7-006 |
| `pipe-head` | R-M7-006 |
| `pass` | R-M7-006 |
| `bind` | R-M7-005 |
| `invoke` | R-M7-005, R-M7-010 |
| `define` | R-M7-005, R-M7-007 |
| `lambda` | R-M7-005 |
| `if` | R-M7-006 |
| `case-start` | R-M7-006 |
| `case` | R-M7-006, R-M7-010 |
| `for-start` | R-M7-006 |
| `for` | R-M7-006, R-M7-008 |
| `block` | R-M7-006, R-M7-007 |
| `host` | R-M7-010, R-M7-011 |

R-M7-013 must project every continuation field listed in the machine-readable inventory, including optional failure state.
Preserve version and identity bindings, program and registry, run options, limits, environments, tasks, root, runnable queue, pending requests, completed receipts, and counters.
Also preserve next identity allocation, merged-child markers, and replay phase.
Task projections must retain parent, operation payload, environment, path, depth, caret, source span, node identity, and completed value.

R-M7-014 covers source revisions and completed-prefix replay. R-M7-015 covers child allocation, failed work, and duplicate-merge charging.
R-M7-007 covers dependency cycles, conflicting bindings, both execution modes, readiness, and the last source result.
R-M7-008 covers all eight limits and counters at boundary values, including aggregate retained data before another effect.

## Diagnostics and host boundary

R-M7-009 applies to every diagnostic below, including primary and related spans and applicable signature, help, bound, consumption, and failure details.

| Diagnostic | Additional planned K requirements |
| --- | --- |
| `PEL_LEX` | R-M7-002 |
| `PEL_PARSE` | R-M7-002 |
| `PEL_UNBOUND_SYMBOL` | R-M7-005 |
| `PEL_UNINITIALIZED_BINDING` | R-M7-005, R-M7-007 |
| `PEL_DUPLICATE_BINDING` | R-M7-005, R-M7-007 |
| `PEL_TYPE` | R-M7-004, R-M7-005, R-M7-006 |
| `PEL_ARGUMENT_MODE` | R-M7-005 |
| `PEL_ARGUMENT_NAME` | R-M7-005 |
| `PEL_ARITY` | R-M7-005 |
| `PEL_INDEX` | R-M7-004 |
| `PEL_NUMERIC_DOMAIN` | R-M7-003 |
| `PEL_CARET_SCOPE` | R-M7-006 |
| `PEL_DEPENDENCY_CYCLE` | R-M7-007 |
| `PEL_LIMIT` | R-M7-008 |
| `PEL_HOST_RESULT` | R-M7-011 |
| `PEL_HOST_FAILURE` | R-M7-010 |
| `PEL_REGISTRY` | R-M7-010, R-M7-011 |
| `PEL_CONTINUATION_MISMATCH` | R-M7-013, R-M7-014, R-M7-015 |

R-M7-010 and R-M7-011 cover registry identity, fully applied suspension, request identity, matching receipts, and atomic validation of a supplied receipt subset.
Include already-emitted requests, no receipt, invalid receipt, typed failure, forged descriptors, forbidden host value tags, and schema mismatch.
Natural-language conditions require the selected predicate digest and a typed Boolean response. Print produces an abstract output event.
R-M7-012 keeps actual provider behavior, credentials, filesystem grants, budgets, cancellation, publication, and M4 retry/race policies external.
M2 generation and checking are authoring services. Generated source must re-enter a checked draft and cannot acquire implicit evaluation or authority.
JavaScript accessor and prototype rejection belong to the TypeScript boundary checks unless a separate correspondence claim includes them.

## Remaining verification obligations

- Implement the six planned K modules and record actual toolchain and backend hashes.
- Define the observation projection, numerical model, grammar locations, and closure graph correspondence.
- Turn each mapped profile pair and relevant TypeScript regression into independently specified K comparison cases.
- Add positive and negative cases for each builtin, operation, diagnostic, and continuation field. Inventory membership does not establish sufficient behavioral cases.
- Execute differential tests, finite receipt schedules, fixed-seed programs, and distinguishing mutations on one unchanged definition.
- Check the two scoped receipt/counter claims with the proof backend and retain the deliberately false control.
- Keep parser, evaluator, continuation, and host correspondence claims open until their individual evidence exists.

The M7 task list remains unchecked. This audit adds no release approval and does not expand a planned sprint into a completed formalization.
