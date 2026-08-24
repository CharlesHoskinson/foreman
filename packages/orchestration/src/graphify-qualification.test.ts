import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { canonicalize, sha256Hex } from "@foreman/core";
import {
  acquireGraphifyPublicationLockV1,
  evaluateGraphifyFreshnessV1,
  qualifyGraphifyCandidateV1,
  releaseGraphifyPublicationLockV1,
  runGraphifyQualificationCli,
  type GraphifyQualificationInputV1,
} from "./graphify-qualification.js";

const encoder = new TextEncoder();
const COMMIT = "1".repeat(40);
const INTERPRETER = "/opt/graphify/bin/python";

const GRAPH_A = {
  directed: false,
  graph: {},
  hyperedges: [],
  links: [
    {
      _origin: "ast",
      confidence: "EXTRACTED",
      confidence_score: 1,
      relation: "contains",
      source: "zeta",
      source_file: "src/zeta.ts",
      source_location: "L1",
      target: "alpha",
      weight: 1,
    },
  ],
  multigraph: false,
  nodes: [
    {
      _origin: "ast",
      file_type: "code",
      id: "zeta",
      label: "zeta.ts",
      source_file: "src/zeta.ts",
      source_location: "L1",
    },
    {
      _callable: true,
      _origin: "ast",
      file_type: "code",
      id: "alpha",
      label: "alpha()",
      source_file: "src/zeta.ts",
      source_location: "L2",
    },
  ],
} as const;

const GRAPH_B = {
  nodes: [...GRAPH_A.nodes].reverse(),
  links: GRAPH_A.links,
  hyperedges: [],
  graph: {},
  multigraph: false,
  directed: false,
} as const;

const DIAGNOSTICS = {
  danglingEndpointEdges: 0,
  missingEndpointEdges: 0,
  nonObjectEdges: 0,
} as const;

function bytes(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value));
}

function validInput(
  overrides: Partial<GraphifyQualificationInputV1> = {},
): GraphifyQualificationInputV1 {
  return {
    expectedVersion: "0.9.48",
    observedVersion: "0.9.48",
    expectedCommit: COMMIT,
    observedCommit: COMMIT,
    interpreter: INTERPRETER,
    graphBytesA: bytes(GRAPH_A),
    graphBytesB: bytes(GRAPH_B),
    inputTokensA: 0,
    outputTokensA: 0,
    inputTokensB: 0,
    outputTokensB: 0,
    diagnosticsA: DIAGNOSTICS,
    diagnosticsB: DIAGNOSTICS,
    previousGraphBytes: null,
    fileRenames: [],
    cadence: "manual",
    generatedAt: "2026-08-24T12:00:00Z",
    ...overrides,
  };
}

test("qualification normalizes two equivalent code-only builds", () => {
  const result = qualifyGraphifyCandidateV1(validInput());
  assert.equal(result._tag, "Qualified");
  if (result._tag !== "Qualified") return;
  assert.equal(result.metadata.graphifyVersion, "0.9.48");
  assert.equal(result.metadata.sourceCommit, COMMIT);
  assert.equal(result.metadata.inputTokens, 0);
  assert.equal(result.metadata.outputTokens, 0);
  assert.equal(result.metadata.endpointOrderCount, 1);
  assert.equal(result.metadata.sourceFileCount, 1);
  assert.equal(result.metadata.directed, false);
  assert.equal(result.metadata.lastRefreshFailed, false);
  assert.equal(result.metadata.graphSha256, sha256Hex(result.graphBytes));
  assert.equal(
    new TextDecoder().decode(result.metadataBytes),
    `${canonicalize(result.metadata)}\n`,
  );
  const normalized = JSON.parse(new TextDecoder().decode(result.graphBytes)) as {
    nodes: Array<{ id: string }>;
  };
  assert.deepEqual(normalized.nodes.map((node) => node.id), ["alpha", "zeta"]);
});

