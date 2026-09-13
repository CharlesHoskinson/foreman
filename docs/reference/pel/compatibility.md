# Pel compatibility

The profile is `pel-paper-v2-foreman-1`. It implements the pinned Pel v2 paper profile in strict TypeScript for Node.js 24.

Compatibility means conformance to this profile. No verified upstream implementation supplied the compatibility oracle. The language does not execute arbitrary JavaScript or shell source.

The source is [Pel v2](https://arxiv.org/abs/2505.13453v2), sections 4 through 6. The pinned PDF SHA-256 is `8060369dde44dace725eadf856bbfa43db96e79c61bfe406c0d2598d10c6f178`. The captured [manifest](../../research/pel-release/sources/pel/manifest.json) records attribution.

The [glyph review](../../research/pel-release/sources/pel/glyph-verification.md) verifies pages 11 and 14. The [PixelRAG reading](../../research/pel-release/sources/pel/pixelrag-reading.md) checks all 29 pages. Page-image checks establish nil and pairs on page 12, argument modes on page 14, and if/case on page 17.

ASCII `|>` normalizes the printed triangle. This decision is an inference from the PDF rendering and symbol exclusions. The rendering does not establish original source bytes. The lexer rejects extracted `^>` and the unnormalized triangle. Caret remains injection syntax.

The fixture corpus contains one positive and one negative case for every row below. Each case stores source attribution, normalized AST, expected result or diagnostic, and emitted host requests. Some negative paper cases assert a counterexample result instead of adding an extension restriction. The test suite checks exact metadata against the controlling design and executes each case.

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
| Nil representations | paper | §4.2, p12 | PV2-048-P | PV2-048-N | Both #nil and () denote absence of a value. |
| Mixed argument prohibition | paper | §4.3, p14 | PV2-049-P | PV2-049-N | A call cannot mix named and positional arguments. |
| Multiple index selection | paper | §4.5, pp15–16 | PV2-050-P | PV2-050-N | A list of indices selects the corresponding list elements. |
| Definition environment capture | paper | §4.3, p13 | PV2-051-P | PV2-051-N | A closure captures the environment in which it is defined. |
| Builtin strictness | paper | §4.3, p14 | PV2-052-P | PV2-052-N | Strict functions evaluate arguments, while non-strict builtins receive expressions. |
| If branch selection | paper | §4.6.1, p17 | PV2-053-P | PV2-053-N | If evaluates its condition and only the selected branch. |
| Case ordering and pipe chain | paper | §4.6.2, p17 | PV2-054-P | PV2-054-N | Case tries conditions in order and pipes its scrutinee into the leading call of a condition chain. |
| Quoted expression grammar | paper | §4.1, pp10–11 | PV2-055-P | PV2-055-N | A quote precedes an expression and disables pair formation within quoted syntax. |
| Literal-list pair formation | paper | §4.2, p12 | PV2-056-P | PV2-056-N | A key followed by a non-keyword value forms a pair, while a standalone key pairs with nil. |

The [extension reference](extensions.md) describes the capability boundary, frozen signatures, limits, and restart ownership.
