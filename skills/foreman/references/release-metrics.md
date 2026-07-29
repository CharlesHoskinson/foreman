# Release metrics reference

Single source of truth for Foreman release-metric **definitions and claim
discipline**. This document does **not** compute metrics; it names formulas,
upstream fields, companions, misreadings, gaming vectors, zero-denominator
strings, and minimum sample sizes for sigma / p90-style figures.

**Linter:** `skills/foreman/scripts/lib/metrics-lint.sh` enforces companion
adjacency, sigma-before-claim, smaller-than-sigma, uncomputable-render honesty,
zero-denominator guards, and the v0.2.9 active-set rules. Default mode is
**shadow** (report violations, exit 0); set `--mode enforce` or
`FOREMAN_METRICS_LINT_MODE=enforce` to fail the build.

**Upstream ownership:** event payload keys and emission sites belong to
`decision-lineage-and-telemetry` (partially landed on the
`decision-lineage-emission` branch this worktree is based on). Sigma windows
belong to `regression-harness-tiers`. M5 formula and per-pair shape belong
solely to `graph-eval-falsification`.

**Field inventory (this branch, verified):** see worktree `REPORT.md` § T1.
Usage numerics are often `source:"unavailable"` with keys omitted — never
treat absence as zero.

---

## Conventions

### Uncomputable strings (two distinct forms)

1. **Blocked input** (instrumentation missing or out of scope):
   `uncomputable -- <reason>, pending <package-or-mechanism>`
2. **Zero denominator** (instrument exists; population empty):
   `uncomputable -- zero denominator (<denominator name> = 0 over <window>)`

Neither is a pass, a target met, an improvement, or a zero. A blank cell, a
placeholder `0` / `0%` / `100%`, `n/a`, or an omitted row is **not** a valid
uncomputable render.

### Sigma and minimum sample size

Sigma for a metric is the standard deviation of that metric across **repeated
measurement windows of unchanged code** (from `regression-harness-tiers`).
Until enough windows exist, comparative language is forbidden and the report
must state:

`sigma not yet estimated (n=<k> windows, need n>=<threshold>)`

Per-metric thresholds are listed below. There is **no** single global n.

### v0.2.9 active set

| Status | Metrics |
|---|---|
| **Active** (may appear in a v0.2.9 report) | M2, M3, M4, M7, M8 |
| **Defined but excluded** | M1, M6 |
| **Owned elsewhere; not rendered in v0.2.9** | M5 (`graph-eval-falsification`) |
| **Deferred entirely** | M9, M10, M11, M12, M13 |

Of the five active metrics: M2 and M7 are computable from confirmed inputs
today; M8 uses a documented interim file basis for one input; M3 and M4 depend
on usage/phase fields that are **emitted but often partial or unavailable**.
A report **must not** describe the active set as "fully computed."

---

## M1 — first-pass gate rate

| | |
|---|---|
| **Formula** | tasks with `gate: pass` on round 1 ÷ tasks that reached round 1 |
| **Units** | percent (0–100) or fraction |
| **Denominator** | tasks that reached round 1 |
| **Upstream fields** | `round_done` (round/attempt identity); `gate_decision.payload.pass` (or interim `gate-decision.json.pass` joined by run dir) |
| **Companion** | architect-authored share of merged lines in the same window |
| **Companion upstream** | **NOT EMITTED** — no authorship instrumentation exists |
| **Misreading** | "a rising first-pass gate rate means the implementer model is improving." |
| **Gaming vector** | Architect hand-edits the bulk of a change so round 1 passes; companion share exposes the intervention. Typed companion field: `architect_authored_share` (lines). |
| **Zero denom** | `uncomputable -- zero denominator (tasks that reached round 1 = 0 over <window>)` |
| **Blocked render** | `uncomputable -- no architect-authored-share instrumentation scoped in this release` |
| **Min sample (sigma)** | n ≥ 20 windows before publishing sigma; p90-style not applicable (rate) |
| **v0.2.9** | **Excluded** from active set; citing a bare M1 value is rejected |

