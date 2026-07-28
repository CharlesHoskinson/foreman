# Design — three-outcome-verdicts

## The asymmetry that makes this work: four values in the artifact, three in the schema

`UNVERIFIED` is assigned by the harness that observes the audit process. It is
never offered to the model.

This is the central design decision and a reviewer will want to change it, so
the reasoning is here rather than in a comment. Two independent arguments:

1. **The failures that matter are silent.** A process killed by a rate limit, a
   truncated stdout, an expired token, a CLI that exits 0 having written
   nothing (`bugeventlog.md`, 2026-07-19, grok `--prompt-file`) — in every one
   of these the model emits nothing at all. A verdict value the model must
   choose cannot cover the cases where the model does not get to choose.
2. **A self-declared "I could not verify" is an escape hatch on hard diffs.**
   The one class of diff where an auditor is most valuable is the one where it
   is most tempted to abstain. N1 §8.1's framing applies: the auditor's output
   is a claim, and a claim of non-verification made by the claimant is not
   evidence of anything.

So `adapters/verdict.schema.json` keeps `APPROVED | WARNING | BLOCKED`, and
`audit-verdict.json` — the harness-written artifact the gate consumes — carries
`APPROVED | WARNING | BLOCKED | UNVERIFIED`. State this asymmetry in both files,
or the next reader will "fix" the mismatch.

## Every audit writes a verdict, including the ones that fail

Today `audit-run.sh` communicates failure only by dying, and the gate reads a
directory that may still hold the last successful answer. The inversion:

- **Exit status is for the caller.** Non-zero still means the audit did not
  complete, and callers that check it keep working.
- **The artifact is for the gate.** `audit-verdict.json` is written on every
  path, including the failure paths, before the non-zero exit.

Write it atomically (tmp + rename), the same discipline `el_emit` uses for
`.seq` (`lib/eventlog.sh`): a crash mid-write must leave the previous verdict
intact rather than a half-parsed one, and the evidence binding below will
correctly reject the stale intact file.

## Evidence binding, and why on content rather than on sha

The stale-verdict hazard is not fixed by remembering to delete a file. It is
fixed by making the verdict *say what it is about* and having the gate check.

`audit-verdict.json` carries `evidence: {diff_sha256, base_sha, head_sha,
attempt}`. `gate-eval.sh` recomputes the diff it is gating and compares
`diff_sha256`. A mismatch is a distinct gate reason — "audit verdict does not
match the diff under evaluation" — not a generic schema failure.

**Bind on the diff's content hash, not on `head_sha`.** A rebase onto a moved
base, an amended commit message, or a re-checkpoint produces a new sha with a
byte-identical diff. Binding on sha would invalidate a perfectly good 27-minute
audit for a no-op, and the predictable response to that is operators deleting
the check. Binding on content invalidates exactly when the reviewed bytes
changed.

`base_sha`, `head_sha` and `attempt` are recorded for the lineage record and for
diagnosis; only `diff_sha256` is the gate predicate.

## What the gate does with UNVERIFIED

Fails closed, with its own reason string, and does not charge a rework round.

Three properties, each deliberate:

- **Closed, because an unverified diff is an unreviewed diff.** The expensive
  direction of error for a merge gate is the false pass (N1 §8.1 cites the
  measured false-positive rate of LLM verifiers as the reason the gate must be
  deterministic checks, not the auditor's word).
- **Distinct, because conflating it with `BLOCKED` destroys the record.** It
  would make R6's M9 (verdict distribution) and M5 (unique-catch rate of the
  cross-vendor auditor) uncomputable, and it is precisely the "an errored lane
  is not a dissenting lane" error R2's P2 names.
- **Not charged as a rework round, because the worker did nothing.**
  `limits.max_rework_rounds` is a budget on the implementer's attempts.
  Spending it on an expired auth token misattributes an infrastructure failure
  to an implementer, and — since the budget is finite — eventually abandons a
  perfectly good change because the auditor's CLI was broken.

The action itself is policy: `[audit.policy]` gains `unverified`, defaulting to
`"retry"`, alongside the existing `blocked = "never"`.

## Alternatives considered and REJECTED

**Map auditor failure onto `BLOCKED`.** The obvious fail-closed option, and it
is what a careful engineer would reach for. Rejected because fail-closed is a
property of the *gate action*, which is preserved either way, while the
*recorded verdict* would become a lie. Three consequences: the verdict
distribution stops measuring auditor behaviour and starts measuring
infrastructure reliability; a worker is charged a rework round for someone
else's outage; and an operator reading the record sees a rejection where there
was silence. The whole point of the third outcome is that these are different
events.

