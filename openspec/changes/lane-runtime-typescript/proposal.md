# Change: lane-runtime-typescript

## Why

`skills/foreman/scripts/lane-run.sh` is 1,500 lines of Bash that owns every
lane round: admission, launcher spawn, heartbeat and ownership events,
checkpoints, the gate phase, report freshness, and signal cleanup.
`watch.sh` is 1,300 lines that reads those events. The architecture policy
admits both only by digest pin, so every change is a policy exception. The
2026-09-05 containment remedy needed exactly that exception.

`packages/orchestration/src/round-*.ts` already holds the round reducer, the
round transaction, and the `lane-round` CLI. They project events. They do not
yet own the process.

## What changes

- Move round ownership into `packages/orchestration`: launcher resolution,
  the containment probe and policy, the CMD and gate spawns, ownership and
  heartbeat mirroring, checkpoints, attempt-fresh report assertion, and the
  bounded kill ladder.
- Make `lane-run.sh` and `watch.sh` thin adapters that locate Node, forward
  arguments and environment, and execute one compiled entry point.
- Remove `LANE_RUN_BODY_SHA256` and the `watch.sh` pin from
  `packages/policy/src/architecture-adapter.ts`.
- Keep every event name, payload field, heartbeat field, exit code, and
  stderr line that `tests/lane-run.bats`, `tests/watch.bats`, and
  `tests/round-ownership.bats` assert today.

## Impact

- **Callers:** `lane-queue.sh` command shapes are unchanged.
- **Events:** `events.jsonl` gains no new event types. The `ownership`
  payload keeps `containment`.
- **Policy:** two digest pins are deleted. The thin-adapter grammar applies.
- **Tests:** the three Bats files keep passing through the adapter. New
  TypeScript tests own the behavior.
