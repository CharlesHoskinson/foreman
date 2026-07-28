# Design — test-infrastructure-hardening

## The core problem is signal, not coverage

The suite has 382 tests across 33 files and reasonable coverage. What it lacks
is the ability to say what a red result *means*. Today a failure can be any of:
a product defect, a platform mismatch, a privilege mismatch, an unbuilt
artefact, a missing tool, a network-dependent probe, a load-sensitive
assertion, or a test that was never valid in this environment.

Triaging nine failures by hand cost more than an hour and the answer was "two
were real." That cost recurs on every release and, worse, it trains the reader
to discount red — which is how test 54, a genuine concurrency defect, sat
unnoticed.

So the design goal is not "more tests." It is: **red means the product is
broken, and nothing else does.**

## Skip-with-reason is the mechanism, and it is dangerous alone

Converting inapplicable failures into skips is the obvious fix and the obvious
way to make things worse — the degenerate end state is a suite that skips
everything and reports green. Every serious treatment of this pairs the skip
mechanism with a coverage counterweight, and this design does too:

1. **Declared skip budgets per file per platform.** Skipping is allowed only up
   to a number someone wrote down. Exceeding it fails the run.
2. **Reasons are mandatory.** A bare `skip` with no message is a failure. The
   reason string is what makes a skip auditable later.
3. **Slack is reported.** If a file consistently skips fewer tests than its
   budget allows, the runner says so, so budgets ratchet down rather than
   drift up.

Without those three, this package is a net negative. They are the load-bearing
part of the design.

## Per-slice baselines, because aggregates lie at this size

With 382 tests, one subsystem failing entirely moves the headline number by a
few percent — within the range a reader dismisses as flake. The measured form
of this effect: seeded regressions moved an aggregate by −1.7 to −5.9 pp while
the owning slice fell −25 to −91 pp (`R6-eval-and-workflow.md`).

`tests/baseline.tsv` therefore records per-file expected pass counts, committed
and updated deliberately. The runner diffs against it. Deliberate updating is
the point: a baseline regenerated automatically from a failing run is a
rubber stamp.

## Why not just fix the seven non-defect failures and move on

Because they are not a fixed set. `launcher/dist` will be built by
`wsl-launcher-shipped` and that particular failure disappears — but the *class*
returns with the next build artefact, the next Windows-only behaviour, the next
tool dependency. Six of today's nine failures are instances of "the harness had
no way to express a precondition." Expressing preconditions is the fix; the
seven individual repairs fall out of it.

## Boundaries with the rest of the release

This package deliberately owns none of the underlying fixes:

- the exec-bit index change belongs to `crlf-extensionless-hardening`;
- building `launcher/dist` belongs to `wsl-launcher-shipped`;
- the Linux CI job belongs to `wsl-ci-parity`;
- tests 43/50/54's product-side causes belong to `lock-primitive-hardening`.

It owns the harness that consumes them. That boundary matters because three of
those packages already exist and were written before this evidence; duplicating
their work here would create merge contention on `env/tool-check.sh` and
`lane-run.sh`, which R5 already flags as the release's only real three-way file
contention.

## Determinism over sleeps

`WATCH_VTICK` (the injectable clock from v0.2.5) already exists and is used by
the watch tests. Timing assertions elsewhere still sleep against the wall
clock, which is why test 43 passes alone and fails under a loaded box. The fix
is to extend the existing mechanism, not invent a second one.

Quarantine is offered as the fallback for a test that resists determinism, but
with a tracking note and outside the default run — an indefinitely-flaky test
left in the default run is the thing that taught everyone to discount red.

## Regression injection: proving the tests can fail

A test that cannot fail is indistinguishable from a test that passes. The
injection harness seeds known defects — a duplicated sequence number, a
swallowed concurrency collision, a dropped provenance field — and asserts the
owning slice goes red. Anything that stays green is reported as an unprotected
defect class.

This is run on demand rather than in the default suite: it mutates the tree,
and its value is periodic assurance, not per-commit gating.

## The second failure class: the checker, not the test

Everything above concerns a test that fires and whose red result cannot be
interpreted. On 2026-07-28 the release measured a different and worse class:
a check whose *predicate does not match what it claims to test*. Four instances
in one session, four different actors, one shape.

The reason it is worse is asymmetric visibility. A test that fails demands
attention. A check that passes for the wrong reason is filed as evidence and
closes the question. Two of the four produced published conclusions that were
not merely unsupported but **inverted** — "the `flock` fix failed" (it had not)
and "UNVERIFIED non-termination is refuted" (it is confirmed). Both went into
architect reports before being caught.

### Why regression injection does not cover this

The injection harness already specified here seeds a defect and asserts the
owning slice goes red. That answers "does this test fire?" It does not answer
"does this predicate mean what its author thought?" — because the injected
defect is chosen by the same person who wrote the predicate, from the same
mental model. In three of the four incidents the harness would have reported
green, because the *test* was fine; the *reading of its output* was wrong.