test("qualification binds Graphify commit metadata and records external import placeholders", () => {
  const graph = {
    ...GRAPH_A,
    built_at_commit: COMMIT,
    nodes: [
      ...GRAPH_A.nodes,
      {
        _origin: "ast",
        file_type: "code",
        id: "node_fs",
        label: "node:fs",
        source_file: "node:fs",
      },
    ],
    links: [
      ...GRAPH_A.links,
      {
        _origin: "ast",
        confidence: "EXTRACTED",
        relation: "dynamic_import",
        source: "zeta",
        source_file: "src/zeta.ts",
        target: "node_fs",
      },
    ],
  };
  const qualified = qualifyGraphifyCandidateV1(
    validInput({ graphBytesA: bytes(graph), graphBytesB: bytes(graph) }),
  );
  assert.equal(qualified._tag, "Qualified");
  assert.deepEqual(
    qualifyGraphifyCandidateV1(
      validInput({
        graphBytesA: bytes({ ...graph, built_at_commit: "2".repeat(40) }),
        graphBytesB: bytes({ ...graph, built_at_commit: "2".repeat(40) }),
      }),
    ),
    { schemaVersion: 1, _tag: "Refused", reason: "source_mismatch" },
  );
});

test("qualification removes nondeterministic deferred community labels", () => {
  const first = {
    ...GRAPH_A,
    nodes: GRAPH_A.nodes.map((node, index) => ({ ...node, community: index + 1 })),
  };
  const second = {
    ...GRAPH_A,
    nodes: GRAPH_A.nodes.map((node, index) => ({ ...node, community: index + 20 })),
  };
  const result = qualifyGraphifyCandidateV1(
    validInput({ graphBytesA: bytes(first), graphBytesB: bytes(second) }),
  );
  assert.equal(result._tag, "Qualified");
  if (result._tag !== "Qualified") return;
  const graph = JSON.parse(new TextDecoder().decode(result.graphBytes)) as {
    nodes: Array<Record<string, unknown>>;
  };
  assert.equal(graph.nodes.every((node) => !("community" in node)), true);
});

test("qualification refuses each isolated invalid boundary", () => {
  const cases: ReadonlyArray<{
    readonly reason: string;
    readonly input: GraphifyQualificationInputV1;
  }> = [
    {
      reason: "version_mismatch",
      input: validInput({ observedVersion: "0.9.47" }),
    },
    {
      reason: "source_mismatch",
      input: validInput({ observedCommit: "2".repeat(40) }),
    },
    { reason: "model_usage", input: validInput({ inputTokensA: 1 }) },
    {
      reason: "nondeterministic",
      input: validInput({
        graphBytesB: bytes({ ...GRAPH_B, graph: { changed: true } }),
      }),
    },
    {
      reason: "health_failure",
      input: validInput({
        diagnosticsA: { ...DIAGNOSTICS, danglingEndpointEdges: 1 },
      }),
    },
    {
      reason: "duplicate_node",
      input: validInput({
        graphBytesA: bytes({ ...GRAPH_A, nodes: [GRAPH_A.nodes[0], GRAPH_A.nodes[0]] }),
        graphBytesB: bytes({ ...GRAPH_A, nodes: [GRAPH_A.nodes[0], GRAPH_A.nodes[0]] }),
      }),
    },
    {
      reason: "invalid_source",
      input: validInput({
        graphBytesA: bytes({
          ...GRAPH_A,
          nodes: [{ ...GRAPH_A.nodes[0], source_file: "../escape.ts" }, GRAPH_A.nodes[1]],
        }),
        graphBytesB: bytes({
          ...GRAPH_A,
          nodes: [{ ...GRAPH_A.nodes[0], source_file: "../escape.ts" }, GRAPH_A.nodes[1]],
        }),
      }),
    },
    {
      reason: "dangling_endpoint",
      input: validInput({
        graphBytesA: bytes({
          ...GRAPH_A,
          links: [{ ...GRAPH_A.links[0], target: "missing" }],
        }),
        graphBytesB: bytes({
          ...GRAPH_A,
          links: [{ ...GRAPH_A.links[0], target: "missing" }],
        }),
      }),
    },
    {
      reason: "duplicate_link",
      input: validInput({
        graphBytesA: bytes({ ...GRAPH_A, links: [GRAPH_A.links[0], GRAPH_A.links[0]] }),
        graphBytesB: bytes({ ...GRAPH_A, links: [GRAPH_A.links[0], GRAPH_A.links[0]] }),
      }),
    },
    {
      reason: "endpoint_order_lost",
      input: validInput({
        graphBytesA: bytes({
          ...GRAPH_A,
          links: [{ ...GRAPH_A.links[0], source: "alpha", target: "zeta" }],
        }),
        graphBytesB: bytes({
          ...GRAPH_A,
          links: [{ ...GRAPH_A.links[0], source: "alpha", target: "zeta" }],
        }),
      }),
    },
    {
      reason: "invalid_input",
      input: validInput({ graphBytesA: encoder.encode("{not-json") }),
    },
  ];

  for (const item of cases) {
    assert.deepEqual(qualifyGraphifyCandidateV1(item.input), {
      schemaVersion: 1,
      _tag: "Refused",
      reason: item.reason,
    });
  }
});

