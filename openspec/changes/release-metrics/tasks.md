# Tasks — release-metrics

Ordering: T1 is the premise check. T2 is the reference doc and is the
dependency for everything after it. T3-T5 can proceed in parallel once
T2's shape is fixed. T6-T7 depend on T2-T5. T8 gates.

This package does not touch `audit-run.sh`, `gate-eval.sh`,
`lib/eventlog.sh`, the event schema, the regression harness, or the test
suite. Where a task needs a field from one of those, cite the field name
from the owning package's spec; do not invent a parallel one.

## T1 — confirm the premises before writing definitions

- [ ] Re-confirm `events.jsonl` schema v2's event list (`prompt`,
      `heartbeat`, `checkpoint`, `ownership`, `state`, `waiting_child`,
      `round_done`, `alert`, `resume`, `merge_base`) has no `usage`,
      `finding`, `audit_verdict`, or `gate_decision` event, and no vendor
      field on any event.
- [ ] Re-confirm `audit-run.sh` and `gate-eval.sh` contain zero `el_emit`
      calls.
- [ ] Confirm no existing script in `skills/foreman/scripts/` computes any
      of M1-M13 today. Record the evidence (grep output) rather than
      asserting it.
- [ ] IF any premise fails, stop and record the finding rather than
      adapting the change to it.

## T2 — the metrics reference doc

- [ ] Create `skills/foreman/references/release-metrics.md` defining
      M1-M13: exact formula, units, the documented misreading in one
      sentence, the required companion number and how it is computed,
      and at least one concrete gaming vector with its cross-check.
- [ ] For each metric, name the exact upstream field(s) it reads
      (`decision-lineage-and-telemetry`'s event names / `metrics.json`
      keys) or state explicitly that the field does not exist yet and
      the metric is therefore pending.
- [ ] M5's entry states the per-vendor-pair requirement, the
      uncomputable-today state and why, and cites the
      ~2-effective-vote / 11%-recovery counter-evidence verbatim as the
      reason no aggregate form is ever permitted.
- [ ] Document the minimum sample size per metric below which p90-style
      and per-100-style figures are marked low-sample.

## T3 — companion-number and sigma-before-claim enforcement

- [ ] Add a report-linter check (new file under
      `skills/foreman/scripts/lib/`, e.g. `metrics-lint.sh`) that scans a
      generated report for every metric name it contains and fails if a
      metric's companion is not present in the same row/sentence.
- [ ] Add the sigma check: any sentence characterizing a metric as
      "improved," "regressed," "better," or "worse" between two releases
      must have an adjacent stated sigma value; fail otherwise.
- [ ] Add the smaller-than-sigma check: if both the delta and the sigma
      are numerically present, and the delta's absolute value is less
      than sigma, fail unless the report already states "not
      distinguishable from noise."
- [ ] Do NOT implement metric computation in this script — it lints
      already-rendered report text/data, it does not compute M1-M13 from
      raw events.

## T4 — gaming-detector

- [ ] For each metric in the reference doc (T2), the gaming-detector
      logic compares the metric's period-over-period move (in units of
      its own sigma) against its named companion's move; if the metric
      moves >1 sigma and the companion does not move correspondingly,
      mark gaming-candidate in the linter's output.
- [ ] The gaming-candidate flag is advisory (does not block publication
      by itself) but SHALL be visually distinct in any generated report
      and SHALL require an explicit manual annotation before the metric
      is cited in release notes.
- [ ] Document, per metric, what "moved correspondingly" means
      concretely (e.g. for M1/architect-share: both move up together is
      suspicious; M1 up with architect-share flat or down is not).

## T5 — M5 per-vendor-pair shape

- [ ] Specify the exact report shape for M5 once computable: one row per
      ordered (implementer-vendor, auditor-vendor) pair, each with its
      own sample size, never a collapsed aggregate.
- [ ] Specify the explicit uncomputable-state string the linter and any
      report generator must emit while `decision-lineage-and-telemetry`'s
      finding-level vendor provenance is absent.
- [ ] Add a linter check that a report may not omit or blank M5 silently
      — it must render one of: per-pair figures, or the
      uncomputable-state string.

## T6 — sigma methodology

- [ ] Document, per metric, the population sigma is measured over
      (repeated windows of unchanged code from `regression-harness-tiers`)
      and the minimum window count before a sigma is publishable.
- [ ] Add the "sigma not yet estimated (n=<k>, need n>=<threshold>)"
      state as the required output when sample size is insufficient.

## T7 — tests

- [ ] New `tests/release-metrics.bats`.
- [ ] Linter rejects a report with a metric and no adjacent companion.
- [ ] Linter accepts a report with metric + companion in the same
      row/sentence.
- [ ] Linter rejects an "improved"/"regressed" claim with no sigma
      stated.
- [ ] Linter rejects a claim whose stated delta is smaller than its
      stated sigma, unless the report already states the
      noise-indistinguishable language.
- [ ] Linter flags a metric as gaming-candidate when it moves >1 sigma
      without its companion corroborating, and does not flag it when the
      companion corroborates.
- [ ] Linter rejects a report that silently omits or blanks M5, and
      accepts one with the explicit uncomputable-state string.
- [ ] Declare preconditions via `tests/lib/preconditions.bash` per
      `test-infrastructure-hardening`'s helper.
- [ ] Full suite green on WSL/Ubuntu 26.04.
- [ ] Full suite green on Git-Bash/Windows.

## T8 — docs and gate

- [ ] `bugeventlog.md` entry recording that none of the release's
      comparative claims were computable before this package, with the
      grep evidence from T1.
- [ ] `SKILL.md` reporting section gains a pointer to
      `references/release-metrics.md` and states the companion-number
      and sigma-before-claim rules as standing doctrine, not just linter
      behavior.
- [ ] Docs gate: `markdownlint-cli2`, `codespell`, `lychee`.
- [ ] `openspec validate release-metrics --strict`.
