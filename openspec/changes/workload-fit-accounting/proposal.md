# Change: workload-fit-accounting

## Why

The operator's post-mortem on a real run (reverse-engineering a live ZK SDK +
indexer) was a manual, honest verdict — "foreman is a poor fit for empirical
spelunking" — arrived at only after the fact, by inspection.
`docs/superpowers/specs/2026-07-19-empirical-workloads-design.md` (C5) names
the gap: foreman has no automated up-front prediction of a workload's
cost-fit, and no automated post-run accounting of how much of the delivered
work was discovery (expensive lane) versus implementation offloaded to
grok/codex. Today this is entirely a manual operator judgment call, made
after the run is already done.

## What changes

- The five-part spec / `roles.md` gain a required `## Meta` line `fit:
  discovery_fraction: high | medium | low` — the architect's up-front
  estimate. WHEN `high`, the architect SHALL WARN the operator: "poor
  cost-fit — mostly empirical discovery; the expensive lane will dominate;
  grok offload will be small" and get an explicit proceed. This estimate is
  appended as the first record of a new, host-side **fit ledger**
  `$RD/fit.jsonl`: `{"phase":"estimate","discovery_fraction":"high"}`.
- **Audit correction (load-bearing):** agent-dispatched lanes
  (`foreman-discover`, `foreman-search`, `foreman-plan`) emit **zero**
  `el_emit` entries — `el_emit` is called only by host-side scripts
  (`lane-run.sh`, `lane-supervise.sh`, `resume.sh`, `watch.sh`,
  `worker-run.sh`). A fit-report that reads the event log for a discovery
  lane label would find nothing and mis-report a discovery-heavy run as
  *good* fit — the inverse of its purpose. So `foreman-fit-report.sh`
  reads the architect-kept **fit ledger** `$RD/fit.jsonl` instead (one JSON
  object per line; `phase` ∈ `estimate | discover | implement`;
  `discover`/`implement` records carry `lane` and optional `weight`, default
  1). The canonical implement-lane label is **`worker-grok`**
  (`worker-run.sh`: `LANE="worker-$VENDOR"`), never the illustrative
  `grok:1`.
- New `skills/foreman/scripts/foreman-fit-report.sh RUN_ID` (+
  `tests/fit-report.bats`): reads `$RD/fit.jsonl`, tallies `weight` (default
  1) grouped by `phase` (`discover` → discovery, `implement` → offload), and
  prints `foreman-fit report RUN_ID=<id> discovery=<d> offload=<o>
  offload_fraction=<p>% fit_verdict=<good|poor>` — `poor` when
  `offload_fraction < 50`. IF the ledger is absent, THEN it refuses cleanly
  (`no fit ledger`, non-zero exit) rather than reading the event log or
  crashing.
- Wired into Cleanup via `foreman-cleanup.sh RUN_ID` (the confirmed run-close
  script, `SKILL.md:60`) so every discovery-touched run emits the fit report
  at run end; a plain determined run with no ledger is skipped silently.

## Impact

- Affected: `skills/foreman/references/five-part-spec.md`/`roles.md` (the
  `fit:` declaration + warn doctrine + fit-ledger seed); new
  `skills/foreman/scripts/foreman-fit-report.sh` + `tests/fit-report.bats`
  (reads `$RD/fit.jsonl`); `foreman-cleanup.sh RUN_ID` (the resolved Cleanup
  wiring point); `skills/foreman/SKILL.md` (surfacing the signal).
- No change to the event log schema — this package does NOT read the event
  log for discovery accounting (agent-dispatched lanes emit no events); it
  introduces a new, separate, architect-kept ledger file (`$RD/fit.jsonl`)
  and, where it counts real implement-lane activity, uses the actual
  `worker-grok`/`worker-codex` labels.
