# REPORT — release-metrics round 1 (T1 re-baselined, T2, T3)

## T1 — emission re-baseline and field inventory
**DONE** (2026-07-29)

### Premise inversion confirmed
This worktree is based on `s4/decision-lineage-emission` (`8b9b8e8`). The
original `tasks.md` T1 stop-if-emissions-exist condition is **deliberately
false**. Emissions are present. Work continued.

### `el_emit` call sites (were "zero" in original T1 — now non-zero)

| Script | Types emitted | Evidence |
|---|---|---|
| `gate-eval.sh:111` | `gate_decision` | `rg -n 'el_emit' skills/foreman/scripts/gate-eval.sh` |
| `audit-run.sh:186,211` | `audit_verdict`, one `finding` per finding | `rg -n 'el_emit' skills/foreman/scripts/audit-run.sh` |
| `lane-run.sh` | `prompt`, `heartbeat`, `checkpoint`, `ownership`, `state`, `waiting_child`, `round_done` (with nested `usage` + `phases`), `alert` | code read |
| `lib/telemetry.sh` | helpers; `tl_emit_finding_outcome` → `finding_outcome` | code read |

### Fields verified present (name and shape)

| Field / path | Event / site | Shape |
|---|---|---|
| `payload.pass` | `gate_decision` | boolean |
| `payload.reasons` | `gate_decision` | string array |
| `payload.base`, `payload.head` | `gate_decision` | sha strings |
| `payload.inputs_evaluated` | `gate_decision` | string array |
| `payload.verdict` | `audit_verdict` | APPROVED/WARNING/BLOCKED/UNVERIFIED |
| `payload.vendor`, `payload.model`, `payload.effort` | `audit_verdict` | strings |
| `payload.duration_s` | `audit_verdict` | number (audit wall seconds) |
| `payload.usage` | nested on `audit_verdict` and `round_done` | see usage block |
| `payload.evidence.diff_sha256`, `.base_sha`, `.head_sha` | `audit_verdict` | strings/null |
| `payload.model_identity.requested_alias`, `.cli_version` | `audit_verdict` / `prompt` | strings/null |
| `payload.id`, `.source`, `.severity`, `.file`, `.line`, `.upheld` | `finding` | id hex; upheld null at emit |
| `payload.usage.vendor`, `.model`, `.source` | usage block | always present |
| `payload.usage.effort` | usage block | optional |
| `payload.usage.input_tokens`, `.output_tokens`, `.cached_tokens`, `.cost_usd` | usage block | **omitted when source=unavailable** (never zero) |
| `payload.phases.implement_s` | `round_done` | number (always) |
| `payload.phases.queue_wait_s` | `round_done` / `prompt` | number when `LANE_QUEUED_AT` set |
| `payload.phases.gate_s` | `round_done` | number in `--round` mode after gate |
| `alert` kinds | `lane-run` / `lane-supervise` | worker_timeout, abandoned, ownership_timeout, degraded, round_incomplete, … |
| `ownership` | `lane-run` | lane-start denominator for M7 |
| `round_done` | `lane-run` | green join via gate decision |

**Observed usage-block samples (this host):**

```text
$ bash -c 'source …/telemetry.sh; tl_usage_block grok grok-4.5 "" unavailable'
{"vendor":"grok","model":"grok-4.5","source":"unavailable"}

$ bash -c '… tl_usage_block codex gpt-5.6-sol medium vendor_reported 10 5 1 0.02'
{"vendor":"codex","model":"gpt-5.6-sol","source":"vendor_reported","effort":"medium",
 "input_tokens":10,"output_tokens":5,"cached_tokens":1,"cost_usd":0.02}
```

### Fields that are `unavailable`-capable (must not be treated as zero)

| Vendor | Usage reporting | Metric implication |
|---|---|---|
| grok | often `source:"unavailable"` | M3 must omit or mark partial, never cost=0 |
| codex | sometimes vendor_reported; default often unavailable | same |
| claude | no harness-facing usage channel → unavailable | same |

