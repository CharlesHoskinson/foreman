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
} from "@foreman/event-log";
import {
  MAX_COMMAND_ARGV_ENTRIES,
  MAX_COMMAND_ARGV_TOTAL_BYTES,
  MAX_COMMAND_ARG_BYTES,
  MAX_GATE_COMMAND_BYTES,
  MAX_REPORT_CONTENT_BYTES,
  MAX_REPORT_PATH_BYTES,
  absentReportSnapshot,
  decodeCommandArgv,
  decodeReportSnapshotV1,
  decodeRoundOutcomeV1,
  decodeRoundPlanV1,
  decodeRoundRequestV1,
  isRoundContractFailure,
  presentReportSnapshot,
  utf8ByteLength,
} from "./round-contract.js";

const runId = decodeRunId("v030-round-r2") as RunId;
const laneId = decodeLaneId("grok-r1") as LaneId;
const attemptId = decodeAttemptId(3) as AttemptId;
const digestA = sha256Hex("report-a");
const digestB = sha256Hex("report-b");

function validPlanFields() {
  return {
    schemaVersion: 1 as const,
    runId,
    laneId,
    attemptId,
    mode: "round" as const,
    commandArgv: ["tool", "--flag", ""],
    gateCommand: "npm test",
    reportPath: "FOREMAN_REPORT.md",
    reportBaseline: { _tag: "Absent" as const },
  };
}

describe("ReportSnapshotV1", () => {
  it("decodes Absent and Present including empty file as Present byteLength 0", () => {
    const absent = decodeReportSnapshotV1({ _tag: "Absent" });
    assert.ok(!isRoundContractFailure(absent));
    assert.deepEqual(absent, { _tag: "Absent" });

    const empty = presentReportSnapshot(sha256Hex(""), 0);
    assert.ok(!isRoundContractFailure(empty));
    assert.equal(empty._tag, "Present");
    assert.equal(empty.byteLength, 0);

    const decoded = decodeReportSnapshotV1(empty);
    assert.ok(!isRoundContractFailure(decoded));
    assert.deepEqual(decoded, empty);
  });

  it("rejects non-lowercase digest and oversize content", () => {
    const badHex = decodeReportSnapshotV1({
      _tag: "Present",
      digest: digestA.toUpperCase(),
      byteLength: 1,
    });
    assert.ok(isRoundContractFailure(badHex));
    assert.equal(badHex.reason, "invalid_digest");

    const over = presentReportSnapshot(digestA, MAX_REPORT_CONTENT_BYTES + 1);
    assert.ok(isRoundContractFailure(over));
    assert.equal(over.reason, "bound_exceeded");
  });
});

