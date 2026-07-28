# Spec delta — vendor concurrency and quota

EARS-phrased. See `skills/foreman/references/five-part-spec.md`.
Header shape follows the OpenSpec CLI's parseable form (see
`lock-primitive-hardening/tasks.md` T8 for the repo-wide conformance debt).

## ADDED Requirements

### Requirement: a new vendor's concurrency cap is 1 until a GREEN row exists

A vendor with no recorded GREEN row in
`docs/research/vendor-concurrency-results.md` SHALL have a pueue group cap of 1.

The `agy` group SHALL be created with a cap of 1, and the cap SHALL carry an
inline citation stating that no GREEN row exists for it.
IF a cap above 1 is proposed for any vendor, THEN it SHALL cite a specific
GREEN row recorded at that N or higher, and SHALL NOT be justified by analogy
with another vendor.
A shim-level test of the concurrency harness SHALL NOT be accepted as evidence
for a cap raise; only a recorded live destructive run counts.
WHILE a vendor's lanes share mutable state because per-lane isolation is
incomplete, its cap SHALL remain 1 regardless of any run's outcome, and the
reason SHALL be recorded.

#### Scenario: the fourth vendor enters the topology at 1

- WHEN the group topology is created
- THEN the agy group has a cap of 1
- AND the code carries the citation explaining that no GREEN row exists.

#### Scenario: a cap raise without a row is refused

- WHEN a change proposes raising a vendor cap without citing a GREEN row at
  that N
- THEN the change is refused
- AND the refusal names the governance rule and the missing row.

### Requirement: the concurrency harness covers every vendor and its real isolation lever

`vendor-concurrency-test.sh` SHALL be able to run its destructive matrix for
every vendor Foreman supports.

Each vendor's case SHALL use that vendor's actual isolation lever as published
by its adapter.
The agy case SHALL isolate by `$HOME` and SHALL NOT use `GEMINI_CLI_HOME`,
which has been probed and has no effect on this CLI.
Each run SHALL re-probe the vendor's authentication after the matrix using the
same non-billing command the readiness inventory uses, so cross-lane auth
invalidation becomes an explicit abort rather than a silent degradation.
WHERE a vendor's lanes necessarily share mutable state, the harness SHALL
monitor that shared state directly — including any database file and its
write-ahead companions, the settings file, and the credential — in addition to
the existing containment scan.
IF the harness cannot isolate a vendor's lanes at all, THEN it SHALL record
that as the finding rather than reporting a GREEN row.

#### Scenario: a shared SQLite database is watched, not assumed safe

- WHEN the matrix runs for a vendor whose lanes share one home
- THEN the harness monitors the shared conversation database and its
  write-ahead files for corruption
- AND a corruption event aborts the run with a named finding.

#### Scenario: auth invalidation across lanes is caught

- WHEN a vendor is authenticated before the matrix and not authenticated after
- THEN the run reports an auth-invalidation abort naming the vendor
- AND no GREEN row is recorded.

### Requirement: readiness reports entitlement, not only authentication

The readiness inventory SHALL report, for each vendor, whether the configured
model and reasoning effort are actually available to the active credential.

WHERE the vendor CLI exposes plan or tier information, the row SHALL report it.
WHERE it does not, the row SHALL report the model set the credential can
enumerate.
IF the configured model is not available to the credential, THEN the vendor
SHALL be reported NOT-READY for that configuration, naming the configured model
and the available set — a valid credential that cannot serve the configured
model is not readiness.
IF an auditor lane is configured at the highest reasoning level and the
credential cannot serve it, THEN Foreman SHALL report that the auditor doctrine
is unmet for that vendor, and SHALL NOT describe the resulting audit as a
highest-reasoning audit.

#### Scenario: a valid credential that cannot serve the pinned model is NOT-READY

- WHEN a vendor is authenticated but its enumerable model set does not contain
  the configured model
- THEN the readiness row reports NOT-READY naming the configured model and the
  available set
