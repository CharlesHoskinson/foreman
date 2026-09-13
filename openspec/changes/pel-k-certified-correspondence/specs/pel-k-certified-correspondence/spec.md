# Prove the stronger TypeScript correspondence claim

## ADDED Requirements

### Requirement: K11-001 Source representation admission

K2 SHALL require a checked source binding for the admitted TypeScript execution semantics before accepting a correspondence proof.

#### Scenario: K11-001-P Accepted behavior

- **GIVEN** Exact parser, evaluator, continuation, dependency, numeric, and runtime validation source hashes.
- **WHEN** Complete the end-to-end vertical slice through the selected mechanized representation.
- **THEN** Identify every trusted translation and runtime assumption with checked binding evidence.

#### Scenario: K11-001-N Distinguishing refusal

- **GIVEN** Use only a hand-copied evaluator model or differential test results.
- **WHEN** The same requirement check runs.
- **THEN** Refuse certified correspondence and report the remaining source-binding obligation.

### Requirement: K11-002 Parser preservation and rejection

K2 SHALL prove source-parser correspondence for admitted bytes including the selected malformed-input and location behavior.

#### Scenario: K11-002-P Accepted behavior

- **GIVEN** The full profile grammar and actual tokenizer/parser representation.
- **WHEN** Discharge parse success and rejection relation obligations across the full declared domain.
- **THEN** Relate equivalent trees, byte locations, and specified rejection outcomes.

#### Scenario: K11-002-N Distinguishing refusal

- **GIVEN** Prove only a translated AST subset or omit malformed input.
- **WHEN** The same requirement check runs.
- **THEN** Keep full source-parser certification incomplete.

### Requirement: K11-003 Evaluator trace correspondence

K2 SHALL prove both directions of observable trace correspondence under the declared runtime and host assumptions.

#### Scenario: K11-003-P Accepted behavior

- **GIVEN** Related initial states, fixed scheduling choices, and admissible finite host scripts.
- **WHEN** Prove initialization, step simulation in both directions, and terminal observation agreement.
- **THEN** Preserve values, effects, failures, counters, and admitted administrative stuttering.

#### Scenario: K11-003-N Distinguishing refusal

- **GIVEN** Prove one sample program, one direction, or only final values.
- **WHEN** The same requirement check runs.
- **THEN** Record only the narrower result and block the full K2 claim.

### Requirement: K11-004 Recovery and theorem closure

K2 SHALL prove continuation and replay preservation and close all theorem dependencies before certification.

#### Scenario: K11-004-P Accepted behavior

- **GIVEN** Related suspended states, accepted revisions, and child merges.
- **WHEN** Discharge restore, replay, and charging obligations and audit the dependency graph.
- **THEN** Bind the complete claim to the exact source and formal toolchain with an independent replay.

#### Scenario: K11-004-N Distinguishing refusal

- **GIVEN** Use assumed equivalence lemmas, unresolved counterexamples, or an unsupported termination claim.
- **WHEN** The same requirement check runs.
- **THEN** Refuse certification and retain explicit open obligations.
