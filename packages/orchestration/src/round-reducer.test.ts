import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sha256Hex } from "@foreman/core";
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
  type RoundOutcomeV1,
  type RoundPlanV1,
} from "./round-contract.js";
import {
  initialRoundReducerState,
  recoverRoundAttempt,
  reduceRoundEvent,
} from "./round-reducer.js";

const runId = decodeRunId("v030-recover") as RunId;
const laneId = decodeLaneId("grok-r1") as LaneId;
const attemptId = decodeAttemptId(4) as AttemptId;
const identity = makeAttemptIdentity(runId, laneId, attemptId);
const otherAttempt = makeAttemptIdentity(
  runId,
  laneId,
  decodeAttemptId(9) as AttemptId,
);

const digest = sha256Hex("fresh-report");
const presentRaw = presentReportSnapshot(digest, 12);
assert.ok(!("reason" in presentRaw));
assert.equal(presentRaw._tag, "Present");
const present = presentRaw as {
  readonly _tag: "Present";
  readonly digest: string;
  readonly byteLength: number;
};

function plan(): RoundPlanV1 {
  return {
    schemaVersion: 1,
    runId,
    laneId,
    attemptId,
    mode: "round",
    commandArgv: ["impl", ""],
    gateCommand: "npm test",
    reportPath: "FOREMAN_REPORT.md",
    reportBaseline: absentReportSnapshot(),
  };
}

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

function incompleteOutcome(
  reason: "gate_failed" | "report_missing" = "gate_failed",
): RoundOutcomeV1 {
  return {
    _tag: "incomplete",
    attemptIdentity: identity,
    implementationExitCode: 1,
    gateExitCode: reason === "gate_failed" ? 2 : 0,
    reportFresh: false,
    reason,
    reportBaseline: absentReportSnapshot(),
    report: absentReportSnapshot(),
  };
}

let seq = 0;
function ev(
  type: string,
  payload: Record<string, unknown>,
  opts?: { lane?: string; commit?: string },
): StoredEvent {
  seq += 1;
  const base: StoredEvent = {
    seq,
    ts: "2026-08-04T12:00:00Z",
    type,
    lane: opts?.lane ?? laneId,
    payload,
  };
  if (opts?.commit !== undefined) {
    return { ...base, commit: opts.commit };
  }
  return base;
}

function successfulSequence(): StoredEvent[] {
  const p = plan();
  return [
    ev("prompt", { attempt: attemptId, roundPlan: p }),
    ev("ownership", { attempt: attemptId }),
    ev("checkpoint", { attempt: attemptId }, { commit: "abc123def456" }),
    ev("heartbeat", { attempt: attemptId }),
    ev("state", { attempt: attemptId, state: "verifying" }),
    ev("round_done", { attempt: attemptId, outcome: completedOutcome() }),
  ];
}

function incompleteSequence(): StoredEvent[] {
  const p = plan();
  const incomplete = incompleteOutcome("gate_failed");
  return [
    ev("prompt", { attempt: attemptId, roundPlan: p }),
    ev("checkpoint", { attempt: attemptId }, { commit: "ckpt-commit-1" }),
    ev("state", { attempt: attemptId, state: "verifying" }),
    ev("waiting_child", { attempt: attemptId, outcome: incomplete }),
    ev("alert", {
      attempt: attemptId,
      kind: "round_incomplete",
      outcome: incomplete,
    }),
  ];
}

