import {
  canonicalize,
  isCoreFailure,
  parseJsonRejectDuplicateKeys,
  sha256Hex,
} from "@foreman/core";

const encoder = new TextEncoder();
const MAX_RUN_SET_BYTES = 16 * 1024 * 1024;
const PLANNED_RUNS = 2000 as const;
const PAIR_COUNT = PLANNED_RUNS / 2;

export type GraphEvaluationArmV1 = "baseline" | "graph";
export type GraphEvaluationOutcomeV1 = "PASS" | "FAIL" | "UNAVAILABLE";

export type GraphEvaluationObservationV1 = {
  readonly arm: GraphEvaluationArmV1;
  readonly outcome: GraphEvaluationOutcomeV1;
  readonly pairId: number;
};

export type GraphEvaluationRunSetV1 = {
  readonly schema: "foreman.graph-evaluation-run-set.v1";
  readonly plannedRuns: 2000;
  readonly observations: readonly GraphEvaluationObservationV1[];
};

export type GraphEvaluationReportV1 = {
  readonly schema: "foreman.graph-evaluation-report.v1";
  readonly runSetSha256: string;
  readonly plannedRuns: 2000;
  readonly completedRuns: number;
  readonly unavailableRuns: number;
  readonly notRunRuns: number;
  readonly baselinePasses: number;
  readonly graphPasses: number;
  readonly result:
    | "PROMOTE"
    | "GRAPH_OFF_FAILED"
    | "GRAPH_OFF_INCONCLUSIVE"
    | "GRAPH_OFF_UNCOMPUTABLE";
  readonly graphDefault: "on" | "off";
};

export type GraphEvaluationBuildResultV1 =
  | {
      readonly schemaVersion: 1;
      readonly _tag: "Built";
      readonly report: GraphEvaluationReportV1;
      readonly reportBytes: Uint8Array;
      readonly sha256: string;
    }
  | {
      readonly schemaVersion: 1;
      readonly _tag: "Invalid";
      readonly reason: "invalid_run_set";
    };

function invalid(): GraphEvaluationBuildResultV1 {
  return { schemaVersion: 1, _tag: "Invalid", reason: "invalid_run_set" };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expected.length &&
    expected.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

function parseRunSet(bytes: Uint8Array): GraphEvaluationRunSetV1 | null {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_RUN_SET_BYTES) {
    return null;
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch {
    return null;
  }
  if (!text.endsWith("\n") || text.endsWith("\r\n")) return null;
  const body = text.slice(0, -1);
  const decoded = parseJsonRejectDuplicateKeys(body);
  if (isCoreFailure(decoded) || canonicalize(decoded) !== body) return null;
  const value = JSON.parse(body) as unknown;
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, ["schema", "plannedRuns", "observations"]) ||
    value.schema !== "foreman.graph-evaluation-run-set.v1" ||
    value.plannedRuns !== PLANNED_RUNS ||
    !Array.isArray(value.observations) ||
    value.observations.length > PLANNED_RUNS
  ) {
    return null;
  }

  const observations: GraphEvaluationObservationV1[] = [];
  let previousOrder = 0;
  for (const raw of value.observations) {
    if (
      !isPlainObject(raw) ||
      !hasExactKeys(raw, ["arm", "outcome", "pairId"]) ||
      (raw.arm !== "baseline" && raw.arm !== "graph") ||
      (raw.outcome !== "PASS" &&
        raw.outcome !== "FAIL" &&
        raw.outcome !== "UNAVAILABLE") ||
      !Number.isSafeInteger(raw.pairId) ||
      (raw.pairId as number) < 1 ||
      (raw.pairId as number) > PAIR_COUNT
    ) {
      return null;
    }
    const order = ((raw.pairId as number) - 1) * 2 + (raw.arm === "graph" ? 2 : 1);
    if (order <= previousOrder) return null;
    previousOrder = order;
    observations.push({
      arm: raw.arm,
      outcome: raw.outcome,
      pairId: raw.pairId as number,
    });
  }
  return {
    schema: "foreman.graph-evaluation-run-set.v1",
    plannedRuns: PLANNED_RUNS,
    observations,
  };
}

export function buildGraphEvaluationReportV1(
  runSetBytes: Uint8Array,
): GraphEvaluationBuildResultV1 {
  try {
    const runSet = parseRunSet(runSetBytes);
    if (runSet === null) return invalid();

    let completedRuns = 0;
    let unavailableRuns = 0;
    let baselinePasses = 0;
    let graphPasses = 0;
    for (const observation of runSet.observations) {
      if (observation.outcome === "UNAVAILABLE") {
        unavailableRuns += 1;
      } else {
        completedRuns += 1;
        if (observation.outcome === "PASS") {
          if (observation.arm === "baseline") baselinePasses += 1;
          else graphPasses += 1;
        }
      }
    }
    const notRunRuns = PLANNED_RUNS - runSet.observations.length;
    let result: GraphEvaluationReportV1["result"] =
      "GRAPH_OFF_UNCOMPUTABLE";
    if (completedRuns === PLANNED_RUNS && unavailableRuns === 0 && notRunRuns === 0) {
      if (graphPasses > baselinePasses) result = "PROMOTE";
      else if (graphPasses < baselinePasses) result = "GRAPH_OFF_FAILED";
      else result = "GRAPH_OFF_INCONCLUSIVE";
    }
    const report: GraphEvaluationReportV1 = {
      schema: "foreman.graph-evaluation-report.v1",
      runSetSha256: sha256Hex(runSetBytes),
      plannedRuns: PLANNED_RUNS,
      completedRuns,
      unavailableRuns,
      notRunRuns,
      baselinePasses,
      graphPasses,
      result,
      graphDefault: result === "PROMOTE" ? "on" : "off",
    };
    const reportBytes = encoder.encode(`${canonicalize(report)}\n`);
    return {
      schemaVersion: 1,
      _tag: "Built",
      report,
      reportBytes,
      sha256: sha256Hex(reportBytes),
    };
  } catch {
    return invalid();
  }
}