**Map auditor failure onto `WARNING`.** Rejected, and strictly worse: under the
documented policy a `WARNING` with resolved findings is mergeable at architect
discretion. An errored audit would become a merge path.

**Let the auditor emit `UNVERIFIED` itself.** Rejected — see the asymmetry
section above. Kept here as an explicit rejection because it is the reading of
R2's P2 that a fast reader will arrive at, and it inverts the mechanism.

**Delete `audit-verdict.json` at the start of every audit.** Rejected as the
primary mechanism. It fixes the stale-file symptom and leaves the gate unable to
tell *which* diff any verdict is about, so a fresh verdict against the wrong
worktree still passes. It also converts a crash between delete and write from
"stale input" into "missing input" — a different wrong answer, not a right one.
Evidence binding is the mechanism. Deletion is permitted as redundant safety and
is not sufficient alone.

**Retry the audit automatically inside `audit-run.sh` on `UNVERIFIED`.**
Rejected for this release. Bounded retry belongs to the policy layer that
already owns `max_rework_rounds`, and the audit is the serial critical path at
24-27 minutes; a silent inner retry doubles the worst case on the exact stage
that is already the bottleneck, and it hides the failure rate that
`decision-lineage-and-telemetry` exists to measure. Make the failure visible
first; automate the response once its frequency is known.

**Have `gate-eval.sh` compute the audit itself, or re-derive the verdict.**
Rejected: it would put a model call inside the deterministic gate. R1's rule
applies — *"the same reason you don't let students write the exam"* — the gate's
job is to check artifacts, not to produce them.

## Findings get ids without changing the model-facing schema

`verdict.schema.json` sets `additionalProperties: false` on findings, so adding
an `id` field would be a model-facing schema change and another thing the
auditor can get wrong.

Instead the harness derives a stable id at normalisation time from the finding's
own content — file, line, severity, and a normalised summary — so the same
finding reported by two lanes, or by the same lane across a re-audit, resolves to
the same id. Consolidation then merges by id and picks a representative, per
R2's P5: *"Return decisions about findings BY INDEX — never re-emit finding
text."* The synthesizer chooses; it never rewrites evidence.

The known failure mode is worth stating: a content-derived id changes when the
auditor rewords its own summary between rounds, splitting one finding into two.
The normalisation must therefore be conservative (case, whitespace, punctuation)
and the id must be recorded alongside the raw text so a human can see the split.
This is the over-merge / under-merge tension R2's P13 names, and neither
direction may abort a run.

## Latency: what is in scope, and what is emphatically not

**In scope:** a wall-clock bound on the audit call, and a recorded duration.
Both are prerequisites for the third outcome — a hang is an unverified audit
that never admits it — and both are two lines of change.

**Out of scope, owned by v0.4.0:** effort tiering, sharded parallel audit and
its consolidation, pre-packaged audit bundles, hunk-hash-scoped re-audits,
session and thread reuse. This package must not implement, prototype, or
partially specify any of them. The 24-27 minute figure is a real problem and
half-solving it here would leave v0.4.0 building on a partial mechanism.

The one thing this package owes v0.4.0 is a number: today the 24-27 minute
figure comes from two hand-timed observations in `bugeventlog.md`. Recording
`duration_s` on every audit turns that into a distribution before anyone
optimises against it.

## Risks

- **`gate-eval.sh` gains a dependency.** It sources `lib/config.sh` for the
  first time. The deterministic gate must not acquire a new failure mode: every
  policy read takes the `audit-run.sh:27-29` pattern — `toml_get` with a
  hard-coded fallback — so a missing or malformed config degrades to the
  built-in defaults rather than failing the gate.
- **Evidence binding can over-fire.** Mitigated by hashing content rather than
  shas. If it still over-fires in practice, the finding is that the diff
  computation is unstable — which is itself worth knowing — and must be logged,
  not worked around by loosening the predicate.
- **Four values where consumers expect three.** Any consumer that switches on
  the verdict needs the new arm. The known consumers are `gate-eval.sh:43-47`
  and the doctrine in `SKILL.md:244-251`; both are in scope here. A grep for the
  literal verdict strings is a required task, not an assumption.
- **A timeout default that is too tight turns healthy audits into
  `UNVERIFIED`.** Defaulting from `limits.round_timeout_min` (30) sits above the
  observed 27-minute worst case with almost no margin. The default MUST be set
  from the measured distribution once `duration_s` exists, and until then it
  must be generous. An over-tight bound would manufacture the very failures this
  package exists to represent.

