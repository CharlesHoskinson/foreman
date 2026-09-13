# ForeDi controller restoration — source-to-model drift review

Branch `fix/foredi-release-completion` at `1229dd3`. Reviewed against
`origin/main` (merge base `c171fe2`).

`formal/check-drift.sh` reports four covered sources that changed with no
`formal/` update:

| Source | Model |
|---|---|
| `skills/foreman/scripts/audit-run.sh` | `audit_gate` |
| `skills/foreman/scripts/lane-supervise.sh` | `lane_lifecycle` |
| `skills/foreman/scripts/lane-run.sh` | `lane_lifecycle` |
| `skills/foreman/scripts/watch.sh` | `lane_lifecycle` |

This record supplies the source review that `check-drift.sh` requires. It
states, for each source, what changed, what the model abstracts, and why the
abstraction is unaffected. It also names one correspondence gap that the
review found and did not repair.

## 1. What the change is

The four sources do not exist in `origin/main`. Commit `e7186bf` restored 12
approved legacy controllers. The four sources above are part of that set. Each
restoration is a pure addition against the merge base: `audit-run.sh` +650/-0,
`lane-run.sh` +1574/-0, `watch.sh` +1352/-0, `lane-supervise.sh` +18/-0.

Each restored file is byte-identical to its body at
`6c1515ecf3d28ccbea6205731e9142aede7a8110`. The blob identity is the evidence,
not the diff:

| Source | Blob at `HEAD` and at `6c1515e` | Mode |
|---|---|---|
| `audit-run.sh` | `82c690cbd2bc02178eeb7b1d1ee0642a4a995dea` | 100755 |
| `lane-run.sh` | `e6c49f00701b5bf4d8f17ddb0a43f2d84b393571` | 100755 |
| `watch.sh` | `6d4ec0afaca9e3b082fa6f2179bcd776f6adea11` | 100755 |
| `lane-supervise.sh` | `1ee0bac08cd6e4ce4d421123a9e4c2b0ce12e391` | 100755 |

Byte identity establishes the restored file contents. It does not prove
equivalence across changed dependencies or runtime environments. This review
compares the reinstated behavior with the existing model boundaries.

## 2. `audit_gate` — `audit-run.sh`

`audit_gate.qnt` abstracts `audit-run.sh` as two things. First, the paths that
exit without replacing `audit-verdict.json`. Second, the vendor name-string
comparison. The type `AuditFailureReason` (`audit_gate.qnt:50-60`) enumerates
`CliMissing`, `CliUnauthenticated`, `VendorMismatch`, `SchemaMissing`,
`NonzeroExit`, `EmptyOutput`, `NoJsonObject`, `OutOfEnum`, and
`WorktreeMutation`. The actions `auditSuccess` and `auditFailure` carry them.
The `uncapped_errors` configuration disables the attempt cap and expects a
violation of `audit_attempts_bounded_by_three`. The `capped_errors` and
`post_fix` configurations impose a cap of three.

The restored body carries each of these facts:

- `audit-run.sh:37` writes `audit-verdict.json`, and `:179-204` atomically
  writes a harness-assigned `UNVERIFIED` verdict. This is the
  `ALWAYS_WRITE_VERDICT` behavior that the `main=post_fix` rows assume.
- `audit-run.sh:63-64` reads `limits.max_audit_attempts` and defaults it to 3.
  Line `:247` compares the `UNVERIFIED` count against it. This supplies finite
  retry control. The model counts attempts abstractly; this review does not
  assert a one-to-one counter mapping.
- `audit-run.sh:56-57` reads `worker.vendor` and `audit.vendor` as name
  strings. Lines `:396-398` and `:473-474` are the refusal paths. This is the
  selected CLI/vendor identity check. These paths do not, by themselves,
  establish observed model-family identity. The model treats CLI names and
  families separately. Its `cross_vendor_family_distinct` row retains a
  historical `schedule`-tier, non-gating outcome. This review does not promote
  that outcome to a claim about current provider-family enforcement.