So the extension is not a new harness. It is a rule about where a predicate
gets its licence: **from having been observed to fail.**

### The positive control

One run, against an input the check is required to reject, with the rejection
recorded. That is the whole mechanism, and it is cheap. Applied to the four
incidents:

| # | the check | the control that would have caught it |
|---|---|---|
| 1 | `grep -q "violation"` | the known-holding control arm would have classified as violated in the same run — a predicate that classifies both arms identically is not a predicate |
| 2 | `rework_rounds_bounded` | the property was already known to hold pre-fix; a predicate that holds in both arms discriminates nothing |
| 3 | `--step=event_step` | the pre-fix configuration was known to violate; a "safe" verdict on it is the control failing |
| 4 | exit-code success predicate | delete the deliverable and confirm the lane reports failure |

Note what each control has in common: it asks the check to produce the *negative*
answer, once. None of them requires new infrastructure, and none of them takes
more than a single extra run.

The rule has a sharp edge worth stating: a control that would also be rejected
by a check with the *wrong* predicate proves nothing. In incident 1, feeding
the predicate an obviously-broken input still yields "violated", because it
yields "violated" for everything. The control must be the arm the check is
required to *accept*, run alongside the arm it is required to reject.

### Artifacts over exit codes, substrings and self-report

Three of the four failed at the boundary where a check reads someone else's
output. The rule that falls out is mechanical:

1. **Artifact and content, never exit status.** A lane that exits 0 with its
   deliverable missing has failed. `bugeventlog.md` records this twice in one
   session across two vendors — a `codex exec` audit lane that exited 0 having
   written nothing after printing that its report was "ready for its required
   final repository write", and a Grok council lane that ended its turn waiting
   for a background task that did not exist. One of them ran its own existence
   check, saw `absent`, and ended anyway.
2. **Anchored tokens, never substrings.** `[ok] No violation found` contains
   `violation`. Match `^\[ok\]` and `^\[violation\]`.
3. **Unknown output is ERROR, never PASS.** A crashed, timed-out or
   reformatted checker is an unknown. Unknowns must not be green — this is the
   same asymmetry as the skip-budget rule elsewhere in this package: the
   degenerate quiet state must cost something.
4. **An agent's account of its own state is context, not a verdict.**

### Vacuity, and where to stop

Full vacuity detection — proving an assertion's precondition reachable — is
tractable for a model checker and generally not for a bats suite. The design
therefore takes what is cheap and requires the substitute where it is not:
report precondition reachability and state variation where the mechanism allows
it; require the positive control everywhere else. What is *not* acceptable is a
check with neither, presented as evidence.

The registry of known-vacuous predicates is the cheap durable part. It cost one
line to record that `rework_rounds_bounded` cannot answer termination for a loop
in which `round` never advances, and that `audit_attempts_bounded_by_three` can.
That line is what prevents the second occurrence.

### Cross-checking, and its honest limitation

Cross-checking is required here because it is the only thing that has actually
worked: all four incidents were caught by comparison against an independent
result and by no other means. It is also the weakest of the mechanisms in this
package, because it depends on a second result existing and on somebody
noticing the disagreement. It is a backstop, not a gate, and the positive
control is what reduces reliance on it.

The requirement is therefore scoped narrowly — to results that would change a
release decision — rather than applied to every check, which would be
unaffordable and would decay into a formality.

## Risks

- **Annotation churn across 33 files.** Mechanical but wide. Mitigation: land
  the helper and the runner first, then annotate file-by-file, so a bad
  annotation is attributable to one commit.
- **Budgets become a rubber stamp** if set generously and never revisited. The
  slack report is the mitigation; if it is ignored, the mechanism decays.
- **CI on `windows-latest` will be slow and may be flaky at first.** It should
  start non-blocking for one release and become blocking once its own flake
  rate is measured — introducing a blocking job with unknown flake would
  reproduce the very problem this package exists to fix.
- **Positive controls become ceremonial.** The rule is cheap enough to satisfy
  badly: a control that the check would reject for any input at all — which is
  the exact defect in incident 1 — looks identical in a diff to a real one.
  Mitigation is the both-arms rule (the check must produce opposite answers on
  the two arms in the same run); the residual risk is that reviewers do not
  check that both arms are present, and it is real.
- **Vacuity reporting is only as good as the mechanism underneath.** For bats
  assertions there is no general way to prove a precondition reachable, so the
  fallback is the positive control. Anywhere both are skipped, the check is
  back to providing no evidence, and nothing mechanical detects that state.
- **Cross-checking depends on somebody noticing.** All four incidents were
  caught this way, but each was caught because a second result happened to
  exist and happened to disagree visibly. It is a backstop with no trigger of
  its own; scoping it to release-deciding results keeps it affordable but does
  not make it reliable.
- **The rules apply to this package's own gates.** The skip-budget and
  baseline checks are themselves checks, and neither has been observed failing
  yet. They are in scope for T8, and exempting them would be the first
  instance of the failure this package documents.
