# Foreman Endstop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install Foreman Endstop as the persistent feedback limit for every current and future Foreman workstream.

**Architecture:** Add an event-sourced execution contract to `@foreman/orchestration`. Use the existing external `RunJournal` lock for atomic decisions. Guard queue admission before any process starts.

**Tech Stack:** Node.js 24, TypeScript, Effect 3.22, Node test runner, OpenSpec 1.7.

## Global Constraints

- Write all new executable source in TypeScript.
- Run all new executable source on Node.js 24.
- Use Effect for durable state, typed failures, and process boundaries.
- Permit one audit and one correction per default contract.
- Permit at most 12 action reservations per default contract.
- Keep all terminal states absorbing.
- Require new user authorization for a replacement contract.
- Store Endstop state outside worktrees and branches.
- Refuse every future workstream that has no valid Endstop contract.
- Make Endstop a v0.3.0 release prerequisite.
- Do not integrate or modify the isolated R7B2 candidate.

---

## File structure

- `packages/orchestration/src/execution-contract.ts`: closed contract decoder and canonical identity.
- `packages/orchestration/src/execution-terminal-policy.ts`: pure command decision and event reducer.
- `packages/orchestration/src/execution-ledger.ts`: Effect service backed by `RunJournal.transact`.
- `packages/orchestration/src/execution-guard-cli.ts`: strict contract creation, status, cancellation, and action reservation CLI.
- `packages/orchestration/src/execution-guard-main.ts`: live Node.js entry point.
- `packages/event-log/src/run-journal.ts`: generic atomic append-or-return transaction.
- `packages/orchestration/src/queue-cli.ts`: contract-bound queue grammar.
- `packages/orchestration/src/queue-admission.ts`: reserve before process execution.
- `scripts/build-runtime.ts`: `execution-guard` bundle registration.
- `scripts/verify-runtime.ts`: deterministic artifact verification.
- `openspec/changes/v030-release-program/`: Endstop release prerequisite.

### Task 1: Pure contract and terminal reducer

**Files:**

- Create: `packages/orchestration/src/execution-contract.ts`
- Create: `packages/orchestration/src/execution-terminal-policy.ts`
- Create: `packages/orchestration/src/execution-terminal-policy.test.ts`
- Modify: `packages/orchestration/src/index.ts`

**Interfaces:**

- Produces: `decodeExecutionContractV1`, `executionContractSha256`, `initialExecutionState`, `decideExecutionCommand`, and `evolveExecution`.
- Produces terminal tags: `Completed`, `Escalated`, `Stalled`, `BudgetExhausted`, `Cancelled`, `Invalidated`, and `BlockedExternal`.

- [ ] **Step 1: Write failing contract and absorbing-state tests**

```typescript
it("keeps every terminal state absorbing", () => {
  for (const terminal of terminalFixtures) {
    const next = evolveExecution(terminal, actionReservedEvent);
    assert.deepEqual(next, terminal);
  }
});

it("reaches a terminal within the total action bound", () => {
  let state = initialExecutionState(strictContract);
  for (let index = 0; index < 40 && state._tag === "Running"; index += 1) {
    state = applyAccepted(state, reserveCommand(actionCycle[index % actionCycle.length]!));
  }
  assert.notEqual(state._tag, "Running");
  assert.ok(state.reservations <= 12);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- packages/orchestration/src/execution-terminal-policy.test.ts`

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Add the closed contract and command model**

```typescript
export const executionActionKinds = [
  "implement", "verify", "audit", "correct", "council",
  "provider_retry", "resume", "integrate", "publish",
] as const;

export type ExecutionCommand =
  | { readonly _tag: "ReserveAction"; readonly action: ExecutionActionKind; readonly candidateSha256: Sha256Hex; readonly commandSha256?: Sha256Hex; readonly at: string; readonly reservationId: string }
  | { readonly _tag: "RecordProductChange"; readonly candidateSha256: Sha256Hex; readonly at: string }
  | { readonly _tag: "RecordMilestone"; readonly milestone: RequiredMilestone; readonly candidateSha256: Sha256Hex; readonly evidenceSha256: Sha256Hex; readonly at: string }
  | { readonly _tag: "Cancel"; readonly authorizationSha256: Sha256Hex; readonly at: string };
```

- [ ] **Step 4: Implement the reducer and terminal precedence**

Implement the first-match order from `openspec/changes/bounded-execution-terminal-policy/design.md`.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `npm test -- packages/orchestration/src/execution-terminal-policy.test.ts`