The restoration preserves the historical body's verdict publication and
attempt-cap behavior. The model retains historical and repaired configurations.
It does not prove current provider-family enforcement or full implementation
refinement. The
gate artifacts the model reads against — `gate-eval.sh`, `checks-run.sh`,
`docs-check.sh`, `wt-merge.sh` — are present at `HEAD` and unchanged by this
branch. No state, action, invariant, or expectation row of `audit_gate` needs a
change.

## 3. `lane_lifecycle` — `lane-run.sh` and `watch.sh`

`lane_lifecycle.qnt` abstracts `lane-run.sh` as the `--round` ownership mode
against the older plain agent wrapper. The `RoundOwner` type
(`lane_lifecycle.qnt:47-50`) is the whole distinction: `DAEMON_ROUND` owns the
round, `AGENT_WRAPPER` does not, `PLAIN_RESUME` is a daemon round that lost
ownership. `daemonComplete` requires `GATE_GREEN` and `reportIsFresh`.
`resumedRoundCompletesSafely` also sets `roundDone`; it compresses a successful
gate and fresh-report path into one model transition.

The restored `lane-run.sh` carries that contract. Lines `:52-53` state that
`--round GATE_CMD REPORT_PATH` makes the script own the whole round: command,
then gate, then attempt-fresh report assertion, then `round_done`. Line `:228`
refuses to run without round ownership while `durable.enabled=true`. Lines
`:1522-1537` define and check report freshness. The model's `reportIsFresh`
(`lane_lifecycle.qnt:189-193`) accepts either a newer mtime or a matching
attempt identifier. These are abstract alternatives, not a proof that every
report format has the same implementation predicate. Line `:1452` is the
`ROUND_MODE` block itself.

`lane_lifecycle.qnt` abstracts `watch.sh` as the v2 classifier and its
thresholds. `WatchState` (`:63-73`) is the ten labels. `rawWatchState`
(`:218-239`) is the first-match-wins cascade. `watchState` (`:243-259`) adds the
loop-mode grace clamp and the `PHASE → STALLED → DEAD` bridge.

The restored `watch.sh` carries that classifier. `wd_classify_v2` is at
`watch.sh:930`. Lines `:22` name the same label set. Lines `:352-381` resolve
`STALL_WARN`, `STALL_DEAD`, `WATCH_TICK`, `STARTING_STALE`, `IMPL_STALE`,
`VERIFY_STALE`, and `WATCH_GRACE`. Lines `:458-477` are the debounce that
starts the debounce; the bridge through `:479-484` completes the observable
`RUNNING → STALLED → DEAD` chain the model reproduces at
`:254-258`.

The model header at `:43-45` states that production thresholds
`10 < 90 < 300 < 600 < 900` map to `1 < 3 < 10 < 20 < 30`, and that boundary
comparisons match `watch.sh` exactly. The restored body defaults
`STALL_WARN=300` and `STALL_DEAD=900` (`watch.sh:61`, `:374`). The ordering the
model relies on is intact.

`lane-queue.sh`, the third `lane_lifecycle` source, is present at `HEAD` and
unchanged by this branch.

For these two sources the restoration retains the bodies at `6c1515e` and the
reviewed ownership and classifier behavior. This source review does not prove
that every concrete transition refines the model.

## 4. `lane_lifecycle` — `lane-supervise.sh`, and the correspondence gap

This source is the one that does not resolve cleanly. It needs care, because
the honest statement is narrow.

### 4.1 What was restored

The restored `lane-supervise.sh` is 18 lines. It is a thin adapter. It
resolves `FOREMAN_HOME`, requires `node`, requires
`skills/foreman/runtime/dist/lane-supervise.js`, and `exec`s the bundle. It
contains no supervision logic. Its own header points at
`packages/orchestration/src/supervisor*.ts` (R5D).

This body is not new. `lane-supervise.sh` has been this 935-byte adapter since
`bf8f9fb` (`foreman(worker): v030-r5d-resume-supervisor-ts-20260805`). The
restoration reinstated the adapter, not a Bash supervisor.

