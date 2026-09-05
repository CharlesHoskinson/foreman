# Design: lane-runtime-typescript

## Context

The round reducer and transaction exist in TypeScript. The process side does
not. The Bash round has 26 documented traps in its header comments. Each one
becomes a named test.

## Decisions

- One new module group under `packages/orchestration/src/lane-runtime/`:
  `resolve-launcher.ts`, `containment.ts`, `spawn.ts`, `mirror.ts`,
  `gate.ts`, `report-fresh.ts`, `cleanup.ts`, `round-main.ts` (extends the
  existing `lane-round` entry), and `watch-main.ts`.
- Effect owns child lifetimes, timers, and cancellation. Pure functions own
  argv shapes, payload construction, and state transitions.
- Host boundaries are injectable services, the same pattern as
  `packages/launcher/src/services.ts`.
- The adapters keep their names and paths so callers and tests do not move.
  Their diagnostics follow the adapter grammar: the prefix is the bundle
  basename, so `lane-round: node is required` and `lane-watch: node is required`.
- The containment decision table is parity with the 2026-09-05 remedy, not a
  tightening. An explicit `FOREMAN_CONTAINMENT_REQUIRE=any` is honored even
  when `LANE_VENDOR` is set.

## Interfaces

```ts
export type LaunchArgv = readonly string[]; // ["node", bundle] or [binary]
export function resolveLauncher(env, toolRoot, platform, exists, which): LaunchArgv | null;
export type ContainmentDecision =
  | { _tag: "Proceed"; strong: boolean; record: CapabilityRecord | null; approval: string | null }
  | { _tag: "Refuse"; record: CapabilityRecord | null; reason: string };
export function decideContainment(record, env): ContainmentDecision;
export function ownershipPayload(input): OwnershipPayload; // includes containment
export function killPlan(strong: boolean, launcherPid: number, groupPid: number | null): KillStep[];
```

## Failure handling

Every host failure maps to the exit code the Bash round used: 2 for
configuration, 3 for a missing CLI, 130 and 143 for signals, and the child's
own code otherwise. A failed event append is logged and does not abort the
round, as today.

## Verification

Bats parity first, TypeScript unit tests second, the policy check last.
Live checks: one strong round and one refused round on WSL as an unprivileged
user, with the receipts stored under `docs/research/`.
