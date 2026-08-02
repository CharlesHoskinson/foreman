# Spec delta: positive-control expansion

## ADDED Requirements

### Requirement: v0.3 expands the gate inventory one named kind at a time

Foreman SHALL extend the v0.2.9 full-tree check inventory to named checks of
`kind: probe` and `kind: verdict-predicate` in v0.3.

Each added kind SHALL keep the identity form
`<repository-relative path>::<check name>`.

Each registered check SHALL bind to existing known-bad, known-good, and
same-run control-record paths. The control record SHALL show opposite
classifications for the two arms.

The comparator SHALL fail on an empty selected-kind inventory, an unregistered
check, a stale row, malformed data, an absent evidence path, or identical
classifications.

#### Scenario: probe expansion does not change the v0.2.9 gate census

- WHEN v0.2.9 runs the comparator with `--kind gate`
- THEN probe and verdict-predicate rows do not become v0.2.9 release blockers
- AND the v0.3 package preserves their implementation work.

#### Scenario: a new probe kind earns enforcement through a RED control

- WHEN the scanner adds `--kind probe`
- THEN a fixture with an unregistered named probe makes the comparator fail
- AND adding a valid row with opposite control classifications restores PASS.

### Requirement: output keywords do not define check identity

Foreman SHALL derive probe and verdict-predicate identities from named
executable consumers, not from a scan for words such as `PASS`, `FAIL`,
`WARNING`, or `BLOCKED`.

IF a predicate is reachable only through a wrapper that the grammar does not
recognize, THEN the coverage report SHALL name that limitation and SHALL NOT
describe the inventory as exhaustive.

#### Scenario: help text does not become a verdict predicate

- WHEN a documentation or help string contains `PASS` and `FAIL`
- THEN the scanner does not emit a check identity for that string
- AND only the named parser that consumes an outcome can enter the inventory.

### Requirement: exhaustive assertion registration stays withdrawn

Foreman SHALL NOT require an exhaustive repository-wide registry row for every
Bats assertion.

Each feature package SHALL still prove its own new assertions fail-capable
through test-first implementation or a known-bad arm.

#### Scenario: withdrawal does not waive feature tests

- WHEN a feature adds a new assertion
- THEN its owning package still demonstrates a failing pre-fix state
- AND the assertion does not need a row in the global positive-control
  registry solely because it is an assertion.
