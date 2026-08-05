# Tasks: bounded-execution-terminal-policy

## 1. Contract and reducer

- [ ] Add failing tests for strict contract decoding and canonical identity.
- [ ] Add `ExecutionContractV1` and its closed limit schema.
- [ ] Add failing tests for each terminal transition.
- [ ] Add the pure execution reducer and terminal arbiter.
- [ ] Add exhaustive tests that prove terminal states are absorbing.

## 2. Atomic journal transaction

- [ ] Add failing single-process and concurrent-process transaction tests.
- [ ] Add a generic pure transaction callback to `RunJournal`.
- [ ] Keep all file reads and appends inside the existing journal lock.
- [ ] Prove that only one caller reserves the last action unit.

## 3. Durable execution ledger

- [ ] Add failing tests for contract creation, replay, and reservation.
- [ ] Add the Effect `ExecutionLedger` service.
- [ ] Reject changed contract bytes for an existing contract identifier.
- [ ] Persist each terminal decision before returning it.
- [ ] Rebuild the same state after a process restart.

## 4. Guarded queue admission

- [ ] Add failing CLI parse tests for contract-bound `add` requests.
- [ ] Reject uncontracted Foreman action dispatch.
- [ ] Reserve the action before `pueue` or direct process execution.
- [ ] Reject terminal and exhausted contracts before process execution.
- [ ] Add the `execution-guard` runtime artifact.

## 5. Progress and evidence reuse

- [ ] Add fake-clock tests for wall-time and stall limits.
- [ ] Count only allowed product-path changes as progress.
- [ ] Key verification evidence by candidate and command hashes.
- [ ] Refuse a repeated verification for an unchanged candidate.

## 6. Dependency behavior

- [ ] Add tests for independent and dependent package admission.
- [ ] Permit independent packages after another package freezes.
- [ ] Block every package that depends on a non-completed package.
- [ ] Prevent release completion while a required package is frozen.

## 7. Endless-loop falsification

- [ ] Add an adversarial loop that uses all feedback action types.
- [ ] Restart the ledger process during the adversarial loop.
- [ ] Change lane, round, session, and attempt identifiers during the loop.
- [ ] Prove that the loop reaches a terminal state within 12 reservations.
- [ ] Prove that every later dispatch starts zero processes.
- [ ] Prove that only explicit new user authorization permits a new contract.

## 8. Operator contracts and runtime evidence

- [ ] Update the Foreman skill to require contract-bound dispatch.
- [ ] Update the Council skill to prohibit automatic review reruns.
- [ ] Build and verify the runtime bundle and manifest.
- [ ] Run focused tests, type checking, runtime verification, and strict
      OpenSpec validation.
- [ ] Run the full repository test command and report the baseline secret-scan
      failure separately if it remains.