describe("round reducer transitions", () => {
  it("follows successful structural order to Completed", () => {
    let state = initialRoundReducerState();
    for (const event of successfulSequence()) {
      const r = reduceRoundEvent(state, event, identity);
      assert.notEqual(r._tag, "Rejected", event.type);
      state = r.state;
    }
    assert.equal(state.phase, "Completed");
    assert.equal(state.terminalOutcome?._tag, "completed");
  });

  it("keeps Verifying on waiting_child and Incomplete only on matching alert", () => {
    const events = incompleteSequence();
    let state = initialRoundReducerState();
    for (const event of events.slice(0, 4)) {
      const r = reduceRoundEvent(state, event, identity);
      assert.notEqual(r._tag, "Rejected", event.type);
      state = r.state;
    }
    assert.equal(state.phase, "Verifying");
    assert.equal(state.pendingIncomplete?._tag, "incomplete");

    const term = reduceRoundEvent(state, events[4]!, identity);
    assert.equal(term._tag, "Advanced");
    assert.equal(term.state.phase, "Incomplete");
  });

  it("public reducer rejects different lane and attempt without changing state", () => {
    let state = initialRoundReducerState();
    const p = plan();
    state = reduceRoundEvent(
      state,
      ev("prompt", { attempt: attemptId, roundPlan: p }),
      identity,
    ).state;

    const otherAtt = reduceRoundEvent(
      state,
      ev("checkpoint", { attempt: otherAttempt.attemptId }, {
        commit: "other",
      }),
      identity,
    );
    assert.equal(otherAtt._tag, "Rejected");
    assert.equal(otherAtt.reason, "invalid_transition");
    assert.equal(otherAtt.state.phase, "Implementing");
    assert.equal(otherAtt.state.checkpointIdentity, null);

    const otherLane = reduceRoundEvent(
      state,
      ev(
        "checkpoint",
        { attempt: attemptId },
        { lane: "other-lane", commit: "x" },
      ),
      identity,
    );
    assert.equal(otherLane._tag, "Rejected");
    assert.equal(otherLane.reason, "invalid_transition");
    assert.equal(otherLane.state.checkpointIdentity, null);
  });

  it("rejects ownership and heartbeat before prompt and after verifying", () => {
    const unstarted = initialRoundReducerState();
    const beforePrompt = reduceRoundEvent(
      unstarted,
      ev("ownership", { attempt: attemptId }),
      identity,
    );
    assert.equal(beforePrompt._tag, "Rejected");
    assert.equal(beforePrompt.reason, "invalid_transition");

    const beforeHb = reduceRoundEvent(
      unstarted,
      ev("heartbeat", { attempt: attemptId }),
      identity,
    );
    assert.equal(beforeHb._tag, "Rejected");
    assert.equal(beforeHb.reason, "invalid_transition");

    let state = initialRoundReducerState();
    state = reduceRoundEvent(
      state,
      ev("prompt", { attempt: attemptId, roundPlan: plan() }),
      identity,
    ).state;
    // ownership before checkpoint while Implementing is ok
    const mid = reduceRoundEvent(
      state,
      ev("ownership", { attempt: attemptId }),
      identity,
    );
    assert.equal(mid._tag, "Unchanged");
    state = mid.state;
    state = reduceRoundEvent(
      state,
      ev("checkpoint", { attempt: attemptId }, { commit: "c1" }),
      identity,
    ).state;
    // heartbeat after checkpoint while still Implementing is ok
    const afterCkpt = reduceRoundEvent(
      state,
      ev("heartbeat", { attempt: attemptId }),
      identity,
    );
    assert.equal(afterCkpt._tag, "Unchanged");
    state = afterCkpt.state;
    state = reduceRoundEvent(
      state,
      ev("state", { attempt: attemptId, state: "verifying" }),
      identity,
    ).state;
    assert.equal(state.phase, "Verifying");
    const afterVerify = reduceRoundEvent(
      state,
      ev("ownership", { attempt: attemptId }),
      identity,
    );
    assert.equal(afterVerify._tag, "Rejected");
    assert.equal(afterVerify.reason, "invalid_transition");
  });

  it("rejects duplicate prompt and verifying without checkpoint", () => {
    const p = plan();
    let state = initialRoundReducerState();
    state = reduceRoundEvent(
      state,
      ev("prompt", { attempt: attemptId, roundPlan: p }),
      identity,
    ).state;
    const dup = reduceRoundEvent(
      state,
      ev("prompt", { attempt: attemptId, roundPlan: p }),
      identity,
    );
    assert.equal(dup._tag, "Rejected");
    assert.equal(dup.reason, "invalid_transition");

    const earlyVerify = reduceRoundEvent(
      state,
      ev("state", { attempt: attemptId, state: "verifying" }),
      identity,
    );
    assert.equal(earlyVerify._tag, "Rejected");
    assert.equal(earlyVerify.reason, "invalid_transition");
  });
});

