# Round Resume Decision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the pure TypeScript authority for safe, round-preserving resume.

**Architecture:** Select the newest typed prompt for one lane. Reuse `recoverRoundAttempt` for the selected identity. Combine recovery with explicit safety observations and return one closed decision.

**Tech Stack:** Node.js 24, strict TypeScript, Effect-compatible tagged data, and Node test runner.

## Global Constraints

- Add no Python, shell, PowerShell, Bun, or Deno code.
- Preserve command arguments as an array.
- Use `recoverRoundAttempt` as the only recovery reducer.
- Perform no filesystem, process, lock, restore, or queue operation.
- Use test-driven development.

---

### Task 1: Select the current typed round

**Files:**

- Create: `packages/orchestration/src/resume-decision.ts`
- Create: `packages/orchestration/src/resume-decision.test.ts`

**Interfaces:**

- Consume: `StoredEvent`, `LaneId`, `AttemptIdentity`, `RoundPlanV1`.
- Produce: `selectLatestRoundAttempt(events, runId, laneId)` and `LatestRoundAttemptV1`.

Use this public selection shape:

```ts
export type LatestRoundAttemptV1 =
  | { readonly _tag: "NoRound" }
  | { readonly _tag: "Selected"; readonly attemptIdentity: AttemptIdentity }
  | { readonly _tag: "LegacyUnbound"; readonly attemptIdentity: AttemptIdentity; readonly promptSequence: number }
  | { readonly _tag: "Invalid"; readonly laneId: LaneId; readonly promptSequence: number; readonly attemptIdentity?: AttemptIdentity };

export function selectLatestRoundAttempt(
  events: readonly StoredEvent[],
  runId: RunId,
  laneId: LaneId,
): LatestRoundAttemptV1;
```

- [ ] **Step 1: Write RED selection tests**

Create shared helpers that build a valid plan and stored event.
Then add this table and the two identity tests:

```ts
const selectionCases = [
  { name: "no prompt", events: [], tag: "NoRound" },
  { name: "newest prompt has no round plan", events: [typedPrompt(1), legacyPrompt(2)], tag: "LegacyUnbound" },
  { name: "newest prompt has an invalid plan", events: [typedPrompt(1), invalidPlanPrompt(2)], tag: "Invalid" },
] as const;

for (const c of selectionCases) {
  it(c.name, () => {
    assert.equal(selectLatestRoundAttempt(c.events, runId, laneId)._tag, c.tag);
  });
}

it("selects the newest valid attempt for the requested lane", () => {
  const result = selectLatestRoundAttempt(
    [typedPrompt(1), typedPrompt(3), typedPrompt(2, otherLaneId)],
    runId,
    laneId,
  );
  assert.equal(result._tag, "Selected");
  if (result._tag === "Selected") assert.equal(result.attemptIdentity.attemptId, 3);
});

it("rejects a plan whose identity differs from its enclosing prompt", () => {
  const result = selectLatestRoundAttempt(
    [typedPromptWithPlanAttempt(4, 5)],
    runId,
    laneId,
  );
  assert.equal(result._tag, "Invalid");
});
```

- [ ] **Step 2: Run the RED tests**

Run: `node --import tsx --test packages/orchestration/src/resume-decision.test.ts`

Expected: The test command fails because the module does not exist.

- [ ] **Step 3: Implement current-attempt selection**

Reject duplicate and decreasing event sequences before prompt selection.
Do not sort or repair invalid history.
Select the greatest prompt sequence for the requested lane.
Decode the attempt and plan with existing decoders.
Return only the closed result tags from the OpenSpec requirement.

Use `decodeAttemptId` for `payload.attempt`.
Use `decodeRoundPlanV1` for `payload.roundPlan`.
Use `attemptIdentityFromPlan` for the plan identity.
Compare all three identity fields before returning `Selected`.
Carry the decoded identity through `LegacyUnbound` and eligible `Invalid` results.

- [ ] **Step 4: Run the selection tests**

Run: `node --import tsx --test packages/orchestration/src/resume-decision.test.ts`

Expected: All selection tests pass.

### Task 2: Decide safe round resume

**Files:**

- Modify: `packages/orchestration/src/resume-decision.ts`
- Modify: `packages/orchestration/src/resume-decision.test.ts`
- Modify: `packages/orchestration/src/index.ts`

**Interfaces:**

- Consume: `recoverRoundAttempt`, selected attempt, resume counts, process state, and lock state.
- Produce: `decideRoundResume(input): RoundResumeDecisionV1`.

Use these public shapes:

