import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decodeAttemptId,
  decodeLaneId,
  decodeRunId,
  makeAttemptIdentity,
  type AttemptId,
  type LaneId,
  type RunId,
  type StoredEvent,
} from "@foreman/event-log";
import {
  absentReportSnapshot,
  presentReportSnapshot,
  type CheckpointIdentityV1,
  type RoundOutcomeV1,
  type RoundPlanV1,
} from "./round-contract.js";
import {
  decideRoundResume,
  selectLatestRoundAttempt,
  type DecideRoundResumeInput,
} from "./resume-decision.js";

const runId = decodeRunId("v030-resume-r5a") as RunId;
const laneId = decodeLaneId("grok-r5a") as LaneId;
const otherLaneId = decodeLaneId("codex-r5a") as LaneId;
const attemptId = decodeAttemptId(3) as AttemptId;
const identity = makeAttemptIdentity(runId, laneId, attemptId);

const digest = "a".repeat(64);
const presentRaw = presentReportSnapshot(digest, 12);
assert.ok(!("reason" in presentRaw));
assert.equal(presentRaw._tag, "Present");
const present = presentRaw as {
  readonly _tag: "Present";
  readonly digest: string;
  readonly byteLength: number;
};

function planFor(
  attempt: AttemptId,
  opts?: {
    readonly lane?: LaneId;
    readonly run?: RunId;
    readonly commandArgv?: readonly string[];
  },
): RoundPlanV1 {
  return {
    schemaVersion: 1,
    runId: opts?.run ?? runId,
    laneId: opts?.lane ?? laneId,
    attemptId: attempt,
    mode: "round",
    commandArgv: opts?.commandArgv ?? ["impl", ""],
    gateCommand: "npm test",
    reportPath: "FOREMAN_REPORT.md",
    reportBaseline: absentReportSnapshot(),
  };
}

function plan(): RoundPlanV1 {
  return planFor(attemptId);
}

const checkpointIdentity: CheckpointIdentityV1 = {
  attemptIdentity: identity,
  commit: "ckpt-resume-1",
};

function completedOutcome(): RoundOutcomeV1 {
  return {
    _tag: "completed",
    attemptIdentity: identity,
    implementationExitCode: 0,
    gateExitCode: 0,
    reportFresh: true,
    reportBaseline: absentReportSnapshot(),
    report: present,
  };
}

function promptEvent(
  sequence: number,
  payload: Record<string, unknown>,
  lane: LaneId = laneId,
): StoredEvent {
  return {
    seq: sequence,
    ts: "2026-08-05T12:00:00Z",
    type: "prompt",
    lane,
    payload,
  };
}

function typedPrompt(
  sequence: number,
  lane: LaneId = laneId,
  attempt: number = sequence,
): StoredEvent {
  const att = decodeAttemptId(attempt) as AttemptId;
  return promptEvent(
    sequence,
    {
      attempt: att,
      roundPlan: planFor(att, { lane }),
    },
    lane,
  );
}

function legacyPrompt(sequence: number): StoredEvent {
  return promptEvent(sequence, {
    attempt: decodeAttemptId(sequence) as AttemptId,
    cmd: "legacy-command",
  });
}

function invalidPlanPrompt(sequence: number): StoredEvent {
  return promptEvent(sequence, {
    attempt: decodeAttemptId(sequence) as AttemptId,
    roundPlan: {
      schemaVersion: 1,
      // missing required fields → invalid plan
      mode: "round",
    },
  });
}

function typedPromptWithPlanAttempt(
  promptAttempt: number,
  planAttempt: number,
): StoredEvent {
  const promptAtt = decodeAttemptId(promptAttempt) as AttemptId;
  const planAtt = decodeAttemptId(planAttempt) as AttemptId;
  return promptEvent(promptAttempt, {
    attempt: promptAtt,
    roundPlan: planFor(planAtt),
  });
}

function checkpointEvent(attempt: AttemptId, commit: string): StoredEvent {
  return {
    seq: 1000 + attempt,
    ts: "2026-08-05T12:00:01Z",
    type: "checkpoint",
    lane: laneId,
    commit,
    payload: { attempt },
  };
}

function completedEvents(): StoredEvent[] {
  const p = plan();
  return [
    promptEvent(attemptId, { attempt: attemptId, roundPlan: p }),
    {
      seq: 10,
      ts: "2026-08-05T12:00:01Z",
      type: "checkpoint",
      lane: laneId,
      commit: checkpointIdentity.commit,
      payload: { attempt: attemptId },
    },
    {
      seq: 11,
      ts: "2026-08-05T12:00:02Z",
      type: "state",
      lane: laneId,
      payload: { attempt: attemptId, state: "verifying" },
    },
    {
      seq: 12,
      ts: "2026-08-05T12:00:03Z",
      type: "round_done",
      lane: laneId,
      payload: { attempt: attemptId, outcome: completedOutcome() },
    },
  ];
}

function recoverableEvents(): StoredEvent[] {
  const p = plan();
  return [
    promptEvent(attemptId, { attempt: attemptId, roundPlan: p }),
    checkpointEvent(attemptId, checkpointIdentity.commit),
  ];
}

