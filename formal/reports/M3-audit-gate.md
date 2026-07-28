# M3 — Audit, verdict, gate, and merge decision

## The flow modelled, and the state machine

The model is in `specs/audit_gate.qnt`. It follows one Foreman task from a
worker diff through checks, docs-check, audit, the three on-disk gate
artifacts, `gate-eval.sh`, `merge-gate.sh`, and the final `wt-merge.sh`
decision.

The source behavior represented is:

- `audit-run.sh:31-42,91-108` compares the configured worker/auditor vendor-name
  strings at lines 31-33, then has failure exits for mismatch, unsupported
  or missing CLI, missing schema, worktree mutation, non-zero process exit,
  empty output, no JSON object, and an out-of-enum verdict. In the current
  implementation these paths do not replace `audit-verdict.json`.
- `gate-eval.sh` contains no vendor, CLI, or model-family logic. Lines 43-47
  accept a parseable `APPROVED` or `WARNING`, reject `BLOCKED`, and do not
  compare the verdict to the current diff.
- `gate-eval.sh:12-14,40-52` also requires passing `checks-result.json` and
  `docs-check.json`, but neither artifact is bound to the current diff.
  `checks-run.sh:18-29` can exit before its write at lines 40-42, while a
  completed failing check does write `status: fail`. `docs-check.sh` normally
  writes pass/fail JSON at lines 115-131, but argument/setup/output failures can
  exit before that replacement. Thus both files have a real stale-pass window.
- `merge-gate.sh:146-160` emits `MERGEABLE` only if the recorded merge base
  exists, belongs to the branch, and is at most
  `durable.merge_base_max_commits` behind local `origin/main`.
- `wt-merge.sh:48-120,143-151` commits pending worker changes and then
  squash-merges the worker branch.
- `foreman.toml.example:17-18` supplies the default
  `limits.max_rework_rounds = 3`.

The principal state variables are:

| State | Meaning |
|---|---|
| `diff: int` | Collision-free abstract content-hash id. A rework mints `diff + 1`. |
| `verdictFile` | `NoVerdict` or `VerdictPresent({ verdict, boundDiff })`. |
| `checksFile`, `docsFile` | `NoArtifact` or `ArtifactPresent({ status, boundDiff })`; success refreshes the file, a completed failure writes `ArtifactFail`, and a pre-write failure preserves the previous record. |
| `round` | Worker rework count, separately bounded by `MAX_REWORK_ROUNDS`. |
| `auditAttempts` | Infrastructure/auditor attempt count, independently capped in the repaired configuration. |
| `workerCli`, `auditCli` | CLI identities: Claude, Codex, Grok, or agy. |
| `workerFamily`, `auditFamily` | Model families: Anthropic, OpenAI, XAI, or Google. |
| `originDistance` | Commits from the recorded merge base to current local `origin/main`. |
| `mergeFreshness` | The recorded `MERGEABLE` / `NOT_MERGEABLE` result. |
| `mergedDiff`, `authorizingDiff`, `authorizingVerdict` | Ghost state that records what shipped and what the accepting verdict actually described. |
| `gateReason`, `auditFailureReason` | Sum types, used instead of manipulating strings. `GateBlocked` and `GateUnverified` are distinct values. |

The phases are:

1. `AwaitAudit`: checks/docs may refresh, write a current failure, or fail
   before replacement; then run an audit. The model can emit only `APPROVED`,
   `WARNING`, or `BLOCKED`; only the harness failure transition can write
   `UNVERIFIED`.
2. `AwaitGate`: accept an applicable positive verdict or reject a missing,
   blocked, unverified, hash-mismatched, route-disallowed, or failed/stale
   checks/docs result.
3. `NeedsRework`: mint a new diff id, increment `round`, and audit again.
4. `AwaitFreshness`: evaluate the recorded merge base against the current
   `originDistance`.
