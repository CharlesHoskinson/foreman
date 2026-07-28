# Change: release-metrics

## Why

Foreman v0.2.9 makes comparative claims about whether this release improved
anything, but today it cannot compute a single one of them. Verified by
inspection: `events.jsonl` schema v2 emits `prompt`, `heartbeat`,
`checkpoint`, `ownership`, `state`, `waiting_child`, `round_done`, `alert`,
`resume`, `merge_base` — there is no `usage` event, no `finding` event, no
`audit_verdict` event, no `gate_decision` event, and no vendor field on any
event (vendor is inferred from a path string, not recorded). `gate-eval.sh`
and `audit-run.sh` contain zero `el_emit` calls: audit and gate decisions
never enter the lineage store at all.

Consequence: none of this release's comparative claims — cost, quality,
cross-vendor value, lane reliability — are currently computable. That gap
is being closed by `decision-lineage-and-telemetry` (event payloads,
`metrics.json`), `regression-harness-tiers` (the harness), and
`test-infrastructure-hardening` (the suite). None of those three packages
defines what the numbers mean once they exist, what a reader will
misinterpret from each one in isolation, or what discipline stops a metric
from being gamed or a noise-floor delta from being reported as a finding.
That is this package.

The stakes for getting the definitions right rather than just the
plumbing: the counter-evidence already in hand shows nine frontier LLMs
across seven families collapse to approximately 2 effective independent
votes, with aggregation recovering at most 11% of an 8-22 percentage-point
deficit. If Foreman reports a naive aggregate cross-vendor catch rate once
telemetry lands, it will overstate the case for multi-vendor auditing
using exactly the kind of number this counter-evidence refutes. The metric
(M5) has to be specified per vendor pair from day one, not patched later
once a misleading aggregate has already shipped in a release note. That
specification is `graph-eval-falsification`'s to write and own -- the
2026-07-28 proportionality review made it M5's sole owner after the metric
was found defined twice, differently. What remains this package's is the
claim discipline around it: in v0.2.9 M5 is not rendered at all, so no
cross-vendor independence claim may be published from a v0.2.9 report.

## What changes

- **Twelve metric definitions (M1-M4, M6-M13)**, each with an exact
  computation, a named denominator, a documented misreading, and a required
  companion number that must be rendered alongside it. **M5 is not defined
  here** -- it was defined twice, differently, in this package and in
  `graph-eval-falsification`; the 2026-07-28 proportionality review made
  `graph-eval-falsification` its sole owner and this package a consumer of
  its formula and field names:
  - M1 first-pass gate rate — companion: architect-authored share of
    merged lines.
  - M2 rounds-to-green — p50 AND p90 AND abandoned count, never p50
    alone.
  - M3 cost per merged change — includes failed attempts, not just the
    winning one.
  - M4 wall-clock split by queue / implement / audit / gate, with an
    explicit `unaccounted` bucket.
  - M5 — **owned by `graph-eval-falsification`, not defined here.** Not
    computed or cited in a v0.2.9 report at all, so no independence claim
    about cross-vendor auditing may be published from a v0.2.9 report;
    from the release in which M5 becomes computable, such a claim must
    cite a measured per-pair M5 and never a collapsed aggregate.
  - M6 escaped-defect rate per 1k merged lines, fixed 14-day window.
  - M7 lane mortality per 100 lane-starts.
  - M8 evidence completeness.
  - M9-M13 (verdict distribution, auditor-architect kappa, flake rate,
    budget vs declared, prediction-hold rate) — defined in the reference
    doc, but **deferred entirely** from v0.2.9's report: the package may
    not compute or cite any of them in a v0.2.9 release report even where
    partial data exists.
- **The companion-number rule**: no metric may be published or cited
  without its companion in the same row/sentence; a report violating this
  is invalid output.
- **The sigma-before-claim rule**: no release-over-release delta may be
  called an improvement or regression until Foreman's own noise floor
  (sigma) for that metric is measured; a delta smaller than sigma must be
  reported as indistinguishable from noise.
- **The gaming-exposure rule**: every metric's reference entry names at
  least one concrete way it could be moved without moving the underlying
  outcome, and the typed companion field a human reviewer checks. A metric
  moving by more than sigma is flagged for human review with its companion
  shown alongside. The automated directional-corroboration inference is
  **cut** — it was itself an unvalidated predicate with no positive control
  distinguishing real gaming from coincidental correlated movement — so the
  linter never auto-classifies a move as gaming or as legitimate.
- **A reduced v0.2.9 active set**: M2, M3, M4, M7 and M8 only. M2 and M7 are
  computed from inputs confirmed present today, M8 on a documented interim
  basis for one input, and M3 and M4 render uncomputable pending
  `decision-lineage-and-telemetry`. The report may not describe that set as
  fully computed.
- **Zero denominators are uncomputable, not zero.** Every metric names its
  denominator; an empty population renders
  `uncomputable -- zero denominator (<denominator name> = 0 over <window>)`,
  never 0, 0%, 100%, blank or an omitted row, and can satisfy no threshold
  and carry no comparative claim. A blocked-input uncomputable render must
  name a blocking package that exists and has not landed, so the mark cannot
  excuse a metric whose input is in fact available.

## Impact

- Affected: `skills/foreman/SKILL.md` (reporting/claim-discipline
  section), `skills/foreman/references/orchestration-hardening.md`.
- New: `skills/foreman/references/release-metrics.md` (the metric
  reference doc: formulas, denominators, misreadings, companions and
  gaming-exposure notes for M1-M4 and M6-M13, plus a pointer entry for M5
  naming `graph-eval-falsification` as its owner), a report-linter helper
  (`skills/foreman/scripts/lib/metrics-lint.sh` or equivalent) enforcing
  the companion-number and sigma-before-claim rules on any generated
  report, `tests/release-metrics.bats`.
- Depends on `decision-lineage-and-telemetry` for the `usage`, `finding`,
  `audit_verdict`, `gate_decision` event payloads and `metrics.json`
  production that M1, M3, M4, M8, M9 and M10 read from. This package defines
  the formulas against those field names; it does not invent parallel
  fields.
- Depends on `graph-eval-falsification` as M5's sole owner. This package
  defines no M5 formula, shape or threshold, and cites its field names
  verbatim where a future release's report renders it.
- Depends on `regression-harness-tiers` for the harness that produces
  repeated-run data needed to measure sigma, and on
  `test-infrastructure-hardening` for the suite these metrics' tests run
  under.
- Deliberately NOT affected: this package does not modify
  `audit-run.sh`, `gate-eval.sh`, `lib/eventlog.sh`, or the event schema
  itself — those are `decision-lineage-and-telemetry`'s files. It does
  not touch the harness runner or the test suite infrastructure.