describe("recoverRoundAttempt", () => {
  it("returns Completed for terminal round_done and incomplete alert", () => {
    const done = recoverRoundAttempt(successfulSequence(), identity);
    assert.equal(done._tag, "Completed");
    if (done._tag === "Completed") {
      assert.equal(done.outcome._tag, "completed");
      assert.equal(done.attemptIdentity.attemptId, attemptId);
    }

    const inc = recoverRoundAttempt(incompleteSequence(), identity);
    assert.equal(inc._tag, "Completed");
    if (inc._tag === "Completed") {
      assert.equal(inc.outcome._tag, "incomplete");
    }
  });

  it("returns Recoverable after checkpoint when waiting_child alone is nonterminal", () => {
    const p = plan();
    const incomplete = incompleteOutcome();
    const events: StoredEvent[] = [
      ev("prompt", { attempt: attemptId, roundPlan: p }),
      ev("checkpoint", { attempt: attemptId }, { commit: "only-ckpt" }),
      ev("state", { attempt: attemptId, state: "verifying" }),
      ev("waiting_child", { attempt: attemptId, outcome: incomplete }),
    ];
    const r = recoverRoundAttempt(events, identity);
    assert.equal(r._tag, "Recoverable");
    if (r._tag === "Recoverable") {
      assert.equal(r.checkpointIdentity.commit, "only-ckpt");
      assert.equal(r.roundPlan.attemptId, attemptId);
    }
  });

  it("returns Invalid checkpoint_missing when prompt has no later checkpoint", () => {
    const p = plan();
    const events: StoredEvent[] = [
      ev("prompt", { attempt: attemptId, roundPlan: p }),
      ev("ownership", { attempt: attemptId }),
    ];
    const r = recoverRoundAttempt(events, identity);
    assert.equal(r._tag, "Invalid");
    if (r._tag === "Invalid") {
      assert.equal(r.reason, "checkpoint_missing");
    }
  });

  it("returns LegacyUnbound for prompt without roundPlan", () => {
    const events: StoredEvent[] = [
      ev("prompt", { attempt: attemptId, cmd: "legacy" }),
    ];
    const r = recoverRoundAttempt(events, identity);
    assert.equal(r._tag, "LegacyUnbound");
    if (r._tag === "LegacyUnbound") {
      assert.equal(r.attemptIdentity.attemptId, attemptId);
    }
  });

  it("selects only the requested attempt among interleaved events", () => {
    const p = plan();
    const otherPlan: RoundPlanV1 = {
      ...p,
      attemptId: otherAttempt.attemptId,
    };
    const events: StoredEvent[] = [
      ev("prompt", { attempt: otherAttempt.attemptId, roundPlan: otherPlan }),
      ev("prompt", { attempt: attemptId, roundPlan: p }),
      ev(
        "checkpoint",
        { attempt: otherAttempt.attemptId },
        { commit: "wrong" },
      ),
      ev("checkpoint", { attempt: attemptId }, { commit: "right-commit" }),
      ev("state", { attempt: otherAttempt.attemptId, state: "verifying" }),
      ev("state", { attempt: attemptId, state: "verifying" }),
      ev("round_done", {
        attempt: attemptId,
        outcome: completedOutcome(),
      }),
    ];
    const r = recoverRoundAttempt(events, identity);
    assert.equal(r._tag, "Completed");
  });

  it("returns Invalid invalid_transition for checkpoint before prompt", () => {
    const events: StoredEvent[] = [
      ev("checkpoint", { attempt: attemptId }, { commit: "too-early" }),
      ev("prompt", { attempt: attemptId, roundPlan: plan() }),
    ];
    const r = recoverRoundAttempt(events, identity);
    assert.equal(r._tag, "Invalid");
    if (r._tag === "Invalid") {
      assert.equal(r.reason, "invalid_transition");
    }
  });

  it("recovery ignores interleaved valid other-attempt events (prefilter)", () => {
    // Public reducer would Reject other attempts; recovery must prefilter them.
    const p = plan();
    const otherPlan: RoundPlanV1 = {
      ...p,
      attemptId: otherAttempt.attemptId,
    };
    const events: StoredEvent[] = [
      ev("prompt", { attempt: attemptId, roundPlan: p }),
      ev("prompt", { attempt: otherAttempt.attemptId, roundPlan: otherPlan }),
      ev("ownership", { attempt: otherAttempt.attemptId }),
      ev("checkpoint", { attempt: attemptId }, { commit: "mine" }),
      ev(
        "checkpoint",
        { attempt: otherAttempt.attemptId },
        { commit: "theirs" },
      ),
      ev("state", { attempt: attemptId, state: "verifying" }),
      ev("round_done", {
        attempt: attemptId,
        outcome: completedOutcome(),
      }),
    ];
    const r = recoverRoundAttempt(events, identity);
    assert.equal(r._tag, "Completed");
  });

  it("accepts durable gate_failed with null report from first-match hide", () => {
    const incomplete: RoundOutcomeV1 = {
      _tag: "incomplete",
      attemptIdentity: identity,
      implementationExitCode: 0,
      gateExitCode: 4,
      reportFresh: false,
      reason: "gate_failed",
      reportBaseline: absentReportSnapshot(),
      report: null,
    };
    const events: StoredEvent[] = [
      ev("prompt", { attempt: attemptId, roundPlan: plan() }),
      ev("checkpoint", { attempt: attemptId }, { commit: "g1" }),
      ev("state", { attempt: attemptId, state: "verifying" }),
      ev("waiting_child", { attempt: attemptId, outcome: incomplete }),
      ev("alert", {
        attempt: attemptId,
        kind: "round_incomplete",
        outcome: incomplete,
      }),
    ];
    const r = recoverRoundAttempt(events, identity);
    assert.equal(r._tag, "Completed");
    if (r._tag === "Completed") {
      assert.equal(r.outcome._tag, "incomplete");
      if (r.outcome._tag === "incomplete") {
        assert.equal(r.outcome.reason, "gate_failed");
        assert.equal(r.outcome.report, null);
      }
    }
  });

  it("rejects corrupt durable outcomes instead of trusting them", () => {
    // completed shape with nonzero gate is corrupt matrix combination
    const corrupt = {
      _tag: "completed" as const,
      attemptIdentity: identity,
      implementationExitCode: 0,
      gateExitCode: 1,
      reportFresh: true as const,
      reportBaseline: absentReportSnapshot(),
      report: present,
    };
    const events: StoredEvent[] = [
      ev("prompt", { attempt: attemptId, roundPlan: plan() }),
      ev("checkpoint", { attempt: attemptId }, { commit: "g2" }),
      ev("state", { attempt: attemptId, state: "verifying" }),
      ev("round_done", { attempt: attemptId, outcome: corrupt }),
    ];
    const r = recoverRoundAttempt(events, identity);
    assert.equal(r._tag, "Invalid");
    if (r._tag === "Invalid") {
      assert.equal(r.reason, "invalid_payload");
    }
  });

  it("ignores same-lane non-structural note without payload.attempt", () => {
    let state = initialRoundReducerState();
    state = reduceRoundEvent(
      state,
      ev("prompt", { attempt: attemptId, roundPlan: plan() }),
      identity,
    ).state;
    const note = reduceRoundEvent(
      state,
      ev("note", { text: "unbound observer note" }),
      identity,
    );
    assert.equal(note._tag, "Ignored");
    assert.equal(note.state.phase, "Implementing");
    assert.equal(note.state.checkpointIdentity, null);

    // Recovery still completes when an unbound note is interleaved.
    const events: StoredEvent[] = [
      ev("prompt", { attempt: attemptId, roundPlan: plan() }),
      ev("note", { text: "noise" }),
      ev("checkpoint", { attempt: attemptId }, { commit: "n1" }),
      ev("state", { attempt: attemptId, state: "verifying" }),
      ev("round_done", {
        attempt: attemptId,
        outcome: completedOutcome(),
      }),
    ];
    const r = recoverRoundAttempt(events, identity);
    assert.equal(r._tag, "Completed");
  });

  it("rejects bound unknown event type after Completed and Incomplete", () => {
    // After Completed
    let done = initialRoundReducerState();
    for (const event of successfulSequence()) {
      const r = reduceRoundEvent(done, event, identity);
      assert.notEqual(r._tag, "Rejected", event.type);
      done = r.state;
    }
    assert.equal(done.phase, "Completed");
    const bogusDone = reduceRoundEvent(
      done,
      ev("bogus", { attempt: attemptId }),
      identity,
    );
    assert.equal(bogusDone._tag, "Rejected");
    assert.equal(bogusDone.reason, "unknown_event_type");
    assert.equal(bogusDone.state.phase, "Completed");

    // After Incomplete
    let inc = initialRoundReducerState();
    for (const event of incompleteSequence()) {
      const r = reduceRoundEvent(inc, event, identity);
      assert.notEqual(r._tag, "Rejected", event.type);
      inc = r.state;
    }
    assert.equal(inc.phase, "Incomplete");
    const bogusInc = reduceRoundEvent(
      inc,
      ev("bogus", { attempt: attemptId }),
      identity,
    );
    assert.equal(bogusInc._tag, "Rejected");
    assert.equal(bogusInc.reason, "unknown_event_type");
    assert.equal(bogusInc.state.phase, "Incomplete");
  });

  it("rejects completed outcome whose baseline differs from the bound plan baseline", () => {
    // Plan baseline is present with the same digest as the report. A corrupt
    // completed outcome claims Absent baseline so the decoder would allow
    // completed; binding to the plan must reject it.
    const planBaseline = present;
    const boundPlan: RoundPlanV1 = {
      ...plan(),
      reportBaseline: planBaseline,
    };
    // Completes only if baseline is absent or digest differs — corrupt claim.
    const falseCompleted: RoundOutcomeV1 = {
      _tag: "completed",
      attemptIdentity: identity,
      implementationExitCode: 0,
      gateExitCode: 0,
      reportFresh: true,
      reportBaseline: absentReportSnapshot(),
      report: present,
    };

    let state = initialRoundReducerState();
    state = reduceRoundEvent(
      state,
      ev("prompt", { attempt: attemptId, roundPlan: boundPlan }),
      identity,
    ).state;
    state = reduceRoundEvent(
      state,
      ev("checkpoint", { attempt: attemptId }, { commit: "base-bind-c" }),
      identity,
    ).state;
    state = reduceRoundEvent(
      state,
      ev("state", { attempt: attemptId, state: "verifying" }),
      identity,
    ).state;
    const rejected = reduceRoundEvent(
      state,
      ev("round_done", { attempt: attemptId, outcome: falseCompleted }),
      identity,
    );
    assert.equal(rejected._tag, "Rejected");
    assert.equal(rejected.reason, "conflicting_outcome");
    assert.equal(rejected.state.phase, "Verifying");

    const recovered = recoverRoundAttempt(
      [
        ev("prompt", { attempt: attemptId, roundPlan: boundPlan }),
        ev("checkpoint", { attempt: attemptId }, { commit: "base-bind-c2" }),
        ev("state", { attempt: attemptId, state: "verifying" }),
        ev("round_done", { attempt: attemptId, outcome: falseCompleted }),
      ],
      identity,
    );
    assert.equal(recovered._tag, "Invalid");
    if (recovered._tag === "Invalid") {
      assert.equal(recovered.reason, "conflicting_outcome");
    }
  });

  it("rejects incomplete outcome whose baseline differs from the bound plan baseline", () => {
    const planBaseline = present;
    const boundPlan: RoundPlanV1 = {
      ...plan(),
      reportBaseline: planBaseline,
    };
    // Valid incomplete shape (report_missing) but baseline is Absent, not plan's Present.
    const falseIncomplete: RoundOutcomeV1 = {
      _tag: "incomplete",
      attemptIdentity: identity,
      implementationExitCode: 0,
      gateExitCode: 0,
      reportFresh: false,
      reason: "report_missing",
      reportBaseline: absentReportSnapshot(),
      report: absentReportSnapshot(),
    };

    let state = initialRoundReducerState();
    state = reduceRoundEvent(
      state,
      ev("prompt", { attempt: attemptId, roundPlan: boundPlan }),
      identity,
    ).state;
    state = reduceRoundEvent(
      state,
      ev("checkpoint", { attempt: attemptId }, { commit: "base-bind-i" }),
      identity,
    ).state;
    state = reduceRoundEvent(
      state,
      ev("state", { attempt: attemptId, state: "verifying" }),
      identity,
    ).state;
    const wait = reduceRoundEvent(
      state,
      ev("waiting_child", { attempt: attemptId, outcome: falseIncomplete }),
      identity,
    );
    assert.equal(wait._tag, "Rejected");
    assert.equal(wait.reason, "conflicting_outcome");
    assert.equal(wait.state.pendingIncomplete, null);

    // Recovery: waiting_child then alert both carry the mismatched baseline.
    const recovered = recoverRoundAttempt(
      [
        ev("prompt", { attempt: attemptId, roundPlan: boundPlan }),
        ev("checkpoint", { attempt: attemptId }, { commit: "base-bind-i2" }),
        ev("state", { attempt: attemptId, state: "verifying" }),
        ev("waiting_child", { attempt: attemptId, outcome: falseIncomplete }),
        ev("alert", {
          attempt: attemptId,
          kind: "round_incomplete",
          outcome: falseIncomplete,
        }),
      ],
      identity,
    );
    assert.equal(recovered._tag, "Invalid");
    if (recovered._tag === "Invalid") {
      assert.equal(recovered.reason, "conflicting_outcome");
    }
  });
});
