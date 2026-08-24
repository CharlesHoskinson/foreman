import {
  canonicalize,
  isCommitSha40,
  isCoreFailure,
  isSha256Hex,
  parseJsonRejectDuplicateKeys,
  sha256Hex,
} from "@foreman/core";

const encoder = new TextEncoder();
const MAX_GRAPH_BYTES = 32 * 1024 * 1024;
const MAX_METADATA_BYTES = 1024 * 1024;
const MIN_BUDGET_TOKENS = 256;
const MAX_BUDGET_TOKENS = 4_000;
const MAX_SEEDS = 8;

const IMPLEMENTER_RELATIONS = new Set([
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
  "references",
]);
const AUDITOR_RELATIONS = new Set([
  ...IMPLEMENTER_RELATIONS,
  "cites",
  "rationale_for",
]);

export type GraphContextRoleV1 = "implementer" | "auditor";

export type GraphContextSeedV1 = {
  readonly id: string;
  readonly label: string;
  readonly sourceFile: string;
};

export type GraphContextEdgeV1 = {
  readonly alias: string;
  readonly edgeKey: string;
  readonly source: string;
  readonly target: string;
  readonly relation: string;
  readonly sourceFile: string;
  readonly sourceLocation: string;
};

export type GraphContextBlockV1 = {
  readonly schema: "foreman.graph-context.v1";
  readonly graphSha256: string;
  readonly sourceCommit: string;
  readonly graphifyVersion: "0.9.48";
  readonly role: GraphContextRoleV1;
  readonly taskSha256: string;
  readonly budgetTokens: number;
  readonly estimatedTokens: number;
  readonly truncated: boolean;
  readonly seeds: readonly GraphContextSeedV1[];
  readonly edges: readonly GraphContextEdgeV1[];
  readonly citationInstruction: "Cite served edges by alias. Mark any uncited load-bearing claim.";
};

export type GraphContextBuildResultV1 =
  | {
      readonly schemaVersion: 1;
      readonly _tag: "Built";
      readonly block: GraphContextBlockV1;
      readonly blockBytes: Uint8Array;
      readonly sha256: string;
    }
  | {
      readonly schemaVersion: 1;
      readonly _tag: "NoContext";
      readonly marker: "NO GRAPH CONTEXT";
    }
  | {
      readonly schemaVersion: 1;
      readonly _tag: "Invalid";
      readonly reason: "invalid_graph" | "invalid_metadata" | "invalid_input";
    };

export type GraphContextClaimV1 = {
  readonly text: string;
  readonly citations: readonly string[];
};

export type GraphContextVerificationCodeV1 =
  | "HALLUCINATED_EDGE_ID"
  | "OUT_OF_CONTEXT_CITATION"
  | "UNSUPPORTED_CLAIM";

export type GraphContextVerificationResultV1 =
  | { readonly schemaVersion: 1; readonly _tag: "Valid" }
  | {
      readonly schemaVersion: 1;
      readonly _tag: "Invalid";
      readonly codes: readonly GraphContextVerificationCodeV1[];
    }
  | { readonly schemaVersion: 1; readonly _tag: "InvalidInput" };

type GraphNode = {
  readonly id: string;
  readonly label: string;
  readonly sourceFile: string;
};

type GraphEdge = Omit<GraphContextEdgeV1, "alias">;

type ParsedGraph = {
  readonly nodes: readonly GraphNode[];
  readonly links: readonly GraphEdge[];
};

type ParsedMetadata = {
  readonly graphSha256: string;
  readonly sourceCommit: string;
  readonly graphifyVersion: "0.9.48";
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function parseCanonicalFile(bytes: Uint8Array, maxBytes: number): unknown | null {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > maxBytes) return null;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch {
    return null;
  }
  if (!text.endsWith("\n") || text.endsWith("\r\n")) {
    return null;
  }
  const body = text.slice(0, -1);
  const parsed = parseJsonRejectDuplicateKeys(body);
  if (isCoreFailure(parsed) || canonicalize(parsed) !== body) return null;
  return JSON.parse(body) as unknown;
}

function boundedString(value: unknown, maxBytes = 16_384): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    encoder.encode(value).byteLength <= maxBytes &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function boundedTaskText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    encoder.encode(value).byteLength <= 64 * 1024 &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
  );
}

function edgeIdentity(input: {
  readonly source: string;
  readonly target: string;
  readonly relation: string;
  readonly sourceFile: string;
  readonly sourceLocation: string;
}): string {
  return sha256Hex(
    [
      input.source,
      input.target,
      input.relation,
      input.sourceFile,
      input.sourceLocation,
    ].join("\u0000"),
  );
}

