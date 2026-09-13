# Implement scheduling, limits, and diagnostics

## ADDED Requirements

### Requirement: K04-001 Ready-task scheduling

The scheduler SHALL reproduce ordered and automatic dependency-ready work under the same external receipt schedule.

#### Scenario: K04-001-P Accepted behavior

- **GIVEN** Independent requests, dependent definitions, conflicting bindings, and both completion orders.
- **WHEN** Run both modes and project each ready boundary.
- **THEN** Match request identities, ready sets, already-emitted flags, and required ordering.

#### Scenario: K04-001-N Distinguishing refusal

- **GIVEN** Introduce a dependency cycle or execute a dependent task before its producer.
- **WHEN** The same requirement check runs.
- **THEN** Return the prescribed cycle diagnostic or reject the invalid transition.

### Requirement: K04-002 Final source selection

The scheduler SHALL select the final source expression value regardless of completion order.

#### Scenario: K04-002-P Accepted behavior

- **GIVEN** A slow first expression and an earlier-completing final expression.
- **WHEN** Complete requests in each admitted order.
- **THEN** Return the final source expression value with the same charged counters.

#### Scenario: K04-002-N Distinguishing refusal

- **GIVEN** Mutate result selection to choose the last completed task.
- **WHEN** The same requirement check runs.
- **THEN** The distinguishing case fails even if all individual expression values are correct.

### Requirement: K04-003 Exact resource boundaries

The limit rules SHALL preserve all eight profile limits and their exact debit boundaries.

#### Scenario: K04-003-P Accepted behavior

- **GIVEN** Source, token, AST, syntax-depth, reduction, iteration, call-depth, and value-byte limits at zero and N-1, N, N+1.
- **WHEN** Execute each boundary before and after suspension.
- **THEN** Match counters and the first rejected operation. Preserve nondecreasing cumulative counters.

#### Scenario: K04-003-N Distinguishing refusal

- **GIVEN** Use invalid limit values or mutate one counter to charge after the operation.
- **WHEN** The same requirement check runs.
- **THEN** Reject invalid limits and detect the changed debit boundary.

### Requirement: K04-004 Located diagnostics

The definition SHALL cover every diagnostic code without disguising stuck execution or tool failure.

#### Scenario: K04-004-P Accepted behavior

- **GIVEN** All current diagnostic constructors with distinguishing spans and structured fields.
- **WHEN** Execute each negative fixture and a valid neighboring case.
- **THEN** Match specified fields and preserve the valid case result.

#### Scenario: K04-004-N Distinguishing refusal

- **GIVEN** Remove a required semantic rule or exhaust the harness wall-clock bound.
- **WHEN** The same requirement check runs.
- **THEN** Report stuck or timeout outside the Pel diagnostic domain and fail the required gate.

### Requirement: R-M7-007 Scheduling, bounds and diagnostics

When top-level dependencies become ready, the K definition SHALL reproduce ordered and automatic M1 evaluation with ready/already-emitted batches and the last-source result.

#### Scenario: T-M7-007

- **GIVEN** Independent requests with both receipt orders,dependent definitions,conflicting symbol bindings and a slow first expression.
- **WHEN** Run both M1 options and all bounded receipt schedules.
- **THEN** Request identity and ready batches agree; completion order does not change the selected last-source result. Permitted independent interleavings are compared explicitly.

### Requirement: R-M7-008 Scheduling, bounds and diagnostics

When a Pel semantic limit is reached, the K definition SHALL stop at the same pre-operation boundary and preserve the same counters as M1.

#### Scenario: T-M7-008

- **GIVEN** Source,token,AST,syntax depth,reduction,iteration,call depth and value-byte limits at N-1,N,N+1.
- **WHEN** Run limit boundary fixtures and repeat after serialization.
- **THEN** Counters and rejection boundaries agree; administrative K rewrites do not debit Pel counters.

### Requirement: R-M7-009 Scheduling, bounds and diagnostics

If execution encounters an invalid state or operation, then the K definition SHALL return a located domain diagnostic without inventing a host result.

#### Scenario: T-M7-009

- **GIVEN** Unknown symbol,arity/type errors,malformed closure graph,host failure and a deliberately stuck semantics rule.
- **WHEN** Execute invalid fixtures and remove one required rule in a temporary mutation definition.
- **THEN** Defined failures agree with M1; stuck/timeout/tool failure is harness failure, distinct from a Pel diagnostic.
