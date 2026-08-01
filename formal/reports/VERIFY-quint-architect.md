# Architect verification of the Quint models — 2026-07-28

Three GPT-5.6 Sol lanes produced formal models of Foreman's orchestration. Each
was given the same validation criterion: **a model that finds nothing is
worthless — it must independently reproduce a defect we already observed in the
field.** This document records the architect re-running every check rather than
accepting the lanes' reports.

All three specs typecheck clean under Quint 0.32.0.

## Method note — a false alarm I generated and corrected

The first pass used `grep -q "violation"` as the pass/fail predicate. Quint
prints `[ok] No violation found` on success, which contains that substring, so
**every run reported as violated**, including the control arms. That briefly
looked like the `flock` fix failing — the fix I had already specified in
`lock-primitive-hardening`.

The correct predicate anchors on the line prefix: `^\[violation\]` versus
`^\[ok\]`. Recorded because it is the same class of defect this release is
built to prevent — a checker that cannot distinguish success from failure is
worse than no checker, and it nearly produced a confident wrong report.

## M2 — event log, locking, concurrency: FULLY VALIDATED

The strongest result. This model had empirical ground truth to hit: the
measured uutils `mkdir` TOCTOU (57 mutual-exclusion violations across 15 rounds
of 8 racers; GNU 0; `flock` 0 on ext4/tmpfs/drvfs).

| module | invariant | result |
|---|---|---|
| `toctou` | `mutual_exclusion` | **VIOLATED** |
| `toctou` | `seq_uniqueness` | **VIOLATED** |
| `atomic` | `mutual_exclusion` | holds |
| `atomic` | `seq_uniqueness` | holds |

20,000 samples, 40 steps each. The counterexample state is exactly the observed
failure: `seqHolders: Set(0, 1)` — two processes inside the sequence-lock
critical section simultaneously, with `phase: Map(0 -> InCompact, 1 -> InSeq)`.
Found in 68 ms at 647 traces/second.

This is independent corroboration. The model was written from the code and the
finding description, and it reproduces both the violation and the fix. It also
derives the *consequence* we did not measure directly: duplicate sequence
numbers in the event log, which is the failure mode that would corrupt crash
recovery and replay.

## M3 — audit → verdict → gate: FULLY VALIDATED

Target: the stale-verdict hole — `audit-run.sh` dies on five paths without
writing `audit-verdict.json`, `$RD` is stable across rounds, nothing deletes
the stale file, and `gate-eval.sh:43-47` reads it with no freshness check.

| module | invariant | result |
|---|---|---|
| `pre_fix` | `no_stale_approved_merge` | **VIOLATED** |
| `pre_fix` | `no_unaudited_merge` | **VIOLATED** |
| `post_fix` | `no_stale_approved_merge` | holds |
| `post_fix` | `no_unaudited_merge` | holds |

The content-hash binding specified in `three-outcome-verdicts` restores both
invariants. Confirmed.

**Additional result, and it settles an open question:** `rework_rounds_bounded`
**holds** in both `uncapped_errors` and `capped_errors`. The concern that
UNVERIFIED not consuming a rework round admits non-termination — an auditor
that always errors looping forever — does not materialise in this model. That
was a genuine open question in the package design; it now has an answer.

## M1 — lane lifecycle: PARTIALLY VALIDATED, stated honestly

| invariant | result |
|---|---|
| `inv_round_done_requires_fresh_report` | holds |
| `inv_no_completion_from_exit_code` | holds |
| `inv_no_silent_limbo` | holds |
| `inv_redispatched_resume_starts_new_round` | holds |
| `witness_agent_abandoned` (reachability) | **fires — state is reachable** |
| `witness_round_done` (reachability) | fires |
| `witness_h4_disabled_prefix_attractor` | **did not fire in the default module** |

Unlike M2 and M3, this model ships a single module rather than a
pre-fix/post-fix pair, so the safety invariants hold by construction — they
describe the *fixed* system. The abandoned-worker state is shown reachable via
the witness idiom, which does demonstrate the attractor's shape, but the
specifically named pre-fix attractor witness did not fire under the default
configuration and presumably needs a parameter this run did not set.

The report also discloses that **Apalache could not run in the lane's sandbox**
(`java.net.SocketException: Operation not permitted`), so M1's evidence is
random simulation, not bounded model checking.

