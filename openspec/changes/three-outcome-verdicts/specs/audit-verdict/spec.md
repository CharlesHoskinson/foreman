# Spec delta — audit verdict

EARS-phrased. See `skills/foreman/references/five-part-spec.md`.

Note on format: this delta uses the header shape the OpenSpec CLI actually
parses (`## ADDED Requirements` → `### Requirement:` → `#### Scenario:`), as
established by `lock-primitive-hardening`.

## ADDED Requirements

### Requirement: an audit that produces no judgment is recorded as UNVERIFIED

The audit stage SHALL distinguish "the auditor judged this change" from "no
judgment was produced", and SHALL represent the second case as the verdict
`UNVERIFIED`.

WHEN the audit process exits non-zero, exceeds its wall-clock bound, produces
empty output, produces output containing no JSON object, produces a verdict
outside the model-facing vocabulary, or mutates the worktree under review, THEN
the audit stage SHALL record `verdict = "UNVERIFIED"` together with a machine-
readable reason naming which of those conditions occurred.
IF the audit CLI is absent or unauthenticated, THEN the audit stage SHALL
record `UNVERIFIED` rather than aborting without an artifact.
`UNVERIFIED` SHALL be assigned by the harness observing the audit process, and
SHALL NOT be a value the auditing model is able to select.
The model-facing verdict schema SHALL remain `APPROVED | WARNING | BLOCKED`,
and both the schema file and the verdict artifact SHALL state that this
asymmetry is deliberate.

#### Scenario: a dead auditor is unverified, not rejected

- WHEN the audit process is killed mid-run by a rate limit
- THEN the recorded verdict is `UNVERIFIED` with a reason naming the non-zero
  exit
- AND the verdict is not `BLOCKED`
- AND the verdict is not `APPROVED`.

#### Scenario: unparsable output is unverified

- WHEN the audit process exits 0 but its output contains no JSON object
- THEN the recorded verdict is `UNVERIFIED` with a reason naming the parse
  failure.

#### Scenario: a mutated worktree invalidates the audit without losing the record

- WHEN the worktree's `git status --porcelain` differs before and after the
  audit
- THEN the recorded verdict is `UNVERIFIED` with a reason naming the mutation
- AND the audit stage exits non-zero.

### Requirement: every audit writes a verdict artifact

The audit stage SHALL write `audit-verdict.json` on every execution path,
including every failure path, before returning to its caller.

The write SHALL be atomic, so that an interrupted write leaves the previous
artifact intact rather than a partially-written one.
The audit stage's exit status SHALL communicate completion to its caller, and
SHALL NOT be the only signal that an audit failed.
The audit stage SHALL NOT terminate on a failure path without having written an
artifact describing that failure.

#### Scenario: a failed re-audit does not leave the prior verdict standing

- WHEN a re-audit of a reworked diff fails for any reason
- THEN `audit-verdict.json` describes that failure as `UNVERIFIED`
- AND it no longer describes the previous round's judgment.

### Requirement: every verdict carries provenance and an evidence reference

`audit-verdict.json` SHALL carry, for every verdict value including
`UNVERIFIED`: the audit vendor, the audit model identifier, the reasoning
effort requested, the verdict, a reason when the verdict is `UNVERIFIED`, an
evidence reference, and the start time, end time and duration in seconds of the
audit call.

The evidence reference SHALL contain the content hash of the reviewed diff, the
base commit sha, the head commit sha, and the attempt id.
The vendor and model SHALL be the values actually used for the call, not the
configured defaults, so that a substituted auditor is visible in the record.

#### Scenario: a substituted auditor is visible in the record

- WHEN an audit runs under a different vendor or model than
  `.foreman/config.toml` names
- THEN the recorded provenance names the vendor and model that actually ran
- AND a reader can determine the substitution from the artifact alone.

#### Scenario: duration is recorded even when the audit fails

- WHEN an audit times out
- THEN the artifact records `UNVERIFIED`, the reason `timeout`, and the elapsed
  duration in seconds.

### Requirement: the audit call is bounded in wall clock

