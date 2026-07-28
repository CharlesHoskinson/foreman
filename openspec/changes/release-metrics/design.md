# Design — release-metrics

## Approach: definitions and discipline are a contract, not a computation engine

This package ships a reference document and a linter, not a telemetry
pipeline. The reference doc (`release-metrics.md`) is the single source of
truth for what each of M1-M13 means, computed from field names owned by
`decision-lineage-and-telemetry`. The linter is a small, dependency-free
check that any generated report must pass before it can be published or
cited: every metric present has its companion adjacent, every comparative
claim has a stated sigma, and no metric exceeding its sigma-move without a
corroborating companion escapes the gaming-candidate flag.

Why a linter and not just a style guide: a style guide gets skipped under
release pressure — exactly the pressure most likely to produce a
misleadingly bare "M1: 82%" in a release note. A mechanical check that
refuses to let that line stand is cheap to build and does not rely on
anyone remembering the discipline in the moment they are most likely to
forget it.

## M5 is designed to fail loudly, not silently, while uncomputable

The naive design renders M5 as blank, zero, or "N/A" when telemetry is
absent. Rejected: a blank field reads as "not yet measured, presumably
fine," and a release note's silence on M5 is exactly the silence that
would let an unsupported cross-vendor-independence claim stand
unchallenged elsewhere in the same document. Instead the reference doc and
the linter require M5 to render as an explicit sentence: "uncomputable —
no finding-level vendor provenance in events.jsonl schema v2," with a
pointer to the dependency. This is a deliberate over-verbose default that
only goes away once the real number exists.

## Sigma methodology, stated rather than left implicit

Sigma for a metric is the standard deviation of that metric's value across
repeated measurement windows of unchanged code — supplied by
`regression-harness-tiers`' repeated-run capability. Until that harness
produces enough repeated windows to estimate sigma with a stated minimum
sample size (documented per-metric in the reference doc, not a single
global number), no comparative claim for that metric may be published;
the report states "sigma not yet estimated (n=<k> windows, need
n>=<threshold>)" in place of a claim. This is the same shape as the M5
gate: an explicit blocked state rather than a silently optimistic default.

## Alternatives rejected

- **Compute the metrics ourselves in this package.** Rejected: this
  package's boundary is definitions and discipline; computing M1-M13
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
- **Silent zero/blank for uncomputable metrics.** Rejected above (M5
  section) — silence reads as "measured and fine," not "not measured."
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
  design: several requirements (M5, sigma) are specified to render an
  explicit blocked state rather than assume the dependency has landed.
  If merged before the dependency, the reference doc and linter are
  still correct and simply report most metrics as pending.