**Assessment: M1 has not met the validation criterion as stated.** It models
the fixed system well and its witnesses are informative, but it does not
demonstrate the pre-fix background-and-stop attractor violating a safety
invariant the way M2 and M3 demonstrate theirs. That is a gap to close, not a
result to accept — and it should be closed by adding a pre-fix module, matching
its siblings.

## What this changes

- `lock-primitive-hardening`: the `flock` remedy now has formal corroboration
  in addition to the measurement. The specified fix is sound in the model.
- `three-outcome-verdicts`: the content-hash evidence binding is formally
  confirmed to close the stale-verdict hole, and the UNVERIFIED
  non-termination worry is answered negatively.
- `round-ownership-default`: still rests on the empirical record alone; M1 owes
  a pre-fix module before it can claim formal support.

## Limits of this verification

Random simulation with 20,000 samples at 40 steps is not exhaustive proof. No
Apalache/TLC bounded model checking ran in any lane. These results establish
that the violations are *reachable* and that the fixes hold *across the sampled
space* — not that the fixed systems are correct for all executions.

---

## ADDENDUM — M1 re-verified against its final artifact (correction)

## Correcting my own assessment above

The M1 section above says the model "has not met the validation criterion."
**That was wrong, and it was my error twice over:**

1. I checked the file while the lane was still iterating (24,885 bytes; final
   is 25,911 with `init_prefix`/`step_prefix` and `init_postfix`/`step_postfix`
   entrypoints that did not exist when I looked).
2. I ran `--main=lane_lifecycle` with the *default* `init`/`step`, which is
   aliased to the post-fix configuration. Invariants describing a fixed system
   naturally hold. I concluded the model couldn't show the bug when in fact I
   had never asked it to.

Re-run against the final artifact with the explicit entrypoints:

| config | invariant | result |
|---|---|---|
| `init_prefix` / `step_prefix` | `inv_round_done_requires_fresh_report` | **VIOLATED** |
| `init_prefix` / `step_prefix` | `inv_no_completion_from_exit_code` | **VIOLATED** |
| `init_postfix` / `step_postfix_without_resume` | `inv_round_done_requires_fresh_report` | holds |

**M1 fully meets the criterion.** The background-and-stop attractor is
reproduced, and the shipped fix closes it. All three models are now validated.

Apalache is present and functional (`~/.quint/apalache-dist-0.56.1`, invoked by
`quint verify`, ~30 s per run) — the earlier note that no bounded model
checking ran anywhere is also withdrawn.

## M1's new defect: CONFIRMED formally AND in the shipped code

M1 reports a defect nobody was looking for: **the structural fix for failure
class #1 holds only until the first auto-resume.**

Formal confirmation, via Apalache to depth 12:

| config | predicate | result |
|---|---|---|
| `init_postfix` / `step_postfix` | `witness_shipped_resume_loses_round_ownership` | not reachable |
| `init_postfix` / `step_shipped_resume_bug` | same witness | **REACHABLE (exit 1)** |

The difference is one action, `successfulResumePlain`, modelling
`lane-supervise.sh`'s re-dispatch. So the finding is only as good as that
action's fidelity to the code — which is checkable, so I checked it.

`skills/foreman/scripts/lane-supervise.sh:343-345` logs, in the shipped code:

> `prior rounds used --round mode, but GATE_CMD/REPORT_PATH are never recorded
> in any event payload in the currently shipped schema -- re-dispatching PLAIN
> mode (not --round); the resumed round loses gate-phase automation until
> re-dispatched manually with --round`

and then calls `ls_reenqueue` with a bare `cmd`. The header notes at `:79-83`
confirm no event payload records `--round GATE_CMD REPORT_PATH` mode.

**The model is faithful and the defect is real.** The code is honest about the
mechanism — it warns — but nothing connects that warning to its consequence:
a recovered lane silently returns to the exact ownership mode whose absence
produced 11+ field occurrences of the background-and-stop attractor. The
auto-resume supervisor, whose purpose is recovery, reopens the failure it is
recovering from.

## Consequence for the release

`round-ownership-default` is incomplete as written. It turns on the durable
round loop to close failure class #1, but the loop is abandoned at the first
auto-resume. The fix is bounded and follows from the diagnosis: **record
`GATE_CMD` and `REPORT_PATH` in the `prompt` event payload** so a resumed round
can be re-dispatched in `--round` mode. The event schema is additive and
`el_emit` treats `type` opaquely, so this needs no library change — it is the
same additive-payload move `decision-lineage-and-telemetry` already makes.