### Fields needed by metric defs that are NOT emitted / incomplete

| Need | Status | Metric impact |
|---|---|---|
| architect-authored share of merged lines | **NOT emitted** | M1 blocked (excluded from v0.2.9 active set) |
| defect→merge linkage | **NOT emitted** | M6 blocked (excluded) |
| `payload.phases.audit_s` on `round_done` | **NOT present** — audit time on `audit_verdict.duration_s` only | M4 join incomplete; `unaccounted` never emitted |
| `metrics.json` rollup | **not produced** | consumers read `events.jsonl` |
| sigma / repeated-window variance | **not measured** | all comparative claims blocked |

### No existing metric computer (half of original T1 that still stands)

```text
$ rg -n 'first-pass|rounds-to-green|cost.per.merged|lane.mortality|evidence.completeness|release.metric' \
    skills/foreman/scripts -g '*.sh'
(none)
```

### decision-events.bats
Queued behind host-wide `flock /tmp/foreman-bats.lock` (s1-lock lane held
the lock for a full suite for >10 min). Field inventory rests on static
inspection + `tl_usage_block` live samples above. Linter verification used
the standalone harness (no bats lock required).

## T2 — release-metrics.md reference
**DONE**

Created `skills/foreman/references/release-metrics.md`:

- M1–M4, M6–M13 fully defined (formula, units, denominator, upstream fields,
  companion, misreading, gaming vector + typed companion field, zero-denom
  string, min sample / sigma thresholds, v0.2.9 status)
- M5 is a **pointer only** to `graph-eval-falsification` (no local formula)
- Documents unavailable handling for usage numerics
- Claim-discipline standing rules and min-sample summary table
- SKILL.md + references/index.md point at it

## T3 — report linter (lib + CLI)
**DONE**

New file: `skills/foreman/scripts/lib/metrics-lint.sh`

```text
metrics-lint.sh [--mode shadow|enforce] [--version VERSION] REPORT_FILE
# default mode: shadow (D7)
# Env: FOREMAN_METRICS_LINT_MODE, FOREMAN_METRICS_REPORT_VERSION, FOREMAN_REPO_ROOT
```

Rules implemented: companion, sigma-missing, smaller-than-sigma,
uncomputable-result, zero-denom-pass/shape/claim, deferred metrics,
independence claim, fully-computed language, blocker package existence,
human-review flag for >sigma moves (no auto gaming label).

Does **not** compute metrics from events — lints rendered text only.

## D7/D9 — shadow/enforce switch and dogfood
**DONE**

- Default `ML_MODE=shadow` (also `FOREMAN_METRICS_LINT_MODE`)
- Shadow: prints violations, exit 0
- Enforce: prints violations, exit 1
- Observed (see V7): shadow on known-bad companion case exits 0 with
  `[companion]` named; enforce exits 1
- Dogfood path: run the linter against any release report text; this round's
  own verification fixtures exercise the same rules that will gate future
  project reports once ten clean shadow runs are recorded

## Verification 1 — metric without companion fails
**DONE — observed FAIL**

```text
$ bash skills/foreman/scripts/lib/metrics-lint.sh --mode enforce /tmp/v1.md
# input: M7: 6 per 100 lane-starts
metrics-lint: 1 violation(s) mode=enforce version=v0.2.9
  VIOLATION: [companion] M7 reported without required companion in the same row/sentence: M7: 6 per 100 lane-starts
exit:1
```

## Verification 2 — improvement claim with no sigma fails
**DONE — observed FAIL**

```text
# input: M7 improved from 8 to 6 per 100 … (companions present, no sigma)
metrics-lint: 1 violation(s) mode=enforce version=v0.2.9
  VIOLATION: [sigma-missing] M7 comparative claim (improved/regressed/better/worse) without stated sigma: M7 improved from 8 to 6 per 100 lane-starts (lane starts: 50; maintainer-initiated: 2; unattended: 1).
exit:1
```

## Verification 3 — delta smaller than sigma fails
**DONE — observed FAIL**

