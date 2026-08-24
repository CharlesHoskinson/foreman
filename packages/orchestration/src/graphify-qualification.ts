import {
  mkdirSync,
  readFileSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from "node:fs";
import { basename, isAbsolute, join } from "node:path";
import {
  canonicalize,
  decodeUtf8Fatal,
  isCommitSha40,
  isCoreFailure,
  isSha256Hex,
  parseJsonRejectDuplicateKeys,
  sha256Hex,
} from "@foreman/core";

const encoder = new TextEncoder();
const GRAPHIFY_VERSION = "0.9.48";
const GRAPH_ROOT_KEYS = [
  "directed",
  "graph",
  "hyperedges",
  "links",
  "multigraph",
  "nodes",
] as const;
const GRAPH_ROOT_KEYS_WITH_COMMIT = [
  "built_at_commit",
  ...GRAPH_ROOT_KEYS,
] as const;
const DIAGNOSTIC_KEYS = [
  "danglingEndpointEdges",
  "missingEndpointEdges",
  "nonObjectEdges",
] as const;
const METADATA_KEYS = [
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
  "sourceFileCount",
] as const;

export type GraphifyDiagnosticsV1 = {
  readonly danglingEndpointEdges: number;
  readonly missingEndpointEdges: number;
  readonly nonObjectEdges: number;
};

export type GraphifyFileRenameV1 = {
  readonly oldPath: string;
  readonly newPath: string;
};

export type GraphifyNodeRenameV1 = GraphifyFileRenameV1 & {
  readonly mappings: readonly {
    readonly oldId: string;
    readonly newId: string;
  }[];
  readonly unmapped: readonly string[];
};

export type GraphifyRefreshMetadataV1 = {
  readonly schema: "foreman.graphify-refresh.v1";
  readonly graphifyVersion: "0.9.48";
  readonly interpreter: string;
  readonly sourceCommit: string;
  readonly graphSha256: string;
  readonly normalizedGraphSha256: string;
  readonly healthSha256: string;
  readonly inputTokens: 0;
  readonly outputTokens: 0;
  readonly directed: boolean;
  readonly endpointOrderCount: number;
  readonly sourceFileCount: number;
  readonly renames: readonly GraphifyNodeRenameV1[];
  readonly cadence: string;
  readonly generatedAt: string;
  readonly lastRefreshFailed: boolean;
};

export type GraphifyQualificationReasonV1 =
  | "invalid_input"
  | "version_mismatch"
  | "source_mismatch"
  | "model_usage"
  | "nondeterministic"
  | "duplicate_node"
  | "invalid_source"
  | "dangling_endpoint"
  | "duplicate_link"
  | "endpoint_order_lost"
  | "health_failure"
  | "rename_invalid"
  | "lock_timeout";

export type GraphifyQualificationInputV1 = {
  readonly expectedVersion: string;
  readonly observedVersion: string;
  readonly expectedCommit: string;
  readonly observedCommit: string;
  readonly interpreter: string;
  readonly graphBytesA: Uint8Array;
  readonly graphBytesB: Uint8Array;
  readonly inputTokensA: number;
  readonly outputTokensA: number;
  readonly inputTokensB: number;
  readonly outputTokensB: number;
  readonly diagnosticsA: GraphifyDiagnosticsV1;
  readonly diagnosticsB: GraphifyDiagnosticsV1;
  readonly previousGraphBytes: Uint8Array | null;
  readonly fileRenames: readonly GraphifyFileRenameV1[];
  readonly cadence: string;
  readonly generatedAt: string;
};

export type GraphifyQualificationResultV1 =
  | {
      readonly schemaVersion: 1;
      readonly _tag: "Qualified";
      readonly graphBytes: Uint8Array;
      readonly metadataBytes: Uint8Array;
      readonly metadata: GraphifyRefreshMetadataV1;
    }
  | {
      readonly schemaVersion: 1;
      readonly _tag: "Refused";
      readonly reason: GraphifyQualificationReasonV1;
    };

export type GraphifyFreshnessInputV1 = {
  readonly graphBytes: Uint8Array | null;
  readonly metadataBytes: Uint8Array | null;
  readonly currentCommit: string;
  readonly ancestry: "same" | "ancestor" | "unrelated" | "missing";
  readonly trackedSourcePaths: readonly string[];
};

export type GraphifyFreshnessResultV1 = {
  readonly schemaVersion: 1;
  readonly _tag:
    | "Fresh"
    | "Stale"
    | "Unrelated"
    | "Missing"
    | "Invalid"
    | "RefreshFailed";
  readonly sourceCommit?: string;
  readonly currentCommit?: string;
  readonly missingSourcePaths?: readonly string[];
};

export type GraphifyPublicationLockV1 = {
  readonly schemaVersion: 1;
  readonly _tag: "Acquired";
  readonly lockPath: string;
  readonly token: string;
};

export type GraphifyPublicationLockResultV1 =
  | GraphifyPublicationLockV1
  | {
      readonly schemaVersion: 1;
      readonly _tag: "Refused";
      readonly reason: "lock_timeout";
    };

export type GraphifyCliResultV1 =
  | GraphifyFreshnessResultV1
  | {
      readonly schemaVersion: 1;
      readonly _tag: "Qualified";
      readonly sourceCommit: string;
    }
  | {
      readonly schemaVersion: 1;
      readonly _tag: "Refused";
      readonly reason: GraphifyQualificationReasonV1;
    };

export type GraphifyQualificationCliIo = {
  readonly writeStdout: (text: string) => void;
  readonly writeStderr: (text: string) => void;
};

export type GraphifyQualificationCliServices = {
  readonly qualify: (input: {
    readonly repository: string;
    readonly manifest: string;
    readonly cadence: string;
  }) => Promise<GraphifyCliResultV1>;
  readonly freshness: (repository: string) => Promise<GraphifyCliResultV1>;
};

type JsonRecord = Record<string, unknown>;
type ParsedNode = JsonRecord & {
  readonly id: string;
  readonly label: string;
  readonly source_file: string;
  readonly source_location?: string;
};
type ParsedLink = JsonRecord & {
  readonly source: string;
  readonly target: string;
  readonly relation: string;
  readonly source_file: string;
  readonly source_location?: string;
};
type ParsedGraph = {
  readonly built_at_commit?: string;
  readonly directed: boolean;
  readonly graph: JsonRecord;
  readonly hyperedges: readonly unknown[];
  readonly links: readonly ParsedLink[];
  readonly multigraph: boolean;
  readonly nodes: readonly ParsedNode[];
};
type GraphHealth = {
  readonly directed: boolean;
  readonly endpointOrderCount: number;
  readonly externalNodeCount: number;
  readonly linkCount: number;
  readonly nodeCount: number;
  readonly sourceFiles: readonly string[];
  readonly unlocatedDynamicImportCount: number;
};

function refused(reason: GraphifyQualificationReasonV1): GraphifyQualificationResultV1 {
  return { schemaVersion: 1, _tag: "Refused", reason };
}

function plainObject(value: unknown): value is JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: JsonRecord, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return (
    actual.length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function noControls(value: string): boolean {
  return !/[\u0000-\u001f\u007f]/u.test(value);
}

function safeRelativePath(value: string): boolean {
  if (
    value.length === 0 ||
    !noControls(value) ||
    value.includes("\\") ||
    isAbsolute(value) ||
    /^[A-Za-z]:/u.test(value)
  ) {
    return false;
  }
  const segments = value.split("/");
  return segments.every(
    (segment) => segment.length > 0 && segment !== "." && segment !== "..",
  );
}

function jsonValue(value: unknown): boolean {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(jsonValue);
  return plainObject(value) && Object.values(value).every(jsonValue);
}

function utf8Compare(left: string, right: string): number {
  return Buffer.from(left).compare(Buffer.from(right));
}

function canonicalCompare(left: unknown, right: unknown): number {
  return utf8Compare(canonicalize(left), canonicalize(right));
}

function parseJsonBytes(bytes: Uint8Array): unknown | null {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const parsed = parseJsonRejectDuplicateKeys(text.trimEnd());
    return isCoreFailure(parsed) ? null : parsed;
  } catch {
    return null;
  }
}

function parseGraph(bytes: Uint8Array): ParsedGraph | null {
  const value = parseJsonBytes(bytes);
  if (
    !plainObject(value) ||
    (!exactKeys(value, GRAPH_ROOT_KEYS) &&
      !exactKeys(value, GRAPH_ROOT_KEYS_WITH_COMMIT)) ||
    (Object.hasOwn(value, "built_at_commit") &&
      typeof value["built_at_commit"] !== "string")
  ) {
    return null;
  }
  if (
    typeof value["directed"] !== "boolean" ||
    typeof value["multigraph"] !== "boolean" ||
    !plainObject(value["graph"]) ||
    !Array.isArray(value["hyperedges"]) ||
    !value["hyperedges"].every(jsonValue) ||
    !Array.isArray(value["nodes"]) ||
    !Array.isArray(value["links"])
  ) {
    return null;
  }
  const nodes: ParsedNode[] = [];
  for (const node of value["nodes"]) {
    if (
      !plainObject(node) ||
      !jsonValue(node) ||
      typeof node["id"] !== "string" ||
      node["id"].length === 0 ||
      !noControls(node["id"]) ||
      typeof node["label"] !== "string" ||
      !noControls(node["label"]) ||
      typeof node["source_file"] !== "string" ||
      (node["source_location"] !== undefined &&
        typeof node["source_location"] !== "string")
    ) {
      return null;
    }
    nodes.push(node as ParsedNode);
  }
  const links: ParsedLink[] = [];
  for (const link of value["links"]) {
    if (
      !plainObject(link) ||
      !jsonValue(link) ||
      typeof link["source"] !== "string" ||
      typeof link["target"] !== "string" ||
      typeof link["relation"] !== "string" ||
      typeof link["source_file"] !== "string" ||
      (link["source_location"] !== undefined &&
        typeof link["source_location"] !== "string")
    ) {
      return null;
    }
    links.push(link as ParsedLink);
  }
  return {
    ...(typeof value["built_at_commit"] === "string"
      ? { built_at_commit: value["built_at_commit"] }
      : {}),
    directed: value["directed"],
    graph: value["graph"],
    hyperedges: value["hyperedges"],
    links,
    multigraph: value["multigraph"],
    nodes,
  };
}

function normalizeGraph(graph: ParsedGraph): ParsedGraph {
  const withoutDeferredCommunity = (node: ParsedNode): ParsedNode => {
    const { community: _community, ...retained } = node;
    return retained as ParsedNode;
  };
  return {
    ...(graph.built_at_commit === undefined
      ? {}
      : { built_at_commit: graph.built_at_commit }),
    directed: graph.directed,
    graph: graph.graph,
    hyperedges: [...graph.hyperedges].sort(canonicalCompare),
    links: [...graph.links].sort((left, right) =>
      utf8Compare(
        `${left.source}\u0000${left.target}\u0000${left.relation}\u0000${left.source_file}\u0000${left.source_location}`,
        `${right.source}\u0000${right.target}\u0000${right.relation}\u0000${right.source_file}\u0000${right.source_location}`,
      ),
    ),
    multigraph: graph.multigraph,
    nodes: graph.nodes
      .map(withoutDeferredCommunity)
      .sort((left, right) => utf8Compare(left.id, right.id)),
  };
}

function graphHealth(
  graph: ParsedGraph,
): GraphHealth | GraphifyQualificationReasonV1 {
  const nodeIds = new Set<string>();
  const sourceFiles = new Set<string>();
  let externalNodeCount = 0;
  for (const node of graph.nodes) {
    if (nodeIds.has(node.id)) return "duplicate_node";
    nodeIds.add(node.id);
    if (node.source_location === undefined) {
      externalNodeCount += 1;
    } else {
      if (
        !safeRelativePath(node.source_file) ||
        node.source_location.length === 0 ||
        !noControls(node.source_location)
      ) {
        return "invalid_source";
      }
      sourceFiles.add(node.source_file);
    }
  }
  const linkKeys = new Set<string>();
  let endpointOrderCount = 0;
  let unlocatedDynamicImportCount = 0;
  for (const link of graph.links) {
    if (!safeRelativePath(link.source_file)) return "invalid_source";
    if (link.source_location === undefined) {
      if (link.relation !== "dynamic_import") return "invalid_source";
      unlocatedDynamicImportCount += 1;
    } else {
      if (
        link.source_location.length === 0 ||
        !noControls(link.source_location)
      ) {
        return "invalid_source";
      }
    }
    if (!nodeIds.has(link.source) || !nodeIds.has(link.target)) {
      return "dangling_endpoint";
    }
    const key = `${link.source}\u0000${link.target}\u0000${link.relation}`;
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
    unlocatedDynamicImportCount,
  };
}

function diagnosticsValid(value: GraphifyDiagnosticsV1): boolean {
  return (
    plainObject(value) &&
    exactKeys(value, DIAGNOSTIC_KEYS) &&
    DIAGNOSTIC_KEYS.every(
      (key) => Number.isSafeInteger(value[key]) && value[key] === 0,
    )
  );
}

function validTimestamp(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(value);
}

function renameLabel(label: string, oldPath: string, newPath: string): string {
  if (label === oldPath) return newPath;
  if (label === basename(oldPath)) return basename(newPath);
  return label;
}

function deriveRenames(
  previous: ParsedGraph | null,
  next: ParsedGraph,
  renames: readonly GraphifyFileRenameV1[],
): readonly GraphifyNodeRenameV1[] | null {
  if (previous === null && renames.length > 0) return null;
  if (previous === null) return [];
  const seenOld = new Set<string>();
  const seenNew = new Set<string>();
  const result: GraphifyNodeRenameV1[] = [];
  for (const rename of renames) {
    if (
      !plainObject(rename) ||
      !exactKeys(rename, ["oldPath", "newPath"]) ||
      !safeRelativePath(rename.oldPath) ||
      !safeRelativePath(rename.newPath) ||
      seenOld.has(rename.oldPath) ||
      seenNew.has(rename.newPath)
    ) {
      return null;
    }
    seenOld.add(rename.oldPath);
    seenNew.add(rename.newPath);
    const oldNodes = previous.nodes.filter(
      (node) => node.source_file === rename.oldPath,
    );
    const newNodes = next.nodes.filter(
      (node) => node.source_file === rename.newPath,
    );
    const used = new Set<string>();
    const mappings: Array<{ readonly oldId: string; readonly newId: string }> = [];
    const unmapped: string[] = [];
    for (const oldNode of oldNodes) {
      const expectedLabel = renameLabel(
        oldNode.label,
        rename.oldPath,
        rename.newPath,
      );
      const matches = newNodes.filter(
        (node) => node.label === expectedLabel && !used.has(node.id),
      );
      if (matches.length !== 1 || matches[0] === undefined) {
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
      unmapped,
    });
  }
  return result.sort((left, right) => utf8Compare(left.oldPath, right.oldPath));
}

export function qualifyGraphifyCandidateV1(
  input: GraphifyQualificationInputV1,
): GraphifyQualificationResultV1 {
  try {
    if (
      !plainObject(input) ||
      input.expectedVersion !== GRAPHIFY_VERSION ||
      typeof input.observedVersion !== "string"
    ) {
      return refused("invalid_input");
    }
    if (input.observedVersion !== input.expectedVersion) {
      return refused("version_mismatch");
    }
    if (
      !isCommitSha40(input.expectedCommit) ||
      !isCommitSha40(input.observedCommit) ||
      input.expectedCommit !== input.observedCommit
    ) {
      return refused("source_mismatch");
    }
    if (
      input.inputTokensA !== 0 ||
      input.outputTokensA !== 0 ||
      input.inputTokensB !== 0 ||
      input.outputTokensB !== 0
    ) {
      return refused("model_usage");
    }
    if (!diagnosticsValid(input.diagnosticsA) || !diagnosticsValid(input.diagnosticsB)) {
      return refused("health_failure");
    }
    const graphA = parseGraph(input.graphBytesA);
    const graphB = parseGraph(input.graphBytesB);
    if (graphA === null || graphB === null) return refused("invalid_input");
    if (
      (graphA.built_at_commit !== undefined &&
        graphA.built_at_commit !== input.expectedCommit) ||
      (graphB.built_at_commit !== undefined &&
        graphB.built_at_commit !== input.expectedCommit)
    ) {
      return refused("source_mismatch");
    }
    const healthA = graphHealth(graphA);
    if (typeof healthA === "string") return refused(healthA);
    const healthB = graphHealth(graphB);
    if (typeof healthB === "string") return refused(healthB);
    const normalizedA = `${canonicalize(normalizeGraph(graphA))}\n`;
    const normalizedB = `${canonicalize(normalizeGraph(graphB))}\n`;
    if (
      normalizedA !== normalizedB ||
      canonicalize(healthA) !== canonicalize(healthB) ||
      canonicalize(input.diagnosticsA) !== canonicalize(input.diagnosticsB)
    ) {
      return refused("nondeterministic");
    }
    if (
      typeof input.interpreter !== "string" ||
      input.interpreter.length === 0 ||
      !noControls(input.interpreter) ||
      typeof input.cadence !== "string" ||
      input.cadence.length === 0 ||
      !noControls(input.cadence) ||
      typeof input.generatedAt !== "string" ||
      !validTimestamp(input.generatedAt)
    ) {
      return refused("invalid_input");
    }
    const previous =
      input.previousGraphBytes === null
        ? null
        : parseGraph(input.previousGraphBytes);
    if (input.previousGraphBytes !== null && previous === null) {
      return refused("rename_invalid");
    }
    const renames = deriveRenames(previous, graphA, input.fileRenames);
    if (renames === null) return refused("rename_invalid");
    const graphBytes = encoder.encode(normalizedA);
    const health = {
      ...healthA,
      diagnostics: input.diagnosticsA,
    };
    const graphSha256 = sha256Hex(graphBytes);
    const metadata: GraphifyRefreshMetadataV1 = {
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
      lastRefreshFailed: false,
    };
    return {
      schemaVersion: 1,
      _tag: "Qualified",
      graphBytes,
      metadataBytes: encoder.encode(`${canonicalize(metadata)}\n`),
      metadata,
    };
  } catch {
    return refused("invalid_input");
  }
}

function parseMetadata(bytes: Uint8Array): GraphifyRefreshMetadataV1 | null {
  const text = decodeUtf8Fatal(bytes);
  if (isCoreFailure(text) || !text.endsWith("\n")) return null;
  const body = text.slice(0, -1);
  const parsed = parseJsonRejectDuplicateKeys(body);
  if (
    isCoreFailure(parsed) ||
    !plainObject(parsed) ||
    !exactKeys(parsed, METADATA_KEYS) ||
    canonicalize(parsed) !== body ||
    parsed["schema"] !== "foreman.graphify-refresh.v1" ||
    parsed["graphifyVersion"] !== GRAPHIFY_VERSION ||
    typeof parsed["interpreter"] !== "string" ||
    typeof parsed["sourceCommit"] !== "string" ||
    !isCommitSha40(parsed["sourceCommit"]) ||
    typeof parsed["graphSha256"] !== "string" ||
    !isSha256Hex(parsed["graphSha256"]) ||
    typeof parsed["normalizedGraphSha256"] !== "string" ||
    !isSha256Hex(parsed["normalizedGraphSha256"]) ||
    typeof parsed["healthSha256"] !== "string" ||
    !isSha256Hex(parsed["healthSha256"]) ||
    parsed["inputTokens"] !== 0 ||
    parsed["outputTokens"] !== 0 ||
    typeof parsed["directed"] !== "boolean" ||
    !Number.isSafeInteger(parsed["endpointOrderCount"]) ||
    !Number.isSafeInteger(parsed["sourceFileCount"]) ||
    !Array.isArray(parsed["renames"]) ||
    typeof parsed["cadence"] !== "string" ||
    typeof parsed["generatedAt"] !== "string" ||
    typeof parsed["lastRefreshFailed"] !== "boolean"
  ) {
    return null;
  }
  return JSON.parse(body) as GraphifyRefreshMetadataV1;
}

export function evaluateGraphifyFreshnessV1(
  input: GraphifyFreshnessInputV1,
): GraphifyFreshnessResultV1 {
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
    const normalized = encoder.encode(`${canonicalize(normalizeGraph(graph))}\n`);
    const health = graphHealth(graph);
    if (
      typeof health === "string" ||
      sha256Hex(input.graphBytes) !== metadata.graphSha256 ||
      sha256Hex(normalized) !== metadata.normalizedGraphSha256 ||
      metadata.sourceFileCount !== health.sourceFiles.length ||
      metadata.endpointOrderCount !== health.endpointOrderCount ||
      metadata.directed !== health.directed
    ) {
      return { schemaVersion: 1, _tag: "Invalid" };
    }
    const represented = new Set(health.sourceFiles);
    const missingSourcePaths = [...new Set(input.trackedSourcePaths)]
      .filter((path) => !represented.has(path))
      .sort(utf8Compare);
    const identity = {
      sourceCommit: metadata.sourceCommit,
      currentCommit: input.currentCommit,
      missingSourcePaths,
    };
    if (input.ancestry === "unrelated") {
      return { schemaVersion: 1, _tag: "Unrelated", ...identity };
    }
    if (
      input.ancestry === "missing" ||
      input.ancestry === "ancestor" ||
      input.currentCommit !== metadata.sourceCommit ||
      missingSourcePaths.length > 0
    ) {
      return { schemaVersion: 1, _tag: "Stale", ...identity };
    }
    return { schemaVersion: 1, _tag: "Fresh", ...identity };
  } catch {
    return { schemaVersion: 1, _tag: "Invalid" };
  }
}