The audit call SHALL be bounded by a configurable wall-clock limit
(`audit.timeout_min`), defaulting from `limits.round_timeout_min`.

IF the bound is exceeded, THEN the audit process SHALL be terminated together
with its process group, and the verdict SHALL be recorded as `UNVERIFIED` with
reason `timeout`.
The audit stage SHALL NOT block indefinitely on the audit process under any
condition.
This requirement covers bounding and measurement only. Effort tiering, sharded
parallel audit, pre-packaged audit bundles, hunk-scoped re-audits, and session
reuse are OUT OF SCOPE for this change and SHALL NOT be implemented by it.

#### Scenario: a hung audit cannot hang the gate

- WHEN the audit process produces no output and does not exit within the
  configured bound
- THEN it is terminated with its process group
- AND `UNVERIFIED` with reason `timeout` is recorded
- AND no audit process from that call remains alive.

### Requirement: findings carry stable ids and are addressed by id

Each finding in `audit-verdict.json` SHALL carry a stable id derived by the
harness from the finding's own content.

The id SHALL be stable across re-audits and across lanes for a finding with the
same file, line, severity and normalised summary.
WHERE reports from multiple lanes are consolidated, the consolidation SHALL
merge findings by id and select a representative, and SHALL NOT rewrite,
paraphrase or re-emit any finding's evidence text.
The raw finding text SHALL be retained alongside the derived id, so that an
id split caused by rewording is visible rather than silent.
The model-facing verdict schema SHALL NOT be extended with an id field.

#### Scenario: two lanes reporting the same finding merge to one

- WHEN two audit lanes report a finding with the same file, line, severity and
  normalised summary
- THEN consolidation records one finding with one id
- AND both source lanes are named against it.

#### Scenario: consolidation never rewrites evidence

- WHEN consolidation selects a representative among merged findings
- THEN the representative's evidence text is byte-identical to one of the
  source findings
- AND no synthesized or paraphrased evidence text appears in the output.


### Requirement: every gate input is bound to the diff under evaluation

The merge gate SHALL bind all three of its decision inputs -- the audit
verdict, the independent-checks result, and the docs-check result -- to the
content hash of the diff under evaluation, and SHALL NOT treat any of them as
applicable to a diff it does not describe.

WHEN the gate reads `checks-result.json`, it SHALL read the recorded diff
identity alongside `.status`, and IF that identity does not match the diff
under evaluation, THEN the gate SHALL fail with a distinct reason naming the
stale independent-checks artifact.
WHEN the gate reads `docs-check.json`, it SHALL apply the same binding and
produce its own distinct failure reason.
`checks-run.sh` and the docs check SHALL each record `diff_sha256` for the diff
they evaluated, alongside the `sha` field `checks-run.sh` already writes.
The binding SHALL be on the diff's content hash for the same reason the verdict
binding is, so that a rebase producing a byte-identical diff does not
invalidate a valid check run.
Because all three artifacts live in the same run directory `$RD`, which is
stable across rounds and which nothing empties between rounds, the gate SHALL
NOT infer freshness from the presence of a file, from its mtime, or from the
round number.

#### Scenario: a round-N checks pass does not authorise a round-N+1 diff

- WHEN `checks-result.json` records `status: "pass"` for the round-N diff
- AND the worker reworks the diff so that the round-N+1 diff has a different
  content hash
- AND the audit verdict for round N+1 is fresh and `APPROVED`
- THEN the gate fails
- AND the reason names the stale independent-checks artifact rather than the
  verdict.

#### Scenario: a stale docs check does not authorise merge

- WHEN `docs-check.json` records `status: "pass"` for a diff whose content hash
  differs from the diff under evaluation
- THEN the gate fails
- AND the reason names the stale docs artifact.

#### Scenario: all three inputs fresh is the only passing configuration

- WHEN the verdict, the checks result and the docs result each record the
  content hash of the diff under evaluation
- THEN the gate's evidence binding passes
- AND the gate proceeds to evaluate the verdict value under `[audit.policy]`.

### Requirement: repeated UNVERIFIED audits are separately bounded and terminate