function baseInput(
  partial: Partial<DecideRoundResumeInput> & {
    readonly events: readonly StoredEvent[];
  },
): DecideRoundResumeInput {
  return {
    runId,
    laneId,
    resumeCount: 0,
    resumeMaxAttempts: 3,
    processState: "inactive",
    lockState: "free",
    ...partial,
  };
}

function noPromptInput(): DecideRoundResumeInput {
  return baseInput({ events: [] });
}

function completedInput(): DecideRoundResumeInput {
  return baseInput({ events: completedEvents() });
}

function legacyInput(): DecideRoundResumeInput {
  return baseInput({ events: [legacyPrompt(1)] });
}

function missingCheckpointInput(): DecideRoundResumeInput {
  return baseInput({
    events: [promptEvent(attemptId, { attempt: attemptId, roundPlan: plan() })],
  });
}

function recoverableInput(
  overrides: Partial<DecideRoundResumeInput> = {},
): DecideRoundResumeInput {
  return baseInput({
    events: recoverableEvents(),
    ...overrides,
  });
}

describe("selectLatestRoundAttempt", () => {
  const selectionCases = [
    { name: "no prompt", events: [] as StoredEvent[], tag: "NoRound" },
    {
      name: "newest prompt has no round plan",
      events: [typedPrompt(1), legacyPrompt(2)],
      tag: "LegacyUnbound",
    },
    {
      name: "newest prompt has an invalid plan",
      events: [typedPrompt(1), invalidPlanPrompt(2)],
      tag: "Invalid",
    },
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
    if (result._tag === "Selected") {
      assert.equal(result.attemptIdentity.attemptId, 3);
    }
  });

  it("rejects a plan whose identity differs from its enclosing prompt", () => {
    const result = selectLatestRoundAttempt(
      [typedPromptWithPlanAttempt(4, 5)],
      runId,
      laneId,
    );
    assert.equal(result._tag, "Invalid");
  });

  it("returns Invalid when plan run identity differs from the requested run", () => {
    const wrongRun = decodeRunId("other-run") as RunId;
    const att = decodeAttemptId(7) as AttemptId;
    const result = selectLatestRoundAttempt(
      [
        promptEvent(7, {
          attempt: att,
          roundPlan: planFor(att, { run: wrongRun }),
        }),
      ],
      runId,
      laneId,
    );
    assert.equal(result._tag, "Invalid");
  });
});

describe("decideRoundResume", () => {
  const safetyCases = [
    {
      processState: "active" as const,
      lockState: "free" as const,
      reason: "prior_attempt_active" as const,
    },
    {
      processState: "unknown" as const,
      lockState: "free" as const,
      reason: "process_state_unknown" as const,
    },
    {
      processState: "inactive" as const,
      lockState: "held" as const,
      reason: "lock_held" as const,
    },
    {
      processState: "inactive" as const,
      lockState: "unknown" as const,
      reason: "lock_state_unknown" as const,
    },
  ] as const;

  for (const c of safetyCases) {
    it(`waits for ${c.reason}`, () => {
      const result = decideRoundResume(
        recoverableInput({
          processState: c.processState,
          lockState: c.lockState,
        }),
      );
      assert.deepEqual(result, {
        _tag: "Wait",
        attemptIdentity: identity,
        reason: c.reason,
      });
    });
  }

  it("returns NoRound when the lane has no prompt", () => {
    assert.equal(decideRoundResume(noPromptInput())._tag, "NoRound");
  });

  it("returns Completed for a durable terminal outcome", () => {
    assert.equal(decideRoundResume(completedInput())._tag, "Completed");
  });

  it("refuses legacy unbound history", () => {
    const result = decideRoundResume(legacyInput());
    assert.equal(result._tag, "Refused");
    if (result._tag === "Refused") {
      assert.equal(result.reason, "legacy_unbound");
    }
  });

  it("refuses missing checkpoint recovery", () => {
    const result = decideRoundResume(missingCheckpointInput());
    assert.equal(result._tag, "Refused");
    if (result._tag === "Refused") {
      assert.equal(result.reason, "checkpoint_missing");
    }
  });

  it("refuses when the resume limit is reached", () => {
    assert.equal(
      decideRoundResume(
        recoverableInput({ resumeCount: 2, resumeMaxAttempts: 2 }),
      )._tag,
      "Refused",
    );
  });

  it("refuses an invalid observation", () => {
    assert.equal(
      decideRoundResume(recoverableInput({ resumeCount: -1 }))._tag,
      "Refused",
    );
  });

  it("returns Resume with exact plan, checkpoint, and empty later argv", () => {
    const resumed = decideRoundResume(recoverableInput());
    assert.equal(resumed._tag, "Resume");
    if (resumed._tag === "Resume") {
      assert.deepEqual(resumed.roundPlan.commandArgv, ["impl", ""]);
      assert.equal(resumed.roundPlan.gateCommand, "npm test");
      assert.equal(resumed.roundPlan.reportPath, "FOREMAN_REPORT.md");
      assert.deepEqual(resumed.checkpointIdentity, checkpointIdentity);
      assert.equal(resumed.nextResumeCount, 1);
    }
  });

  it("prefers Completed over wait observations", () => {
    const result = decideRoundResume(
      baseInput({
        events: completedEvents(),
        processState: "active",
        lockState: "held",
      }),
    );
    assert.equal(result._tag, "Completed");
  });
});
