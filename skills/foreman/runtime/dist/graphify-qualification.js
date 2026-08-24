// packages/orchestration/src/graphify-qualification-main.ts
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  accessSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync as mkdirSync2,
  mkdtempSync,
  readFileSync as readFileSync2,
  realpathSync,
  renameSync,
  rmSync as rmSync2,
  statSync,
  writeFileSync as writeFileSync2
} from "node:fs";
import { tmpdir } from "node:os";
import {
  delimiter,
  dirname,
  isAbsolute as isAbsolute2,
  join as join2,
  relative,
  resolve,
  sep
} from "node:path";

// packages/core/src/failures.ts
var CORE_FAILURE_BRAND = Symbol("@foreman/core/CoreFailure");
function malformedUtf8() {
  return { [CORE_FAILURE_BRAND]: true, _tag: "MalformedUtf8" };
}
function oversizeInput(maxBytes) {
  return { [CORE_FAILURE_BRAND]: true, _tag: "OversizeInput", maxBytes };
}
function duplicateJsonKey() {
  return { [CORE_FAILURE_BRAND]: true, _tag: "DuplicateJsonKey" };
}
function invalidJson() {
  return { [CORE_FAILURE_BRAND]: true, _tag: "InvalidJson" };
}
function isCoreFailure(v) {
  return typeof v === "object" && v !== null && v[CORE_FAILURE_BRAND] === true;
}

// packages/core/src/utf8.ts
var MAX_INPUT_BYTES = 1048576;
function decodeUtf8Fatal(bytes) {
  if (bytes.byteLength > MAX_INPUT_BYTES) {
    return oversizeInput(MAX_INPUT_BYTES);
  }
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    return decoder.decode(bytes);
  } catch {
    return malformedUtf8();
  }
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

// packages/core/src/decode.ts
var SHA256_HEX = /^[0-9a-f]{64}$/;
var COMMIT_SHA40 = /^[0-9a-f]{40}$/;
function isSha256Hex(value) {
  return SHA256_HEX.test(value);
}
function isCommitSha40(value) {
  return COMMIT_SHA40.test(value);
}