Expected: all terminal-policy tests pass.

- [ ] **Step 6: Commit the pure policy**

Run: `git add packages/orchestration/src && git commit -m "feat: add bounded execution policy"`

### Task 2: Atomic journal transaction

**Files:**

- Modify: `packages/event-log/src/run-journal.ts`
- Modify: `packages/event-log/src/run-journal.test.ts`
- Modify: `packages/event-log/src/index.ts`

**Interfaces:**

- Produces: `RunJournal.transact<A>(runId, decide)`.
- Consumes a pure callback over the complete validated event list.

- [ ] **Step 1: Write failing append-or-return tests**

```typescript
const result = await runEffect((journal) => journal.transact(runId, (events) =>
  events.length === 0
    ? { _tag: "Append", draft, result: (stored) => stored.seq }
    : { _tag: "Return", value: events.length },
));
assert.equal(result, 1);
```

Add a child-process test. Start two callers against one final budget event.
Assert that only one callback appends.

- [ ] **Step 2: Run the journal tests and verify RED**

Run: `node --import tsx --test packages/event-log/src/run-journal.test.ts`

Expected: FAIL because `transact` does not exist.

- [ ] **Step 3: Expose the existing locked transaction safely**

```typescript
export type RunJournalTransactionDecision<A> =
  | { readonly _tag: "Append"; readonly draft: StoredEventDraftV1; readonly result: (stored: StoredEvent) => A }
  | { readonly _tag: "Return"; readonly value: A };
```

Validate every append draft before the locked write. Map all synchronous
exceptions to `RunJournalFailure`.

- [ ] **Step 4: Run journal tests and verify GREEN**

Run: `node --import tsx --test packages/event-log/src/run-journal.test.ts`

Expected: all journal tests pass.

- [ ] **Step 5: Commit the transaction primitive**

Run: `git add packages/event-log/src && git commit -m "feat: add atomic journal decisions"`

### Task 3: Durable execution ledger and CLI

**Files:**

- Create: `packages/orchestration/src/execution-ledger.ts`
- Create: `packages/orchestration/src/execution-ledger.test.ts`
- Create: `packages/orchestration/src/execution-guard-cli.ts`
- Create: `packages/orchestration/src/execution-guard-cli.test.ts`
- Create: `packages/orchestration/src/execution-guard-main.ts`
- Modify: `packages/orchestration/src/index.ts`

**Interfaces:**

- Produces Effect service methods `create`, `reserve`, `recordProductChange`, `recordMilestone`, `cancel`, and `status`.
- Produces CLI commands `create`, `reserve`, `status`, and `cancel`.

- [ ] **Step 1: Write failing restart and immutable-contract tests**

Create a contract, reserve actions, replace the live layer, and read status.
Assert that the reservation count stays unchanged. Submit changed bytes under
the same contract identifier. Assert `contract_mismatch`.

- [ ] **Step 2: Verify RED**

Run: `node --import tsx --test packages/orchestration/src/execution-ledger.test.ts packages/orchestration/src/execution-guard-cli.test.ts`

Expected: FAIL because the ledger and CLI do not exist.

- [ ] **Step 3: Implement ledger events and strict CLI parsing**

```typescript
export class ExecutionLedger extends Context.Tag("ExecutionLedger")<ExecutionLedger, {
  readonly create: (contract: ExecutionContractV1) => Effect.Effect<ExecutionSnapshot, ExecutionLedgerFailure>;
  readonly reserve: (request: ReserveExecutionAction) => Effect.Effect<ExecutionAdmission, ExecutionLedgerFailure>;
  readonly status: (contractId: RunId) => Effect.Effect<ExecutionSnapshot, ExecutionLedgerFailure>;
}>() {}
```

Use `RunJournal.transact` for every state-changing method.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the command from Step 2. Expected: all tests pass.

- [ ] **Step 5: Commit the durable ledger**

Run: `git add packages/orchestration/src && git commit -m "feat: persist execution terminal decisions"`

### Task 4: Guard queue admission

**Files:**

- Modify: `packages/orchestration/src/queue-cli.ts`
- Modify: `packages/orchestration/src/queue-cli.test.ts`
- Modify: `packages/orchestration/src/queue-admission.ts`
- Modify: `packages/orchestration/src/queue-admission.test.ts`
- Modify: `packages/orchestration/src/queue-main.ts`

**Interfaces:**

- Consumes `ExecutionLedger.reserve`.
- Produces contract-bound `add` requests.

