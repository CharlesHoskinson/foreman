// packages/orchestration/src/graph-evaluation-main.ts
import { lstatSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";

// packages/core/src/failures.ts
var CORE_FAILURE_BRAND = Symbol("@foreman/core/CoreFailure");
function duplicateJsonKey() {
  return { [CORE_FAILURE_BRAND]: true, _tag: "DuplicateJsonKey" };
}
function invalidJson() {
  return { [CORE_FAILURE_BRAND]: true, _tag: "InvalidJson" };
}
function isCoreFailure(v) {
  return typeof v === "object" && v !== null && v[CORE_FAILURE_BRAND] === true;
}

// packages/core/src/sha256.ts
import { createHash } from "node:crypto";
function sha256Hex(data) {
  const hash = createHash("sha256");
  if (typeof data === "string") {
    hash.update(data, "utf8");
  } else {
    hash.update(data);
  }
  return hash.digest("hex");
}

// packages/core/src/canonical-json.ts
var PARSE_FAIL = Symbol("@foreman/core/parseFail");
function parseFail(failure) {
  return { [PARSE_FAIL]: true, failure };
}
function isParseFail(v) {
  return typeof v === "object" && v !== null && v[PARSE_FAIL] === true;
}
function parseJsonRejectDuplicateKeys(text) {
  let i = 0;
  const s = text;
  let depth = 0;
  function skipWs() {
    while (i < s.length) {
      const c = s.charCodeAt(i);
      if (c === 32 || c === 9 || c === 10 || c === 13) {
        i += 1;
      } else {
        break;
      }
    }
  }
  function peek() {
    return i < s.length ? s[i] : "";
  }
  function fail() {
    return parseFail(invalidJson());
  }
  function parseString() {
    if (peek() !== '"') return fail();
    i += 1;
    let out = "";
    while (i < s.length) {
      const c = s[i];
      if (c === '"') {
        i += 1;
        return out;
      }
      if (c === "\\") {
        i += 1;
        if (i >= s.length) return fail();
        const e = s[i];
        i += 1;
        switch (e) {
          case '"':
          case "\\":
          case "/":
            out += e;
            break;
          case "b":
            out += "\b";
            break;
          case "f":
            out += "\f";
            break;
          case "n":
            out += "\n";
            break;
          case "r":
            out += "\r";
            break;
          case "t":
            out += "	";
            break;
          case "u": {
            if (i + 4 > s.length) return fail();
            const hex = s.slice(i, i + 4);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) return fail();
            out += String.fromCharCode(parseInt(hex, 16));
            i += 4;
            break;
          }
          default:
            return fail();
        }
      } else if (c.charCodeAt(0) < 32) {
        return fail();
      } else {
        out += c;
        i += 1;
      }
    }
    return fail();
  }
  function parseNumber() {
    const start = i;
    if (peek() === "-") i += 1;
    if (peek() < "0" || peek() > "9") return fail();
    if (peek() === "0") {
      i += 1;
      if (peek() >= "0" && peek() <= "9") return fail();
    } else {
      while (peek() >= "0" && peek() <= "9") i += 1;
    }
    if (peek() === ".") {
      i += 1;
      if (peek() < "0" || peek() > "9") return fail();
      while (peek() >= "0" && peek() <= "9") i += 1;
    }
    if (peek() === "e" || peek() === "E") {
      i += 1;
      if (peek() === "+" || peek() === "-") i += 1;
      if (peek() < "0" || peek() > "9") return fail();
      while (peek() >= "0" && peek() <= "9") i += 1;
    }
    const num = Number(s.slice(start, i));
    if (!Number.isFinite(num)) return fail();
    return num;
  }
  function parseValue() {
    skipWs();
    const c = peek();
    if (c === '"') return parseString();
    if (c === "{") return parseObject();
    if (c === "[") return parseArray();
    if (c === "t") {
      if (s.slice(i, i + 4) !== "true") return fail();
      i += 4;
      return true;
    }
    if (c === "f") {
      if (s.slice(i, i + 5) !== "false") return fail();
      i += 5;
      return false;
    }
    if (c === "n") {
      if (s.slice(i, i + 4) !== "null") return fail();
      i += 4;
      return null;
    }
    if (c === "-" || c >= "0" && c <= "9") return parseNumber();
    return fail();
  }
  function parseObject() {
    if (depth >= 64) return fail();
    depth += 1;
    if (peek() !== "{") return fail();
    i += 1;
    skipWs();
    const obj = /* @__PURE__ */ Object.create(null);
    const seen = /* @__PURE__ */ new Set();
    if (peek() === "}") {
      i += 1;
      depth -= 1;
      return obj;
    }
    while (true) {
      skipWs();
      const key = parseString();
      if (isParseFail(key)) return key;
      if (seen.has(key)) return parseFail(duplicateJsonKey());
      seen.add(key);
      skipWs();
      if (peek() !== ":") return fail();
      i += 1;
      const val = parseValue();
      if (isParseFail(val)) return val;
      Object.defineProperty(obj, key, {
        value: val,
        writable: true,
        enumerable: true,
        configurable: true
      });
      skipWs();
      if (peek() === ",") {
        i += 1;
        continue;
      }
      if (peek() === "}") {
        i += 1;
        depth -= 1;
        return obj;
      }
      return fail();
    }
  }
  function parseArray() {
    if (depth >= 64) return fail();
    depth += 1;
    if (peek() !== "[") return fail();
    i += 1;
    skipWs();
    const arr = [];
    if (peek() === "]") {
      i += 1;
      depth -= 1;
      return arr;
    }
    while (true) {
      const val = parseValue();
      if (isParseFail(val)) return val;
      arr.push(val);
      skipWs();
      if (peek() === ",") {
        i += 1;
        continue;
      }
      if (peek() === "]") {
        i += 1;
        depth -= 1;
        return arr;
      }
      return fail();
    }
  }
  const value = parseValue();
  if (isParseFail(value)) {
    return value.failure;
  }
  skipWs();
  if (i !== s.length) {
    return invalidJson();
  }
  return value;
}
function canonicalize(value) {
  if (value === null) return "null";
  if (value === true) return "true";
  if (value === false) return "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("non_finite_number");
    }
    if (Object.is(value, -0)) return "0";
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map((v) => canonicalize(v)).join(",") + "]";
  }
  if (typeof value === "object") {
    const obj = value;
    const keys = Object.keys(obj).sort();
    const parts = [];
    for (const k of keys) {
      parts.push(JSON.stringify(k) + ":" + canonicalize(obj[k]));
    }
    return "{" + parts.join(",") + "}";
  }
  throw new Error("unsupported_json_value");
}

