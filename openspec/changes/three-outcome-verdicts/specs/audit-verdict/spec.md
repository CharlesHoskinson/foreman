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

- WHEN the reviewed worktree's content digest, as defined by
  `evidence-contracts` (the canonical fixed-arity record of path, state, mode
  and hash over every path
  `git status --porcelain=v1 -z -uall --no-renames` reports, deletions
  included), differs before and after the audit on a path that is not an entry
  of the round's recorded declared deliverable set
- THEN the recorded verdict is `UNVERIFIED` with a reason naming the mutation
- AND the audit stage exits non-zero
- AND detection does not depend on the porcelain status string changing, which
  is verified blind to a second edit of an already-modified file.

### Requirement: every audit writes a verdict artifact

The audit stage SHALL write `audit-verdict.json` on every execution path,
including every failure path, before returning to its caller.

Every write SHALL be atomic (temporary file plus rename), so that an
interrupted write leaves a complete previous artifact rather than a
partially-written one.
The audit stage's exit status SHALL communicate completion to its caller, and
SHALL NOT be the only signal that an audit failed.
The audit stage SHALL NOT terminate on a failure path without having written an
artifact describing that failure.

#### Scenario: a failed re-audit does not leave the prior verdict standing

- WHEN a re-audit of a reworked diff fails for any reason
- THEN `audit-verdict.json` describes that failure as `UNVERIFIED`
- AND it no longer describes the previous round's judgment.

### Requirement: the current audit attempt is published before the auditor is spawned

WHEN the audit stage begins an audit, and BEFORE it spawns the auditor process,
it SHALL allocate a new audit attempt id from `el_attempt_new` (the existing
per-run-per-lane monotonic attempt entity), SHALL atomically record that id as
the current audit attempt in the run directory, and SHALL atomically publish
`audit-verdict.json` carrying `verdict = "UNVERIFIED"`, `state =
"in_progress"`, a reason naming audit non-completion, and the full evidence
reference for the attempt about to run.

Atomicity of the publish means a temporary file plus rename, so the artifact on
disk is at all times a complete document; it does not mean the previous
verdict survives until the audit finishes.
WHILE an audit is in flight, the artifact on disk SHALL therefore describe the
current attempt as unfinished, and SHALL NOT describe any previous attempt's
judgment.
An audit killed at any point after the publish SHALL leave the in-progress
`UNVERIFIED` record for the current attempt, and SHALL NOT leave a previous
`APPROVED` readable by the gate.
The gate SHALL treat `state = "in_progress"` as non-authorizing under every
`[audit.policy]` value.
Deleting `audit-verdict.json` at the start of an audit SHALL NOT be used in
place of this publish, because it converts a crash between delete and write
into a missing input rather than a correctly-recorded unfinished one.

#### Scenario: an interrupted same-diff re-audit cannot leave a valid approval

- WHEN a previous attempt recorded `APPROVED` for a diff
- AND a re-audit of the byte-identical diff is spawned and killed before it
  completes
- THEN `audit-verdict.json` records the current attempt as `UNVERIFIED` with
  `state = "in_progress"`
- AND the gate fails naming the unfinished audit attempt
- AND the gate does not read a previous `APPROVED` carrying the same
  `diff_sha256`.

#### Scenario: the published attempt id is the one the gate compares against

- WHEN an audit is spawned
- THEN the run directory records the new attempt id before the auditor process
  starts
- AND that recorded id survives a restart of the orchestrating agent.

### Requirement: every verdict carries provenance and an evidence reference

`audit-verdict.json` SHALL carry, for every verdict value including
`UNVERIFIED`: the audit vendor, the audit model identifier, the reasoning
effort requested, the verdict, `state`, a reason when the verdict is
`UNVERIFIED`, an evidence reference, and the start time, end time and duration
in seconds of the audit call.