describe("RoundRequestV1 / RoundPlanV1", () => {
  it("decodes a request without attemptId or reportBaseline", () => {
    const req = decodeRoundRequestV1({
      runId,
      laneId,
      commandArgv: ["impl", ""],
      gateCommand: "true",
      reportPath: "out.md",
    });
    assert.ok(!isRoundContractFailure(req));
    assert.equal(req.commandArgv[1], "");
    assert.deepEqual(req.commandArgv, ["impl", ""]);
  });

  it("rejects request fields that invent attempt or baseline", () => {
    const withAttempt = decodeRoundRequestV1({
      runId,
      laneId,
      attemptId: 1,
      commandArgv: ["impl"],
      gateCommand: "true",
      reportPath: "out.md",
    });
    assert.ok(isRoundContractFailure(withAttempt));
  });

  it("decodes a complete round plan and preserves argv entries exactly", () => {
    const plan = decodeRoundPlanV1(validPlanFields());
    assert.ok(!isRoundContractFailure(plan));
    assert.equal(plan.mode, "round");
    assert.equal(plan.schemaVersion, 1);
    assert.deepEqual(plan.commandArgv, ["tool", "--flag", ""]);
  });

  it("rejects NUL in argv, gate, and report path", () => {
    assert.equal(
      (decodeCommandArgv(["ok", "a\0b"]) as { reason: string }).reason,
      "nul_rejected",
    );
    const plan = decodeRoundPlanV1({
      ...validPlanFields(),
      gateCommand: "true\0",
    });
    assert.ok(isRoundContractFailure(plan));
    assert.equal(plan.reason, "nul_rejected");

    const path = decodeRoundPlanV1({
      ...validPlanFields(),
      reportPath: "x\0y",
    });
    assert.ok(isRoundContractFailure(path));
    assert.equal(path.reason, "nul_rejected");
  });

  it("enforces UTF-8 byte bounds on argv total and path", () => {
    // Each entry under per-arg limit but total over.
    const entry = "x".repeat(MAX_COMMAND_ARG_BYTES);
    const count = Math.floor(MAX_COMMAND_ARGV_TOTAL_BYTES / MAX_COMMAND_ARG_BYTES) + 1;
    assert.ok(count <= MAX_COMMAND_ARGV_ENTRIES);
    const many = Array.from({ length: count }, () => entry);
    const total = decodeCommandArgv(many);
    assert.ok(isRoundContractFailure(total));
    assert.equal(total.reason, "bound_exceeded");

    const pathBytes = "p".repeat(MAX_REPORT_PATH_BYTES + 1);
    assert.ok(utf8ByteLength(pathBytes) > MAX_REPORT_PATH_BYTES);
    const path = decodeRoundPlanV1({
      ...validPlanFields(),
      reportPath: pathBytes,
    });
    assert.ok(isRoundContractFailure(path));
    assert.equal(path.reason, "bound_exceeded");
  });

  it("rejects empty argv and empty first entry; keeps later empty entries", () => {
    assert.ok(isRoundContractFailure(decodeCommandArgv([])));
    assert.ok(isRoundContractFailure(decodeCommandArgv([""])));
    const kept = decodeCommandArgv(["cmd", "", "tail"]);
    assert.ok(!isRoundContractFailure(kept));
    assert.deepEqual(kept, ["cmd", "", "tail"]);
  });

  it("rejects gate command over the UTF-8 byte bound", () => {
    const gate = "g".repeat(MAX_GATE_COMMAND_BYTES + 1);
    const plan = decodeRoundPlanV1({
      ...validPlanFields(),
      gateCommand: gate,
    });
    assert.ok(isRoundContractFailure(plan));
    assert.equal(plan.reason, "bound_exceeded");
  });
});

