# Implement independent syntax and exact values

## ADDED Requirements

### Requirement: K02-001 Independent grammar

The K parser SHALL cover all token kinds and AST constructors using source bytes independently of the TypeScript parser.

#### Scenario: K02-001-P Accepted behavior

- **GIVEN** Every PV2 lexical and grammar pair plus comments, escapes, Unicode, CRLF, and both supported ASCII pipe forms.
- **WHEN** Parse with K and TypeScript and compare independently expected trees and locations.
- **THEN** All required nodes and spans agree, including quote and pair-presence distinctions.

#### Scenario: K02-001-N Distinguishing refusal

- **GIVEN** Supply malformed UTF-8, ambiguous boundaries, malformed numeric tokens, or the unsupported alternate pipe glyph.
- **WHEN** The same requirement check runs.
- **THEN** Return the specified located lexical or parse rejection. AST-import success cannot substitute for this result.

### Requirement: K02-002 Numeric fidelity

The K numeric rules SHALL preserve the selected profile arithmetic, bit patterns, normalization, and safe-integer restrictions.

#### Scenario: K02-002-P Accepted behavior

- **GIVEN** Negative zero, 0.1 plus 0.2, subnormal values, rounding ties, and safe-integer boundaries.
- **WHEN** Run arithmetic, comparisons, pow, and sqrt on both backends and TypeScript.
- **THEN** Match independently reviewed numeric expectations bitwise after permitted normalization.

#### Scenario: K02-002-N Distinguishing refusal

- **GIVEN** Supply division by zero, forbidden nonfinite results, unsafe integer results, or a backend rounding disagreement.
- **WHEN** The same requirement check runs.
- **THEN** Return the profile diagnostic for invalid arithmetic. Treat implementation disagreements as unresolved conformance failures.

### Requirement: K02-003 Tagged values and selection

The definition SHALL preserve all value tags and callable-list selection rules.

#### Scenario: K02-003-P Accepted behavior

- **GIVEN** Nil, empty lists, explicit nil pairs, duplicate keys, quoted syntax, multiple indices, and inclusive slices.
- **WHEN** Evaluate values and callable selections.
- **THEN** Preserve tag identity, ordering, first-match lookup, and one-based selection.

#### Scenario: K02-003-N Distinguishing refusal

- **GIVEN** Select index zero, a missing key, or a forbidden index type.
- **WHEN** The same requirement check runs.
- **THEN** Return the selected profile diagnostic and location. Do not collapse nil, missing values, and empty lists.

### Requirement: K02-004 Syntax and data separation

The definition SHALL prevent syntax and closure values from becoming ordinary host data through quoting or serialization.

#### Scenario: K02-004-P Accepted behavior

- **GIVEN** Nested quotes, quoted pairs, and provider-shaped strings.
- **WHEN** Evaluate and encode the values without an explicit execution operation.
- **THEN** Preserve syntax as syntax and strings as data. No generated string executes.

#### Scenario: K02-004-N Distinguishing refusal

- **GIVEN** Place a closure or syntax node inside a host data result.
- **WHEN** The same requirement check runs.
- **THEN** Reject the result at its schema boundary without evaluating its contents.

### Requirement: R-M7-002 Pinned profile and executable syntax

When Pel source is parsed by the K definition, the definition SHALL produce the selected M1 syntax and source locations independently of the TypeScript parser.

#### Scenario: T-M7-002

- **GIVEN** Every lexical and grammar row in paper-v2.json, including escapes, quoted pairs, caret, malformed numbers and Unicode spans.
- **WHEN** Parse with K and TypeScript independently and compare normalized trees or diagnostic locations.
- **THEN** All selected syntax cases agree; unsupported syntax is a located rejection, not an assumed AST translation.

### Requirement: R-M7-003 Pinned profile and executable syntax

When numeric expressions execute, the K definition SHALL reproduce the finite binary64 and safe-integer restrictions of the selected Pel profile.

#### Scenario: T-M7-003

- **GIVEN** Negative zero,0.1+0.2,maximum safe integer,overflow,division by zero and out-of-range literals.
- **WHEN** Execute each expression and compare canonical tagged values or diagnostic codes.
- **THEN** Finite values agree bitwise after the profile normalization; invalid numbers reject. Unbounded K integers do not replace Pel numeric behavior.

### Requirement: R-M7-004 Values, closures and native control

When a Pel value or callable list is evaluated, the K definition SHALL preserve M1 tags, pair presence, nil, quoting and one-based selection.

#### Scenario: T-M7-004

- **GIVEN** Nil/empty list,standalone keyword,pair with explicit nil,quoted symbol,multiple indices,slices,index zero and missing key.
- **WHEN** Execute positive and distinguishing negative value fixtures.
- **THEN** Exact tagged values and selection errors match M1; syntax and closures cannot become ordinary host data.