5. `ReadyToMerge`: consume `MERGEABLE` and record the actual diff merged.
6. `Done` or `Abandoned`: terminal states with explicit stuttering.

`boundDiff` is intentionally ghost/oracle data. It records which diff each
artifact really describes so that safety can be stated. In `pre_fix`,
`contentBindingPasses` returns `true` without examining it; therefore the
pre-fix gate cannot see the verdict field. In `post_fix`, the verdict predicate
requires `boundDiff == diff`, but `CHECKS_BIND_CONTENT_HASH = false`, matching
the release's omission for checks/docs. `post_fix_full_binding` enables the
same equality check for all three artifacts.

The file contains six configurations:

- `pre_fix`: no content binding, failure leaves the file untouched, CLI-name
  routing, no audit-attempt cap.
- `post_fix`: verdict content binding, every audit failure writes `UNVERIFIED`,
  family-level routing, a separate three-attempt cap, and deliberately unbound
  checks/docs artifacts (the specified shipping repair).
- `uncapped_errors`: repaired artifact semantics but an auditor that always
  fails and no attempt cap.
- `capped_errors`: the same always-failing auditor with a three-attempt cap.
- `post_fix_toctou`: the repaired gate plus an adversarial diff mutation after
  gate evaluation and before merge.
- `post_fix_full_binding`: verdict, checks, and docs artifacts are all bound to
  the current diff.

## Every invariant in plain English

| Quint name | Plain-English property |
|---|---|
| `no_unaudited_merge` | If a diff is merged, its content-hash id equals the diff id described by the verdict that authorized merge. |
| `no_merge_on_blocked_or_unverified` | A merge is never authorized by `BLOCKED` or harness-assigned `UNVERIFIED`. |
| `cross_vendor_family_distinct` | The actual auditor model family differs from the actual worker model family. |
| `no_same_family_authorized_merge` | A merge can never be authorized by an auditor from the worker's actual model family. Unlike the routing invariant, this requires the defect to reach `merged = true`. |
| `no_unverified_checks_merge` | A merged diff must equal the diff whose independent-checks artifact recorded `pass`. |
| `no_unverified_docs_merge` | A merged diff must equal the diff whose docs-check artifact recorded `pass`. |
| `rework_rounds_bounded` | `round` never exceeds `MAX_REWORK_ROUNDS` (3 in every concrete configuration). |
| `audit_attempts_at_most_cap` | When a non-zero audit-attempt cap is configured, `auditAttempts` never exceeds it. |
| `audit_attempts_bounded_by_three` | Diagnostic finite bound used to show that the uncapped always-error system exceeds three attempts. |
| `naive_cli_check_implies_family_distinct` | Diagnostic claim that differing CLI names imply differing families. The agy gateway refutes it. |
| `no_stale_approved_merge` | A narrower diagnostic form of `no_unaudited_merge` that forces the stale counterexample to use `APPROVED`. |
| `no_warning_authorized_merge` | Diagnostic policy claim that `WARNING` cannot itself authorize merge. Current gate behavior refutes it. |
| `no_merge_beyond_freshness_bound` | At the actual merge, the recorded base is still within `MERGE_BASE_MAX_COMMITS`. A check/merge race refutes it. |
| `task_not_abandoned` | A reachability witness: violating it shows that the capped always-error configuration reaches `Abandoned`. |
| `gate_hash_mismatch_unreachable` | Reachability diagnostic: `GateHashMismatch` is never entered. It holds pre-fix because verdict content binding is disabled. |

The required bounded results are:

| Configuration / property | Apalache bound | Result |
|---|---:|---|
| `pre_fix / no_unaudited_merge` | 8 | **VIOLATED**, state 6 |
| `pre_fix / no_stale_approved_merge` | 8 | **VIOLATED**, state 6 |
| `post_fix /` five required safety invariants combined | 10 | **NoError** through length 10 |
| `pre_fix / no_merge_on_blocked_or_unverified, rework_rounds_bounded` | 10 | **NoError** through length 10 |
| `pre_fix / cross_vendor_family_distinct` | 1 | **VIOLATED** in initial state |
| `uncapped_errors / audit_attempts_bounded_by_three` | 8 | **VIOLATED**, state 7 |
| `capped_errors / audit_attempts_at_most_cap, rework_rounds_bounded` | 10 | **NoError** through length 10 |
| `capped_errors / task_not_abandoned` | 8 | **VIOLATED**, reaches `Abandoned` at state 6 |
| `pre_fix / no_same_family_authorized_merge` | 8 | **VIOLATED**, same-family verdict merges at state 4 |
| `post_fix / no_same_family_authorized_merge` | 10 | **NoError** through length 10 |
| `pre_fix / gate_hash_mismatch_unreachable` | 10 | **NoError** through length 10; `GateHashMismatch` is unreachable |
| `post_fix / no_unverified_checks_merge` | 8 | **VIOLATED**, stale checks pass merges at state 6 |
| `post_fix / no_unverified_docs_merge` | 8 | **VIOLATED**, stale docs pass merges at state 6 |
| `post_fix_full_binding / no_unverified_checks_merge, no_unverified_docs_merge, no_unaudited_merge` | 10 | **NoError** through length 10 |
| `post_fix / no_warning_authorized_merge` | 6 | **VIOLATED**, state 4 |
| `post_fix / no_merge_beyond_freshness_bound` | 9 | **VIOLATED**, state 7 |
| `post_fix_toctou / no_unaudited_merge` | 7 | **VIOLATED**, state 5 |

“NoError through length N” is the bounded result, not an unbounded theorem.

## The stale-verdict counterexample

Apalache found the required `APPROVED` counterexample at state 6 with bound 8.
Here is the actual compacted ITF trace; `APPROVED@0` means the on-disk verdict
describes diff 0.

| State | Phase | `diff` | `round` | Attempts | On-disk verdict | Audit failure | Gate | Authorizer | Merged |
|---:|---|---:|---:|---:|---|---|---|---|---|
| 0 | `AwaitAudit` | 0 | 0 | 0 | absent | none | not run | none | no |
| 1 | `AwaitGate` | 0 | 0 | 1 | `APPROVED@0` | none | not run | none | no |
| 2 | `AwaitAudit` | 1 | 1 | 1 | `APPROVED@0` | none | not run | none | no |
| 3 | `AwaitGate` | 1 | 1 | 2 | `APPROVED@0` | `NoJsonObject` | not run | none | no |
| 4 | `AwaitFreshness` | 1 | 1 | 2 | `APPROVED@0` | `NoJsonObject` | `GatePassed` | `APPROVED@0` | no |
| 5 | `ReadyToMerge` | 1 | 1 | 2 | `APPROVED@0` | `NoJsonObject` | `GatePassed` | `APPROVED@0` | no |
| 6 | `Done` | 1 | 1 | 2 | `APPROVED@0` | `NoJsonObject` | `GatePassed` | `APPROVED@0` | **diff 1** |

Commentary:

1. Round 0 audits diff 0 and writes `APPROVED`.
2. Rework mints diff 1 and increments the worker round to 1. The stable run
   directory still contains `APPROVED@0`.
3. The re-audit fails because its output has no JSON object. This is the real
   `audit-run.sh:103-104` path. Pre-fix failure does not write or remove the
   verdict file.
4. The gate checks only the enum and “not BLOCKED”. It records the old
   authorizer even though current `diff == 1`.
5. Merge-base freshness passes, then diff 1 is squash-merged. The authorizing
   verdict described diff 0, so `mergedDiff == 1 != authorizingDiff == 0`.

This is a concrete reproduction of the requested defect, not merely a
hypothetical execution.

The supplementary random simulator independently found the same trace with a
`VendorMismatch` failure and seed `0xa12e00442bf8c310`.

