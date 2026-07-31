# REPORT — formal-model-suite, round 1

First coherent tranche: make the four existing Quint models runnable,
reproducible, and CI-wired. No git commit. No graphify.

## 1. Runner (reproducible, method-recorded, `^[violation]` anchor)

**Status:** DONE

**Artifact:** `formal/run-checks.sh`

- Resolves Quint via stable absolute path (`QUINT_BIN` or
  `~/.local/share/fnm/node-versions/.../bin/quint`); **refuses**
  `/run/user/*/fnm_multishells/*`.
- Pins Quint **0.32.0** and looks for Apalache **0.56.1**.
- Classifier maps checker output → `VIOLATED` / `HOLDS` / `ERROR` using only
  anchored lines `^\[violation\]` and `^\[ok\]`. Anything else is `ERROR`
  (never green).
- Records method + bound on every row (`simulation samples×steps` or
  `apalache depth=N`) and states HOLDS as “no counterexample within bound
  (not a proof)”.
- Bounds every model run with a wall-clock timeout; kills **owned PID /
  process group only** (see §5).
- Emits `formal/out/report.tsv` + `formal/out/report.json`.

**Commands:**

```text
bash formal/run-checks.sh --self-test
bash formal/run-checks.sh --tier commit
QUINT_BIN=/path/to/quint bash formal/run-checks.sh --tier schedule
```

## 2. Per-model expected outcomes (pin VIOLATE/PASS)

**Status:** DONE

**Artifact:** `formal/expectations.tsv` (committed; never regenerated from a run)

Gating commit-tier rows (architect-reproduced inventory):

| model | config | invariant | expected |
|---|---|---|---|
| eventlog_concurrency | main=toctou | mutual_exclusion | VIOLATED |
| eventlog_concurrency | main=toctou | seq_uniqueness | VIOLATED |
| eventlog_concurrency | main=atomic | mutual_exclusion | HOLDS |
| eventlog_concurrency | main=atomic | seq_uniqueness | HOLDS |
| audit_gate | main=pre_fix | no_stale_approved_merge | VIOLATED |
| audit_gate | main=pre_fix | no_unaudited_merge | VIOLATED |
| audit_gate | main=post_fix | no_stale_approved_merge | HOLDS |
| audit_gate | main=post_fix | no_unaudited_merge | HOLDS |
| audit_gate | main=uncapped_errors | audit_attempts_bounded_by_three | VIOLATED |
| audit_gate | main=capped_errors | audit_attempts_bounded_by_three | HOLDS |
| audit_gate | main=post_fix | no_unverified_checks_merge | VIOLATED |
| audit_gate | main=post_fix | no_unverified_docs_merge | VIOLATED |
| audit_gate | main=post_fix_full_binding | no_unverified_checks_merge | HOLDS |
| lane_lifecycle | init_prefix/step_prefix | inv_round_done_requires_fresh_report | VIOLATED |
| lane_lifecycle | init_prefix/step_prefix | inv_no_completion_from_exit_code | VIOLATED |
| lane_lifecycle | init_postfix/step_postfix_without_resume | inv_round_done_requires_fresh_report | HOLDS |
| lane_lifecycle | init_postfix/step_shipped_resume_bug | witness_shipped_resume_loses_round_ownership | REACHABLE |
| lane_lifecycle | init_postfix/step_postfix | witness_shipped_resume_loses_round_ownership | NOT_REACHABLE |
| lane_lifecycle | init_prefix/step_prefix_bug | inv_round_done_requires_fresh_report | VIOLATED |

Mismatch in **either** direction fails the suite:

- expected VIOLATED/REACHABLE, observed HOLDS → “model lost discriminating power”
- expected HOLDS/NOT_REACHABLE, observed VIOLATED → “regression in modelled fix”

Non-gating `unreproduced` rows record M2/M3 lane findings and M4 evidence_contract
(D1–D5) without failing commit CI unless `--all` is passed.

**Observed:** commit tier `run=19 matched=19 failures=0` (see
`formal/out/suite-commit-final.log`).

## 3. Vacuity reporting (VACUOUS vs holds)

**Status:** DONE

**Artifact:** `formal/vacuous-predicates.tsv`

Seeded entry:

| predicate | cannot answer | use instead |
|---|---|---|
| `rework_rounds_bounded` | UNVERIFIED-loop termination (round never advances) | `audit_attempts_bounded_by_three` |

Rules enforced by the runner:

- A gating manifest row that cites a registered vacuous predicate **fails**.
- The suite does **not** gate on `rework_rounds_bounded` for termination; it
  gates on `audit_attempts_bounded_by_three` under `uncapped_errors` /
  `capped_errors` (architect correction, ADDENDUM 2).
- Self-test logs: *if an invariant holds while its constrained state never
  advances, report VACUOUS not HOLDS*, with the seed case named.

Does **not** implement the separate `max_audit_attempts` product fix (owned by
`three-outcome-verdicts`); only the formal-plane registry and the correct
manifest property.

