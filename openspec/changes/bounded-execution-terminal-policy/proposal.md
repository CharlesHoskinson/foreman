# Change: bounded-execution-terminal-policy

## Why

Foreman bounds some individual commands. It does not bound the complete
implementation feedback path.

The current path can repeat these actions without one shared limit:

- implementation
- verification
- audit
- correction
- Council review
- resume

Each local counter can reset when Foreman creates a new round or session. A
dead watchdog attempt also recommends another retry. This structure caused an
execution loop that continued for more than 21 hours.

The release record shows the defect. The configuration permits three rework
rounds. Sprint 3 recorded five correction rounds for one package.

Foreman needs one durable execution contract. The contract must bind the
complete feedback path. Its terminal states must be absorbing.

## What changes

- Add a typed `ExecutionContractV1` to the Node.js orchestration package.
- Freeze the objective, acceptance criteria, base commit, and allowed paths.
- Add one shared budget for every implementation feedback action.
- Add deterministic terminal decisions with closed reason codes.
- Persist reservations and terminal decisions before external work starts.
- Reject every action after a terminal decision.
- Require a new user authorization for a new contract.
- Keep a failed package frozen while independent packages can continue.
- Block every dependent package until its required package completes.
- Reject duplicate verification for an unchanged candidate.
- Measure progress from product-state changes, not activity records.
- Route Council review and audit through the same action budget.
- Add adversarial tests for counter resets, process restarts, and concurrent
  admissions.

## Impact

- Add source under `packages/orchestration/src/`.
- Extend the durable event journal with one atomic transaction primitive.
- Add the `execution-guard` Node.js runtime artifact.
- Guard `lane-queue add` before any queue process or direct process starts.
- Update Foreman and Council operator contracts.
- Add an OpenSpec terminal-policy capability.
- Do not resume the isolated R7B2 candidate during this change.