The system SHALL bound the number of audit attempts for a single task
independently of the rework-round budget, and SHALL reach a terminal state when
that bound is exhausted.

The bound SHALL be a new configuration key -- `limits.max_audit_attempts`, or
equivalently `audit.max_consecutive_unverified` -- with a conservative default.
The bound SHALL NOT be `limits.max_rework_rounds` and SHALL NOT be derived from
it: an `UNVERIFIED` verdict deliberately consumes no rework round, so a lane
whose auditor always fails never advances `round`, and `limits.max_rework_rounds`
therefore can never be reached in exactly the loop it would need to terminate.
WHEN the audit-attempt bound is exhausted, THEN the task SHALL enter a terminal
`Abandoned` state carrying a reason that names audit non-completion, and that
reason SHALL be distinct from the reason recorded when the rework budget is
exhausted.
The gate SHALL NOT authorise a merge from the `Abandoned` state under any
`[audit.policy]` value.
The audit-attempt count SHALL be recorded in the run directory so that it
survives a restart of the orchestrating agent.

#### Scenario: an auditor that always errors terminates instead of looping

- WHEN every audit for a task records `UNVERIFIED` because the audit CLI is
  unauthenticated
- THEN the task reaches `Abandoned` after the configured number of audit
  attempts
- AND the abandonment reason names audit non-completion rather than rework
  exhaustion
- AND the rework-round count for the task is still zero.

#### Scenario: the audit bound is not the rework bound

- WHEN `limits.max_rework_rounds` is set to a large value and the audit-attempt
  bound to a small one
- THEN a task whose audits always return `UNVERIFIED` is abandoned after the
  small bound
- AND changing `limits.max_rework_rounds` alone does not change when it is
  abandoned.

#### Scenario: a recovered auditor does not erase the record

- WHEN two audits return `UNVERIFIED` and the third returns `APPROVED`
- THEN the gate evaluates the `APPROVED` verdict normally
- AND the recorded audit-attempt count remains readable in the run record.

### Requirement: a gate decision cannot be invalidated between evaluation and merge

The merge SHALL apply to exactly the diff the gate evaluated.

WHEN a merge is performed after a passing gate, the merge step SHALL recompute
the diff's content hash inside the merge transaction and compare it with the
hash the gate recorded, and IF they differ, THEN the merge SHALL abort with a
distinct reason naming the change of the tree under review.
The merge step SHALL NOT create commits from uncommitted worker changes after
the gate has hashed the diff; a worktree that is not clean at gate time SHALL
be committed before the gate hashes it, or the gate SHALL refuse.
The merge-freshness condition SHALL be evaluated inside the same transaction as
the merge it guards, and SHALL NOT be evaluated once and relied upon later.

#### Scenario: a worktree that changes after the gate does not merge

- WHEN the gate passes for a diff
- AND the worker's uncommitted changes are committed after the gate recorded
  that diff's content hash
- THEN the merge aborts
- AND the reason names the content-hash change rather than a verdict value.

#### Scenario: merge freshness is re-evaluated at merge time

- WHEN the merge-freshness condition holds at check time and no longer holds
  when the merge is applied
- THEN the merge aborts
- AND the abort names merge freshness as the unmet condition.

### Requirement: WARNING never authorises a merge by default

A `WARNING` verdict SHALL NOT authorise a merge unless a resolved
`[audit.policy]` value explicitly permits it for the findings present.

WHEN the gate evaluates a `WARNING` verdict, it SHALL resolve
`audit.policy.warning_low_resolved` and `audit.policy.warning_medium` and act on
the resolved values.
IF no resolved policy value permits merge for the findings present, THEN the
gate SHALL fail with a reason naming the unresolved findings.
The gate SHALL NOT reach a merge decision for `WARNING` by falling through a
test that only rejects `BLOCKED`.

#### Scenario: an unresolved medium warning does not merge

- WHEN the verdict is `WARNING` with an unresolved medium-severity finding
- AND `audit.policy.warning_medium` resolves to its built-in default
- THEN the gate fails
- AND the reason names the unresolved finding rather than reporting a pass.

