# Design — release-metrics

## Approach: definitions and discipline are a contract, not a computation engine

This package ships a reference document and a linter, not a telemetry
pipeline. The reference doc (`release-metrics.md`) is the single source of
truth for what each of M1-M4 and M6-M13 means, computed from field names
owned by `decision-lineage-and-telemetry`; M5 is owned by
`graph-eval-falsification` and is not defined here. The linter is a small,
dependency-free check that any generated report must pass before it can be
published or cited: every metric present has its companion adjacent, every
comparative claim has a stated sigma, every metric whose move exceeds its
sigma is flagged for human review with its companion shown alongside (the
linter classifies nothing as gaming by itself -- that automation is cut), and
every rate names its denominator so an empty population renders uncomputable
rather than zero.

Why a linter and not just a style guide: a style guide gets skipped under
release pressure — exactly the pressure most likely to produce a
misleadingly bare "M1: 82%" in a release note. A mechanical check that
refuses to let that line stand is cheap to build and does not rely on
anyone remembering the discipline in the moment they are most likely to
forget it.

## M1, M3, M4 and M6 are designed to fail loudly, not silently, while uncomputable

M5 moved to `graph-eval-falsification` in this fix round (see Cuts
below); the "fail loudly" design this section originally described for M5
now applies to M1, M3, M4 and M6, all of which are uncomputable today for
stated, confirmed reasons.

The naive design renders an uncomputable metric as blank, zero, or "N/A".
Rejected: a blank field reads as "not yet measured, presumably fine," and a
release note's silence on a metric is exactly the silence that would let
an unsupported claim stand unchallenged elsewhere in the same document.
Instead the reference doc and the linter require each of M1, M3, M4 and M6
to render as an explicit sentence naming what is missing and, where one is
scoped, the package that must land first: M3 and M4 point at
`decision-lineage-and-telemetry`'s `usage` payload and phase-boundary
events respectively (both confirmed absent from `events.jsonl` schema v2
by direct inspection); M1 and M6 point at instrumentation --
architect-authored-share and defect-to-merge linkage respectively -- that
no package in this release currently commits to producing, which is itself
worth surfacing rather than hiding behind a placeholder blank. This is a
deliberate over-verbose default that only goes away once the real number,
or a scoped package to produce it, exists.

## Sigma methodology, stated rather than left implicit

Sigma for a metric is the standard deviation of that metric's value across
repeated measurement windows of unchanged code — supplied by
`regression-harness-tiers`' repeated-run capability. Until that harness
produces enough repeated windows to estimate sigma with a stated minimum
sample size (documented per-metric in the reference doc, not a single
global number), no comparative claim for that metric may be published;
the report states "sigma not yet estimated (n=<k> windows, need
n>=<threshold>)" in place of a claim. This is the same shape as the
uncomputable-metric gate above: an explicit blocked state rather than a
silently optimistic default.

## Two failure modes of the "uncomputable" mark, and what stops each

The mark is only worth having if it cannot become a way to pass. Two
distinct ways it could are closed here.

**A rate with nothing in its denominator.** A window with zero lane starts,
zero merged tasks or zero gate decisions is not a window in which the metric
was zero; it is a window in which the metric was not measured. Rendering the
two identically is how "0 defects escaped" gets published from an empty
population. Every metric therefore names its denominator (M1: tasks reaching
round 1; M2: tasks started; M3: tasks merged; M4: tasks with recorded phase
timing; M6: merged lines whose 14-day window completed; M7: lane starts; M8:
gate decisions), and a zero denominator renders a distinct
`uncomputable -- zero denominator (...)` string that satisfies no threshold,
carries no comparative claim, and never enters an aggregate as zero.

**A blocked-input mark whose blocker is fictional or already landed.** The
mark names a blocking package; nothing previously checked that the package
exists or is still unlanded, so the mark would survive the moment it stopped
being true. The linter now verifies the named blocker exists under
`openspec/changes/` and has not landed, and rejects the render otherwise.

Neither state is ever a pass. Both are distinguishable from each other in the
report, because "we have no instrument" and "we have an instrument and an
empty window" call for different actions.

## Alternatives rejected

- **Compute the metrics ourselves in this package.** Rejected: this
  package's boundary is definitions and discipline; computing the metrics
  means reading `metrics.json` and event payloads whose shape belongs to
  `decision-lineage-and-telemetry`. Building a second consumer before
  that producer's shape is frozen risks the same ordering hazard
  `three-outcome-verdicts` flagged for its own dependency: authoring
  consumers before the producer's schema is fixed freezes the schema
  around the wrong shape.
- **A single global sigma threshold across all metrics.** Rejected: M1 (a
  bounded percentage) and M3 (an unbounded cost figure) have different
  noise characteristics; a shared threshold either over-suppresses M1's
  real signal or under-suppresses M3's noise. Per-metric sigma with a
  documented minimum sample size is more code but the alternative
  silently produces wrong claims for at least one metric class.
