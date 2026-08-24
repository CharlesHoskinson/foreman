import assert from "node:assert/strict";
import test from "node:test";
import { canonicalize, sha256Hex } from "@foreman/core";
import {
  buildGraphContextV1,
  verifyGraphContextResponseV1,
  type GraphContextBlockV1,
} from "./graph-context.js";

const encoder = new TextEncoder();
const COMMIT = "1".repeat(40);
const TASK_TEXT = "Implement graph context building\nand verification.\n";

function graphBytes(): Uint8Array {
  return encoder.encode(
    `${canonicalize({
      directed: false,
      graph: {},
      hyperedges: [],
      links: [
        {
          _origin: "ast",
          confidence: "EXTRACTED",
          confidence_score: 1,
          relation: "defines",
          source: "graph_context",
          source_file: "packages/context.ts",
          target: "build_graph_context",
          weight: 1,
        },
        {
          _origin: "ast",
          confidence: "EXTRACTED",
          confidence_score: 1,
          relation: "calls",
          source: "build_graph_context",
          source_file: "packages/context.ts",
          source_location: "L10",
          target: "verify_context",
          weight: 1,
        },
        {
          _origin: "ast",
          confidence: "EXTRACTED",
          confidence_score: 1,
          relation: "rationale_for",
          source: "audit_note",
          source_file: "docs/context.md",
          source_location: "L4",
          target: "graph_context",
          weight: 1,
        },
        {
          _origin: "ast",
          confidence: "EXTRACTED",
          confidence_score: 1,
          relation: "defines",
          source: "unrelated_secret",
          source_file: "packages/secret.ts",
          source_location: "L1",
          target: "secret_value",
          weight: 1,
        },
      ],
      multigraph: false,
      nodes: [
        { _origin: "ast", file_type: "code", id: "graph_context", label: "Graph context", norm_label: "graph context", source_file: "packages/context.ts", source_location: "L1" },
        { _origin: "ast", file_type: "code", id: "build_graph_context", label: "buildGraphContext", norm_label: "buildgraphcontext", source_file: "packages/context.ts", source_location: "L10" },
        { _origin: "ast", file_type: "code", id: "verify_context", label: "verifyContext", norm_label: "verifycontext", source_file: "packages/context.ts", source_location: "L30" },
        { _origin: "ast", file_type: "concept", id: "audit_note", label: "Audit context note", norm_label: "audit context note", source_file: "docs/context.md", source_location: "L4" },
        { _origin: "ast", file_type: "code", id: "unrelated_secret", label: "Unrelated secret", norm_label: "unrelated secret", source_file: "packages/secret.ts", source_location: "L1" },
        { _origin: "ast", file_type: "code", id: "secret_value", label: "secretValue", norm_label: "secretvalue", source_file: "packages/secret.ts", source_location: "L2" },
      ],
    })}\n`,
  );
}

function metadataBytes(graph: Uint8Array): Uint8Array {
  return encoder.encode(
    `${canonicalize({
      cadence: "test",
      directed: false,
      endpointOrderCount: 8,
      generatedAt: "2026-08-24T00:00:00Z",
      graphSha256: sha256Hex(graph),
      graphifyVersion: "0.9.48",
      healthSha256: "2".repeat(64),
      inputTokens: 0,
      interpreter: "/trusted/python",
      lastRefreshFailed: false,
      normalizedGraphSha256: "3".repeat(64),
      outputTokens: 0,
      renames: [],
      schema: "foreman.graphify-refresh.v1",
      sourceCommit: COMMIT,
      sourceFileCount: 3,
    })}\n`,
  );
}

function build(role: "implementer" | "auditor" = "implementer") {
  const graph = graphBytes();
  return buildGraphContextV1({
    graphBytes: graph,
    metadataBytes: metadataBytes(graph),
    taskText: TASK_TEXT,
    role,
    budgetTokens: 800,
  });
}

test("builds one deterministic source-backed context block", () => {
  const first = build();
  const second = build();
  assert.equal(first._tag, "Built");
  assert.deepEqual(second, first);
  if (first._tag !== "Built") return;
  assert.equal(first.block.schema, "foreman.graph-context.v1");
  assert.equal(first.block.sourceCommit, COMMIT);
  assert.equal(first.block.graphifyVersion, "0.9.48");
  assert.equal(first.block.taskSha256, sha256Hex(TASK_TEXT));
  assert.equal(first.block.edges.length >= 2, true);
  assert.equal(first.block.edges.every((edge, index) => edge.alias === `e${String(index + 1).padStart(2, "0")}`), true);
  assert.equal(first.block.edges.some((edge) => edge.relation === "rationale_for"), false);
  assert.equal(first.block.edges.some((edge) => edge.sourceLocation === ""), true);
  assert.equal(first.block.estimatedTokens <= first.block.budgetTokens, true);
  assert.equal(first.sha256, sha256Hex(first.blockBytes));
  assert.equal(new TextDecoder().decode(first.blockBytes), `${canonicalize(first.block)}\n`);
});