- AND the lane is refused before a worktree lock is taken.

#### Scenario: an entitlement that cannot meet the auditor doctrine is reported

- WHEN an auditor is configured at the highest reasoning level and the active
  credential can only serve a smaller model class
- THEN Foreman reports the doctrine as unmet for that vendor
- AND no document describes that vendor's audits as highest-reasoning.

### Requirement: quota exhaustion is unavailability, never a model failure

WHEN a round ends because the account's quota or rate limit is exhausted,
Foreman SHALL report `STATUS: unavailable` and SHALL classify it as a
Setup or account condition.

The classification SHALL route through the adapter's `rc_unavailable` contract
so no call site needs vendor-specific knowledge.
IF a round is classified as quota-exhausted, THEN it SHALL NOT consume a rework
round, because no rework can resolve an exhausted quota.
IF a vendor responds to exhaustion by offering an interactive choice, THEN the
headless lane SHALL be bounded by Foreman's round timeout and the outcome SHALL
be reported as unavailability rather than as a stalled model.
The behaviour of each vendor at quota exhaustion in headless mode is UNVERIFIED
and SHALL be established before that vendor's cap is raised above 1.

#### Scenario: an exhausted quota does not burn the rework budget

- WHEN a round ends because quota is exhausted
- THEN the round is reported `STATUS: unavailable`
- AND the rework counter is unchanged
- AND the operator-facing message names the account condition.

### Requirement: a silent model downgrade is detected and reported

Foreman SHALL record the model actually used by every round and SHALL compare
it against the model the lane pinned.

IF the model actually used differs from the pinned model, THEN Foreman SHALL
report the difference naming both models.
IF the differing round was an audit, THEN its verdict SHALL be marked as
produced by a model other than the configured one, so the gate and the
architect can weigh it accordingly.
A round SHALL NOT be reported as successful at the pinned model when a
different model served it.

#### Scenario: a downgraded audit is not consumed as a full-strength audit

- WHEN an audit is pinned to a high-reasoning model and the vendor serves a
  smaller one
- THEN the round report names both models
- AND the verdict is marked as produced by a different model than configured.

## MODIFIED Requirements

### Requirement: the group topology and its cap citations cover four vendors

`lane-queue.sh:422` creates the fixed group topology
`grok:3 codex:2 claude:3 misc:2 gate:1`, with the cap rationale documented at
`:375-383` and `:415-421` — grok GREEN at N=2 and N=3, codex GREEN at N=2, both
from the 2026-07-18 live authenticated run.

The topology SHALL include a group for every vendor Foreman advertises as a
lane, and SHALL NOT include a group for a vendor it does not.
Each cap SHALL carry an inline citation: either the GREEN row that justifies it
or the statement that no row exists and the cap is therefore 1.
The existing grok, codex and claude caps and their citations SHALL be unchanged
by this change.
IF a vendor's lane is removed from Foreman, THEN its group SHALL be removed
from the topology in the same change, so the topology never advertises a lane
that cannot run.

#### Scenario: the topology and the supported vendor set agree

- WHEN the group topology is created
- THEN there is exactly one group per advertised vendor lane
- AND each cap cites either a GREEN row or the absence of one.

### Requirement: the concurrency results document records negative findings

`docs/research/vendor-concurrency-results.md` records GREEN rows that justify
cap raises.

The document SHALL also record runs that produced no GREEN row, including runs
that could not be performed and the reason.
IF a vendor cannot be isolated per lane, THEN that finding SHALL be recorded as
a permanent constraint rather than as a pending measurement.
Each row SHALL name the vendor CLI version it was recorded against, because a
self-updating CLI can invalidate an earlier verdict without any change on
Foreman's side.

#### Scenario: an unrunnable matrix is recorded as a finding

- WHEN a vendor's concurrency matrix cannot be run because its lanes cannot be
  isolated and authenticated simultaneously
- THEN the document records that finding with its evidence
- AND the vendor's cap remains 1 with that row as its citation.