### 4.2 What the model names

`lane_lifecycle.qnt:1` records the coverage as
`lane-supervise.sh (successfulResumePlain ↔ :343-345)`. `coverage.tsv` repeats
it: `auto-resume; successfulResumePlain at :343-345 loses --round`.

The file has 18 lines. There is no line 343. The pointer refers to a Bash
supervisor body that predates R5D and is not the body that `e7186bf` restored.

This staleness is not caused by the restoration. It was already true at
`6c1515e` and at every commit back to `bf8f9fb`. The restoration makes it
visible, because the drift gate now forces the question.

### 4.3 The distinction the model does not abstract

`lane_lifecycle` models two supervisor resume transitions.
`successfulResumeCore` (`:603-634`) re-enqueues while keeping `DAEMON_ROUND`
ownership. `successfulResumePlain` (`:661-691`) re-enqueues with
`resumeWillBePlain = true`, so the next dispatch sets `owner = PLAIN_RESUME`
(`:342-349`). Both set `lifecycle = DISPATCHED`, `queued = true`, and
`resumeSucceeded = true`. Both are positive resume: the supervisor restores a
checkpoint and admits the lane to the queue again.

The current M6 TypeScript supervisor does not perform either transition for a
legacy lane. `packages/orchestration/src/supervisor.ts:427` returns
`LegacyControllerRequired` with the diagnostic from `activeLegacyRun(runId)`.
`packages/orchestration/src/resume-queue-execution.ts:8-18` fixes that code as
`ActiveLegacyRun` with `exitCode: 3` and `originalController: 'unavailable'`.

The refusal point matters. It is reached after `decideRoundResume` returns
`Resume` (`supervisor.ts:387-404`). It follows the `Missing` ownership refusal
(`:406-414`) and the dry-run branch. It precedes checkpoint restore, worktree
reservation, and queue admission. The supervisor decides that a resume is
warranted and then refuses to carry it out.

So the M6 supervisor's legacy path terminates where the model continues. The
model has no action for it. There is no `Refused` or `LegacyControllerRequired`
successor state in `LaneState`, and `Lifecycle` (`:52-60`) has no member for a
lane that the supervisor declines to resume. `emitTerminalAbandoned`
(`:649-656`) is not the same thing: it fires on an exhausted resume budget, not
on a refusal to dispatch at all.

### 4.4 The conclusion, stated exactly

`lane_lifecycle` does **not** abstract the distinction between positive legacy
resume and M6 `ActiveLegacyRun` refusal. The model represents the first. The
current supervisor implements the second.

Therefore:

- `successfulResumeCore` and `successfulResumePlain` **do not establish
  correspondence** to the M6 supervisor at `HEAD`. They correspond to the
  historical and proposed positive-resume behavior represented by those rows.
- The rows that cite them —
  `init=init_postfix,step=step_shipped_resume_bug /
  witness_shipped_resume_loses_round_ownership = REACHABLE` and
  `init=init_postfix,step=step_postfix /
  witness_shipped_resume_loses_round_ownership = NOT_REACHABLE` — retain their
  recorded bounded model outcomes. They are not current statements about the
  M6 supervisor.
- The restoration did not create this gap and does not widen it. The restored
  18-line adapter forwards to the same TypeScript supervisor that was in force
  before the restoration.

This is retained debt. It is not a claim of equivalence, and it must not be
read as one. Two named obligations remain open and own it: automatic positive
legacy resume, and `lane-runtime-typescript` parity. A future correspondence
claim needs an explicit model of the admitted supervisor paths, including
refusal, with matching expectation rows. That work is a model change with its
own evidence. This restoration does not complete it.

The direct `lane-run.sh` contract is unchanged by all of this. A caller that
invokes `lane-run.sh --round` directly gets the historical round-ownership
behavior that Section 3 describes. The gap is confined to the supervisor's
automatic resume path.

## 5. Evidence

### 5.1 Hosted CI, commit tier, at `1229dd3`

