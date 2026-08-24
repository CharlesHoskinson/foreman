// packages/orchestration/src/graph-context-main.ts
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

// packages/core/src/decode.ts
var SHA256_HEX = /^[0-9a-f]{64}$/;
var COMMIT_SHA40 = /^[0-9a-f]{40}$/;
function isSha256Hex(value) {
  return SHA256_HEX.test(value);
}
function isCommitSha40(value) {
  return COMMIT_SHA40.test(value);
}

// packages/orchestration/src/graph-context.ts
var encoder = new TextEncoder();
var MAX_GRAPH_BYTES = 32 * 1024 * 1024;
var MAX_METADATA_BYTES = 1024 * 1024;
var MIN_BUDGET_TOKENS = 256;
var MAX_BUDGET_TOKENS = 4e3;
var MAX_SEEDS = 8;
var IMPLEMENTER_RELATIONS = /* @__PURE__ */ new Set([
  "calls",
  "contains",
  "defines",
  "dynamic_import",
  "extends",
  "implements",
  "imports",
  "imports_from",
  "indirect_call",
  "inherits",
  "method",
  "re_exports",
  "references"
]);
var AUDITOR_RELATIONS = /* @__PURE__ */ new Set([
  ...IMPLEMENTER_RELATIONS,
  "cites",
  "rationale_for"
]);
function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function parseCanonicalFile(bytes, maxBytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > maxBytes) return null;
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes
    );
  } catch {
    return null;
  }
  if (!text.endsWith("\n") || text.endsWith("\r\n")) {
    return null;
  }
  const body = text.slice(0, -1);
  const parsed2 = parseJsonRejectDuplicateKeys(body);
  if (isCoreFailure(parsed2) || canonicalize(parsed2) !== body) return null;
  return JSON.parse(body);
}
function boundedString(value, maxBytes = 16384) {
  return typeof value === "string" && value.length > 0 && encoder.encode(value).byteLength <= maxBytes && !/[\u0000-\u001f\u007f]/u.test(value);
}
function boundedTaskText(value) {
  return typeof value === "string" && value.length > 0 && encoder.encode(value).byteLength <= 64 * 1024 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
}
function edgeIdentity(input) {
  return sha256Hex(
    [
      input.source,
      input.target,
      input.relation,
      input.sourceFile,
      input.sourceLocation
    ].join("\0")
  );
}
function parseGraph(bytes) {
  const value = parseCanonicalFile(bytes, MAX_GRAPH_BYTES);
  if (!isPlainObject(value) || !Array.isArray(value.nodes) || !Array.isArray(value.links)) {
    return null;
  }
  const nodes = [];
  const nodeIds = /* @__PURE__ */ new Set();
  for (const raw of value.nodes) {
    if (!isPlainObject(raw) || !boundedString(raw.id) || !boundedString(raw.label) || !boundedString(raw.source_file)) {
      return null;
    }
    if (nodeIds.has(raw.id)) return null;
    nodeIds.add(raw.id);
    nodes.push({ id: raw.id, label: raw.label, sourceFile: raw.source_file });
  }
  const links = [];
  const edgeIds = /* @__PURE__ */ new Set();
  for (const raw of value.links) {
    if (!isPlainObject(raw) || !boundedString(raw.source) || !boundedString(raw.target) || !boundedString(raw.relation) || !boundedString(raw.source_file) || raw.source_location !== void 0 && !boundedString(raw.source_location) || !nodeIds.has(raw.source) || !nodeIds.has(raw.target)) {
      return null;
    }
    const edge = {
      edgeKey: edgeIdentity({
        source: raw.source,
        target: raw.target,
        relation: raw.relation,
        sourceFile: raw.source_file,
        sourceLocation: raw.source_location === void 0 ? "" : raw.source_location
      }),
      source: raw.source,
      target: raw.target,
      relation: raw.relation,
      sourceFile: raw.source_file,
      sourceLocation: raw.source_location === void 0 ? "" : raw.source_location
    };
    if (edgeIds.has(edge.edgeKey)) return null;
    edgeIds.add(edge.edgeKey);
    links.push(edge);
  }
  return { nodes, links };
}
function parseMetadata(bytes) {
  const value = parseCanonicalFile(bytes, MAX_METADATA_BYTES);
  if (!isPlainObject(value) || value.schema !== "foreman.graphify-refresh.v1" || value.graphifyVersion !== "0.9.48" || typeof value.graphSha256 !== "string" || !isSha256Hex(value.graphSha256) || typeof value.sourceCommit !== "string" || !isCommitSha40(value.sourceCommit) || value.inputTokens !== 0 || value.outputTokens !== 0 || value.lastRefreshFailed !== false) {
    return null;
  }
  return {
    graphSha256: value.graphSha256,
    sourceCommit: value.sourceCommit,
    graphifyVersion: "0.9.48"
  };
}
function compareUtf8(left, right) {
  return Buffer.from(left).compare(Buffer.from(right));
}
function taskTokens(text) {
  return [
    ...new Set(
      text.normalize("NFKC").toLocaleLowerCase("en-US").split(/[^\p{L}\p{N}_./-]+/u).filter((token) => encoder.encode(token).byteLength >= 3)
    )
  ].sort(compareUtf8);
}
function nodeScore(node, tokens) {
  const haystack = `${node.id}
${node.label}
${node.sourceFile}`.normalize("NFKC").toLocaleLowerCase("en-US");
  return tokens.reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0);
}
function withEstimate(block) {
  let estimatedTokens = 0;
  let result = { ...block, estimatedTokens };
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const bytes2 = encoder.encode(`${canonicalize(result)}
`);
    const next = Math.ceil(bytes2.byteLength / 4);
    if (next === estimatedTokens) return { block: result, bytes: bytes2 };
    estimatedTokens = next;
    result = { ...block, estimatedTokens };
  }
  const bytes = encoder.encode(`${canonicalize(result)}
`);
  return { block: result, bytes };
}
function buildGraphContextV1(input) {
  try {
    if (!boundedTaskText(input.taskText) || input.role !== "implementer" && input.role !== "auditor" || !Number.isSafeInteger(input.budgetTokens)) {
      return { schemaVersion: 1, _tag: "Invalid", reason: "invalid_input" };
    }
    const graph = parseGraph(input.graphBytes);
    if (graph === null) {
      return { schemaVersion: 1, _tag: "Invalid", reason: "invalid_graph" };
    }
    const metadata = parseMetadata(input.metadataBytes);
    if (metadata === null || metadata.graphSha256 !== sha256Hex(input.graphBytes)) {
      return { schemaVersion: 1, _tag: "Invalid", reason: "invalid_metadata" };
    }
    const tokens = taskTokens(input.taskText);
    const rankedNodes = graph.nodes.map((node) => ({ node, score: nodeScore(node, tokens) })).filter((item) => item.score > 0).sort((left, right) => right.score - left.score || compareUtf8(left.node.id, right.node.id));
    if (rankedNodes.length === 0) {
      return { schemaVersion: 1, _tag: "NoContext", marker: "NO GRAPH CONTEXT" };
    }
    const seeds = rankedNodes.slice(0, MAX_SEEDS).map(({ node }) => node);
    const allowed = input.role === "auditor" ? AUDITOR_RELATIONS : IMPLEMENTER_RELATIONS;
    const selectedEdges = /* @__PURE__ */ new Map();
    let frontier = new Set(seeds.map((seed) => seed.id));
    const visited = new Set(frontier);
    for (let hop = 1; hop <= 2; hop += 1) {
      const next = /* @__PURE__ */ new Set();
      for (const edge of graph.links) {
        if (!allowed.has(edge.relation)) continue;
        if (!frontier.has(edge.source) && !frontier.has(edge.target)) continue;
        const sourceNode = graph.nodes.find((node) => node.id === edge.source);
        const targetNode = graph.nodes.find((node) => node.id === edge.target);
        const score = nodeScore(sourceNode, tokens) + nodeScore(targetNode, tokens) + nodeScore(
          { id: edge.relation, label: edge.relation, sourceFile: edge.sourceFile },
          tokens
        ) + (3 - hop);
        selectedEdges.set(edge.edgeKey, { edge, hop, score });
        if (!visited.has(edge.source)) next.add(edge.source);
        if (!visited.has(edge.target)) next.add(edge.target);
      }
      for (const id of next) visited.add(id);
      frontier = next;
    }
    const rankedEdges = [...selectedEdges.values()].sort(
      (left, right) => right.score - left.score || left.hop - right.hop || compareUtf8(left.edge.edgeKey, right.edge.edgeKey)
    );
    const budgetTokens = Math.min(
      MAX_BUDGET_TOKENS,
      Math.max(MIN_BUDGET_TOKENS, input.budgetTokens)
    );
    const base = {
      schema: "foreman.graph-context.v1",
      graphSha256: metadata.graphSha256,
      sourceCommit: metadata.sourceCommit,
      graphifyVersion: metadata.graphifyVersion,
      role: input.role,
      taskSha256: sha256Hex(input.taskText),
      budgetTokens,
      truncated: false,
      seeds,
      edges: [],
      citationInstruction: "Cite served edges by alias. Mark any uncited load-bearing claim."
    };
    const edges = [];
    for (const item of rankedEdges) {
      const candidate = [
        ...edges,
        { ...item.edge, alias: `e${String(edges.length + 1).padStart(2, "0")}` }
      ];
      const rendered2 = withEstimate({
        ...base,
        truncated: candidate.length < rankedEdges.length,
        edges: candidate
      });
      if (rendered2.block.estimatedTokens > budgetTokens) break;
      edges.push(candidate.at(-1));
    }
    const rendered = withEstimate({
      ...base,
      truncated: edges.length < rankedEdges.length,
      edges
    });
    if (rendered.block.estimatedTokens > budgetTokens) {
      return { schemaVersion: 1, _tag: "Invalid", reason: "invalid_input" };
    }
    return {
      schemaVersion: 1,
      _tag: "Built",
      block: rendered.block,
      blockBytes: rendered.bytes,
      sha256: sha256Hex(rendered.bytes)
    };
  } catch {
    return { schemaVersion: 1, _tag: "Invalid", reason: "invalid_input" };
  }
}

