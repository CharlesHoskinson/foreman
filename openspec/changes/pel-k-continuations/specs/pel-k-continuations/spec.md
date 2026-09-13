# Implement continuation, replay, and child semantics

## ADDED Requirements

### Requirement: K06-001 Complete continuation projection

The projection SHALL account for every continuation field and nested operation frame without dropping semantic state.

#### Scenario: K06-001-P Accepted behavior

- **GIVEN** Suspension inside nested closures with defaults, syntax arguments, ready work, and consumed receipts.
- **WHEN** Encode, decode, and restore at every reachable suspension boundary in the fixed corpus.
- **THEN** Resume to the same observations, counters, and graph correspondence as uninterrupted execution.

#### Scenario: K06-001-N Distinguishing refusal

- **GIVEN** Drop mergedChildren, replayPhase, runnable, optional failure, or a captured default.
- **WHEN** The same requirement check runs.
- **THEN** Reject malformed state or detect a distinguishing resumed mismatch.

### Requirement: K06-002 Restore validation

The restoration rules SHALL reject invalid graph references and stale source, profile, registry, or options bindings before resumption.

#### Scenario: K06-002-P Accepted behavior

- **GIVEN** A valid continuation and independently mutated binding and graph fields.
- **WHEN** Validate each state before any request emission.
- **THEN** Accept the valid state and preserve its original identity.

#### Scenario: K06-002-N Distinguishing refusal

- **GIVEN** Use dangling environments, malformed cycles, duplicate pending IDs, or changed options.
- **WHEN** The same requirement check runs.
- **THEN** Return the specified mismatch diagnostic without emitting effects.

### Requirement: K06-003 Completed-prefix replay

The replay rules SHALL preserve completed receipt bindings and reject incompatible source revisions.

#### Scenario: K06-003-P Accepted behavior

- **GIVEN** A completed pure prefix, a completed effect, and a pending suffix.
- **WHEN** Replay an unchanged prefix and then try a changed executed effect argument.
- **THEN** Reuse completed receipts without re-emission and retain original counters.

#### Scenario: K06-003-N Distinguishing refusal

- **GIVEN** Revise a completed effect argument, captured environment, or prohibited replay boundary.
- **WHEN** The same requirement check runs.
- **THEN** Reject the revision without rewriting accepted history.

### Requirement: K06-004 Child accounting

The child rules SHALL preserve one-based allocation and at-most-once merge charging across success, failure, and cancellation.

#### Scenario: K06-004-P Accepted behavior

- **GIVEN** Two child closures, nested children, and separate parent remaining limits.
- **WHEN** Allocate and merge children through the public M1 interfaces.
- **THEN** Match child IDs, parent charges, and remaining limits exactly.

#### Scenario: K06-004-N Distinguishing refusal

- **GIVEN** Merge the same child twice or merge a mismatched child continuation.
- **WHEN** The same requirement check runs.
- **THEN** Reject or preserve the specified idempotent result without a second charge.

### Requirement: R-M7-013 Continuations and replay

When a suspended configuration is serialized and restored, the K definition SHALL preserve lexical values, pending identities, selected options and consumed counters.

#### Scenario: T-M7-013

- **GIVEN** Nested closures,syntax arguments,ready/already-emitted effects and malformed environment references.
- **WHEN** Roundtrip K state and the M1 continuation through the declared correspondence projection.
- **THEN** Equivalent configurations resume to identical observations; broken graph/profile bindings reject. Raw wire-byte equality is required only where explicitly specified.

### Requirement: R-M7-014 Continuations and replay

When completed-prefix replay or a source revision is modeled, the K definition SHALL preserve completed receipt bindings and the selected M1 replay boundary.

#### Scenario: T-M7-014

- **GIVEN** Completed pure prefix,pending suffix,changed executed effect argument,unchanged closure capture and changed options.
- **WHEN** Replay the retained prefix and compare accepted/rejected revisions with M1.
- **THEN** No completed host request is emitted twice; invalid revisions reject and original counters remain charged.

### Requirement: R-M7-015 Continuations and replay

When an M1 child continuation is allocated or merged, the K definition SHALL preserve one-based child identity and charge child counters exactly once.

#### Scenario: T-M7-015

- **GIVEN** Two child closures,duplicate merge,cancelled/failed child and nested child replay.
- **WHEN** Compare start-child and merge-child observations with the M1 public APIs.
- **THEN** Child identities,remaining limits and parent charges agree; M4 retry/race policy remains outside this language-model proof domain.
