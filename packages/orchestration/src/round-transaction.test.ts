import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Effect, Layer } from "effect";
import { sha256Hex } from "@foreman/core";
import {
  decodeAttemptId,
  decodeLaneId,
  decodeRunId,
  makeAttemptIdentity,
  type AttemptId,
  type LaneId,
  type RunId,
} from "@foreman/event-log";
import {
  absentReportSnapshot,
  presentReportSnapshot,
  type RoundOutcomeV1,
  type RoundRequestV1,
} from "./round-contract.js";
import type { ReportReadResult } from "./report-freshness.js";
import {
  AttemptAllocator,
  CheckpointCapture,
  GateCommand,
  ImplementationCommand,
  ReportSnapshotReader,
  RoundBoundaryFailure,
  RoundEventSink,
  runRoundTransaction,
  type RoundEventDraft,
} from "./round-transaction.js";

const runId = decodeRunId("v030-tx") as RunId;
const laneId = decodeLaneId("grok-r2") as LaneId;
const attemptId = decodeAttemptId(7) as AttemptId;
const identity = makeAttemptIdentity(runId, laneId, attemptId);

const digFresh = sha256Hex("fresh-bytes");
const digBase = sha256Hex("base-bytes");

type TxServices =
  | AttemptAllocator
  | RoundEventSink
  | ReportSnapshotReader
  | ImplementationCommand
  | CheckpointCapture
  | GateCommand;

function request(): RoundRequestV1 {
  return {
    runId,
    laneId,
    commandArgv: ["worker", "--mode", ""],
    gateCommand: "gate check",
    reportPath: "FOREMAN_REPORT.md",
  };
}

type BoundaryCounts = {
  allocate: number;
  read: number;
  impl: number;
  checkpoint: number;
  gate: number;
  append: number;
};

type Harness = {
  readonly events: RoundEventDraft[];
  implArgv: readonly string[] | null;
  readonly counts: BoundaryCounts;
  readonly layer: Layer.Layer<TxServices, never, never>;
};

function makeHarness(opts: {
  readonly allocate?: Effect.Effect<
    typeof identity,
    RoundBoundaryFailure
  >;
  readonly baseline?: ReportReadResult;
  readonly postGate?: ReportReadResult;
  readonly implExit?: number;
  readonly gateExit?: number;
  readonly commit?: string;
  readonly failAppendAt?: RoundEventDraft["type"];
  readonly implFail?: boolean;
}): Harness {
  const events: RoundEventDraft[] = [];
  const box: { implArgv: readonly string[] | null } = { implArgv: null };
  const counts: BoundaryCounts = {
    allocate: 0,
    read: 0,
    impl: 0,
    checkpoint: 0,
    gate: 0,
    append: 0,
  };
  let readCount = 0;

  const baseline = opts.baseline ?? {
    _tag: "Snapshot" as const,
    snapshot: absentReportSnapshot(),
  };
  const postPresent = presentReportSnapshot(digFresh, 11);
  if (postPresent === null || typeof postPresent !== "object" || !("_tag" in postPresent) || postPresent._tag !== "Present") {
    throw new Error("test fixture digest failed");
  }
  const postGate = opts.postGate ?? {
    _tag: "Snapshot" as const,
    snapshot: postPresent,
  };

  const allocate = opts.allocate ?? Effect.succeed(identity);

  const layer = Layer.mergeAll(
    Layer.succeed(AttemptAllocator, {
      allocate: () => {
        counts.allocate += 1;
        return allocate;
      },
    }),
    Layer.succeed(RoundEventSink, {
      append: (event) => {
        counts.append += 1;
        if (
          opts.failAppendAt !== undefined &&
          event.type === opts.failAppendAt
        ) {
          return Effect.fail(new RoundBoundaryFailure("append_failed"));
        }
        events.push(event);
        return Effect.void;
      },
    }),
    Layer.succeed(ReportSnapshotReader, {
      read: () => {
        counts.read += 1;
        readCount += 1;
        if (readCount === 1) {
          return Effect.succeed(baseline);
        }
        return Effect.succeed(postGate);
      },
    }),
    Layer.succeed(ImplementationCommand, {
      run: (argv) => {
        counts.impl += 1;
        if (opts.implFail) {
          return Effect.fail(
            new RoundBoundaryFailure("implementation_transport_failed"),
          );
        }
        box.implArgv = argv;
        return Effect.succeed(opts.implExit ?? 0);
      },
    }),
    Layer.succeed(CheckpointCapture, {
      capture: () => {
        counts.checkpoint += 1;
        return Effect.succeed(opts.commit ?? "ckpt-sha-deadbeef");
      },
    }),
    Layer.succeed(GateCommand, {
      run: () => {
        counts.gate += 1;
        return Effect.succeed(opts.gateExit ?? 0);
      },
    }),
  );

  return {
    events,
    counts,
    get implArgv() {
      return box.implArgv;
    },
    set implArgv(v: readonly string[] | null) {
      box.implArgv = v;
    },
    layer,
  };
}

