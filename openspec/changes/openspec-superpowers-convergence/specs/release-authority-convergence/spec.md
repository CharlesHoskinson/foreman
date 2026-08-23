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

Lane and release coverage SHALL resolve the exact family source registered in
the root journal. Each phase-relevant family package SHALL contain canonical
`release-brief.json` bytes that match the source-derived objective, acceptance,
and allowed paths. Caller-selected family or brief bytes SHALL NOT replace the
registered values. Bootstrap SHALL use no family or package-brief authority.

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
`HEAD`. It SHALL verify canonical signatures, role keys, action evidence, and
Git identity and return only `EvidenceValid` or `EvidenceInvalid`. It has no
Endstop identity and SHALL NOT claim or grant admission. Only the composed
`release-policy` boundary SHALL obtain the registered authority for the same
root, family, child, action, package, and candidate and return `Admitted`. A
caller-selected path or digest SHALL NOT create authority.

The schema-to-key map SHALL be exact. Design, evaluation, terminal approval,
and family user-approval receipts SHALL use the pinned user-approval key.
Checks, audit, council request, council outcome, action outcome, evaluation
verdict, evidence-bundle, and family audit signatures SHALL use the pinned
host-audit key. A signature
from the wrong role key SHALL refuse. The approved OpenSpec digest SHALL bind
the exact canonical manifest shape in the design. Each evidence bundle SHALL
also carry a valid host-audit signature.
The signature preimage SHALL be the UTF-8 domain bytes, one `0x0a` byte, and
the UTF-8 canonical unsigned-object bytes. A literal backslash plus `n` SHALL
not be equivalent.

Checks, audit, evaluation-report, child-brief, and family-source inputs SHALL
use the closed canonical schemas, bounds, and digest preimages in the design.
The family builder SHALL derive every objective, acceptance, allowed-path, and
deadline field. An opaque producer path SHALL NOT define its own schema.

Design approval SHALL be issued after `tasks.md` exists. It SHALL bind the
approved design manifest, exact task-plan digest, and post-plan implementation-
base commit and tree. A child's first implementation SHALL start from that exact
base. Each later implementation SHALL start from the exact current journaled
candidate and remain in a direct-parent lineage from the signed base under the
same task-plan authority. A retry or resume SHALL keep its origin candidate.
Signed
checks evidence SHALL admit audit. A signed failed-check,
`WARNING`, `BLOCKED`, or `UNVERIFIED` result SHALL admit correction. A signed
council request SHALL admit council. Its later signed outcome SHALL be outcome
evidence and SHALL NOT authorize that same reservation. Retry and resume SHALL
bind a recorded failed reservation, first origin, and effective original
action. Only a signed
`APPROVED` audit receipt with no findings and matching design approval SHALL
admit integration or publication. Neither verifier SHALL read `[audit.policy]`
or an equivalent mutable exception.

Standalone admission, bundle creation, design issuance, and composed policy
SHALL reconstruct the approved OpenSpec manifest and `tasks.md` only from
bounded Git blobs below the package path in the signed design commit. They
SHALL verify the signed design tree. They SHALL NOT obtain those preimages from
the candidate tree, worktree, mutable `HEAD`, or caller file paths.

#### Scenario: Exact approved candidate is checked

- **WHEN** the named Git identity, registered audit receipt, and signed human
  design approval match
- **AND** the audit finding set is empty
- **THEN** standalone verification returns canonical `EvidenceValid`
- **AND** the Endstop-composed boundary returns canonical `Admitted`

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

#### Scenario: Implementation uses an unrelated commit

- **WHEN** a valid design receipt is paired with a different candidate commit,
  tree, task plan, package, role key, or signed evidence-bundle identity
- **THEN** implementation admission refuses before a worker or queue starts

#### Scenario: Two dependent implementation tasks advance

- **WHEN** the first task starts from the signed base and records one direct-
  parent product commit
- **AND** the second task presents the same design and task-plan authority with
  that exact current commit
- **THEN** the second implementation reservation succeeds
- **AND** a reset, sibling, merge, or unrelated commit refuses

