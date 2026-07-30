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
`.seq` (`lib/eventlog.sh`): the artifact on disk is at all times a complete
document rather than a half-parsed one. Atomicity is about the *shape* of the
file, not about which attempt it describes — see the next section, where the
prior verdict is deliberately replaced before the audit starts rather than
after it finishes.

## Evidence binding: the attempt and the tree, not the diff hash alone

The stale-verdict hazard is not fixed by remembering to delete a file. It is
fixed by making the verdict *say what it is about* and having the gate check.
The first draft of this design made `diff_sha256` the whole predicate. It does
not discriminate the property the gate claims, in two separate ways, both
identified by the infrastructure audit.

**`diff_sha256` does not discriminate the audit attempt.** The design writes a
new verdict by tmp+rename and, as first drafted, left the prior artifact intact
until that rename. An audit of an *unchanged* diff killed before the rename
therefore leaves the previous `APPROVED` in place — carrying the same diff hash,
still gate-valid. The gate would authorise a merge on a judgment that was in the
process of being re-taken.

**`diff_sha256` does not discriminate the evaluated tree.** A rebase onto a
different base can produce a byte-identical patch while changing the resulting
tree, and with it the dependencies the audit, the independent checks and the
docs check all ran against. The formal model abstracts this as `DiffId`, so it
cannot falsify the real predicate — a bounded model checker agreeing with a
predicate that does not discriminate its property is not evidence.

### What is bound

`audit-verdict.json` carries `evidence: {diff_sha256, tree_sha256, base_sha,
head_sha, attempt}` and a top-level `state ∈ {in_progress, complete}`.

- **`diff_sha256`** — content hash of the reviewed diff. Unchanged from the
  first draft, and still the reason an amend or re-checkpoint that changes no
  content does not invalidate a 27-minute audit.
- **`tree_sha256`** — canonical identity of the *evaluated tree*: the git tree
  object id of `HEAD` in the reviewed worktree, combined with a sorted
  canonical content digest (path, state, mode, hash — see below) over every
  path `git status --porcelain=v1 -z -uall --no-renames` reports. That covers
  untracked files, staged and unstaged content, modes, symlinks, deletions and
  binary files. This is the same canonical function `checks-run.sh`, the docs
  check and `evidence-contracts`' `lib/evidence.sh` use, so all of them speak
  about the same tree with one implementation.
- **`attempt`** — the audit attempt id, allocated from the existing
  `el_attempt_new` entity (per-run-per-lane monotonic, persisted, restart-safe).
  It is allocated and recorded in `$RD` **before** the auditor is spawned.
- **`state`** — `in_progress` at publish time, `complete` only after the
  auditor has returned and its output has been interpreted.

### How staleness is detected

Before the auditor is spawned, `audit-run.sh` atomically publishes an
`UNVERIFIED` / `in_progress` record for the new attempt, with the full evidence
reference. From that instant there is no previous `APPROVED` on disk to inherit.
The gate then requires all four of: matching `diff_sha256`, matching
`tree_sha256`, `attempt` equal to the current published attempt, and
`state == complete`. Each failure is its own reason string: diff mismatch,
evaluated-tree mismatch, superseded or unfinished attempt, incomplete audit.
An uncomputable identity fails closed with its own reason and is never treated
as a match.

This composes with the requirement binding all three gate inputs.
`checks-result.json` and `docs-check.json` bind to `{diff_sha256, tree_sha256}`
and deliberately carry no `attempt`: they are not produced by an audit attempt,
so an attempt field on them would be meaningless. The verdict is the only
artifact an audit attempt produces, and the only one the attempt binds.

`base_sha` and `head_sha` remain lineage and diagnosis fields, not predicates.
They are recorded for diagnosis and are never compared by the gate; the gate
predicates are `diff_sha256`, `tree_sha256`, `attempt` and `state`, all four.

### Deletions, symlinks and type changes in `tree_sha256`

The first draft defined `tree_sha256` as path, mode and SHA-256 of bytes over
every porcelain-reported path, which is undefined for the one state porcelain
most commonly reports: a deletion. Reproduced in a scratch repository —
porcelain prints ` D deleted.txt`, and both `stat` and `sha256sum` fail because
the path is gone. Under the fail-closed rule that made an audit of any change
containing a deletion permanently `UNVERIFIED`, and it invited an implementer
to invent an unspecified sentinel.

