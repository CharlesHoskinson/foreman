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

The `release-coverage` command SHALL implement the exact bootstrap, lane, and
release forms in the approved design. Every form SHALL validate the closed
schema-version-1 register, recompute the active OpenSpec inventory and raw
`ROADMAP.md` digests, enforce the Roadmap bijection, and enforce all declared
cross-field rules. Bootstrap SHALL require Track 1 reconciliation. Lane SHALL
reject unresolved v0.4 entries owned by its selected package. Release SHALL
reject every unresolved v0.4 entry.

#### Scenario: Coverage matches current authority

- **WHEN** every active package and Roadmap assignment has one valid entry
- **AND** the stored digests match the current bytes
- **AND** the selected phase's reconciliation and workflow metadata are complete
- **THEN** the command returns exit code 0 and one canonical `Valid` result

#### Scenario: Coverage is stale or ambiguous

- **WHEN** a digest, key, source, enum, owner, Roadmap row, workflow declaration,
  or required reconciliation is missing, duplicated, stale, or invalid
- **THEN** the command returns exit code 1 and one sanitized `Invalid` result
- **AND** it does not mutate repository or external state

### Requirement: Signed action-specific release admission

The `release-admission` command SHALL resolve the explicitly named candidate
commit and tree in the explicitly named repository. It SHALL NOT inspect caller
`HEAD`. It SHALL accept only a canonical receipt signed by the authority key
fixed in the approved design and registered for the same family, child, action,
package, and candidate in Endstop. A caller-selected path or digest SHALL NOT
create authority.

Design approval SHALL admit implementation. Signed checks evidence SHALL admit
audit. A signed failed-check, `WARNING`, `BLOCKED`, or `UNVERIFIED` result SHALL
admit correction. Retry and resume SHALL bind a recorded failed reservation
and its original authority. Only a signed `APPROVED` audit receipt with no
findings and matching design approval SHALL admit integration or publication.
The command SHALL not read `[audit.policy]` or an equivalent mutable exception.

#### Scenario: Exact approved candidate is checked

- **WHEN** the named Git identity, registered audit receipt, and signed human
  design approval match
- **AND** the audit finding set is empty
- **THEN** the command returns exit code 0 and one canonical `Admitted` result

#### Scenario: Audit policy would permit weaker evidence

- **WHEN** integration or publication receives `WARNING`, `BLOCKED`,
  `UNVERIFIED`, malformed, stale, unsigned, unregistered,
  identity-mismatched evidence, a wrong authority, or any finding
- **THEN** release admission returns exit code 1
- **AND** mutable audit policy cannot change that result

#### Scenario: Blocking audit opens correction

- **WHEN** a registered signed audit receipt binds the current candidate and
  reports `BLOCKED` or `UNVERIFIED`
- **AND** the child has remaining correction actions
- **THEN** correction admission succeeds for that candidate
- **AND** integration admission still refuses it

#### Scenario: Caller forges a matching receipt

- **WHEN** caller bytes match the current Git identity but the signature,
  signer fingerprint, or Endstop-registered digest does not match
- **THEN** admission refuses before reservation

### Requirement: Immutable execution family

Track 1 SHALL add one canonical `ExecutionContractV2` family manifest anchored
to Endstop root `v040-release-20260822-r1`. The manifest SHALL bind the root
receipt, Track 1 commit and tree, `wallTimeMs=5184000000`,
`totalActions=4096`, and exactly eight immutable child contracts for Tranches 2
through 9 with the exact IDs, package mapping, dependency graph, action limits,
and authority-key fingerprints in the approved design. The audit and user
receipts SHALL each bind the completed manifest digest and carry a valid
signature from the matching fixed authority. One prior root-journal authority
event SHALL bind both expected receipt digests. The activation event SHALL bind
the manifest digest and both receipt digests; the manifest SHALL NOT contain a
digest of a receipt that approves that manifest.

#### Scenario: Family activates once

- **WHEN** the root remains Running before `2026-08-29T18:05:57Z`
- **AND** the manifest and both approval receipts match exactly
- **THEN** one root journal transaction appends the family activation
- **AND** all prior V1 actions count against the family total

#### Scenario: Activation is partial or repeated

- **WHEN** any required child, bound identity, or approval is missing or wrong
  or unsigned, the expected authority record is absent, or an activation event
  already exists
- **THEN** activation refuses without changing the journal

### Requirement: Child-bounded action admission

Each standard child SHALL set exact positive V1-style limits, allow at most 100
total actions and 14 days, and use the V1 deadline, no-product-change,
verification reuse, and terminal rules. Tranche 8 SHALL allow exactly 2,000
`evaluate` actions, at most 2,048 total actions,
`wallTimeMs=3888000000`, and `noProgressMs=3600000`. Every reservation SHALL be
one event in the root journal and SHALL count against both child and family.
A child's wall-time counter SHALL start at its first accepted action. Dependency
wait time SHALL consume the family deadline but SHALL NOT consume child wall
time. Each absolute child deadline SHALL equal the family deadline.

#### Scenario: A listed child reserves an action

- **WHEN** its dependencies are complete, phase-aware coverage and the
  action-specific evidence policy pass, and its child and family limits remain
  available
- **THEN** the root journal atomically reserves exactly one typed action
- **AND** a crash after reservation leaves that action spent

#### Scenario: A child or action is not listed

- **WHEN** queue admission names an absent child, an unsupported action, an
  exhausted child, an expired deadline, or a failed dependency
- **THEN** no provider or queue task starts

#### Scenario: A child reaches completion

- **WHEN** one candidate records product change, checks, audit, and integration
- **AND** Tranche 9 also records publication
- **THEN** the child becomes `Completed` in one root-journal transaction
- **AND** its dependent children become eligible without replacing the family

### Requirement: Release policy reaches every boundary

The queue boundary for V2 children, `gate-eval.sh`, `merge-gate.sh`, and later
publication tooling SHALL use one thin release-policy adapter. The adapter
SHALL locate Node and forward the fixed approved-design release block to the
exact installed TypeScript `release-policy` artifact. It SHALL not parse policy
data or implement policy decisions. Queue SHALL evaluate policy before one
atomic reservation. Gate SHALL evaluate it after the general result. Merge
SHALL resolve the named branch, require its commit to match the release block,
capture policy JSON outside stdout, and preserve exactly one merge verdict line.

#### Scenario: General gate passes but v0.4 policy fails

- **WHEN** the general gate or merge check passes
- **AND** any installed release artifact is missing or action policy returns nonzero
- **THEN** the boundary returns a non-admitting result

#### Scenario: Bootstrap output is incomplete

- **WHEN** only part of the schemas, policy commands, family protocol, gate
  wiring, runtime artifacts, or exact-runtime checks exists
- **THEN** the bootstrap cannot activate the family

### Requirement: Exact installed runtime inventory

The runtime builder SHALL emit `release-coverage.js`, `release-admission.js`,
`release-authority.js`, and `release-policy.js`. The runtime manifest,
two-clean-build check, tracked-byte check, exact-dist inventory check, and
installed-runtime decoder SHALL treat all four as required.

#### Scenario: Installed policy is stripped or changed

- **WHEN** an artifact is missing, changed, or removed together with its
  manifest entry in a copied installation
- **THEN** installed-runtime verification refuses