test("qualification records exact rename mappings and unmapped nodes", () => {
  const previous = {
    ...GRAPH_A,
    nodes: [
      { ...GRAPH_A.nodes[0], id: "old-file", label: "old.ts", source_file: "src/old.ts" },
      { ...GRAPH_A.nodes[1], id: "old-symbol", label: "work()", source_file: "src/old.ts" },
      { ...GRAPH_A.nodes[1], id: "removed", label: "removed()", source_file: "src/old.ts" },
    ],
    links: [],
  };
  const next = {
    ...GRAPH_A,
    nodes: [
      { ...GRAPH_A.nodes[0], id: "new-file", label: "new.ts", source_file: "src/new.ts" },
      { ...GRAPH_A.nodes[1], id: "new-symbol", label: "work()", source_file: "src/new.ts" },
    ],
    links: [],
  };
  const result = qualifyGraphifyCandidateV1(
    validInput({
      graphBytesA: bytes(next),
      graphBytesB: bytes(next),
      previousGraphBytes: bytes(previous),
      fileRenames: [{ oldPath: "src/old.ts", newPath: "src/new.ts" }],
    }),
  );
  assert.equal(result._tag, "Qualified");
  if (result._tag !== "Qualified") return;
  assert.deepEqual(result.metadata.renames, [
    {
      oldPath: "src/old.ts",
      newPath: "src/new.ts",
      mappings: [
        { oldId: "old-file", newId: "new-file" },
        { oldId: "old-symbol", newId: "new-symbol" },
      ],
      unmapped: ["removed"],
    },
  ]);
});

test("freshness is Graphify-free and distinguishes every state", () => {
  const qualified = qualifyGraphifyCandidateV1(validInput());
  assert.equal(qualified._tag, "Qualified");
  if (qualified._tag !== "Qualified") return;
  const common = {
    graphBytes: qualified.graphBytes,
    metadataBytes: qualified.metadataBytes,
    currentCommit: COMMIT,
    ancestry: "same" as const,
    trackedSourcePaths: ["src/zeta.ts"],
  };
  assert.deepEqual(evaluateGraphifyFreshnessV1(common), {
    schemaVersion: 1,
    _tag: "Fresh",
    sourceCommit: COMMIT,
    currentCommit: COMMIT,
    missingSourcePaths: [],
  });
  assert.equal(
    evaluateGraphifyFreshnessV1({ ...common, ancestry: "ancestor", currentCommit: "2".repeat(40) })._tag,
    "Stale",
  );
  assert.equal(evaluateGraphifyFreshnessV1({ ...common, ancestry: "unrelated" })._tag, "Unrelated");
  assert.equal(evaluateGraphifyFreshnessV1({ ...common, graphBytes: null })._tag, "Missing");
  assert.equal(
    evaluateGraphifyFreshnessV1({ ...common, graphBytes: encoder.encode("{}") })._tag,
    "Invalid",
  );
  assert.equal(
    evaluateGraphifyFreshnessV1({
      ...common,
      metadataBytes: encoder.encode(
        `${canonicalize({ ...qualified.metadata, lastRefreshFailed: true })}\n`,
      ),
    })._tag,
    "RefreshFailed",
  );
  const stale = evaluateGraphifyFreshnessV1({
    ...common,
    trackedSourcePaths: ["src/zeta.ts", "src/missing.ts"],
  });
  assert.equal(stale._tag, "Stale");
  assert.deepEqual(stale.missingSourcePaths, ["src/missing.ts"]);
});