The encoding is therefore fixed-arity with an explicit state character, and
absence is a value: `-`, mode `000000`, a 64-character zero hash. A deletion
changes the identity exactly as a write does, and a lane that removed a file is
distinguishable from a lane that wrote nothing — the property the gate needs.
Symbolic links hash their target string rather than their referent, so a
retargeted link is visible and a link pointing outside the worktree is still
hashable. Directories carry the zero hash and appear only when explicitly
named. An unreadable path is *not* encoded as absent: that collision would let
a permissions failure masquerade as a deletion, so it remains uncomputable and
fails closed on its own reason.

`--no-renames` decomposes a rename into an absent record and a present record,
which the encoding already covers, and `-z` removes porcelain v1's shell
quoting of paths containing spaces, quotes or newlines — quoting that would
otherwise make two distinct trees hash alike after unquoting.

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

**Delete `audit-verdict.json` at the start of every audit.** Rejected, and
replaced by a stronger version of the same instinct. Deletion fixes the
stale-file symptom, leaves the gate unable to tell *which* diff or tree any
verdict is about, and converts a crash between delete and write from "stale
input" into "missing input" — a different wrong answer, not a right one. What
this change does instead is *publish* an `UNVERIFIED` / `in_progress` record for
the new attempt before the auditor is spawned: there is never a window with no
artifact, the artifact never authorises anything it should not, and a killed
audit leaves a correctly-recorded unfinished attempt rather than an inherited
approval. Evidence binding on `{diff_sha256, tree_sha256, attempt, state}` is
the mechanism; the pre-audit publish is what makes the attempt binding
observable. Plain deletion remains insufficient and is not used.

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
  policy read takes the `audit-run.sh:56-58` pattern — `toml_get` with a
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

## Demonstrated rejection — what each gate predicate here is shown to reject

The workstream's standard applied to this package's own predicates: a predicate
is evidence only if it discriminates the claimed property, and it is only
demonstrated to discriminate once a known-bad input is shown to be rejected.
Every row names an input the **previous** predicate (`diff_sha256` alone)
accepts and the new one rejects. A control that both predicates pass would
demonstrate nothing.

| Predicate | Known-bad input it is demonstrated to reject | Demonstration |
|---|---|---|
| `evidence.attempt` equals the current published attempt, and `state == complete` | A previous `APPROVED` left standing by a re-audit of a **byte-identical** diff that was killed before it finished | Fixture: record `APPROVED`; spawn a re-audit of the same diff; `SIGKILL` it after the pre-audit publish; run the gate. The gate must fail naming the unfinished attempt. Assert the same fixture **passes** under a `diff_sha256`-only gate — that is the defect being closed. |
| `evidence.tree_sha256` equals the recomputed evaluated tree | A rebase onto a different base producing a **byte-identical patch** over a different resulting tree | Fixture: audit on base A; rebase onto base B such that `git diff` output is byte-identical; run the gate. The gate must fail naming the evaluated-tree mismatch. Assert the same fixture **passes** under a `diff_sha256`-only gate. |
| `tree_sha256` canonicalisation | An audit whose worktree carried untracked files, unstaged content or a mode change that a `HEAD^{tree}` id alone would not cover | Fixture: identical `HEAD^{tree}`, differing untracked file / mode; the two `tree_sha256` values must differ. |
| Pre-audit publish of `UNVERIFIED` / `in_progress` | Any window in which the artifact on disk authorises a merge while an audit for the current attempt is in flight | Fixture: sample the artifact at every point between spawn and completion; no sample may be an authorizing verdict for a superseded attempt. |
| Fail-closed on uncomputable identity | A gate run in which the diff hash, the tree identity or the attempt id cannot be computed and the comparison silently succeeds | Fixture: force each of the three computations to fail; the gate must fail with three distinct reasons, never pass and never report a match. |
| Per-artifact distinct reasons | A stale `checks-result.json` reported as a verdict problem, or vice versa | Fixture: stale each of the three artifacts in turn; each must produce its own reason string and name which identity mismatched. |

### A note on what the formal model can and cannot say here

`audit_gate.qnt` abstracts the reviewed change as an opaque `DiffId`. Under that
abstraction a rebase-with-identical-patch and a fresh diff are the same value,
and an interrupted attempt is not modelled at all. The model therefore cannot
falsify either defect above, and its `post_fix` holds are not evidence that the
real predicate discriminates. The controls in the table are what carry that
claim; the model carries the ordering and reachability claims it was built for.
This limitation is stated here so the next reader does not read a green model
run as coverage of the predicate.