// packages/orchestration/src/graphify-qualification.ts
import {
  mkdirSync,
  readFileSync,
  rmSync,
  rmdirSync,
  writeFileSync
} from "node:fs";
import { basename, isAbsolute, join } from "node:path";
var encoder = new TextEncoder();
var GRAPHIFY_VERSION = "0.9.48";
var TRACKED_SOURCE_EXTENSIONS = /* @__PURE__ */ new Set([
  ".cjs",
  ".js",
  ".jsx",
  ".mjs",
  ".py",
  ".ts",
  ".tsx"
]);
var GRAPH_ROOT_KEYS = [
  "directed",
  "graph",
  "hyperedges",
  "links",
  "multigraph",
  "nodes"
];
var GRAPH_ROOT_KEYS_WITH_COMMIT = [
  "built_at_commit",
  ...GRAPH_ROOT_KEYS
];
var DIAGNOSTIC_KEYS = [
  "danglingEndpointEdges",
  "missingEndpointEdges",
  "nonObjectEdges"
];
var METADATA_KEYS = [
  "cadence",
  "directed",
  "endpointOrderCount",
  "generatedAt",
  "graphSha256",
  "graphifyVersion",
  "healthSha256",
  "inputTokens",
  "interpreter",
  "lastRefreshFailed",
  "normalizedGraphSha256",
  "outputTokens",
  "renames",
  "schema",
  "sourceCommit",
  "sourceFileCount"
];
function refused(reason) {
  return { schemaVersion: 1, _tag: "Refused", reason };
}
function plainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function exactKeys(value, keys) {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function noControls(value) {
  return !/[\u0000-\u001f\u007f]/u.test(value);
}
function safeRelativePath(value) {
  if (value.length === 0 || !noControls(value) || value.includes("\\") || isAbsolute(value) || /^[A-Za-z]:/u.test(value)) {
    return false;
  }
  const segments = value.split("/");
  return segments.every(
    (segment) => segment.length > 0 && segment !== "." && segment !== ".."
  );
}
function isTrackedGraphifySourcePathV1(path) {
  if (!safeRelativePath(path) || path.startsWith("skills/") || path.startsWith("openspec/changes/archive/")) {
    return false;
  }
  const dot = path.lastIndexOf(".");
  return dot >= 0 && TRACKED_SOURCE_EXTENSIONS.has(path.slice(dot).toLowerCase());
}
function jsonValue(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(jsonValue);
  return plainObject(value) && Object.values(value).every(jsonValue);
}
function utf8Compare(left, right) {
  return Buffer.from(left).compare(Buffer.from(right));
}
function canonicalCompare(left, right) {
  return utf8Compare(canonicalize(left), canonicalize(right));
}
function parseJsonBytes(bytes) {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const parsed = parseJsonRejectDuplicateKeys(text.trimEnd());
    return isCoreFailure(parsed) ? null : parsed;
  } catch {
    return null;
  }
}
function parseGraph(bytes) {
  const value = parseJsonBytes(bytes);
  if (!plainObject(value) || !exactKeys(value, GRAPH_ROOT_KEYS) && !exactKeys(value, GRAPH_ROOT_KEYS_WITH_COMMIT) || Object.hasOwn(value, "built_at_commit") && typeof value["built_at_commit"] !== "string") {
    return null;
  }
  if (typeof value["directed"] !== "boolean" || typeof value["multigraph"] !== "boolean" || !plainObject(value["graph"]) || !Array.isArray(value["hyperedges"]) || !value["hyperedges"].every(jsonValue) || !Array.isArray(value["nodes"]) || !Array.isArray(value["links"])) {
    return null;
  }
  const nodes = [];
  for (const node of value["nodes"]) {
    if (!plainObject(node) || !jsonValue(node) || typeof node["id"] !== "string" || node["id"].length === 0 || !noControls(node["id"]) || typeof node["label"] !== "string" || !noControls(node["label"]) || typeof node["source_file"] !== "string" || node["source_location"] !== void 0 && typeof node["source_location"] !== "string") {
      return null;
    }
    nodes.push(node);
  }
  const links = [];
  for (const link of value["links"]) {
    if (!plainObject(link) || !jsonValue(link) || typeof link["source"] !== "string" || typeof link["target"] !== "string" || typeof link["relation"] !== "string" || typeof link["source_file"] !== "string" || link["source_location"] !== void 0 && typeof link["source_location"] !== "string") {
      return null;
    }
    links.push(link);
  }
  return {
    ...typeof value["built_at_commit"] === "string" ? { built_at_commit: value["built_at_commit"] } : {},
    directed: value["directed"],
    graph: value["graph"],
    hyperedges: value["hyperedges"],
    links,
    multigraph: value["multigraph"],
    nodes
  };
}
function normalizeGraph(graph) {
  const withoutDeferredCommunity = (node) => {
    const { community: _community, ...retained } = node;
    return retained;
  };
  return {
    ...graph.built_at_commit === void 0 ? {} : { built_at_commit: graph.built_at_commit },
    directed: graph.directed,
    graph: graph.graph,
    hyperedges: [...graph.hyperedges].sort(canonicalCompare),
    links: [...graph.links].sort(
      (left, right) => utf8Compare(
        `${left.source}\0${left.target}\0${left.relation}\0${left.source_file}\0${left.source_location}`,
        `${right.source}\0${right.target}\0${right.relation}\0${right.source_file}\0${right.source_location}`
      )
    ),
    multigraph: graph.multigraph,
    nodes: graph.nodes.map(withoutDeferredCommunity).sort((left, right) => utf8Compare(left.id, right.id))
  };
}
function graphHealth(graph) {
  const nodeIds = /* @__PURE__ */ new Set();
  const sourceFiles = /* @__PURE__ */ new Set();
  let externalNodeCount = 0;
  for (const node of graph.nodes) {
    if (nodeIds.has(node.id)) return "duplicate_node";
    nodeIds.add(node.id);
    if (node.source_location === void 0) {
      externalNodeCount += 1;
    } else {
      if (!safeRelativePath(node.source_file) || node.source_location.length === 0 || !noControls(node.source_location)) {
        return "invalid_source";
      }
      sourceFiles.add(node.source_file);
    }
  }
  const linkKeys = /* @__PURE__ */ new Set();
  let endpointOrderCount = 0;
  let unlocatedDynamicImportCount = 0;
  for (const link of graph.links) {
    if (!safeRelativePath(link.source_file)) return "invalid_source";
    if (link.source_location === void 0) {
      if (link.relation !== "dynamic_import") return "invalid_source";
      unlocatedDynamicImportCount += 1;
    } else {
      if (link.source_location.length === 0 || !noControls(link.source_location)) {
        return "invalid_source";
      }
    }
    if (!nodeIds.has(link.source) || !nodeIds.has(link.target)) {
      return "dangling_endpoint";
    }
    const key = `${link.source}\0${link.target}\0${link.relation}`;
    if (linkKeys.has(key)) return "duplicate_link";
    linkKeys.add(key);
    if (utf8Compare(link.source, link.target) > 0) endpointOrderCount += 1;
    sourceFiles.add(link.source_file);
  }
  if (graph.links.length > 0 && endpointOrderCount === 0) {
    return "endpoint_order_lost";
  }
  return {
    directed: graph.directed,
    endpointOrderCount,
    externalNodeCount,
    linkCount: graph.links.length,
    nodeCount: graph.nodes.length,
    sourceFiles: [...sourceFiles].sort(utf8Compare),
    unlocatedDynamicImportCount
  };
}
function diagnosticsValid(value) {
  return plainObject(value) && exactKeys(value, DIAGNOSTIC_KEYS) && DIAGNOSTIC_KEYS.every(
    (key) => Number.isSafeInteger(value[key]) && value[key] === 0
  );
}
function validTimestamp(value) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(value);
}
function renameLabel(label, oldPath, newPath) {
  if (label === oldPath) return newPath;
  if (label === basename(oldPath)) return basename(newPath);
  return label;
}
function deriveRenames(previous, next, renames) {
  if (previous === null && renames.length > 0) return null;
  if (previous === null) return [];
  const seenOld = /* @__PURE__ */ new Set();
  const seenNew = /* @__PURE__ */ new Set();
  const result = [];
  for (const rename of renames) {
    if (!plainObject(rename) || !exactKeys(rename, ["oldPath", "newPath"]) || !safeRelativePath(rename.oldPath) || !safeRelativePath(rename.newPath) || seenOld.has(rename.oldPath) || seenNew.has(rename.newPath)) {
      return null;
    }
    seenOld.add(rename.oldPath);
    seenNew.add(rename.newPath);
    const oldNodes = previous.nodes.filter(
      (node) => node.source_file === rename.oldPath
    );
    const newNodes = next.nodes.filter(
      (node) => node.source_file === rename.newPath
    );
    const used = /* @__PURE__ */ new Set();
    const mappings = [];
    const unmapped = [];
    for (const oldNode of oldNodes) {
      const expectedLabel = renameLabel(
        oldNode.label,
        rename.oldPath,
        rename.newPath
      );
      const matches = newNodes.filter(
        (node) => node.label === expectedLabel && !used.has(node.id)
      );
      if (matches.length !== 1 || matches[0] === void 0) {
        unmapped.push(oldNode.id);
      } else {
        used.add(matches[0].id);
        mappings.push({ oldId: oldNode.id, newId: matches[0].id });
      }
    }
    mappings.sort((left, right) => utf8Compare(left.oldId, right.oldId));
    unmapped.sort(utf8Compare);
    result.push({
      oldPath: rename.oldPath,
      newPath: rename.newPath,
      mappings,
      unmapped
    });
  }
  return result.sort((left, right) => utf8Compare(left.oldPath, right.oldPath));
}
function qualifyGraphifyCandidateV1(input) {
  try {
    if (!plainObject(input) || input.expectedVersion !== GRAPHIFY_VERSION || typeof input.observedVersion !== "string") {
      return refused("invalid_input");
    }
    if (input.observedVersion !== input.expectedVersion) {
      return refused("version_mismatch");
    }
    if (!isCommitSha40(input.expectedCommit) || !isCommitSha40(input.observedCommit) || input.expectedCommit !== input.observedCommit) {
      return refused("source_mismatch");
    }
    if (input.inputTokensA !== 0 || input.outputTokensA !== 0 || input.inputTokensB !== 0 || input.outputTokensB !== 0) {
      return refused("model_usage");
    }
    if (!diagnosticsValid(input.diagnosticsA) || !diagnosticsValid(input.diagnosticsB)) {
      return refused("health_failure");
    }
    const graphA = parseGraph(input.graphBytesA);
    const graphB = parseGraph(input.graphBytesB);
    if (graphA === null || graphB === null) return refused("invalid_input");
    if (graphA.built_at_commit !== void 0 && graphA.built_at_commit !== input.expectedCommit || graphB.built_at_commit !== void 0 && graphB.built_at_commit !== input.expectedCommit) {
      return refused("source_mismatch");
    }
    const healthA = graphHealth(graphA);
    if (typeof healthA === "string") return refused(healthA);
    const healthB = graphHealth(graphB);
    if (typeof healthB === "string") return refused(healthB);
    const normalizedA = `${canonicalize(normalizeGraph(graphA))}
`;
    const normalizedB = `${canonicalize(normalizeGraph(graphB))}
`;
    if (normalizedA !== normalizedB || canonicalize(healthA) !== canonicalize(healthB) || canonicalize(input.diagnosticsA) !== canonicalize(input.diagnosticsB)) {
      return refused("nondeterministic");
    }
    if (typeof input.interpreter !== "string" || input.interpreter.length === 0 || !noControls(input.interpreter) || typeof input.cadence !== "string" || input.cadence.length === 0 || !noControls(input.cadence) || typeof input.generatedAt !== "string" || !validTimestamp(input.generatedAt)) {
      return refused("invalid_input");
    }
    const previous = input.previousGraphBytes === null ? null : parseGraph(input.previousGraphBytes);
    if (input.previousGraphBytes !== null && previous === null) {
      return refused("rename_invalid");
    }
    const renames = deriveRenames(previous, graphA, input.fileRenames);
    if (renames === null) return refused("rename_invalid");
    const graphBytes = encoder.encode(normalizedA);
    const health = {
      ...healthA,
      diagnostics: input.diagnosticsA
    };
    const graphSha256 = sha256Hex(graphBytes);
    const metadata = {
      schema: "foreman.graphify-refresh.v1",
      graphifyVersion: GRAPHIFY_VERSION,
      interpreter: input.interpreter,
      sourceCommit: input.expectedCommit,
      graphSha256,
      normalizedGraphSha256: graphSha256,
      healthSha256: sha256Hex(canonicalize(health)),
      inputTokens: 0,
      outputTokens: 0,
      directed: healthA.directed,
      endpointOrderCount: healthA.endpointOrderCount,
      sourceFileCount: healthA.sourceFiles.length,
      renames,
      cadence: input.cadence,
      generatedAt: input.generatedAt,
      lastRefreshFailed: false
    };
    return {
      schemaVersion: 1,
      _tag: "Qualified",
      graphBytes,
      metadataBytes: encoder.encode(`${canonicalize(metadata)}
`),
      metadata
    };
  } catch {
    return refused("invalid_input");
  }
}
function parseMetadata(bytes) {
  const text = decodeUtf8Fatal(bytes);
  if (isCoreFailure(text) || !text.endsWith("\n")) return null;
  const body = text.slice(0, -1);
  const parsed = parseJsonRejectDuplicateKeys(body);
  if (isCoreFailure(parsed) || !plainObject(parsed) || !exactKeys(parsed, METADATA_KEYS) || canonicalize(parsed) !== body || parsed["schema"] !== "foreman.graphify-refresh.v1" || parsed["graphifyVersion"] !== GRAPHIFY_VERSION || typeof parsed["interpreter"] !== "string" || typeof parsed["sourceCommit"] !== "string" || !isCommitSha40(parsed["sourceCommit"]) || typeof parsed["graphSha256"] !== "string" || !isSha256Hex(parsed["graphSha256"]) || typeof parsed["normalizedGraphSha256"] !== "string" || !isSha256Hex(parsed["normalizedGraphSha256"]) || typeof parsed["healthSha256"] !== "string" || !isSha256Hex(parsed["healthSha256"]) || parsed["inputTokens"] !== 0 || parsed["outputTokens"] !== 0 || typeof parsed["directed"] !== "boolean" || !Number.isSafeInteger(parsed["endpointOrderCount"]) || !Number.isSafeInteger(parsed["sourceFileCount"]) || !Array.isArray(parsed["renames"]) || typeof parsed["cadence"] !== "string" || typeof parsed["generatedAt"] !== "string" || typeof parsed["lastRefreshFailed"] !== "boolean") {
    return null;
  }
  return JSON.parse(body);
}
function evaluateGraphifyFreshnessV1(input) {
  try {
    if (input.graphBytes === null || input.metadataBytes === null) {
      return { schemaVersion: 1, _tag: "Missing" };
    }
    const metadata = parseMetadata(input.metadataBytes);
    const graph = parseGraph(input.graphBytes);
    if (metadata === null || graph === null) {
      return { schemaVersion: 1, _tag: "Invalid" };
    }
    if (metadata.lastRefreshFailed) {
      return { schemaVersion: 1, _tag: "RefreshFailed" };
    }
    const normalized = encoder.encode(`${canonicalize(normalizeGraph(graph))}
`);
    const health = graphHealth(graph);
    if (typeof health === "string" || sha256Hex(input.graphBytes) !== metadata.graphSha256 || sha256Hex(normalized) !== metadata.normalizedGraphSha256 || metadata.sourceFileCount !== health.sourceFiles.length || metadata.endpointOrderCount !== health.endpointOrderCount || metadata.directed !== health.directed) {
      return { schemaVersion: 1, _tag: "Invalid" };
    }
    const represented = new Set(health.sourceFiles);
    const missingSourcePaths = [...new Set(input.trackedSourcePaths)].filter((path) => !represented.has(path)).sort(utf8Compare);
    const identity = {
      sourceCommit: metadata.sourceCommit,
      currentCommit: input.currentCommit,
      missingSourcePaths
    };
    if (input.ancestry === "unrelated") {
      return { schemaVersion: 1, _tag: "Unrelated", ...identity };
    }
    if (input.ancestry === "missing" || input.currentCommit !== metadata.sourceCommit && input.ancestry !== "ancestor" || input.changedSourcePaths.length > 0 || missingSourcePaths.length > 0) {
      return { schemaVersion: 1, _tag: "Stale", ...identity };
    }
    return { schemaVersion: 1, _tag: "Fresh", ...identity };
  } catch {
    return { schemaVersion: 1, _tag: "Invalid" };
  }
}
var CLI_USAGE = "usage: graphify-qualification qualify --repo ABS --manifest ABS --cadence NAME | freshness --repo ABS\n";
async function runGraphifyQualificationCli(argv, io, services) {
  const tail = argv.slice(2);
  let operation = null;
  if (tail.length === 7 && tail[0] === "qualify" && tail[1] === "--repo" && tail[3] === "--manifest" && tail[5] === "--cadence" && tail[2] !== void 0 && tail[4] !== void 0 && tail[6] !== void 0 && isAbsolute(tail[2]) && isAbsolute(tail[4]) && tail[6].length > 0 && noControls(tail[6])) {
    operation = {
      kind: "qualify",
      repository: tail[2],
      manifest: tail[4],
      cadence: tail[6]
    };
  } else if (tail.length === 3 && tail[0] === "freshness" && tail[1] === "--repo" && tail[2] !== void 0 && isAbsolute(tail[2])) {
    operation = { kind: "freshness", repository: tail[2] };
  }
  if (operation === null) {
    try {
      io.writeStderr(CLI_USAGE);
    } catch {
    }
    return 64;
  }
  let result;
  try {
    result = operation.kind === "qualify" ? await services.qualify(operation) : await services.freshness(operation.repository);
  } catch {
    result = operation.kind === "qualify" ? { schemaVersion: 1, _tag: "Refused", reason: "invalid_input" } : { schemaVersion: 1, _tag: "Invalid" };
  }
  try {
    io.writeStdout(`${canonicalize(result)}
`);
  } catch {
    return 1;
  }
  return result._tag === "Qualified" || result._tag === "Fresh" ? 0 : 1;
}
function acquireGraphifyPublicationLockV1(commonGitDirectory, token) {
  const lockPath = join(commonGitDirectory, "foreman-graphify-publish.lock");
  try {
    if (!isAbsolute(commonGitDirectory) || token.length === 0 || !noControls(token)) {
      return { schemaVersion: 1, _tag: "Refused", reason: "lock_timeout" };
    }
    mkdirSync(lockPath);
    writeFileSync(join(lockPath, "owner"), `${token}
`, {
      encoding: "utf8",
      flag: "wx",
      mode: 384
    });
    return { schemaVersion: 1, _tag: "Acquired", lockPath, token };
  } catch {
    return { schemaVersion: 1, _tag: "Refused", reason: "lock_timeout" };
  }
}
function releaseGraphifyPublicationLockV1(lock) {
  try {
    const owner = readFileSync(join(lock.lockPath, "owner"), "utf8");
    if (owner !== `${lock.token}
`) return false;
    rmSync(join(lock.lockPath, "owner"));
    rmdirSync(lock.lockPath);
    return true;
  } catch {
    return false;
  }
}