---

## M2 — rounds-to-green distribution

| | |
|---|---|
| **Formula** | three figures together, never fewer: **p50** rounds-to-green, **p90** rounds-to-green, **abandoned-task count** as a fraction of tasks started |
| **Units** | rounds (p50/p90); fraction or percent (abandoned) |
| **Denominator** | tasks started in the window |
| **Upstream fields** | `round_done` (round progression); `gate_decision.payload.pass` / `gate-decision.json.pass` (green); `alert` with abandonment/timeout kinds from `lane-supervise.sh` / `lane-run.sh` |
| **Companion** | the three figures **are** the companion structure — publishing p50 alone is incomplete; also render task-start count (sample size) |
| **Misreading** | "p50 = 1 means almost everything greened quickly" (hides a long tail and abandons) |
| **Gaming vector** | Manually abandon hard tasks before they inflate p90; companion abandoned rate + start count exposes the cull. Typed fields: `m2_p50`, `m2_p90`, `m2_abandoned_rate`, `tasks_started`. |
| **Zero denom** | `uncomputable -- zero denominator (tasks started = 0 over <window>)` |
| **Low-sample** | if abandoned count is 0 and tasks started &lt; 20, flag p90 and abandoned-rate as low-sample; no comparative claim from them alone |
| **Min sample (sigma / p90)** | n ≥ 20 task starts for p90; n ≥ 10 windows for sigma |
| **v0.2.9** | **Active**, computable today (file join for green) |

---

## M3 — cost per merged change (includes failed attempts)

| | |
|---|---|
| **Formula** | total token cost across **every** attempt of every task started in the window (including abandoned / gated-out) ÷ count of tasks that **merged** in that window |
| **Units** | currency (USD) or token-cost units per merge |
| **Denominator** | tasks that merged in the window |
| **Upstream fields** | nested `payload.usage` on `round_done` and `audit_verdict` — keys `cost_usd`, `input_tokens`, `output_tokens`, `cached_tokens`, `source`, `vendor`, `model`; merge signal is out-of-band (PR/merge record) not yet an event |
| **Unavailable handling** | when `usage.source == "unavailable"`, numerics are **absent**. Do not treat as `$0`. Window cost is partial; report must state share of attempts with `vendor_reported` vs `unavailable` |
| **Companion** | count and cost share of **non-merging** attempts in the same window |
| **Misreading** | "cost per merged change measures efficiency of the winning attempt." |
| **Gaming vector** | Drop failed-attempt costs (publish M3-optimistic as M3); companion non-merging share catches it. Typed fields: `m3_total_cost`, `m3_non_merging_attempt_count`, `m3_non_merging_cost_share`, `usage_unavailable_share`. |
| **Zero denom** | `uncomputable -- zero denominator (tasks that merged = 0 over <window>)` |
| **If only winning-attempt cost** | label `M3-optimistic`; must **not** be published as M3 |
| **Min sample (sigma)** | n ≥ 10 merged tasks and n ≥ 10 windows; require ≥ 50% of attempts with non-unavailable usage before a comparative claim |
| **v0.2.9** | **Active**; may still render blocked/partial if a window has no usable cost fields |

**Note (T1 re-baseline):** usage payloads **are** emitted on this branch. The
older design string claiming "no usage/cost telemetry in events.jsonl schema
v2" is obsolete for emission presence; honesty now concerns
**unavailable** rates and missing merge events, not total absence of the
field.

---

## M4 — wall-clock split by phase