## Formal verification, 2026-07-28: two defects in the fix as specified

`formal/specs/audit_gate.qnt` models this package's own remedy. Verified with
Apalache 0.56.1 via `quint verify`; see
`formal/reports/M3-audit-gate.md` and `formal/reports/VERIFY-quint-architect.md`.
Both findings below were re-checked against the shipped source before being
written down.

### The verdict binding closes only one of three holes

| module | invariant | depth | result |
|---|---|---|---|
| `pre_fix` | `no_stale_approved_merge` | 8 | VIOLATED |
| `post_fix` | `no_stale_approved_merge` | 8 | holds |
| `post_fix` | `no_unverified_checks_merge` | 8 | **VIOLATED**, state 6 |
| `post_fix` | `no_unverified_docs_merge` | 8 | **VIOLATED**, state 6 |
| `post_fix_full_binding` | both of the above, plus `no_unaudited_merge` | 10 | NoError |

`post_fix` is this package's remedy exactly as originally written: the verdict
bound to the diff content hash, checks and docs untouched. It still merges a
round-N+1 diff on a round-N `pass`, because `checks-result.json` and
`docs-check.json` sit in the same stable `$RD` and neither is bound to
anything.

The detail that makes this cheap to fix and embarrassing to have missed:
`checks-run.sh:41-42` **already writes** `{sha: $sha, command: ..., exit_code:
..., status: ...}`. `gate-eval.sh:40` reads `jq -r .status` and discards the
rest; `:49-52` does the same for the docs artifact. The freshness data is in
hand and thrown away.

Hence the widened requirement: bind all three inputs, on content hash, each
with its own mismatch reason.

### UNVERIFIED admits non-termination, and the first check said otherwise

The architect's first pass reported this concern refuted, on the strength of
`rework_rounds_bounded` holding under `uncapped_errors`. That was a **vacuous
pass**, and the correction is worth keeping in the design record because the
same trap will recur:

| module | invariant | depth | result |
|---|---|---|---|
| `uncapped_errors` | `rework_rounds_bounded` | 8 | holds -- **vacuously** |
| `uncapped_errors` | `audit_attempts_bounded_by_three` | 8 | **VIOLATED**, state 7 |
| `capped_errors` | `audit_attempts_bounded_by_three` | 8 | holds |
| `capped_errors` | `task_not_abandoned` | 8 | VIOLATED at state 6 -- reaches `Abandoned` |

`rework_rounds_bounded` constrains `round`. In the failure it was meant to
detect, `round` never advances at all: `UNVERIFIED` deliberately consumes no
rework round, so an auditor that always errors keeps the lane on round 0 while
`auditAttempts` grows without bound. The invariant is trivially true in exactly
the execution it was chosen to rule out.

The design consequence is structural, not a tuning question. `UNVERIFIED` not
charging a rework round is correct -- the worker did nothing -- but it means
`limits.max_rework_rounds` **cannot** terminate an infra-failure loop, because
that loop never spends the budget. A second, independent bound is required, and
reusing `max_rework_rounds` for it would reintroduce the misattribution this
package exists to remove. With a cap of 3 the model reaches `Abandoned` within
`2 * cap` transitions.

### Three further confirmed defects, recorded here for the reader

- **Gate-to-merge TOCTOU survives the fix.** `post_fix_toctou /
  no_unaudited_merge` VIOLATED at depth 7, state 5: `wt-merge.sh` commits
  pending worker changes *after* the gate hashed the diff. A content hash
  computed at gate time is not a statement about the tree at merge time. The
  remedy is a re-check inside the merge transaction, or a frozen tree -- one or
  the other, not a partial of both.
- **Merge freshness has the same check-to-use race**, for the same reason, and
  is fixed by the same move: evaluate it inside the transaction it guards.
- **`WARNING` silently authorises merge.** `post_fix /
  no_warning_authorized_merge` VIOLATED at depth 6, state 4. This is direct
  formal confirmation that `[audit.policy]` is prose the gate never reads --
  independently matching R5's static finding. It is the same root cause as the
  policy-read requirement already in this delta; the new requirement states the
  consequence so a reviewer cannot read the policy read as cosmetic.

### Standing limits of this evidence

Apalache results are bounded: `NoError@N` establishes nothing beyond depth N,
and nothing about fairness, real subprocess kill, torn writes, or hash
collisions. `post_fix_full_binding` holding through depth 10 is bounded
satisfaction, not a theorem. Re-run with:

```
quint verify formal/specs/audit_gate.qnt --main=<module> \
  --invariant=<invariant> --max-steps=<N> --apalache-version=0.56.1
```