## The content-hash binding result (post-fix)

In `post_fix`, every failed audit atomically replaces the logical verdict state
with `VerdictPresent({ verdict: UNVERIFIED, boundDiff: diff })`. The gate:

- rejects `UNVERIFIED` using `GateUnverified`, not `GateBlocked`;
- leaves `round` unchanged;
- recomputes applicability as `fileBoundDiff(verdictFile) == diff`; and
- applies the configured `routeAllowed` predicate.

This repair is intentionally verdict-only. `checksFile` and `docsFile` still
use `CHECKS_BIND_CONTENT_HASH = false` in `post_fix`; their separate
counterexample is finding 4 below.

`GateHashMismatch` is dead in `pre_fix`. With
`BIND_CONTENT_HASH = false`, `contentBindingPasses` is definitionally `true`,
so the `not(contentBindingPasses(verdictFile))` guard of
`gateRejectHashMismatch` is unsatisfiable. Apalache confirmed this by checking
`gate_hash_mismatch_unreachable` (`gateReason != GateHashMismatch`): **NoError
through length 10**. The reason remains in the shared vocabulary because it is
reachable in binding-enabled configurations, not because current pre-fix code
can emit it.

Apalache generated five verification conditions for the combined check:

```text
no_unaudited_merge
no_merge_on_blocked_or_unverified
cross_vendor_family_distinct
rework_rounds_bounded
audit_attempts_at_most_cap
```

The result was:

```text
> VCGen produced 5 verification condition(s)
The outcome is: NoError
Checker reports no error up to computation length 10
EXITCODE: OK
```

Thus the required post-fix properties hold for every modeled execution through
length 10 **under the configuration's explicit assumption that the diff cannot
mutate after gate evaluation**. The last qualification matters; the adversarial
configuration below exposes a separate boundary defect.

## UNVERIFIED termination analysis and the required bound

`UNVERIFIED` correctly consumes no rework round: every state in both
always-error traces has `round == 0`. That makes `max_rework_rounds` incapable
of terminating an infrastructure-failure loop.

Without an audit-attempt cap, Apalache refuted `auditAttempts <= 3`:

```text
state  phase       auditAttempts  round  gate
0      AwaitAudit  0              0      GateNotRun
1      AwaitGate   1              0      GateNotRun
2      AwaitAudit  1              0      GateUnverified
3      AwaitGate   2              0      GateNotRun
4      AwaitAudit  2              0      GateUnverified
5      AwaitGate   3              0      GateNotRun
6      AwaitAudit  3              0      GateUnverified
7      AwaitGate   4              0      GateNotRun
```

The same two transitions can repeat without changing `round`, so this is an
unbounded audit → `UNVERIFIED` → gate-fail → re-audit loop.

The real system needs a separate `max_audit_attempts` or
`max_consecutive_unverified` setting. It must not reuse
`limits.max_rework_rounds`, because that would blame worker iterations for
auditor infrastructure failures. The concrete model uses 3 only to match the
existing rework default; the production default is a policy choice and should
be independently configurable.

With `MAX_AUDIT_ATTEMPTS = 3`, Apalache found no violation of the attempt cap or
rework cap through length 10, and the always-error trace reaches:

```text
state  phase       auditAttempts  round
0      AwaitAudit  0              0
1      AwaitGate   1              0
2      AwaitAudit  1              0
3      AwaitGate   2              0
4      AwaitAudit  2              0
5      AwaitGate   3              0
6      Abandoned   3              0
```

For `capped_errors`, audit success is disabled and the only non-terminal
progress from `AwaitAudit` is an audit failure; from an unverified `AwaitGate`,
rework is disabled and the only progress is the unverified rejection. Therefore
the cap structurally reaches `Abandoned` after at most `2 * cap` transitions.
This is a termination argument for the isolated always-error subsystem, not a
general fairness proof for all Foreman scheduling.