That package should also carry a requirement that the supervisor **refuses to
re-dispatch in plain mode when the prior round used `--round`**, rather than
warning and proceeding — warn-and-proceed is what let this survive.

## Standing limits

The M2/M3 results above remain random-simulation evidence at 20,000 samples.
M1's results are Apalache-bounded to depth 12, which establishes reachability
and absence-within-12-steps, not unbounded correctness. M1's own report also
flags that its `eventually_terminal` temporal property "fails" only as a
no-fairness stuttering artifact and should not be cited as a liveness bug.

---

## ADDENDUM 2 — M3 final results, and a correction to my own termination claim

## Correction: UNVERIFIED non-termination is REAL. I reported the opposite

Earlier in this document I wrote that M3 "settles an open design question:
`rework_rounds_bounded` holds in both `uncapped_errors` and `capped_errors`, so
the concern that UNVERIFIED not consuming a rework round admits non-termination
does not materialise."

**That was wrong, and the error was mine: I tested the wrong property.**

`rework_rounds_bounded` constrains `round`. In the non-termination scenario
`round` never advances at all — an auditor that always errors keeps the lane on
round 0 forever while `auditAttempts` grows without bound. So the invariant I
chose is *trivially* true in exactly the failure it was supposed to detect. It
is a vacuous pass.

The property that actually tests it:

| config | invariant | result |
|---|---|---|
| `uncapped_errors` | `audit_attempts_bounded_by_three` | **VIOLATED** |
| `capped_errors` | `audit_attempts_bounded_by_three` | holds |

**The non-termination concern is confirmed, not refuted.** `max_rework_rounds`
cannot terminate an infra-failure loop, because such a loop never consumes a
rework round. `three-outcome-verdicts` needs a **separate bound** —
`max_audit_attempts` or `max_consecutive_unverified` — and must not reuse
`limits.max_rework_rounds`. With a cap of 3, the model reaches `Abandoned`
within 2×cap transitions.

This is the second time today a checker of mine returned a confident wrong
answer: first `grep "violation"` matching `[ok] No violation found`, now a
vacuously-true invariant. Both are the failure mode this release exists to
prevent, and both were caught only by cross-checking against another lane's
result rather than by the check itself.

## M3's new defect in a fix I already specified — CONFIRMED formally and in code

`three-outcome-verdicts` binds the **audit verdict** to the diff content hash.
That is necessary and insufficient. `gate-eval.sh` gates on two further
artifacts in the same stable `$RD`, and binds neither.

| config | invariant | result |
|---|---|---|
| `post_fix` | `no_unverified_checks_merge` | **VIOLATED** |
| `post_fix` | `no_unverified_docs_merge` | **VIOLATED** |
| `post_fix_full_binding` | `no_unverified_checks_merge` | holds |

Confirmed in the shipped source, and the detail is damning:

- `checks-run.sh:41-42` writes `{sha: $sha, command: …, exit_code: …, status: …}`
  — **the freshness data is already there.**
- `gate-eval.sh:40` reads `jq -r .status` and nothing else. `:49-52` does the
  same for `docs-check.json`.

So a round-N `pass` authorises a round-N+1 diff even with the verdict repair
working perfectly. The gate has the `sha` in hand and ignores it.

**`three-outcome-verdicts` must be widened**: bind all three gate inputs —
verdict, checks result, docs result — to the diff content hash, not the verdict
alone. For `checks-result.json` this is a one-line read of a field that already
exists.

## M3's other new defects (reported, not independently re-verified by me)

- **Gate→merge TOCTOU survives the fix.** `post_fix_toctou / no_unaudited_merge`
  violated: `wt-merge.sh` commits pending worker changes *after* the gate hashed
  the diff. Needs a frozen tree or a re-check inside the merge transaction.
- **Merge-freshness has the same check-to-use race.**
- **`WARNING` silently authorises merge**, confirming `[audit.policy]` is prose
  the gate never reads — which matches R5's independent static finding.
- **Cross-vendor gateway violation reaches a merge.** A `CodexCli`/OpenAI worker
  audited by an `AgyCli`/OpenAI auditor passes the CLI-name check.
  `gate-eval.sh` has *no* vendor logic at all; the only check is
  `audit-run.sh:31-33` comparing config **name strings**. M3 caught its own
  round-1 fidelity bug here — its model had hard-coded a family check the real
  gate lacks — and corrected it.