test("auditor role admits rationale edges without changing graph authority", () => {
  const result = build("auditor");
  assert.equal(result._tag, "Built");
  if (result._tag !== "Built") return;
  assert.equal(result.block.edges.some((edge) => edge.relation === "rationale_for"), true);
});

test("zero seeds emits an explicit marker and never a fallback subgraph", () => {
  const graph = graphBytes();
  assert.deepEqual(
    buildGraphContextV1({
      graphBytes: graph,
      metadataBytes: metadataBytes(graph),
      taskText: "zzzxxyy unmatched vocabulary",
      role: "implementer",
      budgetTokens: 800,
    }),
    { schemaVersion: 1, _tag: "NoContext", marker: "NO GRAPH CONTEXT" },
  );
});

test("budget clamps to the closed range and serialized bytes stay inside it", () => {
  const graph = graphBytes();
  for (const [requested, expected] of [[1, 256], [99_999, 4_000]] as const) {
    const result = buildGraphContextV1({
      graphBytes: graph,
      metadataBytes: metadataBytes(graph),
      taskText: "graph context",
      role: "auditor",
      budgetTokens: requested,
    });
    assert.equal(result._tag, "Built");
    if (result._tag !== "Built") continue;
    assert.equal(result.block.budgetTokens, expected);
    assert.equal(result.block.estimatedTokens <= expected, true);
  }
});

test("accepts a valid graph above the core one MiB document limit", () => {
  const value = JSON.parse(new TextDecoder().decode(graphBytes())) as Record<
    string,
    unknown
  >;
  value.padding = "x".repeat(1_048_576);
  const graph = encoder.encode(`${canonicalize(value)}\n`);
  assert.equal(graph.byteLength > 1_048_576, true);
  const result = buildGraphContextV1({
    graphBytes: graph,
    metadataBytes: metadataBytes(graph),
    taskText: "graph context",
    role: "implementer",
    budgetTokens: 800,
  });
  assert.equal(result._tag, "Built");
});

test("citation verification reports every closed failure code", () => {
  const built = build("implementer");
  assert.equal(built._tag, "Built");
  if (built._tag !== "Built") return;
  const outsideEdgeKey = edgeKey({
    source: "unrelated_secret",
    target: "secret_value",
    relation: "defines",
    sourceFile: "packages/secret.ts",
    sourceLocation: "L1",
  });
  assert.deepEqual(
    verifyGraphContextResponseV1({
      block: built.block,
      graphBytes: graphBytes(),
      claims: [
        { text: "served", citations: [built.block.edges[0]!.alias] },
        { text: "outside", citations: [outsideEdgeKey] },
        { text: "fabricated", citations: ["not-an-edge"] },
        { text: "unsupported", citations: [] },
      ],
    }),
    {
      schemaVersion: 1,
      _tag: "Invalid",
      codes: [
        "HALLUCINATED_EDGE_ID",
        "OUT_OF_CONTEXT_CITATION",
        "UNSUPPORTED_CLAIM",
      ],
    },
  );
});

test("valid citations pass and malformed graph authority fails closed", () => {
  const built = build();
  assert.equal(built._tag, "Built");
  if (built._tag !== "Built") return;
  assert.deepEqual(
    verifyGraphContextResponseV1({
      block: built.block,
      graphBytes: graphBytes(),
      claims: [{ text: "served", citations: [built.block.edges[0]!.alias] }],
    }),
    { schemaVersion: 1, _tag: "Valid" },
  );
  assert.deepEqual(
    buildGraphContextV1({
      graphBytes: encoder.encode("{}\n"),
      metadataBytes: metadataBytes(graphBytes()),
      taskText: "graph context",
      role: "implementer",
      budgetTokens: 800,
    }),
    { schemaVersion: 1, _tag: "Invalid", reason: "invalid_graph" },
  );
});

function edgeKey(edge: {
  readonly source: string;
  readonly target: string;
  readonly relation: string;
  readonly sourceFile: string;
  readonly sourceLocation: string;
}): string {
  return sha256Hex(
    [edge.source, edge.target, edge.relation, edge.sourceFile, edge.sourceLocation].join("\u0000"),
  );
}

const _compileBlock: GraphContextBlockV1 | null = null;
assert.equal(_compileBlock, null);