## Cross-vendor / agy-gateway result

CLI and family are separate sum types. Fixed CLIs resolve as Claude→Anthropic,
Codex→OpenAI, and Grok→XAI. `AgyCli` nondeterministically resolves to Anthropic,
OpenAI, or Google, reflecting the actual listed models:
`claude-sonnet-4-6`, `claude-opus-4-6-thinking`,
`gpt-oss-120b-medium`, and `gemini-*`.

The real pre-fix protection is only `audit-run.sh:31-33` comparing the two
configured vendor-name strings. `gate-eval.sh` performs no second routing
check. The model therefore uses `routeAllowed`: CLI/vendor-name inequality
when `FAMILY_LEVEL_CHECK = false`, family inequality when it is true. Both
`gateAccept` and `gateRejectSameFamily` are governed by that predicate; there
is no unconditional family check hidden in the modeled gate.

The initial-state diagnostic remains valid:

```text
workerCli     workerFamily  auditCli  auditFamily
CodexCli      OpenAI        AgyCli    OpenAI
```

The CLI names differ, so the naive test passes; the families are identical.
The analogous Claude/agy/Anthropic pairing is also in the state space.

More importantly, Apalache now violated
`no_same_family_authorized_merge` at state 4, proving the defect reaches a
real merge:

| State | Phase | Worker | Auditor | Families | Verdict/authorizer | Merged |
|---:|---|---|---|---|---|---|
| 0 | `AwaitAudit` | `CodexCli` | `AgyCli` | OpenAI / OpenAI | absent | no |
| 1 | `AwaitGate` | `CodexCli` | `AgyCli` | OpenAI / OpenAI | `APPROVED@0` | no |
| 2 | `AwaitFreshness` | `CodexCli` | `AgyCli` | OpenAI / OpenAI | `APPROVED@0` | no |
| 3 | `ReadyToMerge` | `CodexCli` | `AgyCli` | OpenAI / OpenAI | `APPROVED@0` | no |
| 4 | `Done` | `CodexCli` | `AgyCli` | OpenAI / OpenAI | `APPROVED@0` | **diff 0** |

The name check passes (`CodexCli != AgyCli`), the same-family auditor produces
a real positive verdict, `gate-eval.sh` has no family check to stop it, and
that verdict merges. This is stronger than the round-1 initial-state result.
Under `post_fix`, family-level routing excludes the pairing:
`no_same_family_authorized_merge` has **NoError through length 10**, as does
the initializer-level `cross_vendor_family_distinct` condition in the combined
five-property run.

This model has one worker. It proves the pairwise routing predicate and exposes
the existential gateway defect. For raced multi-worker rounds, the real router
must quantify the same predicate over every worker family; that set
quantification is not proved by this lane's one-task abstraction.

## What was abstracted away and why that abstraction is safe

- **Diff bytes and cryptographic hashing.** Integer ids stand for
  collision-free content hashes. The stale-file defect depends only on equality
  versus inequality (`0 != 1`), not hash syntax. This abstraction does assume
  collision resistance; it does not analyze deliberate hash collisions.
- **Filesystem and JSON representation.** `NoVerdict` versus
  `VerdictPresent(record)`, and `NoArtifact` versus
  `ArtifactPresent({ status, boundDiff })`, preserve exactly the facts used by
  the gate.
  Parsing, empty output, enum rejection, CLI/config failures, and mutation
  detection are collapsed into `AuditFailureReason` variants because all have
  the same relevant persistence behavior. Keeping separate variants confirms
  each path can drive the shared transition. Checks/docs distinguish failure
  before replacement (old file survives) from completed failure (current
  `ArtifactFail` is written); their pre-write failure and “not run” cases are
  observationally identical on disk.
- **Opaque reason strings.** Quint cannot manipulate strings, so gate and audit
  reasons are sum types. The required property is categorical distinction:
  `GateUnverified != GateBlocked`. Sum types preserve that more strongly than
  free text.