## Method note from M3, worth keeping

M3 verified with Apalache 0.56.1 at depths 1–10 plus 10k-sample simulation, and
states plainly that `NoError@N` is a bounded result, not a theorem: it
establishes nothing beyond depth N, and nothing about fairness, real subprocess
kill, torn writes, or hash collisions. It also hit a gRPC sandbox block on
`quint verify` inside codex and worked around it via `quint compile` plus direct
`apalache-mc`.

---

## ADDENDUM 3 — M2 final results: a race that survives the lock fix

M2 completed with three new races. The second is the important one, because it
**defeats the fix specified in `lock-primitive-hardening`.**

## The fail-open race — verified in shipped code

`wt-new.sh:203`:

> `log "WARN: index.json lock contention exceeded 30s -- proceeding unsynchronized"`

After a bounded spin the code **deliberately enters the index critical section
without the lock**. Apalache confirms the consequence at 8 steps: mutual
exclusion is violated **even with an atomic `mkdir`**. `lock-primitive-hardening`
replaces the *primitive*; it does not touch this *policy*, so the fix does not
reach this call site.

The per-PID tmp name makes it worse in a specific way: it converts what would be
a torn write into a **silent lost update** — a lane disappears from
`index.json` with no error anywhere.

**Consequence:** `lock-primitive-hardening` must add a requirement that no lock
acquisition may fail open. A bounded spin that gives up must **refuse**, not
proceed. Its current scope (swap the primitive, probe the host) leaves the
worst-behaved call site untouched.

## The compaction race

`el_compact` can overwrite `events.jsonl` with a snapshot taken before a
concurrent `el_emit` append — the documented **source of truth** silently loses
a committed event. M2 notes a unique compaction tmp name does *not* fix this,
which rules out the obvious patch.

## The NATS token inversion

Under check-then-act both racers "acquire" and both write `$lock/owner`, so the
loser's token lands on disk: the true holder can no longer release, and the
non-holder can. Compounding it, `el_init` reclaims `.seq.lock` (`eventlog.sh:52`)
and `.attempt.lock` (`:57`) but **not** `.nats-bridge.lock` — verified. So a
crash leaves that lock wedged with no reclamation path.

## Lock-ordering verdict: today's code is clean

`el_emit` takes only `.seq.lock`; `el_attempt_new` only `.attempt.lock`;
`el_compact` reuses `.seq.lock` and calls only read-only `el_read` inside it;
`lane-run.sh` calls them sequentially, never nested. A deliberately-nesting
configuration deadlocks (Apalache, 5 steps). The discipline to preserve:
no nesting; if both are ever required, `.seq.lock` first, `.attempt.lock`
second, release in reverse.

## Method — and a third vacuous check in one day

M2 ran Apalache 0.56.1 on the host (its sandboxed agent could not) and
symbolically confirmed **six counterexamples**: toctou mutex (8 steps/27.7 s),
nested deadlock (5/54 s), fail-open mutex (8/7.7 s), lost index entry (12/62 s),
NATS token soundness (10/10.7 s), NATS deadlock (8/21.4 s). `atomic` /
`mutual_exclusion` showed no violation within 8 steps (385.8 s) — bounded
satisfaction, not proof. It replayed five claimed seeds and all reproduced.

M2 also self-reported that its **first Apalache run returned a vacuous "safe"**
because it passed `--step=event_step` when those actions live in `index_step`.

That is the third vacuous-check incident today, across three different actors:

1. Architect: `grep "violation"` matched `[ok] No violation found`.
2. Architect: tested `rework_rounds_bounded` for a loop in which `round` never
   advances — trivially true in exactly the failure it was meant to detect.
3. M2: verified the wrong module's step function.

None was caught by the check itself; each was caught by cross-checking against
another result. That is direct evidence for the release's own
`test-infrastructure-hardening` thesis — **a checker that cannot distinguish
success from failure is worse than no checker** — and for its
regression-injection requirement, which is the only mechanism here that would
catch a vacuous pass automatically.

**Operational note also worth carrying:** M2 reports that
`pkill -f "quint verify"` matched its own command line and killed its shell,
and would also have killed Lane 1, which was verifying against the same shared
Apalache server on port 8822. Lanes must not `pkill` by pattern.