- [ ] **Step 1: Write failing no-spawn tests**

```typescript
it("starts no process after terminal", async () => {
  const calls: string[] = [];
  const code = await runGuardedAdd(terminalLedgerLayer, processLayer(calls));
  assert.equal(code, 1);
  assert.deepEqual(calls, []);
});
```

Add equivalent tests for missing contracts, exhausted budgets, and duplicate
verification.

- [ ] **Step 2: Verify RED**

Run: `node --import tsx --test packages/orchestration/src/queue-cli.test.ts packages/orchestration/src/queue-admission.test.ts`

Expected: the new contract-bound cases fail.

- [ ] **Step 3: Reserve before queue readiness or process lookup**

Call the ledger before `resolvePueueClient`. Return a closed refusal message.
Do not call `ProcessExec`, `PathLookup`, or `Sleeper` after refusal.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the command from Step 2. Expected: all queue tests pass.

- [ ] **Step 5: Commit guarded admission**

Run: `git add packages/orchestration/src && git commit -m "feat: guard queue actions with execution contracts"`

### Task 5: Falsify loop closure

**Files:**

- Create: `packages/orchestration/src/execution-loop-closure.test.ts`
- Modify: `packages/orchestration/src/execution-terminal-policy.test.ts`

**Interfaces:**

- Uses the public ledger and queue interfaces only.
- Does not call reducer internals to manufacture a terminal.

- [ ] **Step 1: Write the hostile reset test**

Cycle through all action kinds. Change the supplied lane, round, session, and
attempt metadata after each refusal. Restart the ledger layer after every third
request.

- [ ] **Step 2: Verify the test fails before the final guard behavior**

Temporarily run against the preceding commit or omit the guard layer. Confirm
that more than 12 process calls occur.

- [ ] **Step 3: Run the test against guarded admission**

Run: `node --import tsx --test packages/orchestration/src/execution-loop-closure.test.ts`

Expected: at most 12 reservations, one absorbing terminal, and zero process
calls after terminal.

- [ ] **Step 4: Add dependency tests**

Assert that an independent contract can reserve work. Assert that a dependent
contract cannot reserve work until every dependency is `Completed`.

- [ ] **Step 5: Commit loop falsification evidence**

Run: `git add packages/orchestration/src && git commit -m "test: falsify execution loop closure"`

### Task 6: Runtime, operator contracts, and verification

**Files:**

- Modify: `scripts/build-runtime.ts`
- Modify: `scripts/verify-runtime.ts`
- Modify: `skills/foreman/SKILL.md`
- Modify: `skills/council/SKILL.md`
- Modify: `openspec/changes/v030-release-program/tasks.md`
- Modify: `openspec/changes/v030-release-program/sprints.md`
- Modify: `skills/foreman/runtime/manifest.json`
- Create: `skills/foreman/runtime/dist/execution-guard.js` through the build.

**Interfaces:**

- Publishes `execution-guard.js` as a deterministic Node.js 24 bundle.
- Makes contract-bound dispatch mandatory in the operator instructions.

- [ ] **Step 1: Add failing runtime artifact assertions**

Add `execution-guard.js` to the expected artifact list before adding the build
entry. Run `npm run verify-runtime`. Expected: FAIL with a missing artifact.

- [ ] **Step 2: Add the build entry and rebuild**

Run: `npm run build`

Expected: the build prints an `execution-guard.js` SHA-256 value.

- [ ] **Step 3: Update Foreman and Council instructions**

Require one contract-bound dispatch. Prohibit automatic Council reruns. State
that a terminal contract needs explicit user replacement authority.

Add Endstop to the v0.3.0 execution prerequisites. Do not permit later
workstream execution until the Endstop hostile loop test passes.

- [ ] **Step 4: Run focused and structural verification**

Run:

```bash
npm run typecheck
node --import tsx --test packages/event-log/src/run-journal.test.ts packages/orchestration/src/execution-*.test.ts packages/orchestration/src/queue-*.test.ts
npm run build
npm run verify-runtime
openspec validate bounded-execution-terminal-policy --strict
git diff --check
```

Expected: every command exits zero.

- [ ] **Step 5: Run the full test command**

Run: `npm test`

Expected: the new tests pass. Report the pre-existing secret-scan
`bound_exceeded` result separately if it remains.

- [ ] **Step 6: Commit runtime and documentation**

Run: `git add scripts skills packages openspec docs && git commit -m "feat: enforce terminal execution contracts"`
