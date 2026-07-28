# Design — formal-model-suite

## The asset is the violation, not the model

The instinctive reading of a formal model is that its value is the invariant
that holds. For these three models it is the opposite. Each was written against
a defect already observed in the field, and each was validated by the criterion
the architect set for the lanes: *a model that finds nothing is worthless — it
must independently reproduce a defect we already observed.*

So the maintained artefact is the **pair**: a pre-fix configuration that
violates and a post-fix configuration that holds. Only the pair carries
information. A model with just the post-fix arm holds its invariants **by
construction** and says nothing — this is not hypothetical, it is what the
architect's first M1 run actually did. Running `--main=lane_lifecycle` with the
default `init`/`step`, which aliases the post-fix configuration, produced
"invariants hold", from which the architect concluded the model could not show
the bug. The model could; it had never been asked.

That is why the expectation manifest gates in both directions and why every row
names its entrypoint. A green tick on a suite that only checks post-fix arms is
indistinguishable from a green tick on a suite that checks nothing.

## Why a manifest rather than assertions inside the models

Quint has no notion of "this invariant is expected to fail." Expressing the
pre-fix expectation inside the model would mean negating the invariant, which
destroys its meaning and makes the model unreadable next to the code it
abstracts. The expectation therefore lives outside, in a TSV whose rows are the
unit of review.

A TSV is chosen over a script of assertions for a specific reason: **a manifest
row is diffable and a deleted row is visible.** The failure mode being defended
against is someone making the suite green under time pressure. Flipping
`VIOLATED` to `HOLDS`, or deleting a row, shows up in review as a one-line
semantic change. The same edit buried in a shell script does not.

## The classifier is itself a check, so it gets a positive control

The instinct is to treat the harness that parses checker output as plumbing.
On 2026-07-28 that plumbing produced the release's first vacuous result:
`grep -q "violation"` matched `[ok] No violation found`, so every run — control
arms included — classified as violated, and the `flock` remedy briefly appeared
to have failed.

The rule that falls out is narrow and mechanical:

1. Match anchored outcome lines: `^\[violation\]`, `^\[ok\]`.
2. Anything else is `ERROR`, never `PASS`. A checker that crashed, timed out or
   changed its output format is an unknown, and unknowns must not be green.
3. The classifier is run against one known-violating and one known-holding
   fixture before it is trusted. A classifier that has never been observed
   returning `VIOLATED` for a violating run is an untested classifier.

Point 3 is the general positive-control rule from
`test-infrastructure-hardening`, applied to the one component here that
everything else depends on.

## Alternatives considered

**Leave the models as planning artefacts and cite the report. REJECTED.**
This is the status quo and it decays on a schedule. The results are already
tied to a specific Quint version resolved through an `fnm` multishell path that
does not survive a new shell; within one release nobody will be able to
reproduce the numbers in `VERIFY-quint-architect.md`. A cited-but-unreproducible
result is exactly the "stale claim wearing a checker's authority" this package
exists to prevent — the citation gets stronger with age while the evidence gets
weaker.

**Run only the post-fix configurations in CI, as a correctness suite.
REJECTED.** This is the tempting cheap option and it inverts the value. Post-fix
arms hold by construction; the suite would be green from the day it was written
and would stay green through any amount of model rot. It is a suite that cannot
fail, which is precisely the class `test-infrastructure-hardening` exists to
expose.

**Assert on counterexample content rather than on VIOLATED/HOLDS. REJECTED as
the gate, retained as a note.** Pinning the exact counterexample — M2's
`seqHolders: Set(0, 1)` with `phase: Map(0 -> InCompact, 1 -> InSeq)` — would
detect a model that still violates but for a different reason. It is also
brittle: Quint's search order is not stable across versions, and a manifest
that fails whenever the checker picks a different valid counterexample trains
readers to ignore it. Counterexamples are recorded in the report for human
review; the gate asserts the outcome.

**Generate the manifest from a passing run. REJECTED.** Same objection
`test-infrastructure-hardening` makes to auto-regenerating `tests/baseline.tsv`:
a baseline derived from whatever the code did today is a rubber stamp. Every
seeded row here traces to a result a human ran and recorded.

**Port the models to TLA+ / Alloy for better tooling. REJECTED for this
release.** The models exist, typecheck, and have produced results. Re-expressing
them costs weeks and buys nothing this release needs, and a rewrite would have
to re-establish every pre-fix violation from scratch — losing the one property
that makes them valuable.

## Drift is the slow failure, and it is gated at the file level

A model abstracts specific code. `witness_shipped_resume_loses_round_ownership`
is credible only because the architect checked
`lane-supervise.sh:343-345` against the modelled `successfulResumePlain` action
and found them to match. That check has a shelf life.

The gate is deliberately coarse: a coverage record maps each model to the
source files it abstracts, and a change touching a covered file must touch the
model or record why not. Coarse is the right choice — a precise dependency
analysis of a shell codebase against a Quint abstraction is not tractable, and
a gate that is precise but wrong is worse than one that is blunt and forces a
sentence of justification. The escape hatch is deliberate and cheap; what it is
not is silent.

## Method honesty is a requirement, not a courtesy

The results on record are bounded or sampled: Apalache to depths 8-12, random
simulation at 10,000-20,000 samples. `atomic`/`mutual_exclusion` showing no
violation within 8 steps at 385.8 s is bounded satisfaction, not proof.

Formal results carry disproportionate rhetorical weight in a review. A row
reported as "verified" invites a reader to stop asking questions, and the gap
between "no counterexample within 8 steps" and "correct" is where an
unjustified release decision would live. The suite therefore prints the method
and bound on the same line as the verdict, so the qualification cannot be
dropped by quoting the result.

The same honesty covers the known artifact: M1's `eventually_terminal`
"failure" is a no-fairness stuttering artifact and is recorded as such, not as
a liveness defect.

## The vacuous-predicate registry

`rework_rounds_bounded` is kept in the model — it is a true and useful property
of `round`. What is recorded is that it **does not test termination of the
UNVERIFIED loop**, because in that loop `round` never advances while
`auditAttempts` grows without bound. The registry maps the predicate to the
property it cannot answer and to the one that can,
`audit_attempts_bounded_by_three`, which VIOLATES under `uncapped_errors` and
holds under `capped_errors`.

This is a small artefact defending against a specific recurrence: the wrong
predicate was chosen once, produced a confident inverted conclusion, and was
caught only by another lane's result. The registry makes the second attempt
fail loudly instead.

## Risks

- **The manifest becomes a chore and rows get relaxed.** The mitigation is
  reviewability — a flipped outcome is a visible one-line semantic diff — plus
  the rule that changing an expected outcome requires an owning change that
  explains it. If both are ignored the mechanism decays, and it decays quietly.
- **Apalache runtime.** Measured 8-386 s per configuration; the deep-bound rows
  cannot run per commit. Tiering the manifest is the mitigation, and the risk
  is that the scheduled tier is where the interesting rows end up and nobody
  reads its failures. The tier assignment should be reviewed each release.
- **Model fidelity is not gated by anything mechanical.** The drift gate forces
  a human to look; it cannot check that the abstraction is faithful. M3 caught
  its own fidelity bug — it had hard-coded a vendor-family check the real gate
  lacks — by re-reading the source. Nothing here automates that, and this
  design does not pretend otherwise.
- **False confidence from a green formal suite.** The most dangerous outcome of
  this package is a reader who sees "formal checks: green" and stops. The
  method-and-bound line on every result is the mitigation, and it is a weak one
  against a determined skim.
