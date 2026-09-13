# Full Pel K release program

## ADDED Requirements

### Requirement: KGP-001 Explicit release scope

The program SHALL distinguish the K1 full executable profile release from the K2 source-certified correspondence track.

#### Scenario: KGP-001-P Scope-preserving admission

- **GIVEN** All K1 packages pass but K11 remains unimplemented.
- **WHEN** The program evaluates candidate evidence.
- **THEN** Admit only the named K1 claim and publish the residual correspondence obligations.

#### Scenario: KGP-001-N Invalid admission

- **GIVEN** A release note calls the K1 runtime fully proved.
- **WHEN** The program evaluates candidate evidence.
- **THEN** Reject the unsupported claim.

### Requirement: KGP-002 Inherited coverage and ownership

The program SHALL retain every M7 requirement and every current language inventory member in its acceptance denominator.

#### Scenario: KGP-002-P Scope-preserving admission

- **GIVEN** M7 and the audited inventory map into the child packages.
- **WHEN** The program evaluates candidate evidence.
- **THEN** Require all original scenarios and child requirements with exactly identified owners.

#### Scenario: KGP-002-N Invalid admission

- **GIVEN** A child removes a difficult numeric case or continuation field.
- **WHEN** The program evaluates candidate evidence.
- **THEN** Fail coverage and prohibit full-profile acceptance.

### Requirement: KGP-003 Evidence-bound release gates

The program SHALL require KG01-KG12 on one immutable candidate before K1 acceptance.

#### Scenario: KGP-003-P Scope-preserving admission

- **GIVEN** All required results are complete and their transitive identities match.
- **WHEN** The program evaluates candidate evidence.
- **THEN** Accept the candidate only after independent review validates the evidence closure.

#### Scenario: KGP-003-N Invalid admission

- **GIVEN** One claim is unknown, a required case skipped, or an artifact stale.
- **WHEN** The program evaluates candidate evidence.
- **THEN** Refuse acceptance and preserve the incomplete result.

### Requirement: KGP-004 Retained governance

The program SHALL preserve existing numbered-release predicates, host obligations, and the separate production-code cleanup scope.

#### Scenario: KGP-004-P Scope-preserving admission

- **GIVEN** K1 passes while an applicable v0.5 predicate fails.
- **WHEN** The program evaluates candidate evidence.
- **THEN** Record K1 artifact readiness without publishing the numbered release.

#### Scenario: KGP-004-N Invalid admission

- **GIVEN** A worker uses K1 evidence to waive P1-P15 or remove historical controller pins.
- **WHEN** The program evaluates candidate evidence.
- **THEN** Reject the scope change and retain the original obligation.

### Requirement: KGP-005 Feasibility and honest status

The program SHALL resolve parser, numeric, and proof feasibility before making complete-profile or certification claims.

#### Scenario: KGP-005-P Scope-preserving admission

- **GIVEN** A pinned backend cannot reproduce a required numeric result.
- **WHEN** The program evaluates candidate evidence.
- **THEN** Record the mismatch and block its gate until a reviewed resolution exists.

#### Scenario: KGP-005-N Invalid admission

- **GIVEN** A worker narrows the profile or proof domain without a program amendment.
- **WHEN** The program evaluates candidate evidence.
- **THEN** Reject the result and keep implementation acceptance open.

### Requirement: KGP-006 Durable publication evidence

The release SHALL retain reproducible artifacts, an independent cold audit, and verified artwork under the existing publication authority.

#### Scenario: KGP-006-P Scope-preserving admission

- **GIVEN** An admitted candidate and authorized release journal contain all assets.
- **WHEN** The program evaluates candidate evidence.
- **THEN** Verify tag target, downloaded hashes, and the anonymously rendered image after publication.

#### Scenario: KGP-006-N Invalid admission

- **GIVEN** An asset is missing or the remote tag points elsewhere.
- **WHEN** The program evaluates candidate evidence.
- **THEN** Record failed verification and correct through the authorized successor process without rewriting the old tag.