test("the common-Git-directory publication lock has one holder", () => {
  const commonGitDirectory = mkdtempSync(join(tmpdir(), "graphify-lock-"));
  try {
    const first = acquireGraphifyPublicationLockV1(commonGitDirectory, "first");
    assert.equal(first._tag, "Acquired");
    assert.deepEqual(
      acquireGraphifyPublicationLockV1(commonGitDirectory, "second"),
      { schemaVersion: 1, _tag: "Refused", reason: "lock_timeout" },
    );
    if (first._tag === "Acquired") {
      assert.equal(releaseGraphifyPublicationLockV1(first), true);
    }
    const second = acquireGraphifyPublicationLockV1(commonGitDirectory, "second");
    assert.equal(second._tag, "Acquired");
    if (second._tag === "Acquired") {
      assert.equal(releaseGraphifyPublicationLockV1(second), true);
    }
  } finally {
    rmSync(commonGitDirectory, { recursive: true, force: true });
  }
});

test("the CLI accepts only exact absolute qualification and freshness forms", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const calls: string[] = [];
  const services = {
    qualify: async (input: {
      readonly repository: string;
      readonly manifest: string;
      readonly cadence: string;
    }) => {
      calls.push(`qualify:${input.repository}:${input.manifest}:${input.cadence}`);
      return { schemaVersion: 1 as const, _tag: "Qualified" as const, sourceCommit: COMMIT };
    },
    freshness: async (repository: string) => {
      calls.push(`freshness:${repository}`);
      return {
        schemaVersion: 1 as const,
        _tag: "Fresh" as const,
        sourceCommit: COMMIT,
        currentCommit: COMMIT,
        missingSourcePaths: [],
      };
    },
  };
  assert.equal(
    await runGraphifyQualificationCli(
      [
        "node",
        "graphify-qualification.js",
        "qualify",
        "--repo",
        "/repo",
        "--manifest",
        "/repo/env/reference-manifest.toml",
        "--cadence",
        "manual",
      ],
      { writeStdout: (text) => stdout.push(text), writeStderr: (text) => stderr.push(text) },
      services,
    ),
    0,
  );
  assert.equal(
    await runGraphifyQualificationCli(
      ["node", "graphify-qualification.js", "freshness", "--repo", "/repo"],
      { writeStdout: (text) => stdout.push(text), writeStderr: (text) => stderr.push(text) },
      services,
    ),
    0,
  );
  assert.deepEqual(calls, [
    "qualify:/repo:/repo/env/reference-manifest.toml:manual",
    "freshness:/repo",
  ]);
  assert.deepEqual(stderr, []);
  assert.equal(stdout.length, 2);
  assert.equal(stdout[0], `${canonicalize({ schemaVersion: 1, _tag: "Qualified", sourceCommit: COMMIT })}\n`);
});

test("bad CLI argv is exit 64 with no service call", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let calls = 0;
  const exitCode = await runGraphifyQualificationCli(
    ["node", "graphify-qualification.js", "freshness", "--repo", "relative"],
    { writeStdout: (text) => stdout.push(text), writeStderr: (text) => stderr.push(text) },
    {
      qualify: async () => {
        calls += 1;
        return { schemaVersion: 1 as const, _tag: "Refused" as const, reason: "invalid_input" as const };
      },
      freshness: async () => {
        calls += 1;
        return { schemaVersion: 1 as const, _tag: "Invalid" as const };
      },
    },
  );
  assert.equal(exitCode, 64);
  assert.equal(calls, 0);
  assert.deepEqual(stdout, []);
  assert.deepEqual(stderr, ["usage: graphify-qualification qualify --repo ABS --manifest ABS --cadence NAME | freshness --repo ABS\n"]);
});
