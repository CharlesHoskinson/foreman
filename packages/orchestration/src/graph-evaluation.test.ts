import assert from "node:assert/strict";
import test from "node:test";
import { canonicalize, sha256Hex } from "@foreman/core";
import {
  buildGraphEvaluationReportV1,
  type GraphEvaluationObservationV1,
} from "./graph-evaluation.js";

const encoder = new TextEncoder();

function canonicalFile(value: unknown): Uint8Array {
  return encoder.encode(`${canonicalize(value)}\n`);
}

function runSet(
  observations: readonly GraphEvaluationObservationV1[],
): Uint8Array {
  return canonicalFile({
    observations,
    plannedRuns: 2000,
    schema: "foreman.graph-evaluation-run-set.v1",
  });
}

function completeRuns(input: {
  readonly baselinePasses: number;
  readonly graphPasses: number;
}): readonly GraphEvaluationObservationV1[] {
  const rows: GraphEvaluationObservationV1[] = [];
  for (let pairId = 1; pairId <= 1000; pairId += 1) {
    rows.push({
      arm: "baseline",
      outcome: pairId <= input.baselinePasses ? "PASS" : "FAIL",
      pairId,
    });
    rows.push({
      arm: "graph",
      outcome: pairId <= input.graphPasses ? "PASS" : "FAIL",
      pairId,
    });
  }
  return rows;
}

test("an unmeasured release is explicit and keeps graph context off", () => {
  const bytes = runSet([]);
  const result = buildGraphEvaluationReportV1(bytes);
  assert.equal(result._tag, "Built");
  if (result._tag !== "Built") return;
  assert.deepEqual(result.report, {
    baselinePasses: 0,
    completedRuns: 0,
    graphDefault: "off",
    graphPasses: 0,
    notRunRuns: 2000,
    plannedRuns: 2000,
    result: "GRAPH_OFF_UNCOMPUTABLE",
    runSetSha256: sha256Hex(bytes),
    schema: "foreman.graph-evaluation-report.v1",
    unavailableRuns: 0,
  });
  assert.equal(
    new TextDecoder().decode(result.reportBytes),
    `${canonicalize(result.report)}\n`,
  );
  assert.equal(result.sha256, sha256Hex(result.reportBytes));
});

test("a complete paired run set promotes only a measured graph win", () => {
  for (const [baselinePasses, graphPasses, expected] of [
    [600, 601, "PROMOTE"],
    [601, 600, "GRAPH_OFF_FAILED"],
    [600, 600, "GRAPH_OFF_INCONCLUSIVE"],
  ] as const) {
    const result = buildGraphEvaluationReportV1(
      runSet(completeRuns({ baselinePasses, graphPasses })),
    );
    assert.equal(result._tag, "Built");
    if (result._tag !== "Built") continue;
    assert.equal(result.report.result, expected);
    assert.equal(result.report.graphDefault, expected === "PROMOTE" ? "on" : "off");
    assert.equal(result.report.completedRuns, 2000);
    assert.equal(result.report.unavailableRuns, 0);
    assert.equal(result.report.notRunRuns, 0);
  }
});

test("partial and unavailable observations are uncomputable", () => {
  for (const observations of [
    [{ arm: "baseline", outcome: "PASS", pairId: 1 }],
    [
      { arm: "baseline", outcome: "UNAVAILABLE", pairId: 1 },
      { arm: "graph", outcome: "PASS", pairId: 1 },
    ],
  ] as const) {
    const result = buildGraphEvaluationReportV1(runSet(observations));
    assert.equal(result._tag, "Built");
    if (result._tag !== "Built") continue;
    assert.equal(result.report.result, "GRAPH_OFF_UNCOMPUTABLE");
    assert.equal(result.report.graphDefault, "off");
  }
});

test("the run-set decoder rejects ambiguous or noncanonical authority", () => {
  const valid = {
    observations: [{ arm: "baseline", outcome: "PASS", pairId: 1 }],
    plannedRuns: 2000,
    schema: "foreman.graph-evaluation-run-set.v1",
  } as const;
  for (const bytes of [
    encoder.encode(JSON.stringify(valid)),
    encoder.encode(`${JSON.stringify(valid, null, 2)}\n`),
    canonicalFile({ ...valid, extra: true }),
    canonicalFile({ ...valid, plannedRuns: 1999 }),
    canonicalFile({ ...valid, observations: [...valid.observations, ...valid.observations] }),
    canonicalFile({ ...valid, observations: [{ arm: "other", outcome: "PASS", pairId: 1 }] }),
    canonicalFile({ ...valid, observations: [{ arm: "baseline", outcome: "PASS", pairId: 0 }] }),
    canonicalFile({ ...valid, observations: [{ arm: "baseline", outcome: "UNKNOWN", pairId: 1 }] }),
    Uint8Array.of(0xff),
    new Uint8Array(16 * 1024 * 1024 + 1),
  ]) {
    assert.deepEqual(buildGraphEvaluationReportV1(bytes), {
      _tag: "Invalid",
      reason: "invalid_run_set",
      schemaVersion: 1,
    });
  }
});

test("the public evaluator is total for hostile runtime inputs", () => {
  for (const value of [null, undefined, "x", {}, new Proxy({}, { get() { throw new Error("boom"); } })]) {
    assert.doesNotThrow(() => buildGraphEvaluationReportV1(value as Uint8Array));
    assert.equal(buildGraphEvaluationReportV1(value as Uint8Array)._tag, "Invalid");
  }
});