function parseGraph(bytes: Uint8Array): ParsedGraph | null {
  const value = parseCanonicalFile(bytes, MAX_GRAPH_BYTES);
  if (!isPlainObject(value) || !Array.isArray(value.nodes) || !Array.isArray(value.links)) {
    return null;
  }
  const nodes: GraphNode[] = [];
  const nodeIds = new Set<string>();
  for (const raw of value.nodes) {
    if (
      !isPlainObject(raw) ||
      !boundedString(raw.id) ||
      !boundedString(raw.label) ||
      !boundedString(raw.source_file)
    ) {
      return null;
    }
    if (nodeIds.has(raw.id)) return null;
    nodeIds.add(raw.id);
    nodes.push({ id: raw.id, label: raw.label, sourceFile: raw.source_file });
  }
  const links: GraphEdge[] = [];
  const edgeIds = new Set<string>();
  for (const raw of value.links) {
    if (
      !isPlainObject(raw) ||
      !boundedString(raw.source) ||
      !boundedString(raw.target) ||
      !boundedString(raw.relation) ||
      !boundedString(raw.source_file) ||
      (raw.source_location !== undefined &&
        !boundedString(raw.source_location)) ||
      !nodeIds.has(raw.source) ||
      !nodeIds.has(raw.target)
    ) {
      return null;
    }
    const edge = {
      edgeKey: edgeIdentity({
        source: raw.source,
        target: raw.target,
        relation: raw.relation,
        sourceFile: raw.source_file,
        sourceLocation:
          raw.source_location === undefined ? "" : raw.source_location,
      }),
      source: raw.source,
      target: raw.target,
      relation: raw.relation,
      sourceFile: raw.source_file,
      sourceLocation:
        raw.source_location === undefined ? "" : raw.source_location,
    };
    if (edgeIds.has(edge.edgeKey)) return null;
    edgeIds.add(edge.edgeKey);
    links.push(edge);
  }
  return { nodes, links };
}

function parseMetadata(bytes: Uint8Array): ParsedMetadata | null {
  const value = parseCanonicalFile(bytes, MAX_METADATA_BYTES);
  if (
    !isPlainObject(value) ||
    value.schema !== "foreman.graphify-refresh.v1" ||
    value.graphifyVersion !== "0.9.48" ||
    typeof value.graphSha256 !== "string" ||
    !isSha256Hex(value.graphSha256) ||
    typeof value.sourceCommit !== "string" ||
    !isCommitSha40(value.sourceCommit) ||
    value.inputTokens !== 0 ||
    value.outputTokens !== 0 ||
    value.lastRefreshFailed !== false
  ) {
    return null;
  }
  return {
    graphSha256: value.graphSha256,
    sourceCommit: value.sourceCommit,
    graphifyVersion: "0.9.48",
  };
}

function compareUtf8(left: string, right: string): number {
  return Buffer.from(left).compare(Buffer.from(right));
}

function taskTokens(text: string): readonly string[] {
  return [
    ...new Set(
      text
        .normalize("NFKC")
        .toLocaleLowerCase("en-US")
        .split(/[^\p{L}\p{N}_./-]+/u)
        .filter((token) => encoder.encode(token).byteLength >= 3),
    ),
  ].sort(compareUtf8);
}

function nodeScore(node: GraphNode, tokens: readonly string[]): number {
  const haystack = `${node.id}\n${node.label}\n${node.sourceFile}`
    .normalize("NFKC")
    .toLocaleLowerCase("en-US");
  return tokens.reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0);
}

function withEstimate(
  block: Omit<GraphContextBlockV1, "estimatedTokens">,
): { readonly block: GraphContextBlockV1; readonly bytes: Uint8Array } {
  let estimatedTokens = 0;
  let result: GraphContextBlockV1 = { ...block, estimatedTokens };
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const bytes = encoder.encode(`${canonicalize(result)}\n`);
    const next = Math.ceil(bytes.byteLength / 4);
    if (next === estimatedTokens) return { block: result, bytes };
    estimatedTokens = next;
    result = { ...block, estimatedTokens };
  }
  const bytes = encoder.encode(`${canonicalize(result)}\n`);
  return { block: result, bytes };
}