#### Scenario: Standalone evidence is not registered

- **WHEN** a signed bundle is valid but has no matching Endstop registration
- **THEN** standalone verification may return `EvidenceValid`
- **AND** every queue, gate, merge, or publication boundary refuses it

### Requirement: Immutable execution family

Track 1 SHALL add one canonical `ExecutionContractV2` family manifest anchored
to Endstop root `v040-release-20260822-r3`. The manifest SHALL bind the root
receipt, Track 1 commit and tree, `wallTimeMs=5184000000`,
`totalActions=4096`, and exactly eight immutable child contracts for Tranches 2
through 9 with the exact IDs, package mapping, dependency graph, action limits,
authority-key fingerprints, child-brief digest preimages, and deadline formula
in the approved design. The live builder SHALL use its host clock. Activation
SHALL reject a future `createdAt`. The audit and user
receipts SHALL each bind the completed manifest digest and carry a valid
signature from the matching fixed authority. One prior root-journal authority
event SHALL bind the source and both expected receipt digests. The activation
event SHALL bind the manifest, source, and both receipt digests. The manifest SHALL NOT contain a
digest of a receipt that approves that manifest.

The manifest SHALL bind the canonical family-source digest. The builder SHALL
write distinct manifest and preserved-source files plus exactly eight canonical
package briefs under the exact output contract in the design. Family authority
registration SHALL verify and durably publish that source set under the family
manifest digest before it appends the journal event. Missing, extra, conflicting, or
malformed source-set bytes SHALL fail closed.

The host SHALL issue family audit and family user-approval receipts with the
exact producer forms in the approved design. Family authority registration
SHALL validate both receipts once and SHALL be first-write-wins by root contract
ID. An identical replay SHALL be idempotent. A different-family or other
conflicting loser SHALL refuse without an append. Activation SHALL read the
bounded caller manifest, registered source set, and exact prior authority event.
It SHALL NOT accept caller source or receipt paths. Every family, child, status,
registration, and lifecycle command SHALL
bind the same root contract ID and digest.

The existing root `RunJournal` SHALL store the exact V2 payload union and
ordering grammar in the approved design. Family authority SHALL precede
activation. After activation, child authority, registered outcome, evaluation-
verdict, and child-decision events MAY interleave. Each authority SHALL precede
its reservation. Each outcome SHALL follow its reservation. A child operation
that consumes an outcome SHALL follow its registration. Advice, unused
outcomes, and evaluation-run `PASS` outcomes need no later operation. Each
child decision SHALL store an exact V2 operation with its matching
`ExecutionV2Event` array. An evaluation verdict SHALL follow its complete journal-derived run set
and precede completion. No child journal or stream SHALL be created.

#### Scenario: Family activates once

- **WHEN** the root remains Running before `2026-08-30T20:15:48Z`
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

Standard and evaluation limit objects SHALL be a closed discriminated union.
Standard children SHALL contain `kind="standard"` and
`noProductChangeMs=259200000`; they SHALL NOT contain `noProgressMs`.
Tranche 8 SHALL contain `kind="evaluation"` and `noProgressMs=3600000`; it
SHALL NOT contain `noProductChangeMs`. Its no-progress timer SHALL cover all
evaluation-child activity. Its wall and progress clocks SHALL both start at the
first accepted action, including a pre-evaluation action. Only product change,
milestone recording, and registration of a matching signed `PASS` outcome SHALL
reset progress. Reservation, retry, resume, advice, blocking, and failure SHALL
not reset it. An action at or after an exact time boundary SHALL refuse.

Ordinary child authority SHALL be first-write-wins by family, child, action,
candidate, and a null retry key. Retry and resume authority SHALL replace that
null with the exact immediate prior reservation. Chained retries and retries of
different effective actions on one candidate SHALL not collide, while a second
authority for one retry attempt SHALL refuse.

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

- **WHEN** an implement or correct reservation records one product change
- **AND** that current candidate records ordered, registered `PASS` outcomes
  for checks, audit, and integration
