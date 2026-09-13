# Discharge scoped semantic proof obligations

## ADDED Requirements

### Requirement: K08-001 Required claim register

The proof gate SHALL require discharged results for all ten named K1 claims under their explicit domains.

#### Scenario: K08-001-P Accepted behavior

- **GIVEN** The proof-obligations table, source-bound definitions, and nonempty witness states.
- **WHEN** Run every required claim on the pinned proof backend.
- **THEN** Record statement, quantification, domain, assumptions, dependencies, command, limits, and proof artifacts.

#### Scenario: K08-001-N Distinguishing refusal

- **GIVEN** Omit an in-domain or outgoing-boundary transition family, silently narrow a domain, or replace a required proof with examples.
- **WHEN** The same requirement check runs.
- **THEN** Keep the claim incomplete and block K1 acceptance.

### Requirement: K08-002 Nonvacuity and false controls

The proof suite SHALL distinguish valid proofs from unsatisfiable premises and false claims.

#### Scenario: K08-002-P Accepted behavior

- **GIVEN** A reachable matching receipt state, a duplicated-consumption false claim, and an impossible premise.
- **WHEN** Execute witnesses and check each control separately.
- **THEN** Accept the valid proof, retain the false counterexample, and reject the impossible-premise certificate for admission.

#### Scenario: K08-002-N Distinguishing refusal

- **GIVEN** The false control times out or the witness cannot reach the claimed domain.
- **WHEN** The same requirement check runs.
- **THEN** Report unknown control status and fail proof admission.

### Requirement: K08-003 Proof trust and replay

The proof report SHALL identify the complete trusted tool and lemma closure and support a clean independent rerun.

#### Scenario: K08-003-P Accepted behavior

- **GIVEN** A checked result with backend, solver, source, and lemma digests.
- **WHEN** Replay the proof from its manifest on the second pinned environment.
- **THEN** Obtain the same discharged claim status without cached proof assumptions.

#### Scenario: K08-003-N Distinguishing refusal

- **GIVEN** Use an unproved helper as an axiom, omit a solver identity, or change a semantics file.
- **WHEN** The same requirement check runs.
- **THEN** Reject the result binding and reopen affected claims.

### Requirement: K08-004 Honest incomplete outcomes

The release gate SHALL treat refuted, unknown, unavailable, stale, and interrupted required claims as nonpassing.

#### Scenario: K08-004-P Accepted behavior

- **GIVEN** One successful proof and one timeout with partial search output.
- **WHEN** Aggregate the claim results.
- **THEN** Keep distinct statuses and preserve diagnostic artifacts.

#### Scenario: K08-004-N Distinguishing refusal

- **GIVEN** Label a bounded simulation, incomplete search, or tool exit without a recognized proof result as proved.
- **WHEN** The same requirement check runs.
- **THEN** Reject the report and prevent publication.

### Requirement: R-M7-019 Differential evidence and proof status

When a mechanized claim is assessed, its claim record SHALL name its domain, assumptions, exact semantics digest, backend and checked result separately from differential evidence.

#### Scenario: T-M7-019

- **GIVEN** Claims for at-most-once receipt consumption and nondecreasing counters in a finite closed host-script domain,plus a deliberately false invariant.
- **WHEN** Use the pinned proof backend for the selected claims; retain counterexample,timeout or unsupported results.
- **THEN** Only discharged scoped claims say proved; the false control is not proved. No full TypeScript/K equivalence,host safety or termination theorem is inferred.