| | |
|---|---|
| **Formula** | per-task wall clock into five buckets: `queue`, `implement`, `audit`, `gate`, `unaccounted` (five MECE; four named phases alone are not exhaustive) |
| **Units** | seconds or minutes; report share of total |
| **Denominator** | tasks with recorded phase timing |
| **Upstream fields** | `round_done.payload.phases.implement_s` (always); `.queue_wait_s` (when queued); `.gate_s` (`--round` mode); `audit_verdict.payload.duration_s` (audit phase — separate event, join by run/lane); total wall clock not a single field — must be derived |
| **Missing** | no `phases.audit_s` on `round_done`; no emitted `unaccounted`; no single five-bucket rollup |
| **Companion** | explicit `unaccounted` bucket value (and total wall clock) |
| **Misreading** | "phase shares sum to 100% of productive work" without showing unaccounted |
| **Gaming vector** | Fold idle/unaccounted time into implement so implement looks dominant; companion unaccounted exposes the fold. Typed fields: `m4_queue_s`, `m4_implement_s`, `m4_audit_s`, `m4_gate_s`, `m4_unaccounted_s`. |
| **Zero denom** | `uncomputable -- zero denominator (tasks with recorded phase timing = 0 over <window>)` |
| **Min sample (sigma)** | n ≥ 10 tasks with full four named phases present; n ≥ 10 windows |
| **v0.2.9** | **Active**; may render incomplete/uncomputable when join cannot form five buckets |

---

## M5 — cross-vendor auditor unique-catch rate (pointer only)

**Not defined here.** Sole owner: `graph-eval-falsification` evaluation spec
(formula, per-vendor-pair shape, threshold).

- This package **must not** restate the formula.
- **v0.2.9:** M5 is **not computed or cited** in any release-metrics report.
- **Why no aggregate form is ever permitted:** counter-evidence shows ~2
  effective independent votes across nine frontier models / seven families,
  with aggregation recovering at most ~11% of an 8–22 pp deficit. A collapsed
  aggregate would erase the differentiation the multi-vendor design must
  prove or refute.
- When a future release renders M5, companion-number and sigma-before-claim
  still apply, citing `graph-eval-falsification` field names verbatim.
- **Independence claims:** in v0.2.9, any claim that cross-vendor auditing
  found defects a single vendor would have missed is rejected (M5 not
  rendered). Later, such a claim must cite measured **per-pair** M5, never a
  collapsed aggregate.

---

## M6 — escaped-defect rate per 1k merged lines

| | |
|---|---|
| **Formula** | escaped defects (post-merge bugs/reverts/hotfixes attributable to a change) per 1,000 merged lines, fixed trailing **14-day** window from each merge |
| **Units** | defects / 1k lines |
| **Denominator** | merged lines whose 14-day window has completed (exclude younger merges entirely) |
| **Upstream fields** | **NOT EMITTED** — no mechanical defect→merge linkage |
| **Companion** | absolute escaped-defect count and merged-line count for the window |
| **Misreading** | "zero escaped defects means the release was clean" when the window or linkage is empty |
| **Gaming vector** | Attribute defects to "infra" so they fall out of numerator; typed companion: defect→commit map integrity. |
| **Zero denom** | `uncomputable -- zero denominator (merged lines with completed 14-day window = 0 over <window>)` |
| **Blocked render** | `uncomputable -- no defect-to-merge linkage mechanism` |
| **Min sample (sigma)** | n ≥ 5 completed 14-day windows; n ≥ 10k merged lines in the rate base |
| **v0.2.9** | **Excluded** |

---

## M7 — lane mortality per 100 lane-starts