describe("RoundOutcomeV1", () => {
  const identity = makeAttemptIdentity(runId, laneId, attemptId);
  const present = presentReportSnapshot(digestB, 8) as {
    readonly _tag: "Present";
    readonly digest: string;
    readonly byteLength: number;
  };

  it("decodes completed and incomplete outcomes with attempt identity", () => {
    const completed = decodeRoundOutcomeV1({
      _tag: "completed",
      attemptIdentity: identity,
      implementationExitCode: 0,
      gateExitCode: 0,
      reportFresh: true,
      reportBaseline: absentReportSnapshot(),
      report: present,
    });
    assert.ok(!isRoundContractFailure(completed));
    assert.equal(completed._tag, "completed");
    assert.equal(completed.attemptIdentity.attemptId, 3);

    const incomplete = decodeRoundOutcomeV1({
      _tag: "incomplete",
      attemptIdentity: identity,
      implementationExitCode: 1,
      gateExitCode: 2,
      reportFresh: false,
      reason: "gate_failed",
      reportBaseline: absentReportSnapshot(),
      report: { _tag: "Absent" },
    });
    assert.ok(!isRoundContractFailure(incomplete));
    assert.equal(incomplete._tag, "incomplete");
    if (incomplete._tag === "incomplete") {
      assert.equal(incomplete.reason, "gate_failed");
    }
  });

  it("allows null report for gate_failed, report_too_large, and report_read_failed", () => {
    for (const reason of [
      "gate_failed",
      "report_too_large",
      "report_read_failed",
    ] as const) {
      const ok = decodeRoundOutcomeV1({
        _tag: "incomplete",
        attemptIdentity: identity,
        implementationExitCode: 0,
        gateExitCode: reason === "gate_failed" ? 2 : 0,
        reportFresh: false,
        reason,
        reportBaseline: absentReportSnapshot(),
        report: null,
      });
      assert.ok(!isRoundContractFailure(ok), reason);
    }

    const bad = decodeRoundOutcomeV1({
      _tag: "incomplete",
      attemptIdentity: identity,
      implementationExitCode: 0,
      gateExitCode: 0,
      reportFresh: false,
      reason: "report_missing",
      reportBaseline: absentReportSnapshot(),
      report: null,
    });
    assert.ok(isRoundContractFailure(bad));
    assert.equal(bad.reason, "invalid_outcome_shape");
  });

  it("enforces the closed first-match outcome matrix", () => {
    // completed: reject same-digest present baseline
    const sameBase = presentReportSnapshot(digestB, 8) as {
      readonly _tag: "Present";
      readonly digest: string;
      readonly byteLength: number;
    };
    const completedSame = decodeRoundOutcomeV1({
      _tag: "completed",
      attemptIdentity: identity,
      implementationExitCode: 0,
      gateExitCode: 0,
      reportFresh: true,
      reportBaseline: sameBase,
      report: present,
    });
    assert.ok(isRoundContractFailure(completedSame));
    assert.equal(completedSame.reason, "invalid_outcome_shape");

    // gate_failed requires nonzero gate exit
    const gateZero = decodeRoundOutcomeV1({
      _tag: "incomplete",
      attemptIdentity: identity,
      implementationExitCode: 0,
      gateExitCode: 0,
      reportFresh: false,
      reason: "gate_failed",
      reportBaseline: absentReportSnapshot(),
      report: { _tag: "Absent" },
    });
    assert.ok(isRoundContractFailure(gateZero));
    assert.equal(gateZero.reason, "invalid_outcome_shape");

    // report_too_large / report_read_failed require gate 0 and null report
    const largeWithSnap = decodeRoundOutcomeV1({
      _tag: "incomplete",
      attemptIdentity: identity,
      implementationExitCode: 0,
      gateExitCode: 0,
      reportFresh: false,
      reason: "report_too_large",
      reportBaseline: absentReportSnapshot(),
      report: present,
    });
    assert.ok(isRoundContractFailure(largeWithSnap));

    const readWithGate = decodeRoundOutcomeV1({
      _tag: "incomplete",
      attemptIdentity: identity,
      implementationExitCode: 0,
      gateExitCode: 3,
      reportFresh: false,
      reason: "report_read_failed",
      reportBaseline: absentReportSnapshot(),
      report: null,
    });
    assert.ok(isRoundContractFailure(readWithGate));

    // report_missing requires Absent
    const missingPresent = decodeRoundOutcomeV1({
      _tag: "incomplete",
      attemptIdentity: identity,
      implementationExitCode: 0,
      gateExitCode: 0,
      reportFresh: false,
      reason: "report_missing",
      reportBaseline: absentReportSnapshot(),
      report: present,
    });
    assert.ok(isRoundContractFailure(missingPresent));

    // report_empty requires Present zero-length
    const emptyAbsent = decodeRoundOutcomeV1({
      _tag: "incomplete",
      attemptIdentity: identity,
      implementationExitCode: 0,
      gateExitCode: 0,
      reportFresh: false,
      reason: "report_empty",
      reportBaseline: absentReportSnapshot(),
      report: { _tag: "Absent" },
    });
    assert.ok(isRoundContractFailure(emptyAbsent));

    // report_unchanged: both nonempty Present, same digest (lengths may differ)
    const baseLen = presentReportSnapshot(digestA, 3) as {
      readonly _tag: "Present";
      readonly digest: string;
      readonly byteLength: number;
    };
    const postLen = presentReportSnapshot(digestA, 99) as {
      readonly _tag: "Present";
      readonly digest: string;
      readonly byteLength: number;
    };
    const unchanged = decodeRoundOutcomeV1({
      _tag: "incomplete",
      attemptIdentity: identity,
      implementationExitCode: 0,
      gateExitCode: 0,
      reportFresh: false,
      reason: "report_unchanged",
      reportBaseline: baseLen,
      report: postLen,
    });
    assert.ok(!isRoundContractFailure(unchanged));

    const unchangedDiff = decodeRoundOutcomeV1({
      _tag: "incomplete",
      attemptIdentity: identity,
      implementationExitCode: 0,
      gateExitCode: 0,
      reportFresh: false,
      reason: "report_unchanged",
      reportBaseline: baseLen,
      report: present,
    });
    assert.ok(isRoundContractFailure(unchangedDiff));
  });
});