- **Other `gate-eval.sh` inputs.** Forbidden-path evaluation, `hashes.txt`
  drift, and merge conflicts are assumed to pass. Those checks can only prevent
  the modeled merge, so omitting their failure branches cannot hide any of the
  three stale-artifact merges. `checks-result.json` and `docs-check.json` are no
  longer abstracted away: their status, provenance, successful replacement,
  completed-failure replacement, and pre-write-failure persistence are explicit.
  A nondeterministic rework action still stands for another check or architect
  decision requiring rework even after an audit approves.
- **Git object structure.** Base sha, head sha, ancestry, and actual patch
  application are reduced to diff identity plus origin distance. Commit
  identity is deliberately omitted because the specified repair binds diff
  content, not head sha. Dirty-index and conflict exits only block merge and
  cannot manufacture an unauthorized merge.
- **Merge-base scale.** Concrete configurations use
  `MERGE_BASE_MAX_COMMITS = 2` rather than the real default 50 to shorten
  traces. The predicate is the same strict threshold (`distance > max`), so the
  boundary and check/merge race are preserved.
- **Time, process lifetime, and subprocess output.** The state machine records
  success, failure before artifact replacement, or failure after replacement.
  This is sufficient for artifact persistence and retry-count safety; it does
  not prove the proposed wall-clock timeout kills every child process.
- **One task and one worker.** One task is exactly the requested scope and is
  sufficient for the stale artifact because `$RD` is task-local. One worker is
  sufficient to refute CLI-name routing. As noted above, a no-error pairwise
  result alone does not prove a raced multi-worker universal quantification.
- **Atomic artifact writes.** Successful and completed-failure transitions
  replace a whole record in one state step. Pre-write failures leave the whole
  prior record. Torn writes are outside this model; admitting them would require
  a separate filesystem crash model.
- **Post-gate immutability.** The primary `post_fix` result sets
  `ALLOW_POST_GATE_MUTATION = false`. This assumption is necessary, explicitly
  visible, and separately challenged by `post_fix_toctou`; it is not silently
  folded into the safety claim.

These abstractions preserve the stale-artifact defect class because none turns
a stale `boundDiff` into the current diff, deletes an old file, or adds a gate
comparison that the relevant real configuration lacks.

## Any new defect the model exposes

### 1. Content binding has a gate-to-merge TOCTOU unless the diff is frozen

`post_fix_toctou` permits the worktree diff to change after the gate recomputes
the hash but before `wt-merge.sh` commits pending worker changes. Apalache
violated `no_unaudited_merge` at state 5:

```text
state  phase             live diff  authorizing diff  merged diff
0      AwaitAudit        0          -1                -1
1      AwaitGate         0          -1                -1
2      AwaitFreshness    0           0                -1
3      AwaitFreshness    1           0                -1
4      ReadyToMerge      1           0                -1
5      Done              1           0                 1
```

This is not the original stale-file bug: the verdict was fresh when
`gate-eval.sh` checked it. The defect is that check and merge are separate
operations, while `wt-merge.sh` itself commits pending worker changes before
the squash. A robust implementation must freeze the worktree after the gate,
merge an immutable tree/patch object whose hash was checked, or recompute and
compare the diff hash inside the final merge transaction immediately before
applying it.

### 2. Merge freshness has the same check-to-use race

The model allows a concurrent fetch to advance local `origin/main` after
`merge-gate.sh check` returns `MERGEABLE`. With max distance 2, Apalache found:

```text
state  phase             origin distance  recorded freshness  merged
5      ReadyToMerge      2                MERGEABLE           no
6      ReadyToMerge      3                MERGEABLE           no
7      Done              3                MERGEABLE           yes
```

The script boundary therefore needs orchestration serialization or a final
assertion that the checked `origin/main` ref has not changed. Remote movement
alone does not update a local remote-tracking ref; the modeled race requires a
concurrent local fetch or ref update.