## 4. CI wiring (`.github/workflows/`)

**Status:** DONE

**Artifact:** `.github/workflows/formal.yml`

- Triggers: push/PR on `formal/**`, weekly schedule (Sunday), `workflow_dispatch`.
- Installs pinned Quint 0.32.0; runs `--self-test` then `--tier commit`
  (or schedule/all-tiers on cron/dispatch).
- Uploads `formal/out/report.{tsv,json}` and row logs as artifacts.

**Honest note:** **no CI job in this repo currently runs `bats` on any
platform.** This workflow is the first automated formal-model job; it does
**not** add a bats job. Local bats remains gated through
`flock /tmp/foreman-bats.lock`.

## 5. Kill policy (no `pkill -f` by pattern; PID/PGID only)

**Status:** DONE

Implemented in `formal/run-checks.sh`:

- `kill_owned_pid` / `cleanup_owned` (EXIT trap) terminate only recorded PIDs
  and their process groups (`setsid` children).
- `run_bounded` uses a sleep-based wall-clock watchdog on the owned child; on
  timeout SIGTERM then SIGKILL the **same** PGID/PID.
- **No `pkill`, no `pkill -f`, no pattern kill** anywhere under `formal/`.

## 6. Verification evidence (known-bad fail, known-clean pass, wrong grep, vacuous, non-zero exit, bounds)

**Status:** DONE

| Check | Observed |
|---|---|
| Known-violating fixture → VIOLATED | PASS (`formal/fixtures/classifier-violating.txt`, live `known-violating.out`) |
| Known-holding fixture → HOLDS | PASS (`classifier-holding.txt`, live `known-holding.out`) |
| Truncated / no anchor → ERROR | PASS (`classifier-truncated*.txt`) |
| Bare `grep "violation"` on `[ok] No violation found` is **WRONG** | PASS (self-test prints control OK; anchored classifier → HOLDS) |
| Vacuous seed registered; gating on `rework_rounds_bounded` refused | PASS (self-test) |
| Full commit suite | PASS: `19/19` matched, exit 0 |
| Expected HOLDS, model still violates (wrong expectation on toctou) | FAIL exit 1: “regression in modelled fix” |
| Expected VIOLATED, model holds (wrong expectation on atomic) | FAIL exit 1: “model lost discriminating power” |
| All four models typecheck under Quint 0.32.0 | PASS |
| Per-row timeout bound | 180s sim / 600s apalache |
| `openspec validate formal-model-suite --strict` | PASS (`/usr/local/bin/openspec`) |

Classifier fixtures live under `formal/fixtures/`. Runtime reports under
`formal/out/` (gitignored).

**Quoted final suite command:**

```text
QUINT_BIN=/root/.local/share/fnm/node-versions/v24.18.0/installation/bin/quint \
  bash formal/run-checks.sh --tier commit
# → SUITE PASSED  run=19 matched=19 skipped=17 failures=0
```

## 7. Deferred work (and why)

**Status:** DONE (recorded)

| Deferred | Why |
|---|---|
| New Quint models / pre-fix modules beyond the four existing files | BRIEF: first tranche only; “Defer anything requiring new models.” |
| Architect re-run of M4 evidence_contract as gating rows | VERIFY-quint-architect.md inventory is M1–M3 only; M4 rows are non-gating `M4-lane` / unreproduced until re-run |
| Architect re-run of M2 fail-open / compaction / NATS / nesting and M3 TOCTOU / WARNING / cross-vendor | Recorded as non-gating `unreproduced`; Apalache schedule tier only |
| Product fix for `max_audit_attempts` in three-outcome-verdicts | Explicitly out of package; formal plane only records the correct property |
| Product fixes for lock fail-open, resume payload, checks/docs hash binding | Owned by lock-primitive-hardening / round-ownership-default / three-outcome-verdicts |
| Full Apalache schedule tier green on this box in this session | Commit tier green; schedule rows require longer CI budget (workflow supports them) |
| bats CI job | None exists; out of formal-model-suite scope; not invented here |
| bugeventlog / markdownlint / codespell / lychee docs gate (T8 extras) | Round-1 tranche focused on runner+manifest+CI; can land with packaging polish |
| Marking all 47 openspec task checkboxes | Implementation matches T1–T7 intent; checkbox bookkeeping deferred to archive step |

## Files added/touched

| Path | Role |
|---|---|
| `formal/run-checks.sh` | Runner + classifier + controls |
| `formal/expectations.tsv` | Expectation manifest |
| `formal/vacuous-predicates.tsv` | Vacuity registry |
| `formal/coverage.tsv` | Model → source coverage |
| `formal/check-drift.sh` | Drift gate helper |
| `formal/fixtures/*` | Classifier positive/negative controls |
| `formal/specs/*.qnt` | Coverage headers only (models unchanged in logic) |
| `.github/workflows/formal.yml` | CI + schedule |
| `.gitignore` | ignore `formal/out/` |
| `REPORT.md` | This file |