```ts
export type ResumeProcessState = "inactive" | "active" | "unknown";
export type ResumeLockState = "free" | "held" | "unknown";

export type RoundResumeDecisionV1 =
  | { readonly _tag: "NoRound" }
  | { readonly _tag: "Completed"; readonly attemptIdentity: AttemptIdentity; readonly outcome: RoundOutcomeV1 }
  | { readonly _tag: "Wait"; readonly attemptIdentity: AttemptIdentity; readonly reason: "prior_attempt_active" | "process_state_unknown" | "lock_held" | "lock_state_unknown" }
  | { readonly _tag: "Resume"; readonly roundPlan: RoundPlanV1; readonly checkpointIdentity: CheckpointIdentityV1; readonly nextResumeCount: number }
  | { readonly _tag: "Refused"; readonly attemptIdentity?: AttemptIdentity; readonly reason: "legacy_unbound" | "invalid_history" | "checkpoint_missing" | "resume_limit_reached" | "invalid_observation" };

export type DecideRoundResumeInput = {
  readonly events: readonly StoredEvent[];
  readonly runId: RunId;
  readonly laneId: LaneId;
  readonly resumeCount: number;
  readonly resumeMaxAttempts: number;
  readonly processState: ResumeProcessState;
  readonly lockState: ResumeLockState;
};

export function decideRoundResume(input: DecideRoundResumeInput): RoundResumeDecisionV1;
```

- [ ] **Step 1: Write RED decision tests**

Use a table for each safety decision:

```ts
const safetyCases = [
  { processState: "active", lockState: "free", reason: "prior_attempt_active" },
  { processState: "unknown", lockState: "free", reason: "process_state_unknown" },
  { processState: "inactive", lockState: "held", reason: "lock_held" },
  { processState: "inactive", lockState: "unknown", reason: "lock_state_unknown" },
] as const;

for (const c of safetyCases) {
  it(`waits for ${c.reason}`, () => {
    const result = decideRoundResume(recoverableInput({
      processState: c.processState,
      lockState: c.lockState,
    }));
    assert.deepEqual(result, {
      _tag: "Wait",
      attemptIdentity: identity,
      reason: c.reason,
    });
  });
}
```

Add direct assertions for these results:

```ts
assert.equal(decideRoundResume(noPromptInput())._tag, "NoRound");
assert.equal(decideRoundResume(completedInput())._tag, "Completed");
assert.equal(decideRoundResume(legacyInput())._tag, "Refused");
assert.equal(decideRoundResume(missingCheckpointInput())._tag, "Refused");
assert.equal(decideRoundResume(recoverableInput({ resumeCount: 2, resumeMaxAttempts: 2 }))._tag, "Refused");
assert.equal(decideRoundResume(recoverableInput({ resumeCount: -1 }))._tag, "Refused");

const resumed = decideRoundResume(recoverableInput());
assert.equal(resumed._tag, "Resume");
if (resumed._tag === "Resume") {
  assert.deepEqual(resumed.roundPlan.commandArgv, ["impl", ""]);
  assert.equal(resumed.roundPlan.gateCommand, "npm test");
  assert.equal(resumed.roundPlan.reportPath, "FOREMAN_REPORT.md");
  assert.deepEqual(resumed.checkpointIdentity, checkpointIdentity);
  assert.equal(resumed.nextResumeCount, 1);
}
```

- [ ] **Step 2: Run the RED tests**

Run: `node --import tsx --test packages/orchestration/src/resume-decision.test.ts`

Expected: The new decision tests fail because `decideRoundResume` does not exist.

- [ ] **Step 3: Implement the closed decision**

Call `recoverRoundAttempt` once.
Apply the required first-match order.
Return the exact stored plan and checkpoint identity for `Resume`.

- [ ] **Step 4: Export the module**

Export all public resume-decision types and functions from `packages/orchestration/src/index.ts`.

- [ ] **Step 5: Run focused and package checks**

Run: `node --import tsx --test packages/orchestration/src/resume-decision.test.ts`

Expected: All focused tests pass.

Run: `npm run typecheck && npm run build && npm run verify-runtime && npm run verify`

Expected: All commands pass.

- [ ] **Step 6: Run package policy checks**

Run: `openspec validate round-resume-typescript --strict`

Expected: The change is valid.

Run: `node skills/foreman/runtime/dist/architecture-policy.js check --base 56291e450215b441d7d4df7a74548b132e0011fd`

Expected: The policy returns `Pass` with zero findings after the host commits the worker result.

Run: `git diff --check`

Expected: The command returns exit code 0.