### 3. CLI/vendor-name routing permits same-family authorization

The merge-reaching `pre_fix / no_same_family_authorized_merge` counterexample
in the cross-vendor section is itself a release-relevant defect: a Codex worker
and agy auditor both resolving to OpenAI reach `Done(merged = true)` at state 4.
The same construction exists for Claude/agy/Anthropic. The
`cross-vendor-audit-routing` change closes it only if both audit-time selection
and gate routing use resolved family identity, as `post_fix` does.

### 4. Verdict-only binding leaves stale checks/docs merge-authorizing

This finding is applicable to the real scripts. `gate-eval.sh:12-14,40-52`
requires `checks-result.json` and `docs-check.json` to exist and reads only
their `status == "pass"` result. It compares neither artifact to the current
attempt or diff. `checks-result.json` does contain a `sha`, but the gate never
reads it. `docs-check.json` contains no content provenance.

The writers do replace artifacts on ordinary completed failures:
`checks-run.sh:40-42` writes `status: fail` after a non-zero check command, and
`docs-check.sh:115-131` writes fail JSON before its normal exit. However, both
have exits before those writes. A missing command/configuration/archive failure
can stop `checks-run.sh` before line 42; argument, setup, or JSON-output failure
can stop `docs-check.sh` before line 131. A pass from round N can therefore
survive a round-N+1 invocation that never reaches replacement. Not running the
stage has the same on-disk effect.

The shipping `post_fix` binds the verdict but intentionally leaves
`CHECKS_BIND_CONTENT_HASH = false`. Apalache violated both
`no_unverified_checks_merge` and `no_unverified_docs_merge` at state 6. The
checks counterexample's compacted ITF states are:

| State | Phase | Live diff | Verdict | Checks | Docs | Gate | Merged |
|---:|---|---:|---|---|---|---|---|
| 0 | `AwaitAudit` | 0 | absent | `pass@0` | `pass@0` | not run | no |
| 1 | `AwaitGate` | 0 | `WARNING@0` | `pass@0` | `pass@0` | not run | no |
| 2 | `AwaitAudit` | 1 | `WARNING@0` | `pass@0` | `pass@0` | not run | no |
| 3 | `AwaitGate` | 1 | `APPROVED@1` | `pass@0` | `pass@0` | not run | no |
| 4 | `AwaitFreshness` | 1 | `APPROVED@1` | `pass@0` | `pass@0` | passed | no |
| 5 | `ReadyToMerge` | 1 | `APPROVED@1` | `pass@0` | `pass@0` | passed | no |
| 6 | `Done` | 1 | `APPROVED@1` | `pass@0` | `pass@0` | passed | **diff 1** |

The verdict repair works in this trace: the authorizing verdict is fresh for
diff 1. The merge is still unverified because both passing auxiliary artifacts
describe diff 0. A pre-write failure transition leaves exactly the same stale
records, so the trace covers “never ran” and “failed before replacement”
without inventing persistence after ordinary completed failures.

`post_fix_full_binding` sets `CHECKS_BIND_CONTENT_HASH = true`. Apalache
generated three verification conditions for
`no_unverified_checks_merge`, `no_unverified_docs_merge`, and
`no_unaudited_merge`; the combined result was **NoError through length 10**.
The release fix should atomically invalidate old artifacts when a new round
starts and bind all three gate inputs to the same immutable diff/attempt
identity. Binding only `audit-verdict.json` is incomplete.

### 5. `WARNING` is merge-authorizing policy, not merely informational

Apalache violated `no_warning_authorized_merge` at state 4:

```text
AwaitAudit → AwaitGate(WARNING) → AwaitFreshness(authorizer=WARNING)
           → ReadyToMerge → Done(merged=true)
```