// packages/orchestration/src/graph-evaluation.ts
var encoder = new TextEncoder();
var MAX_RUN_SET_BYTES = 16 * 1024 * 1024;
var PLANNED_RUNS = 2e3;
var PAIR_COUNT = PLANNED_RUNS / 2;
function invalid() {
  return { schemaVersion: 1, _tag: "Invalid", reason: "invalid_run_set" };
}
function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function hasExactKeys(value, expected) {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}
function parseRunSet(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_RUN_SET_BYTES) {
    return null;
  }
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes
    );
  } catch {
    return null;
  }
  if (!text.endsWith("\n") || text.endsWith("\r\n")) return null;
  const body = text.slice(0, -1);
  const decoded = parseJsonRejectDuplicateKeys(body);
  if (isCoreFailure(decoded) || canonicalize(decoded) !== body) return null;
  const value = JSON.parse(body);
  if (!isPlainObject(value) || !hasExactKeys(value, ["schema", "plannedRuns", "observations"]) || value.schema !== "foreman.graph-evaluation-run-set.v1" || value.plannedRuns !== PLANNED_RUNS || !Array.isArray(value.observations) || value.observations.length > PLANNED_RUNS) {
    return null;
  }
  const observations = [];
  let previousOrder = 0;
  for (const raw of value.observations) {
    if (!isPlainObject(raw) || !hasExactKeys(raw, ["arm", "outcome", "pairId"]) || raw.arm !== "baseline" && raw.arm !== "graph" || raw.outcome !== "PASS" && raw.outcome !== "FAIL" && raw.outcome !== "UNAVAILABLE" || !Number.isSafeInteger(raw.pairId) || raw.pairId < 1 || raw.pairId > PAIR_COUNT) {
      return null;
    }
    const order = (raw.pairId - 1) * 2 + (raw.arm === "graph" ? 2 : 1);
    if (order <= previousOrder) return null;
    previousOrder = order;
    observations.push({
      arm: raw.arm,
      outcome: raw.outcome,
      pairId: raw.pairId
    });
  }
  return {
    schema: "foreman.graph-evaluation-run-set.v1",
    plannedRuns: PLANNED_RUNS,
    observations
  };
}
function buildGraphEvaluationReportV1(runSetBytes) {
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
    let result = "GRAPH_OFF_UNCOMPUTABLE";
    if (completedRuns === PLANNED_RUNS && unavailableRuns === 0 && notRunRuns === 0) {
      if (graphPasses > baselinePasses) result = "PROMOTE";
      else if (graphPasses < baselinePasses) result = "GRAPH_OFF_FAILED";
      else result = "GRAPH_OFF_INCONCLUSIVE";
    }
    const report = {
      schema: "foreman.graph-evaluation-report.v1",
      runSetSha256: sha256Hex(runSetBytes),
      plannedRuns: PLANNED_RUNS,
      completedRuns,
      unavailableRuns,
      notRunRuns,
      baselinePasses,
      graphPasses,
      result,
      graphDefault: result === "PROMOTE" ? "on" : "off"
    };
    const reportBytes = encoder.encode(`${canonicalize(report)}
`);
    return {
      schemaVersion: 1,
      _tag: "Built",
      report,
      reportBytes,
      sha256: sha256Hex(reportBytes)
    };
  } catch {
    return invalid();
  }
}

// packages/orchestration/src/graph-evaluation-main.ts
var MAX_RUN_SET_BYTES2 = 16 * 1024 * 1024;
var USAGE = "usage: graph-evaluation report --run-set ABS\n";
function readBounded(path) {
  const before = lstatSync(path);
  if (!before.isFile() || before.isSymbolicLink() || before.size > MAX_RUN_SET_BYTES2) {
    throw new Error("invalid file");
  }
  const bytes = readFileSync(path);
  const after = lstatSync(path);
  if (bytes.byteLength > MAX_RUN_SET_BYTES2 || !after.isFile() || after.isSymbolicLink() || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
    throw new Error("file changed");
  }
  return Uint8Array.from(bytes);
}
var args = process.argv.slice(2);
var exitCode = 0;
if (args.length !== 3 || args[0] !== "report" || args[1] !== "--run-set" || args[2] === void 0 || !isAbsolute(args[2])) {
  process.stderr.write(USAGE);
  exitCode = 64;
} else {
  try {
    const result = buildGraphEvaluationReportV1(readBounded(args[2]));
    if (result._tag === "Built") {
      process.stdout.write(result.reportBytes);
    } else {
      process.stderr.write("graph-evaluation: refused\n");
      exitCode = 1;
    }
  } catch {
    process.stderr.write("graph-evaluation: refused\n");
    exitCode = 1;
  }
}
process.exitCode = exitCode;