const CLI_USAGE =
  "usage: graphify-qualification qualify --repo ABS --manifest ABS --cadence NAME | freshness --repo ABS\n";

export async function runGraphifyQualificationCli(
  argv: readonly string[],
  io: GraphifyQualificationCliIo,
  services: GraphifyQualificationCliServices,
): Promise<number> {
  const tail = argv.slice(2);
  let operation:
    | {
        readonly kind: "qualify";
        readonly repository: string;
        readonly manifest: string;
        readonly cadence: string;
      }
    | { readonly kind: "freshness"; readonly repository: string }
    | null = null;
  if (
    tail.length === 7 &&
    tail[0] === "qualify" &&
    tail[1] === "--repo" &&
    tail[3] === "--manifest" &&
    tail[5] === "--cadence" &&
    tail[2] !== undefined &&
    tail[4] !== undefined &&
    tail[6] !== undefined &&
    isAbsolute(tail[2]) &&
    isAbsolute(tail[4]) &&
    tail[6].length > 0 &&
    noControls(tail[6])
  ) {
    operation = {
      kind: "qualify",
      repository: tail[2],
      manifest: tail[4],
      cadence: tail[6],
    };
  } else if (
    tail.length === 3 &&
    tail[0] === "freshness" &&
    tail[1] === "--repo" &&
    tail[2] !== undefined &&
    isAbsolute(tail[2])
  ) {
    operation = { kind: "freshness", repository: tail[2] };
  }
  if (operation === null) {
    try {
      io.writeStderr(CLI_USAGE);
    } catch {
      // The exit code is authoritative when the diagnostic channel fails.
    }
    return 64;
  }
  let result: GraphifyCliResultV1;
  try {
    result =
      operation.kind === "qualify"
        ? await services.qualify(operation)
        : await services.freshness(operation.repository);
  } catch {
    result =
      operation.kind === "qualify"
        ? { schemaVersion: 1, _tag: "Refused", reason: "invalid_input" }
        : { schemaVersion: 1, _tag: "Invalid" };
  }
  try {
    io.writeStdout(`${canonicalize(result)}\n`);
  } catch {
    return 1;
  }
  return result._tag === "Qualified" || result._tag === "Fresh" ? 0 : 1;
}

export function acquireGraphifyPublicationLockV1(
  commonGitDirectory: string,
  token: string,
): GraphifyPublicationLockResultV1 {
  const lockPath = join(commonGitDirectory, "foreman-graphify-publish.lock");
  try {
    if (
      !isAbsolute(commonGitDirectory) ||
      token.length === 0 ||
      !noControls(token)
    ) {
      return { schemaVersion: 1, _tag: "Refused", reason: "lock_timeout" };
    }
    mkdirSync(lockPath);
    writeFileSync(join(lockPath, "owner"), `${token}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    return { schemaVersion: 1, _tag: "Acquired", lockPath, token };
  } catch {
    return { schemaVersion: 1, _tag: "Refused", reason: "lock_timeout" };
  }
}

export function releaseGraphifyPublicationLockV1(
  lock: GraphifyPublicationLockV1,
): boolean {
  try {
    const owner = readFileSync(join(lock.lockPath, "owner"), "utf8");
    if (owner !== `${lock.token}\n`) return false;
    rmSync(join(lock.lockPath, "owner"));
    rmdirSync(lock.lockPath);
    return true;
  } catch {
    return false;
  }
}