| | |
|---|---|
| **Formula** | lanes that terminate without a gate decision (crash/orphan/kill/timeout/abandon classes) ÷ total lane starts × 100 |
| **Units** | per 100 lane-starts |
| **Denominator** | lane starts in the window |
| **Upstream fields** | **numerator:** `alert` kinds from `lane-run.sh` (`worker_timeout`, `worker_launcher_error`, `ownership_timeout`, `degraded`/`launcher_absent`, `round_incomplete`, …) and `lane-supervise.sh` (`abandoned`); **denominator:** `ownership` events (lane claims work) |
| **Companion** | total lane starts (denominator) **and** count of maintainer-initiated terminations (cancel/abandon) vs unattended (crash/orphan/timeout) |
| **Misreading** | "lane mortality measures how fragile the orchestration layer is." (includes intentional cancels and tightened timeouts) |
| **Gaming vector** | Tighten timeouts to "fail fast," inflating mortality while improving ops; companion maintainer-initiated share + start count shows the trade. Typed fields: `m7_per_100`, `lane_starts`, `maintainer_initiated_terminations`, `unattended_terminations`. |
| **Zero denom** | `uncomputable -- zero denominator (lane starts = 0 over <window>)` |
| **Min sample (sigma)** | n ≥ 20 lane starts per window; n ≥ 10 windows |
| **v0.2.9** | **Active**, computable today |

---

## M8 — evidence completeness

| | |
|---|---|
| **Formula** | gate decisions whose required evidence artifacts are present and schema-valid ÷ all gate decisions |
| **Units** | percent |
| **Denominator** | gate decisions in the window |
| **Upstream fields** | `audit-verdict.json` presence + `.verdict` schema; diff content hash; `round_done` in `events.jsonl`; `gate_decision` event **or interim** `gate-decision.json` |
| **Interim basis** | until every gate path always has a `gate_decision` event, the file `gate-decision.json` is a documented substitute; the report **must state** which basis was used |
| **Companion** | total gate-decision count **and** share satisfied by interim file basis vs event |
| **Misreading** | "high evidence completeness means the audits were thorough." (M8 is artifact presence/schema only) |
| **Gaming vector** | Emit empty-but-valid `{"verdict":"APPROVED","findings":[],"summary":""}`; companion does not catch substance — human review of finding density is separate; typed fields: `m8_rate`, `gate_decisions`, `interim_basis_share`. |
| **Zero denom** | `uncomputable -- zero denominator (gate decisions = 0 over <window>)` |
| **Min sample (sigma)** | n ≥ 20 gate decisions; n ≥ 10 windows |
| **v0.2.9** | **Active** on interim basis |

---

## M9 — verdict distribution (deferred)

| | |
|---|---|
| **Formula** | share of audit verdicts in {APPROVED, WARNING, BLOCKED, UNVERIFIED} over the window |
| **Upstream fields** | `audit_verdict.payload.verdict` |
| **Companion** | absolute counts per verdict class |
| **Misreading** | "more APPROVED means quality improved" (may mean weaker auditors) |
| **Gaming vector** | Soften auditor prompt; companion UNVERIFIED/BLOCKED rates and finding density. |
| **Zero denom** | `uncomputable -- zero denominator (audit verdicts = 0 over <window>)` |
| **Min sample (sigma)** | n ≥ 30 verdicts; n ≥ 10 windows |
| **v0.2.9** | **Deferred** — must not compute or cite |

---

## M10 — auditor–architect agreement (Cohen's κ) (deferred)

| | |
|---|---|
| **Formula** | Cohen's κ between auditor verdict classes and architect ship decision over the window |
| **Upstream fields** | `audit_verdict.payload.verdict`; architect decision is **not yet a structured event** (gap) |
| **Companion** | raw agreement rate and marginal distributions |
| **Misreading** | "high κ means audits are redundant" |
| **Gaming vector** | Architect rubber-stamps auditor; companion disagreement cases list. |
| **Zero denom** | `uncomputable -- zero denominator (paired verdict–decision cases = 0 over <window>)` |
| **Min sample (sigma)** | n ≥ 30 pairs; n ≥ 10 windows |
| **v0.2.9** | **Deferred** |

---

## M11 — flake rate (deferred)