```text
# input: M7 improved 2 … (sigma=5)
metrics-lint: 1 violation(s) mode=enforce version=v0.2.9
  VIOLATION: [smaller-than-sigma] M7 |delta|=2 < sigma=5 described as improvement/regression without noise language: M7 improved 2 per 100 lane-starts (sigma=5) (lane starts: 50; maintainer-initiated: 1; unattended: 2).
exit:1
```

## Verification 4 — uncomputable placeholder as result fails
**DONE — observed FAIL**

```text
# input: M3 uncomputable …; this is described as a result of the release.
metrics-lint: 1 violation(s) mode=enforce version=v0.2.9
  VIOLATION: [uncomputable-result] M3 uncomputable placeholder described as a result/pass: M3 uncomputable -- no usable cost fields; this is described as a result of the release.
exit:1
```

## Verification 5 — zero-denominator as pass fails
**DONE — observed FAIL**

```text
# input: M7 uncomputable -- zero denominator (lane starts = 0 over 2026-07); presented as a pass …
metrics-lint: 1 violation(s) mode=enforce version=v0.2.9
  VIOLATION: [zero-denom-pass] M7 zero-denominator uncomputable presented as a pass/result: M7 uncomputable -- zero denominator (lane starts = 0 over 2026-07); presented as a pass for reliability.
exit:1
```

## Verification 6 — correct report passes
**DONE — observed PASS**

```text
metrics-lint: OK (0 violations) mode=enforce version=v0.2.9
exit:0
```

Correct fixture: M2 (p50+p90+abandoned), M7+companions, M8+companions,
M3/M4 uncomputable pending open package `decision-lineage-and-telemetry`,
explicit "not fully computed", no comparative claims.

## Verification 7 — shadow reports but exit 0; enforce non-zero
**DONE — observed**

```text
$ bash …/metrics-lint.sh --mode shadow /tmp/v1.md
metrics-lint: 1 violation(s) mode=shadow version=v0.2.9
  VIOLATION: [companion] M7 reported without required companion …
metrics-lint: shadow mode — violations reported, exit 0
exit:0

$ bash …/metrics-lint.sh --mode enforce /tmp/v1.md
… same VIOLATION …
exit:1
```

## Verification 8 — harness exits non-zero on any case fail
**DONE — observed**

```text
$ bash tests/release-metrics-harness.sh
PASS: V1 companion (exit=1)
PASS: V2 sigma-missing (exit=1)
PASS: V3 smaller-than-sigma (exit=1)
PASS: V4 uncomputable-result (exit=1)
PASS: V5 zero-denom-pass (exit=1)
PASS: V6 correct (exit=0)
PASS: V7 shadow exit 0 with violations
injected mismatch: known-bad exited 1 but mini-harness required 0
PASS: V8 harness exits non-zero when a case fails (injected mismatch ec=1)
----
release-metrics-harness: 8 passed, 0 failed
harness_exit:0
```

V8 injects a mini-harness that wrongly requires exit 0 on known-bad input;
that mini-harness exits 1 — proving the harness failure path is non-zero.
Also: `tests/release-metrics.bats` exists for the flock-gated bats path
(blocked this session by concurrent s1-lock full suite on
`/tmp/foreman-bats.lock`).

## Verification 9 — shellcheck clean
**DONE — observed PASS**

```text
$ shellcheck -x skills/foreman/scripts/lib/metrics-lint.sh tests/release-metrics-harness.sh
sc:0
```

## Other

- `/usr/local/bin/openspec validate release-metrics --strict` → Change
  `release-metrics` is valid
- No git commit (per brief)
- No graphify (per brief)
- Files added/changed:
  - `REPORT.md` (this file)
  - `skills/foreman/references/release-metrics.md`
  - `skills/foreman/scripts/lib/metrics-lint.sh`
  - `tests/release-metrics.bats`
  - `tests/release-metrics-harness.sh`
  - `skills/foreman/SKILL.md` (reporting section + reference pointer)
  - `skills/foreman/references/index.md` (table row)