The evidence reference SHALL contain exactly these fields: `diff_sha256` (the
content hash of the reviewed diff), `tree_sha256` (the canonical identity of
the evaluated tree), `base_sha`, `head_sha`, and `attempt` (the audit attempt
id allocated before the auditor was spawned).
`tree_sha256` SHALL be computed as the git tree object id of `HEAD` in the
reviewed worktree, combined with a canonical content digest of every path
reported by `git status --porcelain=v1 -z -uall --no-renames` in that worktree,
so that untracked files, staged and unstaged content, file modes, symbolic
links, deletions and binary files are all covered.
The canonical content digest SHALL be the SHA-256 of the concatenation of one
fixed-arity record per reported path, records ordered by bytewise-ascending
path, each record carrying the path, a one-character state, a six-digit mode
and a 64-character lowercase hexadecimal hash, NUL-separated and
newline-terminated. The states SHALL be `f` with the git file mode and the
SHA-256 of the bytes for a regular file, `l` with mode `120000` and the SHA-256
of the link target string for a symbolic link, `d` with mode `040000` and
sixty-four `0` characters for a directory, and `-` with mode `000000` and
sixty-four `0` characters for a reported path that does not exist.
A deleted path SHALL therefore be encoded as the absent state and SHALL NEVER
be a missing record, so a worktree containing a deletion is canonicalisable,
two worktrees differing only by a deletion produce different `tree_sha256`
values, and an implementer is not left to invent a sentinel. `--no-renames`
decomposes a rename into an absent record for the old path and a present record
for the new one, and `-z` prevents the shell-quoting that porcelain v1 applies
to paths containing spaces, quotes or newlines.
IF a reported path exists but its bytes, mode or link target cannot be read,
THEN the evaluated tree cannot be canonicalised and the audit stage SHALL
record `UNVERIFIED` naming that path, and SHALL NOT substitute the absent
state, because that would encode an unreadable file identically to a deleted
one.
IF the evaluated tree cannot be canonicalised for any other reason, THEN the
audit stage SHALL likewise record `UNVERIFIED` with a reason naming the failure
to compute the tree identity, and SHALL NOT record an evidence reference
containing an empty or defaulted `tree_sha256`.
This canonical function SHALL be the one `evidence-contracts` specifies for
write-evidence content digests; there SHALL be exactly one implementation of it
in the harness.
`state` SHALL be one of `in_progress` or `complete`, and SHALL be `complete`
only after the auditor has returned and its output has been interpreted.
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

#### Scenario: the evidence reference names the tree, not only the diff

- WHEN any verdict is written
- THEN its evidence reference carries `diff_sha256`, `tree_sha256`, `base_sha`,
  `head_sha` and `attempt`
- AND `tree_sha256` covers untracked files, uncommitted content and file modes
  in the reviewed worktree.

#### Scenario: a worktree containing a deletion is canonicalisable

- WHEN the reviewed worktree has a tracked file deleted but not staged, so
  porcelain reports it as deleted and no bytes exist to hash
- THEN `tree_sha256` is computed with that path carrying the absent state,
  mode `000000` and a 64-character zero hash
- AND the identity differs from that of the otherwise-identical worktree in
  which the file is still present
- AND the audit is not recorded `UNVERIFIED` for an uncomputable tree.

#### Scenario: an unreadable path is unverified, not encoded as absent

- WHEN a path reported by the status enumeration exists but its bytes cannot be
  read
- THEN the verdict is `UNVERIFIED` with a reason naming that path
- AND no `tree_sha256` is written in which that path carries the absent state.

#### Scenario: an uncomputable tree identity is unverified, not defaulted

- WHEN the tree identity cannot be computed
- THEN the verdict is `UNVERIFIED` with a reason naming the computation failure
- AND no evidence reference with an empty or defaulted `tree_sha256` is
  written.

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


### Requirement: every gate input is bound to the diff and to the evaluated tree

The merge gate SHALL bind all three of its decision inputs -- the audit
verdict, the independent-checks result, and the docs-check result -- to both
the content hash of the diff under evaluation and the canonical identity of the
evaluated tree, and SHALL NOT treat any of them as applicable to a diff or a
tree it does not describe.

WHEN the gate reads `checks-result.json`, it SHALL read the recorded
`diff_sha256` and `tree_sha256` alongside `.status`, and IF either does not
match the diff and tree under evaluation, THEN the gate SHALL fail with a
distinct reason naming the stale independent-checks artifact and naming which
of the two identities mismatched.
WHEN the gate reads `docs-check.json`, it SHALL apply the same binding and
produce its own distinct failure reason.
`checks-run.sh` and the docs check SHALL each record `diff_sha256` and
`tree_sha256` for the diff and tree they evaluated, alongside the `sha` field
`checks-run.sh` already writes, computing `tree_sha256` with the same canonical
function the verdict uses.
The checks and docs artifacts SHALL NOT carry an `attempt` field: the audit
attempt binds the verdict only, because only the verdict is produced by an
audit attempt.
The diff binding exists so that a rebase producing a byte-identical diff over an
identical tree does not invalidate a valid run; the tree binding exists because
a byte-identical patch applied over a different base yields a different
resulting tree and different dependencies, and the diff hash alone cannot
discriminate that case.
IF any of the four required identity values cannot be computed at gate time,
THEN the gate SHALL fail closed with a distinct reason naming the computation
failure, and SHALL NOT treat an uncomputable identity as a match, as an empty
value, or as a pass.
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

