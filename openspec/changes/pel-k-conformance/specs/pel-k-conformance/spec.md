# Build independent differential and mutation evidence

## ADDED Requirements

### Requirement: K07-001 Complete executable coverage

The conformance gate SHALL execute every required language case and retain separate product-only boundary dispositions.

#### Scenario: K07-001-P Accepted behavior

- **GIVEN** All current paper fixtures, regression scenarios, and inventory members.
- **WHEN** Resolve each row to a rule label, positive case, distinguishing case, and actual result.
- **THEN** Report zero unmapped language members and zero unexecuted required cases.

#### Scenario: K07-001-N Distinguishing refusal

- **GIVEN** Delete a fixture, mark language behavior product-only, or count a declared case that never ran.
- **WHEN** The same requirement check runs.
- **THEN** Fail closure and retain the unchanged required denominator.

### Requirement: K07-002 Independent expectations

The comparator SHALL compare each fixed case against independently reviewed profile expectations.

#### Scenario: K07-002-P Accepted behavior

- **GIVEN** A fixture for which TypeScript and a mutated K definition produce the same wrong result.
- **WHEN** Compare both implementations to the frozen expected observation.
- **THEN** Reject shared disagreement with the normative expectation.

#### Scenario: K07-002-N Distinguishing refusal

- **GIVEN** Regenerate expected values from the TypeScript engine or use AST import for source-parser coverage.
- **WHEN** The same requirement check runs.
- **THEN** Refuse the substituted evidence and preserve the original expectation.

### Requirement: K07-003 Bounded generation and shrinking

The harness SHALL generate reproducible bounded source programs and retain replayable minimal counterexamples.

#### Scenario: K07-003-P Accepted behavior

- **GIVEN** The declared fixed seeds, grammar bounds, and finite host schedules.
- **WHEN** Run the required tier and shrink each mismatch within the declared budget.
- **THEN** Retain original and minimized source, receipts, options, seed, observations, and all relevant digests.

#### Scenario: K07-003-N Distinguishing refusal

- **GIVEN** Interrupt generation, exceed a budget, or fail to reproduce the minimized case.
- **WHEN** The same requirement check runs.
- **THEN** Report incomplete evidence. Retain the original reproducible failure.

### Requirement: K07-004 Mutation effectiveness

The mutation suite SHALL detect every mandatory semantic and comparator mutation using unchanged fixtures.

#### Scenario: K07-004-P Accepted behavior

- **GIVEN** Mutations change indexing, strictness, capture, pipe effects, result selection, replay counters, receipt binding, child charging, and span comparison.
- **WHEN** Compile temporary definitions and run each distinguishing control.
- **THEN** Each behavior-changing mutant is detected and each unmodified control passes.

#### Scenario: K07-004-N Distinguishing refusal

- **GIVEN** A mutant survives, fails only to compile, or is detected solely by a changed hash.
- **WHEN** The same requirement check runs.
- **THEN** Fail the mutation gate. Compilation or hash rejection alone does not establish behavioral sensitivity.

### Requirement: R-M7-017 Differential evidence and proof status

When conformance evidence is recorded, the TypeScript harness SHALL bind source, K definition, toolchain, runtime, corpus and comparator digests to executed case counts.

#### Scenario: T-M7-017

- **GIVEN** One real execution report,missing K executable,stale source hash and interrupted child process.
- **WHEN** Run and validate reports with finite timeout/output bounds and scoped cleanup.
- **THEN** Only actually executed cases count; missing prerequisites are unavailable, interrupted cases incomplete, and stale evidence cannot pass.

### Requirement: R-M7-016 Differential evidence and proof status

When differential conformance runs, the TypeScript harness SHALL compare independently specified expected observations, K execution and the existing M1 engine for every mapped fixture.

#### Scenario: T-M7-016

- **GIVEN** All paper-v2 rows and current M1 control,closure,limits,host,replay and child regression cases.
- **WHEN** Execute the closed corpus plus fixed-seed bounded programs using the same explicit host schedules.
- **THEN** Every included constructor has positive and negative cases; missing rows or mismatches fail and retain a minimal source/receipt counterexample.

### Requirement: R-M7-018 Differential evidence and proof status

When a semantic mutation changes a required rule, the conformance suite SHALL detect the changed observable behavior.

#### Scenario: T-M7-018

- **GIVEN** Mutations make indexing zero-based,evaluate both if branches,recapture closures dynamically,duplicate pipe effects or reset replay counters.
- **WHEN** Run each temporary mutation against its distinguishing unchanged fixture.
- **THEN** Every mutation is detected; merely parsing or compiling a definition cannot pass conformance.
