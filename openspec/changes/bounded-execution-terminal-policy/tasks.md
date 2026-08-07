# Tasks: bounded-execution-terminal-policy

## 1. Contract and reducer

- [x] Add failing tests for strict contract decoding and canonical identity.
- [x] Add `ExecutionContractV1` and its closed limit schema.
- [x] Add failing tests for each terminal transition.
- [x] Add the pure execution reducer and terminal arbiter.
- [x] Add exhaustive tests that prove terminal states are absorbing.

## 2. Atomic journal transaction

- [x] Add failing single-process and concurrent-process transaction tests.
- [x] Add a generic pure transaction callback to `RunJournal`.
- [x] Keep all file reads and appends inside the existing journal lock.
- [x] Prove that only one caller reserves the last action unit.

## 3. Durable execution ledger

- [x] Add failing tests for contract creation, replay, and reservation.
- [x] Add the Effect `ExecutionLedger` service.
- [x] Reject changed contract bytes for an existing contract identifier.
- [x] Persist each terminal decision before returning it.
- [x] Rebuild the same state after a process restart.

## 4. Guarded queue admission

- [x] Add failing CLI parse tests for contract-bound `add` requests.
- [x] Reject uncontracted Foreman action dispatch.
- [x] Reserve the action before `pueue` or direct process execution.
- [x] Reject terminal and exhausted contracts before process execution.
- [x] Add the `execution-guard` runtime artifact.

## 5. Progress and evidence reuse

- [x] Add fake-clock tests for wall-time and stall limits.
- [x] Count only allowed product-path changes as progress.
- [x] Key verification evidence by candidate and command hashes.
- [x] Refuse a repeated verification for an unchanged candidate.

## 6. Dependency behavior

- [x] Add tests for independent and dependent package admission.
- [x] Permit independent packages after another package freezes.
- [x] Block every package that depends on a non-completed package.
- [x] Prevent release completion while a required package is frozen.

## 7. Endless-loop falsification

- [x] Add an adversarial loop that uses all feedback action types.
- [x] Restart the ledger process during the adversarial loop.
- [x] Change lane, round, session, and attempt identifiers during the loop.
- [x] Prove that the loop reaches a terminal state within 12 reservations.
- [x] Prove that every later dispatch starts zero processes.
- [x] Prove that only explicit new user authorization permits a new contract.

## 8. Operator contracts and runtime evidence

- [x] Update the Foreman skill to require contract-bound dispatch.
- [x] Update the Council skill to prohibit automatic review reruns.
- [x] Make future workstream creation fail closed without Endstop.
- [x] Add Endstop to installed-runtime verification.
- [x] Add Endstop as a v0.3.0 release prerequisite.
- [x] Build and verify the runtime bundle and manifest.
- [x] Run focused tests, type checking, runtime verification, and strict
      OpenSpec validation.
- [x] Run the full repository test command and report the baseline secret-scan
      failure separately if it remains.
