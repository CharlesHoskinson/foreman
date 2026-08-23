## Purpose

Defines one testable authority path from an approved OpenSpec package through
bounded implementation, independent audit, integration, and release admission.

## ADDED Requirements

### Requirement: Closed OpenSpec workflows

Foreman SHALL provide `foreman-bounded` and `foreman-architectural` as
project-local OpenSpec workflows. `foreman-bounded` SHALL order proposal,
specifications, and tasks. `foreman-architectural` SHALL order proposal,
specifications, design, and tasks. Each dependency SHALL be strict and each
workflow SHALL require `tasks.md` before apply.

#### Scenario: A bounded package advances

- **WHEN** the proposal exists but its specifications do not exist
- **THEN** the workflow exposes specifications as the next artifact
- **AND** it does not expose tasks as ready

#### Scenario: An architectural package advances

- **WHEN** proposal and specifications exist but design does not exist
- **THEN** the workflow exposes design as the next artifact
- **AND** it does not expose tasks as ready

#### Scenario: A v0.4 package uses a competing plan

- **WHEN** a v0.4 package does not declare its required Foreman workflow or
  changes an active file under `docs/superpowers/specs` or
  `docs/superpowers/plans` after the v0.3.1 baseline
- **THEN** release coverage refuses the package

### Requirement: Complete release coverage

The `release-coverage check --register <path>` command SHALL validate the
closed schema-version-1 register, recompute the active OpenSpec inventory and
raw `ROADMAP.md` digests, enforce the Roadmap bijection, enforce all declared
cross-field rules, and reject unresolved v0.4 reconciliation.

#### Scenario: Coverage matches current authority

- **WHEN** every active package and Roadmap assignment has one valid entry
- **AND** the stored digests match the current bytes
- **THEN** the command returns exit code 0 and one canonical `Valid` result

#### Scenario: Coverage is stale or ambiguous

- **WHEN** a digest, key, source, enum, owner, Roadmap row, workflow declaration,
  or required reconciliation is missing, duplicated, stale, or invalid
- **THEN** the command returns exit code 1 and one sanitized `Invalid` result
- **AND** it does not mutate repository or external state

### Requirement: Exact release admission

The `release-admission check --program v040 --verdict <path>
--candidate-sha <sha256> --approval <path>` command SHALL inspect the current
Git commit and tree. It SHALL accept only canonical closed receipts that name
that identity, use the SHA-256 of the lowercase commit ID as the candidate
digest, contain verdict `APPROVED`, and contain no findings. The command SHALL
not read `[audit.policy]` or any equivalent mutable exception.

#### Scenario: Exact approved candidate is checked

- **WHEN** current Git identity, candidate digest, audit receipt, and external
  human approval receipt match
- **AND** the audit finding set is empty
- **THEN** the command returns exit code 0 and one canonical `Admitted` result

#### Scenario: Audit policy would permit weaker evidence

- **WHEN** the receipt is `WARNING`, `BLOCKED`, `UNVERIFIED`, malformed, stale,
  non-canonical, identity-mismatched, or has any finding
- **THEN** release admission returns exit code 1
- **AND** mutable audit policy cannot change that result

### Requirement: Immutable execution family

Track 1 SHALL add one canonical `ExecutionContractV2` family manifest anchored
to Endstop root `v040-release-20260822-r1`. The manifest SHALL bind the root
receipt, Track 1 commit and tree, `wallTimeMs=5184000000`,
`totalActions=4096`, and exactly eight immutable child contracts for Tranches 2
through 9. The audit and user receipts SHALL each bind the completed manifest
digest. The activation event SHALL bind the manifest digest and both receipt
digests; the manifest SHALL NOT contain a digest of a receipt that approves
that manifest.

#### Scenario: Family activates once

- **WHEN** the root remains Running before `2026-08-29T18:05:57Z`
- **AND** the manifest and both approval receipts match exactly
- **THEN** one root journal transaction appends the family activation
- **AND** all prior V1 actions count against the family total

#### Scenario: Activation is partial or repeated

- **WHEN** any required child, bound identity, or approval is missing or wrong
  or an activation event already exists
- **THEN** activation refuses without changing the journal

### Requirement: Child-bounded action admission

Each standard child SHALL set exact positive V1-style limits, allow at most 100
total actions and 14 days, and use the V1 deadline, no-product-change,
verification reuse, and terminal rules. Tranche 8 SHALL allow exactly 2,000
`evaluate` actions, at most 2,048 total actions,
`wallTimeMs=3888000000`, and `noProgressMs=3600000`. Every reservation SHALL be
one event in the root journal and SHALL count against both child and family.

#### Scenario: A listed child reserves an action

- **WHEN** its dependencies are complete, both release policies pass, and its
  child and family limits remain available
- **THEN** the root journal atomically reserves exactly one typed action
- **AND** a crash after reservation leaves that action spent

#### Scenario: A child or action is not listed

- **WHEN** queue admission names an absent child, an unsupported action, an
  exhausted child, an expired deadline, or a failed dependency
- **THEN** no provider or queue task starts

### Requirement: Release policy reaches every boundary

The queue boundary for V2 children, `gate-eval.sh`, `merge-gate.sh`, and later
publication tooling SHALL use one thin release-policy adapter. The adapter
SHALL invoke the exact installed `release-coverage` and `release-admission`
artifacts. It SHALL not parse policy data or implement policy decisions.

#### Scenario: General gate passes but v0.4 policy fails

- **WHEN** the general gate or merge check passes
- **AND** either installed policy artifact is missing or returns nonzero
- **THEN** the boundary returns a non-admitting result

#### Scenario: Bootstrap output is incomplete

- **WHEN** only part of the schemas, policy commands, family protocol, gate
  wiring, runtime artifacts, or exact-runtime checks exists
- **THEN** the bootstrap cannot activate the family

### Requirement: Exact installed runtime inventory

The runtime builder SHALL emit separate `release-coverage.js` and
`release-admission.js` artifacts. The runtime manifest, two-clean-build check,
tracked-byte check, exact-dist inventory check, and installed-runtime decoder
SHALL treat both as required.

#### Scenario: Installed policy is stripped or changed

- **WHEN** an artifact is missing, changed, or removed together with its
  manifest entry in a copied installation
- **THEN** installed-runtime verification refuses
