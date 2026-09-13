# Change: foredi-04-durable-execution

## Why

A checked Pel program needs an executable lifecycle. Operators need to start, inspect, cancel, and resume useful work after interruption.
Current round execution, supervisor recovery, and provider loops distribute that lifecycle across several owners.
M4 gives each Pel run one Effect owner and reuses the existing journal and execution ledger.

## What Changes

- Add `foreman run`, `status`, `cancel`, and `resume` to the M2 command surface.
- Persist host suspension, effect intent, provider identity, and validated Pel results in the existing run journal.
- Execute native `do` and `do/async` with bounded concurrency and resource conflict handling.
- Add isolated `fm/race`, bounded `fm/retry`, and durable `fm/checkpoint` library functions.
- Recover completed results and reconcile unknown external outcomes without resetting budgets.
- Expose actionable status, cancellation confirmation, and terminal evidence through one result schema.

## Impact

Depends on M1 language values and continuations, M2 checked admission, and M3 provider transports.
Modify `packages/orchestration`, with journal integration through `packages/event-log` and process supervision through `packages/launcher`.
Retain existing historical round decoders, authority, accounting, and event storage.
M5 supplies task delivery host functions. M4 also runs deterministic registered host fixtures independently.
No second database, authored task format, `fm/sequence`, or `fm/parallel` is introduced.

## Acceptance and Evidence

`catalog.json` maps six implementable features to EARS requirements and concrete planned tests.
The delta spec uses the [official EARS patterns](https://alistairmavin.com/ears/).
All implementation tasks and runtime tests remain planned. This proposal adds no runtime code and authorizes no provider dispatch.