// packages/orchestration/src/graphify-qualification-main.ts
var MAX_GRAPH_BYTES = 32 * 1024 * 1024;
var MAX_PROCESS_BYTES = 4 * 1024 * 1024;
var PROCESS_TIMEOUT_MS = 10 * 6e4;
var GRAPHIFY_VERSION2 = "0.9.48";
var ZERO_DIAGNOSTICS = {
  danglingEndpointEdges: 0,
  missingEndpointEdges: 0,
  nonObjectEdges: 0
};
function refused2() {
  return { schemaVersion: 1, _tag: "Refused", reason: "invalid_input" };
}
function physicallyInside(root, candidate) {
  const rel = relative(root, candidate);
  return rel.length === 0 || !isAbsolute2(rel) && rel !== ".." && !rel.startsWith(`..${sep}`);
}
function boundedRegularFile(path, maxBytes) {
  const before = lstatSync(path);
  if (!before.isFile() || before.isSymbolicLink() || before.size > maxBytes) {
    throw new Error("invalid bounded file");
  }
  const bytes = readFileSync2(path);
  const after = lstatSync(path);
  if (bytes.byteLength > maxBytes || !after.isFile() || after.isSymbolicLink() || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
    throw new Error("file identity changed");
  }
  return Uint8Array.from(bytes);
}
function run(command, args, cwd, env) {
  const result = spawnSync(command, [...args], {
    cwd,
    encoding: "utf8",
    env,
    maxBuffer: MAX_PROCESS_BYTES,
    timeout: PROCESS_TIMEOUT_MS,
    windowsHide: true
  });
  return {
    ok: result.error === void 0 && result.signal === null && result.status === 0 && Buffer.byteLength(result.stdout, "utf8") <= MAX_PROCESS_BYTES && Buffer.byteLength(result.stderr, "utf8") <= MAX_PROCESS_BYTES,
    stdout: result.stdout
  };
}
function resolveHostExecutable(name, repository) {
  const suffixes = process.platform === "win32" ? [".exe", ".cmd"] : [""];
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (directory.length === 0 || !isAbsolute2(directory)) continue;
    for (const suffix of suffixes) {
      const lexical = join2(directory, `${name}${suffix}`);
      try {
        const physical = realpathSync(lexical);
        const stat = statSync(physical);
        if (!stat.isFile() || physicallyInside(repository, physical)) continue;
        accessSync(physical, constants.X_OK);
        return physical;
      } catch {
      }
    }
  }
  throw new Error("host executable unavailable");
}
function gitEnvironment(git2) {
  return {
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
    LANG: "C",
    LC_ALL: "C",
    PATH: dirname(git2),
    ...process.platform === "win32" ? { PATHEXT: ".EXE" } : {}
  };
}
function git(executable, repository, args) {
  const result = run(
    executable,
    [
      "-c",
      "core.fsmonitor=false",
      "-c",
      `core.excludesFile=${process.platform === "win32" ? "NUL" : "/dev/null"}`,
      "-C",
      repository,
      ...args
    ],
    repository,
    gitEnvironment(executable)
  );
  if (!result.ok) throw new Error("Git operation failed");
  return result.stdout;
}
function oneLfLine(value) {
  if (!value.endsWith("\n") || value.endsWith("\r\n")) {
    throw new Error("invalid line frame");
  }
  const line = value.slice(0, -1);
  if (line.length === 0 || /[\r\n\u0000]/u.test(line)) {
    throw new Error("invalid line");
  }
  return line;
}
function manifestSection(text) {
  const match = /(?:^|\n)\[graphify_qualification\]\n([\s\S]*?)(?=\n\[|$)/u.exec(
    text
  );
  if (match?.[1] === void 0) throw new Error("missing graphify manifest");
  const version = /^version = "([^"]+)"$/mu.exec(match[1])?.[1];
  const interpreter = /^reference_interpreter = "([^"]+)"$/mu.exec(
    match[1]
  )?.[1];
  if (version !== GRAPHIFY_VERSION2 || interpreter === void 0) {
    throw new Error("invalid graphify manifest");
  }
  return { version, interpreter };
}
function interpreterFor(repository, manifestPath) {
  const manifest = new TextDecoder("utf-8", { fatal: true }).decode(
    boundedRegularFile(manifestPath, 1024 * 1024)
  );
  const config = manifestSection(manifest);
  const localPath = join2(repository, "graphify-out", ".graphify_python");
  let lexical = config.interpreter;
  if (existsSync(localPath)) {
    lexical = oneLfLine(
      new TextDecoder("utf-8", { fatal: true }).decode(
        boundedRegularFile(localPath, 4096)
      )
    );
  }
  if (!isAbsolute2(lexical)) throw new Error("interpreter is not absolute");
  const physical = realpathSync(lexical);
  if (physicallyInside(repository, physical) || !statSync(physical).isFile()) {
    throw new Error("unsafe interpreter");
  }
  accessSync(physical, constants.X_OK);
  return { lexical, physical, version: config.version };
}
function graphifyEnvironment(interpreter, home) {
  return {
    HOME: home,
    LANG: "C",
    LC_ALL: "C",
    NO_COLOR: "1",
    PATH: dirname(interpreter),
    PYTHONDONTWRITEBYTECODE: "1",
    ...process.platform === "win32" ? { PATHEXT: ".EXE" } : {}
  };
}
function runGraphifyBuild(interpreter, repository, output, home, raw) {
  const args = [
    "-m",
    "graphify",
    "extract",
    repository,
    "--out",
    output,
    "--code-only",
    "--max-workers",
    "1",
    ...raw ? ["--no-cluster"] : []
  ];
  const result = run(
    interpreter,
    args,
    repository,
    graphifyEnvironment(interpreter, home)
  );
  if (!result.ok) throw new Error("Graphify build failed");
}
function tokenCounts(output) {
  const bytes = boundedRegularFile(
    join2(output, "graphify-out", ".graphify_analysis.json"),
    1024 * 1024
  );
  const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (value === null || typeof value !== "object" || !("tokens" in value) || value.tokens === null || typeof value.tokens !== "object" || !("input" in value.tokens) || !("output" in value.tokens) || typeof value.tokens.input !== "number" || typeof value.tokens.output !== "number") {
    throw new Error("invalid Graphify analysis");
  }
  return { input: value.tokens.input, output: value.tokens.output };
}
function parseRenames(raw) {
  if (raw.length === 0) return [];
  const fields = raw.split("\0");
  if (fields.at(-1) !== "") throw new Error("invalid rename frame");
  fields.pop();
  const result = [];
  for (let index = 0; index < fields.length; ) {
    const status = fields[index];
    if (status?.startsWith("R")) {
      const oldPath = fields[index + 1];
      const newPath = fields[index + 2];
      if (oldPath === void 0 || newPath === void 0) {
        throw new Error("invalid rename record");
      }
      result.push({ oldPath, newPath });
      index += 3;
    } else {
      index += 2;
    }
  }
  return result;
}
function trackedSourcePaths(gitPath, repository) {
  const raw = git(gitPath, repository, ["ls-files", "-z"]);
  if (raw.length > 0 && !raw.endsWith("\0")) {
    throw new Error("invalid tracked path frame");
  }
  return raw.split("\0").filter(isTrackedGraphifySourcePathV1).sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
}
function changedSourcePaths(gitPath, repository, sourceCommit, currentCommit) {
  const raw = git(gitPath, repository, [
    "diff",
    "--name-only",
    "-z",
    "--no-ext-diff",
    "--no-textconv",
    sourceCommit,
    currentCommit,
    "--"
  ]);
  if (raw.length > 0 && !raw.endsWith("\0")) {
    throw new Error("invalid changed path frame");
  }
  return raw.split("\0").filter(isTrackedGraphifySourcePathV1).sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
}
function materializeCommit(gitPath, repository, sourceCommit, temporary) {
  const archive = join2(temporary, "source.tar");
  const source = join2(temporary, "source");
  mkdirSync2(source);
  const archived = run(
    gitPath,
    [
      "-c",
      "core.fsmonitor=false",
      "-c",
      `core.excludesFile=${process.platform === "win32" ? "NUL" : "/dev/null"}`,
      "-C",
      repository,
      "archive",
      "--format=tar",
      "-o",
      archive,
      sourceCommit
    ],
    repository,
    gitEnvironment(gitPath)
  );
  if (!archived.ok) throw new Error("Git archive failed");
  const tar = resolveHostExecutable("tar", repository);
  const extracted = run(tar, ["-xf", archive, "-C", source], repository, {
    LANG: "C",
    LC_ALL: "C",
    PATH: dirname(tar)
  });
  if (!extracted.ok) throw new Error("archive extraction failed");
  return source;
}
function optionalFile(path) {
  try {
    return boundedRegularFile(path, MAX_GRAPH_BYTES);
  } catch {
    return null;
  }
}
function publishPair(directory, graphBytes, metadataBytes) {
  mkdirSync2(directory, { recursive: true });
  const graphPath = join2(directory, "graph.json");
  const metadataPath = join2(directory, "refresh-meta.json");
  const priorGraph = optionalFile(graphPath);
  const priorMetadata = optionalFile(metadataPath);
  const graphTemp = join2(directory, `.graph.json.${randomUUID()}.tmp`);
  const metadataTemp = join2(directory, `.refresh-meta.json.${randomUUID()}.tmp`);
  try {
    writeFileSync2(graphTemp, graphBytes, { flag: "wx", mode: 384 });
    writeFileSync2(metadataTemp, metadataBytes, { flag: "wx", mode: 384 });
    renameSync(graphTemp, graphPath);
    renameSync(metadataTemp, metadataPath);
  } catch (error) {
    rmSync2(graphTemp, { force: true });
    rmSync2(metadataTemp, { force: true });
    if (priorGraph === null) rmSync2(graphPath, { force: true });
    else writeFileSync2(graphPath, priorGraph, { mode: 384 });
    if (priorMetadata === null) rmSync2(metadataPath, { force: true });
    else writeFileSync2(metadataPath, priorMetadata, { mode: 384 });
    throw error;
  }
}
async function qualifyLive(input) {
  let temporary = null;
  let lock = null;
  try {
    const repository = realpathSync(input.repository);
    if (!statSync(repository).isDirectory()) return refused2();
    const manifest = realpathSync(input.manifest);
    if (!physicallyInside(repository, manifest)) return refused2();
    const gitPath = resolveHostExecutable("git", repository);
    const root = realpathSync(oneLfLine(git(gitPath, repository, ["rev-parse", "--show-toplevel"])));
    if (root !== repository) return refused2();
    const sourceCommit = oneLfLine(git(gitPath, repository, ["rev-parse", "HEAD"]));
    if (git(gitPath, repository, ["status", "--porcelain", "--untracked-files=no"]) !== "") {
      return refused2();
    }
    const interpreter = interpreterFor(repository, manifest);
    temporary = mkdtempSync(join2(tmpdir(), "foreman-graphify-"));
    const home = join2(temporary, "home");
    const raw = join2(temporary, "raw");
    const first = join2(temporary, "first");
    const second = join2(temporary, "second");
    mkdirSync2(home, { recursive: true });
    const source = materializeCommit(
      gitPath,
      repository,
      sourceCommit,
      temporary
    );
    const version = run(
      interpreter.lexical,
      ["-m", "graphify", "--version"],
      repository,
      graphifyEnvironment(interpreter.lexical, home)
    );
    if (!version.ok || !version.stdout.startsWith(`graphify ${interpreter.version}
`)) {
      return refused2();
    }
    runGraphifyBuild(interpreter.lexical, source, raw, home, true);
    const rawGraph = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        boundedRegularFile(join2(raw, "graphify-out", "graph.json"), MAX_GRAPH_BYTES)
      )
    );
    if (rawGraph.input_tokens !== 0 || rawGraph.output_tokens !== 0) return refused2();
    runGraphifyBuild(interpreter.lexical, source, first, home, false);
    runGraphifyBuild(interpreter.lexical, source, second, home, false);
    const firstTokens = tokenCounts(first);
    const secondTokens = tokenCounts(second);
    const graphDirectory = join2(repository, "graphify-out");
    const previousGraph = optionalFile(join2(graphDirectory, "graph.json"));
    const previousMetadata = optionalFile(join2(graphDirectory, "refresh-meta.json"));
    let fileRenames = [];
    if (previousMetadata !== null) {
      const meta = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(previousMetadata));
      if (typeof meta.sourceCommit === "string" && meta.sourceCommit !== sourceCommit) {
        fileRenames = parseRenames(
          git(gitPath, repository, [
            "diff",
            "--name-status",
            "-z",
            "-M",
            meta.sourceCommit,
            sourceCommit,
            "--"
          ])
        );
      }
    }
    const result = qualifyGraphifyCandidateV1({
      expectedVersion: interpreter.version,
      observedVersion: interpreter.version,
      expectedCommit: sourceCommit,
      observedCommit: sourceCommit,
      interpreter: interpreter.physical,
      graphBytesA: boundedRegularFile(
        join2(first, "graphify-out", "graph.json"),
        MAX_GRAPH_BYTES
      ),
      graphBytesB: boundedRegularFile(
        join2(second, "graphify-out", "graph.json"),
        MAX_GRAPH_BYTES
      ),
      inputTokensA: firstTokens.input,
      outputTokensA: firstTokens.output,
      inputTokensB: secondTokens.input,
      outputTokensB: secondTokens.output,
      diagnosticsA: ZERO_DIAGNOSTICS,
      diagnosticsB: ZERO_DIAGNOSTICS,
      previousGraphBytes: previousGraph,
      fileRenames,
      cadence: input.cadence,
      generatedAt: (/* @__PURE__ */ new Date()).toISOString().replace(/\.\d{3}Z$/u, "Z")
    });
    if (result._tag !== "Qualified") return result;
    const commonRaw = oneLfLine(git(gitPath, repository, ["rev-parse", "--git-common-dir"]));
    const commonGitDirectory = realpathSync(
      isAbsolute2(commonRaw) ? commonRaw : resolve(repository, commonRaw)
    );
    lock = acquireGraphifyPublicationLockV1(commonGitDirectory, randomUUID());
    if (lock._tag !== "Acquired") return lock;
    const revalidated = oneLfLine(git(gitPath, repository, ["rev-parse", "HEAD"]));
    if (revalidated !== sourceCommit) return refused2();
    publishPair(graphDirectory, result.graphBytes, result.metadataBytes);
    return { schemaVersion: 1, _tag: "Qualified", sourceCommit };
  } catch {
    return refused2();
  } finally {
    if (lock?._tag === "Acquired") releaseGraphifyPublicationLockV1(lock);
    if (temporary !== null) rmSync2(temporary, { recursive: true, force: true });
  }
}
async function freshnessLive(repositoryInput) {
  try {
    const repository = realpathSync(repositoryInput);
    const gitPath = resolveHostExecutable("git", repository);
    const currentCommit = oneLfLine(git(gitPath, repository, ["rev-parse", "HEAD"]));
    const graphBytes = optionalFile(join2(repository, "graphify-out", "graph.json"));
    const metadataBytes = optionalFile(
      join2(repository, "graphify-out", "refresh-meta.json")
    );
    let ancestry = "missing";
    let changedPaths = [];
    if (metadataBytes !== null) {
      try {
        const value = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(metadataBytes)
        );
        if (typeof value.sourceCommit === "string" && isCommitSha40(value.sourceCommit)) {
          if (value.sourceCommit === currentCommit) ancestry = "same";
          else {
            const ancestor = run(
              gitPath,
              [
                "-c",
                "core.fsmonitor=false",
                "-C",
                repository,
                "merge-base",
                "--is-ancestor",
                value.sourceCommit,
                currentCommit
              ],
              repository,
              gitEnvironment(gitPath)
            );
            ancestry = ancestor.ok ? "ancestor" : "unrelated";
            if (ancestry === "ancestor") {
              changedPaths = changedSourcePaths(
                gitPath,
                repository,
                value.sourceCommit,
                currentCommit
              );
            }
          }
        }
      } catch {
        ancestry = "missing";
      }
    }
    return evaluateGraphifyFreshnessV1({
      graphBytes,
      metadataBytes,
      currentCommit,
      ancestry,
      trackedSourcePaths: trackedSourcePaths(gitPath, repository),
      changedSourcePaths: changedPaths
    });
  } catch {
    return { schemaVersion: 1, _tag: "Invalid" };
  }
}
var exitCode = await runGraphifyQualificationCli(
  process.argv,
  {
    writeStdout: (text) => process.stdout.write(text),
    writeStderr: (text) => process.stderr.write(text)
  },
  { qualify: qualifyLive, freshness: freshnessLive }
);
process.exitCode = exitCode;