function run(
  harness: Harness,
  req: RoundRequestV1 = request(),
): Promise<
  | { readonly _tag: "ok"; readonly outcome: RoundOutcomeV1 }
  | { readonly _tag: "err"; readonly error: RoundBoundaryFailure }
> {
  return Effect.runPromise(
    Effect.either(runRoundTransaction(req).pipe(Effect.provide(harness.layer))),
  ).then((either) => {
    if (either._tag === "Right") {
      return { _tag: "ok" as const, outcome: either.right };
    }
    return { _tag: "err" as const, error: either.left };
  });
}

describe("runRoundTransaction", () => {
  it("records successful event order and preserves commandArgv exactly", async () => {
    const h = makeHarness({});
    const result = await run(h);
    assert.equal(result._tag, "ok");
    if (result._tag !== "ok") return;

    assert.equal(result.outcome._tag, "completed");
    assert.deepEqual(h.implArgv, ["worker", "--mode", ""]);

    const types = h.events.map((e) => e.type);
    assert.deepEqual(types, [
      "prompt",
      "checkpoint",
      "state",
      "round_done",
    ]);

    const prompt = h.events[0];
    assert.ok(prompt && prompt.type === "prompt");
    assert.equal(prompt.payload.attempt, 7);
    assert.equal(prompt.payload.roundPlan.attemptId, 7);
    assert.deepEqual(prompt.payload.roundPlan.commandArgv, [
      "worker",
      "--mode",
      "",
    ]);

    const ckpt = h.events[1];
    assert.ok(ckpt && ckpt.type === "checkpoint");
    assert.equal(ckpt.commit, "ckpt-sha-deadbeef");
    assert.equal(ckpt.payload.attempt, 7);

    const done = h.events[3];
    assert.ok(done && done.type === "round_done");
    assert.equal(done.payload.outcome._tag, "completed");
  });

  it("runs the gate after nonzero implementation exit", async () => {
    const h = makeHarness({
      implExit: 3,
      gateExit: 0,
      postGate: {
        _tag: "Snapshot",
        snapshot: presentReportSnapshot(digFresh, 5) as {
          readonly _tag: "Present";
          readonly digest: string;
          readonly byteLength: number;
        },
      },
    });
    const result = await run(h);
    assert.equal(result._tag, "ok");
    if (result._tag !== "ok") return;
    assert.equal(result.outcome._tag, "completed");
    if (result.outcome._tag === "completed") {
      assert.equal(result.outcome.implementationExitCode, 3);
    }
    assert.ok(h.events.some((e) => e.type === "state"));
    assert.ok(h.events.some((e) => e.type === "round_done"));
  });

  it("records waiting_child then round_incomplete on gate failure", async () => {
    const h = makeHarness({ gateExit: 9 });
    const result = await run(h);
    assert.equal(result._tag, "ok");
    if (result._tag !== "ok") return;
    assert.equal(result.outcome._tag, "incomplete");
    if (result.outcome._tag === "incomplete") {
      assert.equal(result.outcome.reason, "gate_failed");
    }
    const types = h.events.map((e) => e.type);
    assert.deepEqual(types, [
      "prompt",
      "checkpoint",
      "state",
      "waiting_child",
      "alert",
    ]);
    const alert = h.events[4];
    assert.ok(alert && alert.type === "alert");
    assert.equal(alert.payload.kind, "round_incomplete");
    assert.equal(alert.payload.outcome._tag, "incomplete");
  });

  it("fails closed on prompt append and does not start implementation", async () => {
    const h = makeHarness({ failAppendAt: "prompt" });
    const result = await run(h);
    assert.equal(result._tag, "err");
    if (result._tag !== "err") return;
    assert.equal(result.error.reason, "append_failed");
    assert.equal(h.implArgv, null);
    assert.equal(h.events.length, 0);
  });

  it("fails closed on allocation and does not invent attempt 1", async () => {
    const h = makeHarness({
      allocate: Effect.fail(new RoundBoundaryFailure("allocation_failed")),
    });
    const result = await run(h);
    assert.equal(result._tag, "err");
    if (result._tag !== "err") return;
    assert.equal(result.error.reason, "allocation_failed");
    assert.equal(h.events.length, 0);
  });

  it("fails closed on baseline read failure before prompt", async () => {
    const h = makeHarness({
      baseline: { _tag: "Failure", reason: "report_read_failed" },
    });
    const result = await run(h);
    assert.equal(result._tag, "err");
    if (result._tag !== "err") return;
    assert.equal(result.error.reason, "baseline_read_failed");
    assert.equal(h.events.length, 0);
  });

  it("uses content identity for incomplete report_unchanged", async () => {
    const same = presentReportSnapshot(digBase, 8);
    assert.ok(same && !("reason" in same));
    const h = makeHarness({
      baseline: { _tag: "Snapshot", snapshot: same },
      postGate: { _tag: "Snapshot", snapshot: same },
    });
    const result = await run(h);
    assert.equal(result._tag, "ok");
    if (result._tag !== "ok") return;
    assert.equal(result.outcome._tag, "incomplete");
    if (result.outcome._tag === "incomplete") {
      assert.equal(result.outcome.reason, "report_unchanged");
    }
  });

  it("gate_failed with post-gate reader failure yields report null and decodes", async () => {
    const { decodeRoundOutcomeV1, isRoundContractFailure } = await import(
      "./round-contract.js"
    );
    for (const reason of ["report_too_large", "report_read_failed"] as const) {
      const h = makeHarness({
        gateExit: 3,
        postGate: { _tag: "Failure", reason },
      });
      const result = await run(h);
      assert.equal(result._tag, "ok", reason);
      if (result._tag !== "ok") return;
      assert.equal(result.outcome._tag, "incomplete", reason);
      if (result.outcome._tag === "incomplete") {
        assert.equal(result.outcome.reason, "gate_failed", reason);
        assert.equal(result.outcome.report, null, reason);
        const decoded = decodeRoundOutcomeV1(result.outcome);
        assert.ok(!isRoundContractFailure(decoded), reason);
      }
    }
  });

  it("rejects invalid public requests before any injected boundary", async () => {
    const cases: Array<{ label: string; req: RoundRequestV1 }> = [
      {
        label: "empty_argv",
        req: { ...request(), commandArgv: [] as unknown as readonly string[] },
      },
      {
        label: "empty_first",
        req: { ...request(), commandArgv: ["", "tail"] },
      },
      {
        label: "nul_arg",
        req: { ...request(), commandArgv: ["ok", "a\0b"] },
      },
      {
        label: "nul_gate",
        req: { ...request(), gateCommand: "true\0" },
      },
      {
        label: "nul_path",
        req: { ...request(), reportPath: "x\0y" },
      },
    ];
    for (const c of cases) {
      const h = makeHarness({});
      const result = await run(h, c.req);
      assert.equal(result._tag, "err", c.label);
      if (result._tag !== "err") return;
      assert.equal(result.error.reason, "invalid_request", c.label);
      assert.equal(h.events.length, 0, c.label);
      assert.equal(h.counts.allocate, 0, c.label);
      assert.equal(h.counts.read, 0, c.label);
      assert.equal(h.counts.impl, 0, c.label);
      assert.equal(h.counts.checkpoint, 0, c.label);
      assert.equal(h.counts.gate, 0, c.label);
      assert.equal(h.counts.append, 0, c.label);
    }
  });

  it("rejects extra attemptId on a structurally compatible request without projecting keys", async () => {
    // Structural TypeScript compatibility: a value with extra fields is still
    // assignable to RoundRequestV1 when the target type is not a fresh literal
    // check site. Projection that rebuilds only known keys would strip this.
    const base = request();
    const polluted = {
      runId: base.runId,
      laneId: base.laneId,
      commandArgv: base.commandArgv,
      gateCommand: base.gateCommand,
      reportPath: base.reportPath,
      attemptId: 1,
    };
    const asRequest: RoundRequestV1 = polluted;
    const h = makeHarness({});
    const result = await run(h, asRequest);
    assert.equal(result._tag, "err");
    if (result._tag !== "err") return;
    assert.equal(result.error.reason, "invalid_request");
    assert.equal(h.events.length, 0);
    assert.equal(h.counts.allocate, 0);
    assert.equal(h.counts.read, 0);
    assert.equal(h.counts.impl, 0);
    assert.equal(h.counts.checkpoint, 0);
    assert.equal(h.counts.gate, 0);
    assert.equal(h.counts.append, 0);
  });

  it("type-level terminal draft outcomes are closed by tag", () => {
    // Compile-time witnesses: @ts-expect-error must fire until draft types close.
    const completed = {
      _tag: "completed" as const,
      attemptIdentity: identity,
      implementationExitCode: 0,
      gateExitCode: 0 as const,
      reportFresh: true as const,
      reportBaseline: absentReportSnapshot(),
      report: presentReportSnapshot(digFresh, 4) as {
        readonly _tag: "Present";
        readonly digest: string;
        readonly byteLength: number;
      },
    };
    const incomplete = {
      _tag: "incomplete" as const,
      attemptIdentity: identity,
      implementationExitCode: 0,
      gateExitCode: 1,
      reportFresh: false as const,
      reason: "gate_failed" as const,
      reportBaseline: absentReportSnapshot(),
      report: null,
    };

    const okDone: RoundEventDraft = {
      type: "round_done",
      lane: laneId,
      payload: { attempt: 7, outcome: completed },
    };
    const okWait: RoundEventDraft = {
      type: "waiting_child",
      lane: laneId,
      payload: { attempt: 7, outcome: incomplete },
    };
    const okAlert: RoundEventDraft = {
      type: "alert",
      lane: laneId,
      payload: {
        attempt: 7,
        kind: "round_incomplete",
        outcome: incomplete,
      },
    };

    // @ts-expect-error incomplete outcome is not valid on round_done draft
    const badDone: RoundEventDraft = {
      type: "round_done",
      lane: laneId,
      payload: { attempt: 7, outcome: incomplete },
    };
    // @ts-expect-error completed outcome is not valid on waiting_child draft
    const badWait: RoundEventDraft = {
      type: "waiting_child",
      lane: laneId,
      payload: { attempt: 7, outcome: completed },
    };
    // @ts-expect-error completed outcome is not valid on round_incomplete alert draft
    const badAlert: RoundEventDraft = {
      type: "alert",
      lane: laneId,
      payload: {
        attempt: 7,
        kind: "round_incomplete",
        outcome: completed,
      },
    };

    assert.equal(okDone.type, "round_done");
    assert.equal(okWait.type, "waiting_child");
    assert.equal(okAlert.type, "alert");
    // keep references so trees are not dead-code-eliminated for humans reading the test
    assert.ok(badDone);
    assert.ok(badWait);
    assert.ok(badAlert);
  });
});