| | |
|---|---|
| **Formula** | checks that flip pass/fail on rerun without code change ÷ checks run |
| **Upstream fields** | independent check results (`checks-result.json`); no dedicated flake event yet |
| **Companion** | absolute flake count and check volume |
| **Misreading** | "low flake means tests are good" (may mean tests are shallow) |
| **Gaming vector** | Delete flaky tests; companion test-count delta. |
| **Zero denom** | `uncomputable -- zero denominator (checks run = 0 over <window>)` |
| **Min sample (sigma)** | n ≥ 50 check runs; n ≥ 10 windows |
| **v0.2.9** | **Deferred** |

---

## M12 — budget consumed vs declared (deferred)

| | |
|---|---|
| **Formula** | actual usage cost ÷ declared task/lane budget |
| **Upstream fields** | nested `usage.cost_usd` / tokens; declared budget **not yet a standard event field** |
| **Companion** | absolute overage count and unavailable-usage share |
| **Misreading** | "under budget means efficient" when usage is mostly unavailable |
| **Gaming vector** | Inflate declared budgets; companion budget-revision count. |
| **Zero denom** | `uncomputable -- zero denominator (tasks with declared budget = 0 over <window>)` |
| **Min sample (sigma)** | n ≥ 10 budgeted tasks with vendor_reported usage; n ≥ 10 windows |
| **v0.2.9** | **Deferred** |

---

## M13 — prediction-hold rate (deferred)

| | |
|---|---|
| **Formula** | architect predictions (effort, risk, round count) that hold at merge ÷ predictions made |
| **Upstream fields** | **NOT EMITTED** — no prediction event |
| **Companion** | absolute prediction count and miss reasons |
| **Misreading** | "high hold rate means planning is accurate" under self-selected easy tasks |
| **Gaming vector** | Only record predictions on easy work; companion task-difficulty mix. |
| **Zero denom** | `uncomputable -- zero denominator (predictions made = 0 over <window>)` |
| **Blocked** | `uncomputable -- no prediction instrumentation` |
| **Min sample (sigma)** | n ≥ 20 predictions; n ≥ 10 windows |
| **v0.2.9** | **Deferred** |

---

## Claim discipline (standing rules)

1. **Companion number** — a metric value may not be published without its
   companion in the same row or sentence. Uncomputable renders need no
   companion value (the uncomputable string + named blocker/empty population
   satisfies the rule).
2. **Sigma before claim** — any sentence characterising a metric as improved /
   regressed / better / worse must state that metric's sigma. Until sigma is
   estimated, state `sigma not yet estimated (n=<k>, need n>=<threshold>)` and
   do not use comparative language.
3. **Smaller than sigma** — if |delta| &lt; sigma, the report must say the delta
   is not distinguishable from noise; it must not claim improvement/regression.
4. **Uncomputable is not a result** — a metric showing its uncomputable
   placeholder must not be described as a pass, result, success, or target met.
5. **Zero denominator is not a pass** — never render empty populations as 0 /
   0% / 100%; never let them satisfy a threshold or enter aggregates as zero.
6. **No automated gaming classification** — moves &gt;1σ flag human review with
   companion shown; the linter never labels gaming vs legitimate.
7. **Blocked-input honesty** — a blocked uncomputable string must name a
   package under `openspec/changes/` that still exists (not archived/landed).
   Naming a landed or fictional blocker is a lint failure.

---

## Minimum sample size summary

| Metric | Per-window population floor | Windows for publishable sigma |
|---|---|---|
| M1 | 20 tasks reaching round 1 | 20 |
| M2 | 20 task starts (p90); flag if abandoned=0 and starts&lt;20 | 10 |
| M3 | 10 merges; ≥50% attempts with non-unavailable usage | 10 |
| M4 | 10 tasks with four named phases present | 10 |
| M6 | 10k lines with completed 14-day window | 5 completed windows |
| M7 | 20 lane starts | 10 |
| M8 | 20 gate decisions | 10 |
| M9–M13 | see per-metric rows | 10 (typical) |

Below these floors, figures are **low-sample** and must not support comparative
claims alone.