- **Aggregate M5 across all vendor pairs with a single number.** Rejected
  explicitly by the counter-evidence: the ~2-effective-vote collapse
  means an aggregate would average away exactly the differentiation that
  would justify (or refute) the multi-vendor design. Per-pair reporting
  is the entire point of M5.
- **Silent zero/blank for uncomputable metrics.** Rejected above (the
  fail-loudly section) — silence reads as "measured and fine," not "not
  measured." The same rejection covers a zero rendered for an empty
  population: "0 escaped defects over 0 merged lines" reads as a result and
  is not one.
- **A soft style-guide instead of a mechanical linter.** Rejected: the
  discipline is precisely the thing release pressure erodes; the
  linter's refusal to publish is the whole value of this package over
  just writing the definitions down somewhere.

## Risks

- **Sample-size starvation.** Early releases will have few task starts;
  M2's p90 and M7's per-100 figures will be low-sample for a while. The
  low-sample flag (spec requirement) makes this visible rather than
  pretending precision that is not there.
- **The linter itself becomes a checkbox people route around** (e.g. by
  publishing findings outside its scope, such as a chat message instead
  of a report file). Mitigated by scoping the linter to any file the
  release process treats as a citable report, named explicitly in
  tasks.md, and by making the doctrine ("no comparative claim without
  sigma," "no metric without companion") apply to the claim, not just the
  artifact format.
- **This package ships ahead of `decision-lineage-and-telemetry`.** By
  design: several requirements (M3, M4, the M8 gate-decision input, sigma)
  are specified to render an explicit blocked state rather than assume the
  dependency has landed. If merged before the dependency, the reference doc
  and linter are still correct and simply report those metrics as pending.
  The linter's blocker check keeps that honest in the other direction too:
  once the dependency lands, a report still rendering them as blocked is
  rejected.


## Cuts (2026-07-28 fix round, per audit Findings 7-8 and proportionality review)

**M5 removed from this package; graph-eval-falsification is sole owner
(Finding 7).** M5 was defined twice, differently, in this package and in
`graph-eval-falsification`'s evaluation spec: this package defined it as
a production-telemetry metric blocked on
`decision-lineage-and-telemetry`'s `finding`/`audit_verdict` events;
`graph-eval-falsification` defined it as computable offline today by
substituting one vendor's recorded auditor transcript for another's on the
same diff, against the Tier 1 replay corpus. The audit's proportionality
review resolves this directly: "Remove M5 here because the graph-eval
package owns it." This package's M5 requirement is removed and replaced
with a short ownership/consumer requirement; the metric formula lives only
in `graph-eval-falsification` now. `graph-eval-falsification`'s own
Impact section is out of this package's edit scope; it needs the
symmetric note added by whichever change owns that package (flagged as an
open cross-package action, not resolved here).

**Reduced active metric set: M2, M3, M4, M7, M8 for v0.2.9 (Finding 8 +
proportionality).** Per the audit: "Reduce the release metrics to M2, M3,
M4, M7 and M8 for v0.2.9. Keep M1 only after authorship instrumentation
exists. Remove M5 here because the graph-eval package owns it; defer M6
until defect-to-merge linkage exists; defer M9-M13 rather than shipping 13
nominal metrics with incomplete populations." Applied exactly: M1 and M6
are defined but excluded from the v0.2.9 report until their blocking
instrumentation is scoped to a package (neither is today); M9-M13 are
deferred wholesale, not partially computed; M3, M4 and part of M8 remain in
the active set on the basis that their blocking input
(`decision-lineage-and-telemetry`) is a same-release sibling package, not
an unscoped gap like M1/M6's.

**Automated gaming-direction inference cut; typed companion field plus
human review retained (proportionality).** Per the audit: "Cut automated
"gaming direction" inference; retain a typed companion field and human
review." The original gaming-detector requirement auto-classified a
metric as a gaming-candidate when its companion failed to move in a
"corroborating direction." That inference was itself an unvalidated
predicate with no positive control -- exactly the soundness gap
`test-infrastructure-hardening`'s Finding 12 fix targets for checks in
general. Rather than build and separately validate that predicate, the
fix drops the automated classification and keeps the structural part that
was always load-bearing: the companion field must exist, be typed, and sit
next to the metric, and a large move triggers a human-review flag instead
of an automated verdict.

**Not cut: the per-metric computability audit itself (Finding 8), and the
sigma-before-claim rule.** These are the discipline this package exists to
provide; cutting them would remove the package's only value over an
unstructured note. Confirmed directly against the codebase before writing
any of the above: `gate-eval.sh` and `audit-run.sh` emit zero
`el_emit` calls; no script anywhere emits `input_tokens`,
`output_tokens`, or `cost_usd`; `lane-run.sh` has exactly one
`el_emit state` call site (`verifying`), insufficient for a
four-phase split; and `audit-verdict.json` and `gate-decision.json`
already exist on disk today, joinable by run directory even though they
are not yet in the event log.
