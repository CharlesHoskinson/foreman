# Tasks — release-metrics

Ordering: T1 is the premise check. T2 is the reference doc and is the
dependency for everything after it. T3-T5 can proceed in parallel once
T2's shape is fixed. T6-T7 depend on T2-T5. T8 gates.

Scope note, per the 2026-07-28 proportionality review: **M5 is owned and
defined by `graph-eval-falsification`, not by this package**, and the
automated gaming-direction inference is **cut**. No task below may define an
M5 formula, an M5 report shape, or an automated gaming classifier; where a
task previously did, it now specifies the consumption discipline and the
human-review flag the spec retained.

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

- [x] Create `skills/foreman/references/release-metrics.md` defining
      M1-M4 and M6-M13: exact formula, units, the named denominator, the
      documented misreading in one sentence, the required companion number
      and how it is computed, and at least one concrete gaming vector with
      the typed companion field a human reviewer checks. M5 is NOT defined
      here.
- [x] For each metric, name the exact upstream field(s) it reads
      (`decision-lineage-and-telemetry`'s event names / `metrics.json`
      keys) or state explicitly that the field does not exist yet and
      the metric is therefore pending.
- [x] M5's entry is a pointer, not a definition: it names
      `graph-eval-falsification`'s evaluation spec as the sole owner of M5's
      formula, per-vendor-pair shape and threshold, records that M5 is not
      computed or cited in a v0.2.9 report at all, and cites the
      ~2-effective-vote / 11%-recovery counter-evidence as the reason no
      aggregate form is ever permitted. It SHALL NOT restate the formula.
- [x] Document the minimum sample size per metric below which p90-style
      and per-100-style figures are marked low-sample, and the metric's
      zero-denominator behaviour: the exact
      `uncomputable -- zero denominator (<denominator name> = 0 over
      <window>)` string, distinct from the blocked-input uncomputable
      string.

## T3 — companion-number and sigma-before-claim enforcement

- [x] Add a report-linter check (new file under
      `skills/foreman/scripts/lib/`, e.g. `metrics-lint.sh`) that scans a
      generated report for every metric name it contains and fails if a
      metric's companion is not present in the same row/sentence.
- [x] Add the sigma check: any sentence characterizing a metric as
      "improved," "regressed," "better," or "worse" between two releases
      must have an adjacent stated sigma value; fail otherwise.
- [x] Add the smaller-than-sigma check: if both the delta and the sigma
      are numerically present, and the delta's absolute value is less
      than sigma, fail unless the report already states "not
      distinguishable from noise."
- [ ] Add the uncomputable-render checks: a metric rendering its
      uncomputable string satisfies the companion rule (no companion is
      required because no value is claimed), while a blank cell, a
      placeholder zero or an omitted row does not; a zero-denominator
      render must name the empty population; a blocked-input render must
      name a blocking package that exists under `openspec/changes/` and has
      not landed, and is rejected otherwise.
- [ ] Add the zero-denominator guard: a metric rendered zero-denominator
      uncomputable may not satisfy a threshold, carry a comparative claim,
      or enter an aggregate or period-over-period delta as zero.
- [x] Reject any statement describing the v0.2.9 active set as "fully
      computed": M3 and M4 render uncomputable and M8 uses an interim basis
      for one input.
- [x] Do NOT implement metric computation in this script — it lints
      already-rendered report text/data, it does not compute the metrics
      from raw events.

## T4 — gaming exposure: typed companion field and human review

The automated directional-corroboration inference is **cut** by the
2026-07-28 proportionality review: it was itself an unvalidated predicate
with no positive control distinguishing real gaming from coincidental
correlated movement. What remains is the typed companion field and a
human-review flag.

- [ ] For each metric in the reference doc (T2), document at least one
      concrete way an actor (architect, implementer or auditor) could move
      the metric without the underlying release quality changing, and name
      the **typed companion field** a human reviewer checks when
      investigating that risk.
- [x] The linter flags a metric for human review when its reported value
      moves by more than its measured sigma between consecutive windows,
      rendering the companion value alongside it. The flag is advisory, is
      visually distinct, and requires an explicit manual annotation before
      the metric is cited in release notes.
- [x] The linter SHALL NOT auto-classify a flagged move as gaming or as
      legitimate, and SHALL NOT compute a directional-corroboration verdict
      from the companion's movement.

## T5 — M5 consumption discipline (no local definition)

- [x] Do NOT specify an M5 report shape, formula or threshold here.
      `graph-eval-falsification` owns all three; this package cites its
      field names verbatim where it consumes them.
- [x] Add the v0.2.9 linter rule: a report that computes or cites M5 — or
      M1, M6, or any of M9-M13 — is rejected, naming the metric and the
      deferral.
- [x] Add the independence-claim rule with both of its known-bad inputs: a
      v0.2.9 report asserting cross-vendor independence is rejected naming
      M5 as not rendered in this release; from the release in which M5
      becomes computable, a claim citing a collapsed aggregate rather than
      a per-pair M5 is rejected.

## T6 — sigma methodology

- [x] Document, per metric, the population sigma is measured over
      (repeated windows of unchanged code from `regression-harness-tiers`)
      and the minimum window count before a sigma is publishable.
- [x] Add the "sigma not yet estimated (n=<k>, need n>=<threshold>)"
      state as the required output when sample size is insufficient.

## T7 — tests

- [x] New `tests/release-metrics.bats`.
- [x] Linter rejects a report with a metric and no adjacent companion.
- [x] Linter accepts a report with metric + companion in the same
      row/sentence.
- [x] Linter rejects an "improved"/"regressed" claim with no sigma
      stated.
- [x] Linter rejects a claim whose stated delta is smaller than its
      stated sigma, unless the report already states the
      noise-indistinguishable language.
- [x] Linter flags a metric for human review when it moves >1 sigma
      between consecutive windows, renders its companion alongside, and
      does not auto-classify the move as gaming or as legitimate.
- [x] Linter rejects a v0.2.9 report that computes or cites M5, M1, M6 or
      any of M9-M13.
- [x] Linter rejects a v0.2.9 report asserting cross-vendor independence,
      naming M5 as not rendered in this release.
- [ ] Linter accepts a metric rendering an uncomputable-state string with
      no companion, and rejects a blank cell, a placeholder zero, or an
      omitted row in its place.
- [ ] Linter renders a zero-denominator metric as
      `uncomputable -- zero denominator (...)`, rejects a `0`/`0%`/`100%`
      render for the same window, and rejects a comparative claim built on
      it.
- [x] Linter rejects an uncomputable render naming a blocking package that
      does not exist under `openspec/changes/` or that has already landed.
- [x] Linter rejects a report describing the v0.2.9 active set as "fully
      computed".
- [ ] Declare preconditions via `tests/lib/preconditions.bash` per
      `test-infrastructure-hardening`'s helper.
- [ ] Full suite green on WSL/Ubuntu 26.04.
- [ ] Full suite green on Git-Bash/Windows.

## T8 — docs and gate

- [ ] `bugeventlog.md` entry recording that none of the release's
      comparative claims were computable before this package, with the
      grep evidence from T1.
- [x] `SKILL.md` reporting section gains a pointer to
      `references/release-metrics.md` and states the companion-number
      and sigma-before-claim rules as standing doctrine, not just linter
      behavior.
- [ ] Docs gate: `markdownlint-cli2`, `codespell`, `lychee`.
- [x] `openspec validate release-metrics --strict`.
