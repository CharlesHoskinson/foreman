# Spec delta — workload-fit accounting

EARS-phrased. See `skills/foreman/references/five-part-spec.md`.

## ADDED Requirements

### Requirement: the architect declares an up-front fit estimate and warns on poor cost-fit, seeding the fit ledger

The architect SHALL declare a `## Meta` line `fit: discovery_fraction: high |
medium | low` at task start, estimating what fraction of the workload will
be empirical discovery versus determinable implementation. WHEN
`discovery_fraction` is declared `high`, the architect SHALL WARN the
operator — "poor cost-fit: this workload is mostly empirical discovery; the
expensive lane will dominate; grok offload will be small" — and SHALL
obtain an explicit proceed before continuing.

- The declaration SHALL be appended as the FIRST record of the run's fit
  ledger, `$RD/fit.jsonl`: `{"phase":"estimate","discovery_fraction":
  "high"}` (or `"medium"`/`"low"`) — so the ledger exists from run start and
  the post-run report can be compared against the up-front estimate.

#### Scenario: a high discovery_fraction estimate triggers an up-front warning and seeds the ledger

- WHEN the architect declares `fit: discovery_fraction: high` for a task
- THEN foreman warns the operator that cost-fit is poor and grok offload
  will be small
- AND the operator's explicit proceed is obtained before the task continues
- AND `$RD/fit.jsonl` gains its first line,
  `{"phase":"estimate","discovery_fraction":"high"}`.

### Requirement: foreman-fit-report reads the fit ledger — NOT the event log — and emits a discovery-vs-offload split with a poor-fit verdict

`foreman-fit-report.sh RUN_ID` SHALL read the run's **fit ledger**
(`$RD/fit.jsonl`, one JSON object per line; `phase` ∈ `estimate | discover |
implement`; `discover`/`implement` records carry `lane` and optional
`weight`, default 1). It SHALL NOT read the event log for discovery
accounting: agent-dispatched lanes (`foreman-discover`, `foreman-search`,
`foreman-plan`) emit ZERO `el_emit` entries — `el_emit` is called only by
host-side scripts (`lane-run.sh`, `lane-supervise.sh`, `resume.sh`,
`watch.sh`, `worker-run.sh`) — so a report reading the event log's `lane`
field for a discovery label would find nothing and mis-report a
discovery-heavy run as *good* fit, the inverse of its purpose.

- The report SHALL tally `weight` (default 1) grouped by `phase`: `discover`
  → discovery (expensive lane), `implement` → offload. Where an `implement`
  record reflects real grok/codex lane activity, the canonical label SHALL
  be **`worker-grok`** (`worker-run.sh`: `LANE="worker-$VENDOR"`) /
  `worker-codex` — never the illustrative `grok:1`.
- The report SHALL print exactly: `foreman-fit report RUN_ID=<id>
  discovery=<d> offload=<o> offload_fraction=<p>% fit_verdict=<good|poor>`,
  where `offload_fraction = round(100*offload/(discovery+offload))` (0 when
  the denominator is 0) and `fit_verdict=poor` WHEN `offload_fraction < 50`,
  else `good`.
- IF `$RD/fit.jsonl` is absent, THEN the report SHALL refuse cleanly: print
  `foreman-fit-report: no fit ledger for <RUN_ID>` and exit non-zero — it
  SHALL NOT fall back to reading the event log and SHALL NOT crash.
- The report SHALL be wired into `foreman-cleanup.sh RUN_ID` (the confirmed
  run-close script): after the existing cleanup, IF `$RD/fit.jsonl` exists,
  Cleanup SHALL run the report and append its line to the run summary; a run
  with no ledger SHALL be skipped silently (a plain determined run keeps no
  ledger and needs no fit report).

#### Scenario: a mixed run reports its discovery-vs-offload split from the fit ledger

- WHEN a run's `$RD/fit.jsonl` contains `{"phase":"discover","lane":
  "foreman-discover","weight":2}` and `{"phase":"implement","lane":
  "worker-grok","weight":1}`
- THEN `foreman-fit-report.sh RUN_ID` prints `discovery=2 offload=1
  offload_fraction=33% fit_verdict=poor` (33% is below the 50% threshold).

#### Scenario: a healthy hybrid run (mostly offload) reports good fit

- WHEN a run's `$RD/fit.jsonl` contains `{"phase":"discover","lane":
  "foreman-discover","weight":1}` and `{"phase":"implement","lane":
  "worker-grok","weight":4}`
- THEN `foreman-fit-report.sh RUN_ID` prints `offload_fraction=80%
  fit_verdict=good`.

#### Scenario: an all-discovery run reports poor cost-fit and zero offload

- WHEN a run's `$RD/fit.jsonl` contains only `{"phase":"discover","lane":
  "foreman-discover","weight":1}` (no `implement` record)
- THEN `foreman-fit-report.sh RUN_ID` prints `offload=0
  offload_fraction=0% fit_verdict=poor`.

#### Scenario: a missing fit ledger is refused cleanly, not read from the event log

- WHEN `foreman-fit-report.sh RUN_ID` is invoked for a run with no
  `$RD/fit.jsonl`
- THEN it prints a message containing "no fit ledger" and exits non-zero
- AND it does NOT attempt to read `$RD/events.jsonl` for discovery
  accounting.

#### Scenario: Cleanup wires the report in automatically for a discovery-touched run

- WHEN `foreman-cleanup.sh RUN_ID` runs at the close of a run whose
  `$RD/fit.jsonl` exists
- THEN the fit-report line is appended to the run summary
- AND a run whose `$RD/fit.jsonl` does not exist is skipped silently by this
  step (no ledger, no fit report, no error).
