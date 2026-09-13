# Integrate CI, documentation, and release evidence

## ADDED Requirements

### Requirement: K10-001 Enforcing CI

The required K CI jobs SHALL execute the selected tier and refuse missing, stale, skipped, or incomplete mandatory evidence.

#### Scenario: K10-001-P Accepted behavior

- **GIVEN** A candidate that changes a Pel source file or transitive K import.
- **WHEN** Run dependency-selected commit checks and full release checks.
- **THEN** Record executed counts and results against the exact candidate and toolchain.

#### Scenario: K10-001-N Distinguishing refusal

- **GIVEN** Omit K from PATH, use a cache from another source digest, or exceed the resource bound.
- **WHEN** The same requirement check runs.
- **THEN** Fail the required gate with a specific unavailable or incomplete result.

### Requirement: K10-002 Reproducible distribution

The release archive SHALL contain the complete source, tool, case, proof, and claim closure needed for independent reproduction.

#### Scenario: K10-002-P Accepted behavior

- **GIVEN** Two clean pinned Linux environments and an isolated production install without K.
- **WHEN** Build both archives, replay claims, and run the installed-product smoke checks.
- **THEN** Match deterministic archive hashes and semantic proof results. The production product works without K.

#### Scenario: K10-002-N Distinguishing refusal

- **GIVEN** Omit a transitive definition, license, corpus file, or comparator binding.
- **WHEN** The same requirement check runs.
- **THEN** Reject the archive and retain the missing-artifact diagnosis.

### Requirement: K10-003 Release admission and publication

The publisher SHALL require every K1 predicate and every applicable existing release-program predicate on one immutable candidate.

#### Scenario: K10-003-P Accepted behavior

- **GIVEN** A complete K1 report, independent cold audit, and approved numerical or unnumbered release identity.
- **WHEN** Validate the journal, publish the annotated tag and assets, and read them back.
- **THEN** Match candidate, tag target, source archive, checksums, and published evidence.

#### Scenario: K10-003-N Distinguishing refusal

- **GIVEN** Use a failed v0.5 predicate, a changed candidate, missing asset, or stale audit.
- **WHEN** The same requirement check runs.
- **THEN** Refuse publication or record failed postpublication verification without moving the existing tag.

### Requirement: K10-004 Guide and artwork

The release documentation SHALL explain Pel, K execution, sought improvements, evidence limits, reproduction, and the embedded release image.

#### Scenario: K10-004-P Accepted behavior

- **GIVEN** A fresh reader and the downloadable candidate evidence bundle.
- **WHEN** Follow the documented commands and render the release notes.
- **THEN** Reproduce a passing case and a deliberate failure. Render and download the embedded image successfully.

#### Scenario: K10-004-N Distinguishing refusal

- **GIVEN** Present a broken image URL or claim measured speedups, complete proofs, or K execution from planning-only artifacts.
- **WHEN** The same requirement check runs.
- **THEN** Fail documentation acceptance and correct the unsupported claim or broken asset.

### Requirement: K10-005 Maintenance and rollback

The maintenance policy SHALL reopen affected evidence after semantic changes and preserve previous release identities.

#### Scenario: K10-005-P Accepted behavior

- **GIVEN** A new builtin, changed toolchain, discovered counterexample, or revoked claim.
- **WHEN** Update the inventory and invalidate the transitive affected evidence.
- **THEN** Require fresh conformance, mutations, claims, and review before a successor release.

#### Scenario: K10-005-N Distinguishing refusal

- **GIVEN** A published claim is refuted after release.
- **WHEN** The same requirement check runs.
- **THEN** Publish a correction and successor evidence. Preserve the historical tag and record the affected claim as refuted.

### Requirement: R-M7-020 Differential evidence and proof status

The semantics guide SHALL distinguish planned work, executable definitions, conformance evidence, mechanized claims and open correspondence assumptions.

#### Scenario: T-M7-020

- **GIVEN** No implementation,trace-only results,scoped proof results and a changed semantics digest.
- **WHEN** Render the status table and verify linked claim/trace artifacts and changed-domain invalidation.
- **THEN** PLANNED remains the current sprint state until implementation evidence exists. Changed semantics reopen affected claims; historical evidence remains intact.