export function buildGraphContextV1(input: {
  readonly graphBytes: Uint8Array;
  readonly metadataBytes: Uint8Array;
  readonly taskText: string;
  readonly role: GraphContextRoleV1;
  readonly budgetTokens: number;
}): GraphContextBuildResultV1 {
  try {
    if (
      !boundedTaskText(input.taskText) ||
      (input.role !== "implementer" && input.role !== "auditor") ||
      !Number.isSafeInteger(input.budgetTokens)
    ) {
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
    const rankedNodes = graph.nodes
      .map((node) => ({ node, score: nodeScore(node, tokens) }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score || compareUtf8(left.node.id, right.node.id));
    if (rankedNodes.length === 0) {
      return { schemaVersion: 1, _tag: "NoContext", marker: "NO GRAPH CONTEXT" };
    }
    const seeds = rankedNodes.slice(0, MAX_SEEDS).map(({ node }) => node);
    const allowed = input.role === "auditor" ? AUDITOR_RELATIONS : IMPLEMENTER_RELATIONS;
    const selectedEdges = new Map<string, { readonly edge: GraphEdge; readonly hop: number; readonly score: number }>();
    let frontier = new Set(seeds.map((seed) => seed.id));
    const visited = new Set(frontier);
    for (let hop = 1; hop <= 2; hop += 1) {
      const next = new Set<string>();
      for (const edge of graph.links) {
        if (!allowed.has(edge.relation)) continue;
        if (!frontier.has(edge.source) && !frontier.has(edge.target)) continue;
        const sourceNode = graph.nodes.find((node) => node.id === edge.source)!;
        const targetNode = graph.nodes.find((node) => node.id === edge.target)!;
        const score =
          nodeScore(sourceNode, tokens) +
          nodeScore(targetNode, tokens) +
          nodeScore(
            { id: edge.relation, label: edge.relation, sourceFile: edge.sourceFile },
            tokens,
          ) +
          (3 - hop);
        selectedEdges.set(edge.edgeKey, { edge, hop, score });
        if (!visited.has(edge.source)) next.add(edge.source);
        if (!visited.has(edge.target)) next.add(edge.target);
      }
      for (const id of next) visited.add(id);
      frontier = next;
    }
    const rankedEdges = [...selectedEdges.values()].sort(
      (left, right) =>
        right.score - left.score ||
        left.hop - right.hop ||
        compareUtf8(left.edge.edgeKey, right.edge.edgeKey),
    );
    const budgetTokens = Math.min(
      MAX_BUDGET_TOKENS,
      Math.max(MIN_BUDGET_TOKENS, input.budgetTokens),
    );
    const base = {
      schema: "foreman.graph-context.v1" as const,
      graphSha256: metadata.graphSha256,
      sourceCommit: metadata.sourceCommit,
      graphifyVersion: metadata.graphifyVersion,
      role: input.role,
      taskSha256: sha256Hex(input.taskText),
      budgetTokens,
      truncated: false,
      seeds,
      edges: [] as GraphContextEdgeV1[],
      citationInstruction:
        "Cite served edges by alias. Mark any uncited load-bearing claim." as const,
    };
    const edges: GraphContextEdgeV1[] = [];
    for (const item of rankedEdges) {
      const candidate = [
        ...edges,
        { ...item.edge, alias: `e${String(edges.length + 1).padStart(2, "0")}` },
      ];
      const rendered = withEstimate({
        ...base,
        truncated: candidate.length < rankedEdges.length,
        edges: candidate,
      });
      if (rendered.block.estimatedTokens > budgetTokens) break;
      edges.push(candidate.at(-1)!);
    }
    const rendered = withEstimate({
      ...base,
      truncated: edges.length < rankedEdges.length,
      edges,
    });
    if (rendered.block.estimatedTokens > budgetTokens) {
      return { schemaVersion: 1, _tag: "Invalid", reason: "invalid_input" };
    }
    return {
      schemaVersion: 1,
      _tag: "Built",
      block: rendered.block,
      blockBytes: rendered.bytes,
      sha256: sha256Hex(rendered.bytes),
    };
  } catch {
    return { schemaVersion: 1, _tag: "Invalid", reason: "invalid_input" };
  }
}

export function verifyGraphContextResponseV1(input: {
  readonly block: GraphContextBlockV1;
  readonly graphBytes: Uint8Array;
  readonly claims: readonly GraphContextClaimV1[];
}): GraphContextVerificationResultV1 {
  try {
    const graph = parseGraph(input.graphBytes);
    if (
      graph === null ||
      input.block.graphSha256 !== sha256Hex(input.graphBytes) ||
      !Array.isArray(input.claims)
    ) {
      return { schemaVersion: 1, _tag: "InvalidInput" };
    }
    const aliases = new Set(input.block.edges.map((edge) => edge.alias));
    const servedKeys = new Set(input.block.edges.map((edge) => edge.edgeKey));
    const allKeys = new Set(graph.links.map((edge) => edge.edgeKey));
    const codes = new Set<GraphContextVerificationCodeV1>();
    for (const claim of input.claims) {
      if (
        !isPlainObject(claim) ||
        !boundedString(claim.text, 16_384) ||
        !Array.isArray(claim.citations) ||
        !claim.citations.every((citation) => boundedString(citation, 256))
      ) {
        return { schemaVersion: 1, _tag: "InvalidInput" };
      }
      if (claim.citations.length === 0) codes.add("UNSUPPORTED_CLAIM");
      for (const citation of claim.citations) {
        if (aliases.has(citation) || servedKeys.has(citation)) continue;
        if (allKeys.has(citation)) codes.add("OUT_OF_CONTEXT_CITATION");
        else codes.add("HALLUCINATED_EDGE_ID");
      }
    }
    if (codes.size === 0) return { schemaVersion: 1, _tag: "Valid" };
    return {
      schemaVersion: 1,
      _tag: "Invalid",
      codes: [...codes].sort(compareUtf8),
    };
  } catch {
    return { schemaVersion: 1, _tag: "InvalidInput" };
  }
}
