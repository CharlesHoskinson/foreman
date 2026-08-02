# Reference set index

Entry point into `skills/foreman/references/`. `SKILL.md`'s own "References"
section is the authoritative per-file pointer list for the skill body; this
index is the cross-linked map for readers arriving from
[`README.md`](../../../README.md) or [`docs/USAGE.md`](../../../docs/USAGE.md)
who want the operator-facing detail behind a specific claim.

## By lifecycle stage

| Stage | What to read | File |
|---|---|---|
| Setup & Environment | Windows + WSL inventory, bootstrap, profiles, `.wslconfig` tuning, clock-sync | [`reference-environment.md`](reference-environment.md) |
| Setup & Environment | `foreman-setup.sh`/`foreman-cleanup.sh` requirements (EARS) | [`../../../openspec/changes/archive/2026-07-18-lifecycle-three-stage/specs/lifecycle/spec.md`](../../../openspec/changes/archive/2026-07-18-lifecycle-three-stage/specs/lifecycle/spec.md) |
| Use — routing | Lane table, CLI flags, hard-mode adapters, config keys | [`lanes.md`](lanes.md) |
| Use — specs | The five-part spec template + EARS phrasing | [`five-part-spec.md`](five-part-spec.md) |
| Use — roles | Orchestrator / worker / advisor / auditor contracts | [`roles.md`](roles.md) |
| Use — parallelism | Worktree-isolated search/plan/audit fan-out | [`parallel-worktrees.md`](parallel-worktrees.md) |
| Use — durable rounds | Event log, checkpoints, NATS transport, v1 watchdog | [`durable-lanes.md`](durable-lanes.md) |
| Use — v0.2.5/v0.2.7.5 hardening | Launcher contract, watch.sh v2, pueue/`gate` mutex, vendor isolation, merge-freshness gate, concurrent-worktree git guards | [`orchestration-hardening.md`](orchestration-hardening.md) |
| Use — audit | Audit dimensions + verdict schema | [`audit-checklist.md`](audit-checklist.md) |
| Use — release reporting | Metric definitions (M1–M13), companions, sigma-before-claim, linter | [`release-metrics.md`](release-metrics.md) |
| Use — regression tiers | Runtime/cost budgets, cadence, and the fixed 20% review margin | [`regression-tier-budgets.md`](regression-tier-budgets.md) |
| Cleanup | Covered inline in `orchestration-hardening.md` §9 (git-guards, stale-lock sweep, SIGINT-before-remove) and `reference-environment.md` | — |
| Security (all stages) | Threats and enforcement map | [`security-model.md`](security-model.md) |

## Forward-looking (not yet shipped)

- [`../../../openspec/changes/archive/2026-07-18-t5b-concurrency-verdict/`](../../../openspec/changes/archive/2026-07-18-t5b-concurrency-verdict/)
  and [`../../../docs/research/vendor-concurrency-results.md`](../../../docs/research/vendor-concurrency-results.md) —
  the destructive concurrency test that keeps the `grok`/`codex` pueue caps
  at 1 until a real authenticated green row is recorded.

## Maintenance

`skills/foreman/scripts/maintenance.sh` and `skills/VENDORED.md` are
documented inline in `SKILL.md` §12 and the README's "Repo understanding and
maintenance" section rather than in a dedicated reference file.
