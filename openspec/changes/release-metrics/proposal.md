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
once a misleading aggregate has already shipped in a release note.

## What changes

- **Thirteen metric definitions (M1-M13)**, each with an exact computation,
  a documented misreading, and a required companion number that must be
  rendered alongside it:
  - M1 first-pass gate rate — companion: architect-authored share of
    merged lines.
  - M2 rounds-to-green — p50 AND p90 AND abandoned count, never p50
    alone.
  - M3 cost per merged change — includes failed attempts, not just the
    winning one.
  - M4 wall-clock split by queue / implement / audit / gate, with an
    explicit `unaccounted` bucket.
  - M5 cross-vendor auditor unique-catch rate — per vendor pair,
    currently uncomputable, and no independence claim may be published
    without it.
  - M6 escaped-defect rate per 1k merged lines, fixed 14-day window.
  - M7 lane mortality per 100 lane-starts.
  - M8 evidence completeness.
  - M9-M13 (verdict distribution, auditor-architect kappa, flake rate,
    budget vs declared, prediction-hold rate) — defined, computation
    deferrable.
- **The companion-number rule**: no metric may be published or cited
  without its companion in the same row/sentence; a report violating this
  is invalid output.
- **The sigma-before-claim rule**: no release-over-release delta may be
  called an improvement or regression until Foreman's own noise floor
  (sigma) for that metric is measured; a delta smaller than sigma must be
  reported as indistinguishable from noise.
- **The gaming-detector rule**: every metric's reference entry names at
  least one concrete way it could be moved without moving the underlying
  outcome, and the cross-check (usually its companion) that would expose
  that move. A metric that moves by more than sigma while its companion
  does not corroborate is auto-flagged as a gaming-candidate.
- **M5's per-vendor-pair reporting shape**, gated explicitly on
  `decision-lineage-and-telemetry` landing finding-level vendor
  provenance; until then M5 renders as an explicit "uncomputable" state,
  never a placeholder zero or an estimate.

## Impact

- Affected: `skills/foreman/SKILL.md` (reporting/claim-discipline
  section), `skills/foreman/references/orchestration-hardening.md`.
- New: `skills/foreman/references/release-metrics.md` (the metric
  reference doc: formulas, misreadings, companions, gaming notes for
  M1-M13), a report-linter helper
  (`skills/foreman/scripts/lib/metrics-lint.sh` or equivalent) enforcing
  the companion-number and sigma-before-claim rules on any generated
  report, `tests/release-metrics.bats`.
- Depends on `decision-lineage-and-telemetry` for the `usage`, `finding`,
  `audit_verdict`, `gate_decision` event payloads and `metrics.json`
  production that M1, M3, M5, M8, M9, M10 read from. This package defines
  the formulas against those field names; it does not invent parallel
  fields.
- Depends on `regression-harness-tiers` for the harness that produces
  repeated-run data needed to measure sigma, and on
  `test-infrastructure-hardening` for the suite these metrics' tests run
  under.
- Deliberately NOT affected: this package does not modify
  `audit-run.sh`, `gate-eval.sh`, `lib/eventlog.sh`, or the event schema
  itself — those are `decision-lineage-and-telemetry`'s files. It does
  not touch the harness runner or the test suite infrastructure.
