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
  absentReportSnapshot,
  presentReportSnapshot,
} from "./round-contract.js";
import {
  decideRoundOutcome,
  isReportFresh,
} from "./report-freshness.js";

const identity = makeAttemptIdentity(
  decodeRunId("run-fresh") as RunId,
  decodeLaneId("lane-a") as LaneId,
  decodeAttemptId(2) as AttemptId,
);

const digA = sha256Hex("content-a");
const digB = sha256Hex("content-b");
const emptyDig = sha256Hex("");

describe("isReportFresh", () => {
  it("treats absent baseline + nonempty present as fresh", () => {
    const post = presentReportSnapshot(digA, 10);
    assert.ok(post && !("reason" in post));
    assert.equal(isReportFresh(absentReportSnapshot(), post), true);
  });

  it("rejects empty present, absent post-gate, and identical digest", () => {
    const empty = presentReportSnapshot(emptyDig, 0);
    assert.ok(empty && !("reason" in empty));
    assert.equal(isReportFresh(absentReportSnapshot(), empty), false);
    assert.equal(
      isReportFresh(absentReportSnapshot(), absentReportSnapshot()),
      false,
    );

    const baseline = presentReportSnapshot(digA, 10);
    const same = presentReportSnapshot(digA, 10);
    assert.ok(baseline && !("reason" in baseline));
    assert.ok(same && !("reason" in same));
    assert.equal(isReportFresh(baseline, same), false);

    const changed = presentReportSnapshot(digB, 11);
    assert.ok(changed && !("reason" in changed));
    assert.equal(isReportFresh(baseline, changed), true);
  });

  it("uses digest identity only: equal digest with different lengths is not fresh", () => {
    const baseline = presentReportSnapshot(digA, 10);
    const sameDigestDiffLen = presentReportSnapshot(digA, 42);
    assert.ok(baseline && !("reason" in baseline));
    assert.ok(sameDigestDiffLen && !("reason" in sameDigestDiffLen));
    assert.notEqual(baseline.byteLength, sameDigestDiffLen.byteLength);
    assert.equal(isReportFresh(baseline, sameDigestDiffLen), false);
  });
});

describe("decideRoundOutcome first-match order", () => {
  const baseline = absentReportSnapshot();
  const present = presentReportSnapshot(digB, 4);
  assert.ok(present && !("reason" in present));

  it("1. nonzero gate selects gate_failed even when report is missing", () => {
    const out = decideRoundOutcome({
      attemptIdentity: identity,
      implementationExitCode: 0,
      gateExitCode: 7,
      reportBaseline: baseline,
      postGate: { _tag: "Snapshot", snapshot: absentReportSnapshot() },
    });
    assert.equal(out._tag, "incomplete");
    if (out._tag === "incomplete") {
      assert.equal(out.reason, "gate_failed");
      assert.equal(out.reportFresh, false);
    }
  });

  it("1b. nonzero gate hides reader failures as gate_failed with report null", () => {
    for (const reason of ["report_too_large", "report_read_failed"] as const) {
      const out = decideRoundOutcome({
        attemptIdentity: identity,
        implementationExitCode: 1,
        gateExitCode: 5,
        reportBaseline: baseline,
        postGate: { _tag: "Failure", reason },
      });
      assert.equal(out._tag, "incomplete", reason);
      if (out._tag === "incomplete") {
        assert.equal(out.reason, "gate_failed", reason);
        assert.equal(out.report, null, reason);
      }
    }
  });

  it("6b. equal digest with different lengths selects report_unchanged", () => {
    const basePresent = presentReportSnapshot(digA, 5);
    const postDiffLen = presentReportSnapshot(digA, 50);
    assert.ok(basePresent && !("reason" in basePresent));
    assert.ok(postDiffLen && !("reason" in postDiffLen));
    const out = decideRoundOutcome({
      attemptIdentity: identity,
      implementationExitCode: 0,
      gateExitCode: 0,
      reportBaseline: basePresent,
      postGate: { _tag: "Snapshot", snapshot: postDiffLen },
    });
    assert.equal(out._tag, "incomplete");
    if (out._tag === "incomplete") {
      assert.equal(out.reason, "report_unchanged");
    }
  });

  it("2-3. reader failures select report_too_large then report_read_failed", () => {
    const large = decideRoundOutcome({
      attemptIdentity: identity,
      implementationExitCode: 0,
      gateExitCode: 0,
      reportBaseline: baseline,
      postGate: { _tag: "Failure", reason: "report_too_large" },
    });
    assert.equal(large._tag, "incomplete");
    if (large._tag === "incomplete") {
      assert.equal(large.reason, "report_too_large");
      assert.equal(large.report, null);
    }

    const read = decideRoundOutcome({
      attemptIdentity: identity,
      implementationExitCode: 0,
      gateExitCode: 0,
      reportBaseline: baseline,
      postGate: { _tag: "Failure", reason: "report_read_failed" },
    });
    assert.equal(read._tag, "incomplete");
    if (read._tag === "incomplete") {
      assert.equal(read.reason, "report_read_failed");
      assert.equal(read.report, null);
    }
  });

  it("4-6. missing, empty, unchanged then 7. completed", () => {
    const missing = decideRoundOutcome({
      attemptIdentity: identity,
      implementationExitCode: 0,
      gateExitCode: 0,
      reportBaseline: baseline,
      postGate: { _tag: "Snapshot", snapshot: absentReportSnapshot() },
    });
    assert.equal(missing._tag, "incomplete");
    if (missing._tag === "incomplete") {
      assert.equal(missing.reason, "report_missing");
    }

    const emptySnap = presentReportSnapshot(emptyDig, 0);
    assert.ok(emptySnap && !("reason" in emptySnap));
    const empty = decideRoundOutcome({
      attemptIdentity: identity,
      implementationExitCode: 0,
      gateExitCode: 0,
      reportBaseline: baseline,
      postGate: { _tag: "Snapshot", snapshot: emptySnap },
    });
    assert.equal(empty._tag, "incomplete");
    if (empty._tag === "incomplete") {
      assert.equal(empty.reason, "report_empty");
    }

    const basePresent = presentReportSnapshot(digA, 5);
    assert.ok(basePresent && !("reason" in basePresent));
    const same = presentReportSnapshot(digA, 5);
    assert.ok(same && !("reason" in same));
    const unchanged = decideRoundOutcome({
      attemptIdentity: identity,
      implementationExitCode: 0,
      gateExitCode: 0,
      reportBaseline: basePresent,
      postGate: { _tag: "Snapshot", snapshot: same },
    });
    assert.equal(unchanged._tag, "incomplete");
    if (unchanged._tag === "incomplete") {
      assert.equal(unchanged.reason, "report_unchanged");
    }

    const done = decideRoundOutcome({
      attemptIdentity: identity,
      implementationExitCode: 3,
      gateExitCode: 0,
      reportBaseline: baseline,
      postGate: { _tag: "Snapshot", snapshot: present },
    });
    assert.equal(done._tag, "completed");
    if (done._tag === "completed") {
      assert.equal(done.reportFresh, true);
      assert.equal(done.gateExitCode, 0);
      assert.equal(done.implementationExitCode, 3);
      assert.equal(done.attemptIdentity.attemptId, 2);
    }
  });
});