Required [run 34775448059](https://github.com/CharlesHoskinson/foreman/actions/runs/34775448059).
Artifact `gates-linux-reports-34775448059` contains the report at
`foreman/foreman/formal/out/report.json`:

```text
quint 0.32.0   apalache 0.56.1   tier=commit
rows_run=19   rows_matched=19   failures=0
```

All nine gating `audit_gate` commit rows matched. All six gating
`lane_lifecycle` commit rows matched, including both
`witness_shipped_resume_loses_round_ownership` rows.

### 5.2 Local reruns in this worktree

`formal/run-checks.sh --typecheck-only` passed. All five specs typecheck.
Seven classifier positive controls passed, including the control that proves a
bare `grep violation` is wrong on the success string.

Targeted `lane_lifecycle` commit rows, run one at a time:

| Row | Configuration | Expected | Observed |
|---|---|---|---|
| 25 | `init_prefix / step_prefix / inv_round_done_requires_fresh_report` | VIOLATED | VIOLATED |
| 26 | `init_prefix / step_prefix / inv_no_completion_from_exit_code` | VIOLATED | VIOLATED |
| 27 | `init_postfix / step_postfix_without_resume / inv_round_done_requires_fresh_report` | HOLDS | HOLDS |
| 28 | `init_postfix / step_shipped_resume_bug / witness_shipped_resume_loses_round_ownership` | REACHABLE | VIOLATED (= reachable) |
| 29 | `init_postfix / step_postfix / witness_shipped_resume_loses_round_ownership` | NOT_REACHABLE | HOLDS (= not reached) |
| 30 | `init_prefix / step_prefix_bug / inv_round_done_requires_fresh_report` | VIOLATED | VIOLATED |

Every row matched.

### 5.3 What this evidence does and does not establish

The runs are bounded simulations. A `HOLDS` row means no counterexample was
found within the recorded bound. It is not a proof. A witness row that fires
proves reachability; a witness row that does not fire proves nothing beyond the
samples executed. Nothing here establishes fairness, torn writes, real
subprocess kill, or hash collisions. `eventually_terminal` remains a
no-fairness stuttering artifact and must not be cited as a liveness defect.

These simulations are sampled evidence about the models. They are not
refinement proofs between a model and an implementation, and they are not K
proofs. In particular, Section 5 does not establish that the M6 supervisor
refines `lane_lifecycle`. Section 4.4 records the missing correspondence for
the legacy resume path.

## 6. Other coverage-map observations

The `audit-run.sh` coverage note describes historical failure paths that leave
the verdict file unchanged. The restored body publishes harness-assigned
`UNVERIFIED`. The model retains both configurations; the coverage note is not
an exact description of every current path.

Two `eventlog_concurrency` sources named in `coverage.tsv` are absent from the
tree at `HEAD`: `skills/foreman/scripts/eventlog.sh` and
`skills/foreman/scripts/nats-bridge.sh`. Neither is changed by this branch, so
neither is a drift finding here. Both are the same class of staleness as the
`lane-supervise.sh:343-345` pointer in Section 4.2: the coverage map names
locations that no longer exist. Recorded, not repaired. Repairing a coverage
pointer changes what the drift gate watches, and that needs its own change and
its own evidence.

## 7. Decision

The exact restoration of the four covered sources does not change any
abstraction in `audit_gate.qnt` or `lane_lifecycle.qnt`.

Unchanged and deliberately so: every model, every state variable, every action,
every invariant, every witness, every expectation row, every recorded bound,
every baseline, and every restored source byte.

One unresolved gap blocks a supervisor-refinement claim: `lane_lifecycle`
does not establish correspondence between its positive resume actions
(`successfulResumeCore`, `successfulResumePlain`) and the M6 supervisor's
`ActiveLegacyRun` exit 3 refusal. That gap is retained debt against the open
automatic-legacy-resume and `lane-runtime-typescript` parity obligations. It is
not resolved by this restoration and is not asserted to be equivalent to it.

This record closes the source-to-model drift review for `e7186bf`.