// packages/orchestration/src/graph-context-main.ts
var MAX_GRAPH_BYTES2 = 32 * 1024 * 1024;
var MAX_METADATA_BYTES2 = 1024 * 1024;
var MAX_TASK_BYTES = 64 * 1024;
var USAGE = "usage: graph-context build --graph ABS --metadata ABS --task ABS --role implementer|auditor --budget INTEGER\n";
function readBounded(path, maxBytes) {
  const before = lstatSync(path);
  if (!before.isFile() || before.isSymbolicLink() || before.size > maxBytes) {
    throw new Error("invalid file");
  }
  const bytes = readFileSync(path);
  const after = lstatSync(path);
  if (bytes.byteLength > maxBytes || !after.isFile() || after.isSymbolicLink() || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
    throw new Error("file changed");
  }
  return Uint8Array.from(bytes);
}
function parseArgv(argv) {
  const args = argv.slice(2);
  if (args.length !== 11 || args[0] !== "build" || args[1] !== "--graph" || args[3] !== "--metadata" || args[5] !== "--task" || args[7] !== "--role" || args[9] !== "--budget") {
    return null;
  }
  const graph = args[2];
  const metadata = args[4];
  const task = args[6];
  const role = args[8];
  const budgetText = args[10];
  if (graph === void 0 || metadata === void 0 || task === void 0 || !isAbsolute(graph) || !isAbsolute(metadata) || !isAbsolute(task) || role !== "implementer" && role !== "auditor" || budgetText === void 0 || !/^[1-9][0-9]*$/u.test(budgetText)) {
    return null;
  }
  const budget = Number(budgetText);
  if (!Number.isSafeInteger(budget)) return null;
  return { graph, metadata, task, role, budget };
}
var exitCode = 0;
var parsed = parseArgv(process.argv);
if (parsed === null) {
  process.stderr.write(USAGE);
  exitCode = 64;
} else {
  try {
    const taskText = new TextDecoder("utf-8", { fatal: true }).decode(
      readBounded(parsed.task, MAX_TASK_BYTES)
    );
    const result = buildGraphContextV1({
      graphBytes: readBounded(parsed.graph, MAX_GRAPH_BYTES2),
      metadataBytes: readBounded(parsed.metadata, MAX_METADATA_BYTES2),
      taskText,
      role: parsed.role,
      budgetTokens: parsed.budget
    });
    if (result._tag === "Built") {
      process.stdout.write(result.blockBytes);
    } else if (result._tag === "NoContext") {
      process.stdout.write(`${result.marker}
`);
    } else {
      process.stderr.write("graph-context: refused\n");
      exitCode = 1;
    }
  } catch {
    process.stderr.write("graph-context: refused\n");
    exitCode = 1;
  }
}
process.exitCode = exitCode;