This confirms the source-level policy hole: `gate-eval.sh` accepts `WARNING`,
and `lib/config.sh:62-64` states that the gate does not consume
`[audit.policy]`. If severity-specific warning policy is intended, it must be
read and enforced before `gateAccept`.

## Method: bounded model checking vs simulation

### Type checking

Command:

```bash
quint typecheck specs/audit_gate.qnt
```

Result: exit 0 with no diagnostics.

### Apalache bounded checking

The requested `quint verify` command was attempted first:

```bash
quint verify specs/audit_gate.qnt \
  --main=pre_fix \
  --invariant=no_same_family_authorized_merge \
  --max-steps=8 \
  --verbosity=3
```

It did **not** check the model. The sandbox denied the wrapper's gRPC loopback
socket before verification:

```text
java.net.SocketException: Operation not permitted (Socket creation failed)
Error while starting Apalache server
java.lang.IllegalStateException: channel not registered to an event loop
```

I did not label that failed invocation as verification. To retain Apalache as
the primary method, I compiled the selected Quint module to flattened Quint IR
and passed that IR directly to the installed Apalache 0.56.1 process, avoiding
only the forbidden gRPC transport:

```bash
quint compile specs/audit_gate.qnt \
  --main=pre_fix \
  --invariant=no_stale_approved_merge \
  --target=json --verbosity=0 \
  > .artifacts/round2/final_pre_approved.qnt.json

/root/.quint/apalache-dist-0.56.1/apalache/bin/apalache-mc \
  --out-dir=.artifacts/round2/apalache-final_pre_approved \
  check --length=8 --init=q::init --next=q::step --inv=q::inv \
  .artifacts/round2/final_pre_approved.qnt.json
```

Real output:

```text
# APALACHE version: 0.56.1
> VCGen produced 1 verification condition(s)
State 6: state invariant 0 violated.
The outcome is: Error
EXITCODE: ERROR (12)
```

The post-fix combined command used the same two-stage form with
`--main=post_fix`, the five comma-separated invariant names, and
`check --length=10`. Its real terminal result was:

```text
> VCGen produced 5 verification condition(s)
The outcome is: NoError
Checker reports no error up to computation length 10
EXITCODE: OK
```

Other exact Apalache bounds were 1 for the initial-state agy counterexample; 8
for the uncapped, capped-error, same-family-merge, stale-checks, and stale-docs
witnesses; 6 for the warning witness; 9 for the merge-freshness race; and 7 for
the post-gate diff race. The no-error routing, dead-transition, and
full-binding checks used length 10. The table above records each outcome.

Apalache bounded model checking symbolically explores every modeled execution
up to the stated computation length and can establish absence of a violation
only within that bound. It does not prove behavior after the bound, fairness,
real subprocess termination, cryptographic properties, filesystem durability,
or correctness of behavior omitted by the abstractions.

### Random simulation supplement

Counterexample search:

```bash
quint run specs/audit_gate.qnt \
  --main=pre_fix \
  --invariant=no_stale_approved_merge \
  --max-steps=10 --max-samples=10000 \
  --backend=rust
```

It found the required six-transition violation and supplied seed
`0xa12e00442bf8c310`. Re-running with that seed reproduced the
`APPROVED@0`, rework, `VendorMismatch`, gate-pass, merge-diff-1 trace.

Post-fix simulation:

```bash
quint run specs/audit_gate.qnt \
  --main=post_fix \
  --invariants no_unaudited_merge \
    no_merge_on_blocked_or_unverified \
    cross_vendor_family_distinct \
    rework_rounds_bounded \
    audit_attempts_at_most_cap \
  --max-steps=20 --max-samples=10000 \
  --backend=rust
```

Real summary:

```text
[ok] No violation found (948ms at 10549 traces/second).
Trace length statistics: max=21, min=21, average=21.00
```

Random simulation samples executions and is useful for witnesses and
reproduction. “No violation found” in simulation is not a proof; the bounded
Apalache result is the stronger evidence.