- **AND** Tranche 9 also records publication
- **AND** Tranche 8 records one signed evaluation verdict for its current
  candidate
- **AND** that verdict validates 2,000 completed runs or records bounded
  `GRAPH_OFF_UNCOMPUTABLE` without imputation
- **THEN** the child becomes `Completed` in one root-journal transaction
- **AND** its dependent children become eligible without replacing the family
- **AND** only `PROMOTE` can enable graph context

#### Scenario: A lifecycle outcome is not authoritative

- **WHEN** an outcome is premature, forged, unregistered, bound to another
  reservation or candidate, out of order, or conflicts with an earlier result
- **THEN** no milestone or blocking state changes
- **AND** an identical registered replay appends nothing

#### Scenario: A product change advances a candidate

- **WHEN** an implement-or-correct-effective reservation names one Git base
- **AND** the output is a distinct direct-parent commit whose complete diff is
  inside the allowed paths from the registered family source
- **THEN** one root-journal transaction records both complete Git identities
- **AND** an unrelated commit, merge commit, caller digest, missing source, or
  outside-path change refuses without changing child state

#### Scenario: A child terminal command is unauthorized

- **WHEN** cancellation or invalidation lacks the exact signed user approval
  for the root, family, child, terminal, and reason
- **THEN** the child and every sibling remain unchanged

### Requirement: Release policy reaches every boundary

The queue boundary for V2 children, `release-policy.sh`, `gate-eval.sh`,
`merge-gate.sh`, and later publication tooling SHALL use the one installed
TypeScript `release-policy` artifact. Each changed shell entry point SHALL
become a one-artifact argument and byte-stream adapter and SHALL delete its
domain logic. Compiled TypeScript SHALL own the complete existing general gate,
merge-base, freshness, event, and output behavior plus v0.4 policy. Queue SHALL
evaluate policy before one atomic reservation. Gate SHALL evaluate it after the
complete general result. Merge SHALL resolve the named branch, require its
commit to match the release block, capture policy JSON outside stdout, and
preserve exactly one merge verdict line.

The release block SHALL contain one copy of root, family, child, action, and
candidate identity. The TypeScript parser SHALL derive both release policy and
reservation input from that object. It SHALL require the candidate digest to
equal SHA-256 of the resolved lowercase commit, the package to equal the child
package, and all block fields to equal the registered evidence and Endstop
state. Cross-block or evidence-to-block substitution SHALL refuse.
The compiled gate-eval and merge-check boundaries SHALL supply
non-caller-controlled expected action `integrate` and SHALL reject any block
with another action, including a valid registered `verify` block. Publication
SHALL supply expected action `publish`.

#### Scenario: General gate passes but v0.4 policy fails

- **WHEN** the general gate or merge check passes
- **AND** any installed release artifact is missing or action policy returns nonzero
- **THEN** the boundary returns a non-admitting result

#### Scenario: Caller downgrades an integration action

- **WHEN** gate-eval or merge-check receives valid registered `verify` evidence
- **THEN** the compiled boundary refuses because its expected action is
  `integrate`

#### Scenario: Bootstrap output is incomplete

- **WHEN** only part of the schemas, policy commands, family protocol, gate
  wiring, runtime artifacts, or exact-runtime checks exists
- **THEN** the bootstrap cannot activate the family

#### Scenario: Registration is replayed or replaced

- **WHEN** the same child action and candidate receives an identical signed
  evidence-bundle digest
- **THEN** registration returns the existing state and appends nothing
- **BUT WHEN** the bundle digest, schema, signer, or identity differs
- **THEN** registration refuses and preserves the first write

### Requirement: Exact installed runtime inventory

The runtime builder SHALL emit `release-coverage.js`, `release-admission.js`,
`release-authority.js`, and `release-policy.js`. The runtime manifest,
two-clean-build check, tracked-byte check, exact-dist inventory check, and
installed-runtime decoder SHALL treat all four as required.

#### Scenario: Installed policy is stripped or changed

- **WHEN** an artifact is missing, changed, or removed together with its
  manifest entry in a copied installation
- **THEN** installed-runtime verification refuses
