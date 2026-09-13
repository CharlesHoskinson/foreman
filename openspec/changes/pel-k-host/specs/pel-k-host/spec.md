# Specify and execute abstract host boundaries

## ADDED Requirements

### Requirement: K05-001 Request and receipt binding

The host rules SHALL complete only a pending request whose receipt and contextual bindings validate.

#### Scenario: K05-001-P Accepted behavior

- **GIVEN** Two requests with distinct invocation paths and matching typed receipts.
- **WHEN** Supply success and failure receipts in both permitted orders.
- **THEN** Consume each matching receipt at most once and preserve other pending requests.

#### Scenario: K05-001-N Distinguishing refusal

- **GIVEN** Supply a wrong request ID, stale registry context, conflicting duplicate, or wrong result schema.
- **WHEN** The same requirement check runs.
- **THEN** Reject without completing a different request or changing accepted evidence.

### Requirement: K05-002 Host schema completeness

The host model SHALL validate all registry schema alternatives and selected argument forms.

#### Scenario: K05-002-P Accepted behavior

- **GIVEN** Number, string, Boolean, nil, key, pair, list, association, union, and bounded data schemas.
- **WHEN** Execute positive boundary cases for each schema and host argument mode.
- **THEN** Match registry, argument, result, and failure validation outcomes.

#### Scenario: K05-002-N Distinguishing refusal

- **GIVEN** Supply extra association keys, wrong union alternatives, oversized values, or closure-bearing data.
- **WHEN** The same requirement check runs.
- **THEN** Return the specified registry or host-result diagnostic.

### Requirement: K05-003 Abstract outputs and predicates

The definition SHALL record print and natural-language condition boundaries as observable data.

#### Scenario: K05-003-P Accepted behavior

- **GIVEN** Print defaults and a predicate with explicit selection identity and a supplied Boolean response.
- **WHEN** Execute the same closed script in K and TypeScript.
- **THEN** Match output ordering, argument values, and predicate selection bindings.

#### Scenario: K05-003-N Distinguishing refusal

- **GIVEN** Supply missing predicate evidence or an invalid response type.
- **WHEN** The same requirement check runs.
- **THEN** Remain suspended for missing evidence and reject invalid evidence. Do not infer a truth value.

### Requirement: K05-004 Authority separation

The model SHALL keep provider truth, resource grants, persistence, cancellation, and publication outside language-derived guarantees.

#### Scenario: K05-004-P Accepted behavior

- **GIVEN** Ordinary Pel data shaped like a release approval and a pending external request.
- **WHEN** Project the host boundary without live provider or filesystem operations.
- **THEN** No budget, filesystem, cancellation, or publication authority is created.

#### Scenario: K05-004-N Distinguishing refusal

- **GIVEN** Provide a successful local process exit without a matching remote receipt.
- **WHEN** The same requirement check runs.
- **THEN** Keep remote completion unknown and retain the pending identity.

### Requirement: R-M7-010 Abstract host effects

When a host expression suspends, the K definition SHALL emit a bounded abstract request and accept only its matching supplied receipt.

#### Scenario: T-M7-010

- **GIVEN** Two requests with separate IDs,success and failure receipts,print and natural-language predicate descriptors.
- **WHEN** Supply a finite data-only host script and project ordered boundary observations.
- **THEN** No provider or shell runs; requests,receipt consumption,pending sets and output observations match M1.

### Requirement: R-M7-011 Abstract host effects

If a receipt conflicts with source, registry, schema or request identity, then the K definition SHALL reject it without completing another request.

#### Scenario: T-M7-011

- **GIVEN** Wrong request/profile/registry,duplicate conflicting receipt,closure-bearing provider value and missing receipt.
- **WHEN** Inject each invalid receipt at the same suspension boundary.
- **THEN** Exact mismatches fail; missing external evidence stays suspended. No fabricated cancellation or authority is accepted.

### Requirement: R-M7-012 Abstract host effects

The K host model SHALL treat provider behavior, resource grants and publication authority as explicit external assumptions rather than derived language facts.

#### Scenario: T-M7-012

- **GIVEN** Abstract retry/race/checkpoint handlers and a publication-shaped ordinary data value.
- **WHEN** Execute request scripts with success,unknown and rejected host responses.
- **THEN** Only the supplied abstract response is modeled; no budget authority,remote completion or publication milestone is inferred from source data.
