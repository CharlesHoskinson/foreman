# Implement independent syntax and exact values: design

## Context and decisions

Parse original UTF-8 bytes independently. Preserve byte offsets and scalar line/column locations, including CRLF and malformed input. The K grammar owns ambiguity, precedence, quote binding, pair formation, and ASCII pipe normalization. A transport codec may decode bytes, but must not reuse the TypeScript tokenizer or parser.

Use explicit value constructors for number, string, Boolean, nil, key, pair, list, symbol, syntax, and closure. Keep nil distinct from an empty list. Preserve duplicate-key order, first-match lookup, and pair presence. Closure graph semantics belong to K03.

Represent finite binary64 numbers with explicit precision and exponent semantics. Normalize negative zero according to the profile. Reject forbidden infinities, NaNs, unsafe integer results, and numeric domain errors. Test decimal parsing, subnormals, rounding ties, overflow, underflow, division, square root, and exponentiation. In particular, do not assume K pow and JavaScript Math.pow share an exact algorithm. Freeze a reviewed compatibility decision for every observed disagreement before accepting K02. A cross-runtime ambiguity blocks the affected claim until resolved.

## File ownership

- `formal/pel/syntax.k`
- `formal/pel/values.k`
- `formal/pel/numeric.k`
- `formal/pel/pel.k`
- `packages/pel/test/k/syntax-values.test.ts`
- `packages/pel/test/k/fixtures/syntax-values.json`

These are implementation targets, not files delivered by this plan.
Shared files require serial integration through the program owner.
Preserve existing public APIs and unrelated user changes.

## Interfaces

Consume the [program contracts](../pel-k-release-program/contracts.md) and dependency package outputs.
Produce the case and evidence records defined there, with suite identity `pel-k-syntax-values`.
Every requirement ID below is also a case-group ID accepted by the planned check command.
The program's [coverage map](../pel-k-release-program/coverage.json) binds inherited M7 rows to package owners.

## Failure and verification

Use the negative scenarios as admission controls.
Retain each failed source, host schedule, observation, and tool log.
Do not mark a requirement complete until its distinguishing case runs against the implemented candidate.
See [tasks.md](tasks.md) for commands and exact expected outcomes.