#### Scenario: a checks run against a different tree does not authorise merge

- WHEN `checks-result.json` records `status: "pass"` with a `diff_sha256` equal
  to the diff under evaluation but a `tree_sha256` that differs
- THEN the gate fails
- AND the reason names the evaluated-tree mismatch on the independent-checks
  artifact.

#### Scenario: an uncomputable identity fails the gate closed

- WHEN the gate cannot compute the diff hash or the evaluated-tree identity
- THEN the gate fails with a reason naming the computation failure
- AND the gate does not proceed to compare any input.

#### Scenario: all inputs fresh against the same diff and tree is the only passing configuration

- WHEN the verdict, the checks result and the docs result each record the
  content hash of the diff under evaluation and the identity of the evaluated
  tree
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

### Requirement: the gate binds the verdict to the current audit attempt and the evaluated tree

The merge gate SHALL verify that the audit verdict it reads was produced by the
current audit attempt, against the diff it is gating, and against the tree that
diff resolves to.

WHEN the gate evaluates a task, it SHALL recompute the content hash of the diff
under evaluation and the canonical identity of the evaluated tree, read the
current audit attempt id from the run directory, and require all four of the
following to hold: `evidence.diff_sha256` equals the recomputed diff hash;
`evidence.tree_sha256` equals the recomputed evaluated-tree identity;
`evidence.attempt` equals the current audit attempt id; and `state` equals
`complete`.
IF any one of those four comparisons fails, THEN the gate SHALL fail with its
own distinct reason -- diff mismatch, evaluated-tree mismatch, superseded or
unfinished audit attempt, or incomplete audit -- and SHALL NOT treat the
verdict as applicable.
Staleness is therefore detected by any of: a changed diff, a changed evaluated
tree at an unchanged diff hash, a verdict from an earlier attempt than the one
currently published, or a verdict whose audit never finished.
The diff binding SHALL NOT be on the head commit sha, so that an amend or a
re-checkpoint that changes no content and no resulting tree does not invalidate
a valid audit.
The tree binding exists because `diff_sha256` alone does not discriminate the
evaluated tree: a rebase onto a different base can produce a byte-identical
patch while changing the resulting tree and the dependencies the audit, the
independent checks and the docs check ran against.
The attempt binding exists because `diff_sha256` alone does not discriminate
the audit attempt: an audit of an unchanged diff that is killed before it
completes would otherwise leave a previous `APPROVED` carrying the same diff
hash, still gate-valid.
The gate SHALL continue to fail closed when the verdict artifact is missing or
schema-invalid, and IF the diff hash, the tree identity or the current attempt
id cannot be computed or read, THEN the gate SHALL fail closed with a distinct
reason naming the computation failure rather than treating it as a match.

#### Scenario: a stale verdict no longer passes the gate

- WHEN `audit-verdict.json` records `APPROVED` for a diff whose content hash
  differs from the diff currently under evaluation
- THEN the gate fails
- AND the reason names the evidence mismatch rather than the verdict value.

#### Scenario: an amend with no content and no tree change keeps the audit valid

- WHEN the branch is amended or re-checkpointed such that the head sha changes
  but the diff content is byte-identical and the evaluated tree identity is
  unchanged
- THEN the recorded verdict remains applicable
- AND the gate does not fail on the evidence binding.

#### Scenario: a byte-identical patch over a different base does not stay approved

- WHEN the branch is rebased onto a different base so that the patch is
  byte-identical and `diff_sha256` is unchanged
- AND the resulting evaluated tree identity differs from the one the audit
  recorded
- THEN the gate fails
- AND the reason names the evaluated-tree mismatch rather than the verdict
  value.

#### Scenario: a killed re-audit of an unchanged diff does not inherit the prior approval

- WHEN a previous attempt recorded `APPROVED` for a diff
- AND a re-audit of that byte-identical diff is spawned and killed before
  completion
- THEN the gate fails naming the unfinished or superseded audit attempt
- AND the gate does not authorise a merge on the strength of the matching
  `diff_sha256`.

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