#### Scenario: WARNING is decided by policy, not by the absence of BLOCKED

- WHEN the verdict is `WARNING` and every finding is low severity and resolved
- AND `audit.policy.warning_low_resolved` permits merge
- THEN the gate passes
- AND the pass is attributable to the resolved policy value rather than to the
  verdict merely not being `BLOCKED`.

## MODIFIED Requirements

### Requirement: the gate binds the verdict to the diff under evaluation

The merge gate SHALL verify that the audit verdict it reads describes the diff
it is gating.

WHEN the gate evaluates a task, it SHALL recompute the content hash of the diff
under evaluation and compare it with the verdict's recorded evidence
reference.
IF the hashes differ, THEN the gate SHALL fail with a distinct reason naming
the mismatch, and SHALL NOT treat the verdict as applicable.
The binding SHALL be on the diff's content hash and SHALL NOT be on the head
commit sha, so that a rebase or amend producing a byte-identical diff does not
invalidate a valid audit.
The gate SHALL continue to fail closed when the verdict artifact is missing or
schema-invalid.

#### Scenario: a stale verdict no longer passes the gate

- WHEN `audit-verdict.json` records `APPROVED` for a diff whose content hash
  differs from the diff currently under evaluation
- THEN the gate fails
- AND the reason names the evidence mismatch rather than the verdict value.

#### Scenario: a rebase with no content change keeps the audit valid

- WHEN the branch is rebased such that the head sha changes but the diff
  content is byte-identical
- THEN the recorded verdict remains applicable
- AND the gate does not fail on the evidence binding.

### Requirement: UNVERIFIED fails the gate closed, distinctly, and costs no rework round

The merge gate SHALL treat `UNVERIFIED` as a failure that is distinguishable
from `BLOCKED` at every layer that records or reports it.

WHEN the verdict is `UNVERIFIED`, THEN the gate SHALL fail with a reason string
distinct from the `BLOCKED` reason string, and that reason SHALL carry the
recorded `UNVERIFIED` reason.
An `UNVERIFIED` gate failure SHALL NOT be counted against
`limits.max_rework_rounds`, because no worker attempt is implicated.
The gate SHALL NOT collapse `UNVERIFIED` into `BLOCKED` in any output, metric,
or event payload.

#### Scenario: an infrastructure failure does not consume the worker's budget

- WHEN two consecutive audits return `UNVERIFIED` because the audit CLI is
  unauthenticated
- THEN the gate fails both times
- AND the rework-round count for the task is unchanged
- AND the task is not abandoned for exhausting its rework budget.

#### Scenario: the two failure kinds stay distinguishable

- WHEN a gate decision is recorded for an `UNVERIFIED` verdict and another for
  a `BLOCKED` verdict
- THEN the two decisions carry different reason strings
- AND a reader can count them separately without inspecting free text.

### Requirement: the gate reads the audit policy it documents

The merge gate SHALL read `[audit.policy]` from configuration rather than
leaving it as prose doctrine.

`[audit.policy]` SHALL gain an `unverified` key, defaulting to `retry`, next to
the existing `warning_low_resolved`, `warning_medium` and `blocked` keys.
Every policy value SHALL be resolved with a hard-coded fallback, so that a
missing, unreadable or malformed configuration degrades to the built-in
defaults and SHALL NOT introduce a new way for the gate to fail.
The documentation that describes `[audit.policy]` as gate policy SHALL be
accurate once this lands, and the note stating that the gate does not read it
SHALL be removed rather than left contradicting the code.

#### Scenario: a malformed config does not break the gate

- WHEN `.foreman/config.toml` is unreadable or malformed
- THEN the gate resolves every audit policy value to its built-in default
- AND the gate's pass or fail outcome is unchanged from the default-config
  case.

#### Scenario: the documented policy is the executed policy

- WHEN `audit.policy.blocked` is set to `never`
- THEN a `BLOCKED` verdict fails the gate
- AND the behaviour is produced by the configuration value rather than by
  hard-coded logic alone.
