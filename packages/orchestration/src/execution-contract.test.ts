import assert from "node:assert/strict";
import test from "node:test";

import { canonicalize, sha256Hex } from "@foreman/core";

import {
  decodeExecutionContractFamilyV2,
  decodeExecutionFamilySourceFileV1,
  deriveExecutionContractFamilyV2,
  executionChildPathMatchesV1,
  executionActionKinds,
  executionContractFamilySha256,
  type ExecutionChildBriefV1,
  type ExecutionContractFamilyV2,
  type ExecutionFamilySourceV1,
  type ExecutionV2Event,
} from "./index.js";

const encoder = new TextEncoder();
const utf8 = (text: string): Uint8Array => encoder.encode(text);
const canonicalFile = (value: unknown): Uint8Array =>
  utf8(`${canonicalize(value)}\n`);

const ROOT_SHA = "a".repeat(64);
const TRACK1_COMMIT = "b".repeat(40);
const TRACK1_TREE = "c".repeat(40);
const CREATED_AT = "2026-08-24T12:00:00Z";
const DEADLINE_AT = "2026-10-23T12:00:00Z";

const CHILDREN = [
  {
    schema: "foreman.execution-child-brief.v1",
    childId: "v040-t2-project-registry",
    tranche: 2,
    packageId: "project-registry",
    dependencyChildIds: [],
    objective: "Ship the project registry lane.",
    acceptance: ["Registry resolves stable project identity."],
    allowedPaths: ["packages/orchestration/**", "packages/policy/**"],
  },
  {
    schema: "foreman.execution-child-brief.v1",
    childId: "v040-t3-memory-index",
    tranche: 3,
    packageId: "external-memory-index",
    dependencyChildIds: ["v040-t2-project-registry"],
    objective: "Ship the external memory index lane.",
    acceptance: ["The memory index uses stable project identity."],
    allowedPaths: ["packages/memory/**"],
  },
  {
    schema: "foreman.execution-child-brief.v1",
    childId: "v040-t4-appliance",
    tranche: 4,
    packageId: "hermetic-foreman-appliance",
    dependencyChildIds: [],
    objective: "Ship the hermetic Foreman appliance.",
    acceptance: ["The appliance bootstrap is reproducible."],
    allowedPaths: ["containers/**"],
  },
  {
    schema: "foreman.execution-child-brief.v1",
    childId: "v040-t5-graphify",
    tranche: 5,
    packageId: "knowledge-plane-refresh",
    dependencyChildIds: [],
    objective: "Ship the knowledge-plane refresh.",
    acceptance: ["Graph metadata is immutable."],
    allowedPaths: ["packages/knowledge/**"],
  },
  {
    schema: "foreman.execution-child-brief.v1",
    childId: "v040-t6-work-dag",
    tranche: 6,
    packageId: "work-dag-projection",
    dependencyChildIds: ["v040-t5-graphify"],
    objective: "Ship the work DAG projection.",
    acceptance: ["Work lineage is deterministic."],
    allowedPaths: ["packages/work-dag/**"],
  },
  {
    schema: "foreman.execution-child-brief.v1",
    childId: "v040-t7-context",
    tranche: 7,
    packageId: "graph-context-builder",
    dependencyChildIds: ["v040-t6-work-dag"],
    objective: "Ship the graph context builder.",
    acceptance: ["Context packs are bounded and cited."],
    allowedPaths: ["packages/context/**"],
  },
  {
    schema: "foreman.execution-child-brief.v1",
    childId: "v040-t8-evaluation",
    tranche: 8,
    packageId: "graph-eval-falsification",
    dependencyChildIds: [
      "v040-t3-memory-index",
      "v040-t4-appliance",
      "v040-t7-context",
    ],
    objective: "Ship the graph evaluation lane.",
    acceptance: ["Evaluation uses the locked four-arm design."],
    allowedPaths: ["packages/evaluation/**"],
  },
  {
    schema: "foreman.execution-child-brief.v1",
    childId: "v040-t9-release",
    tranche: 9,
    packageId: "v040-release-program",
    dependencyChildIds: [
      "v040-t2-project-registry",
      "v040-t3-memory-index",
      "v040-t4-appliance",
      "v040-t5-graphify",
      "v040-t6-work-dag",
      "v040-t7-context",
      "v040-t8-evaluation",
    ],
    objective: "Ship the v0.4 release program.",
    acceptance: ["Publication uses the exact admitted candidate."],
    allowedPaths: ["docs/releases/**"],
  },
] as const satisfies readonly ExecutionChildBriefV1[];

const V050_CHILDREN = [
  {
    schema: "foreman.execution-child-brief.v1",
    childId: "v050-lane-runtime-typescript",
    tranche: 2,
    packageId: "lane-runtime-typescript",
    dependencyChildIds: [],
    objective: "Ship the TypeScript lane runtime.",
    acceptance: ["Lane runtime compiles and runs on Node.js 24."],
    allowedPaths: ["packages/orchestration/**"],
  },
  {
    schema: "foreman.execution-child-brief.v1",
    childId: "v050-launcher-node-port",
    tranche: 3,
    packageId: "launcher-node-port",
    dependencyChildIds: ["v050-lane-runtime-typescript"],
    objective: "Ship the Node launcher port.",
    acceptance: ["Launcher preserves exact argv, env, and exit status."],
    allowedPaths: ["packages/orchestration/**"],
  },
  {
    schema: "foreman.execution-child-brief.v1",
    childId: "v050-three-outcome-verdicts",
    tranche: 4,
    packageId: "three-outcome-verdicts",
    dependencyChildIds: ["v050-lane-runtime-typescript"],
    objective: "Ship three-outcome verdicts.",
    acceptance: ["Verdicts discriminate pass, fail, and error."],
    allowedPaths: ["packages/policy/**"],
  },
  {
    schema: "foreman.execution-child-brief.v1",
    childId: "v050-audit-groundedness-gate",
    tranche: 4,
    packageId: "audit-groundedness-gate",
    dependencyChildIds: ["v050-three-outcome-verdicts"],
    objective: "Ship the audit groundedness gate.",
    acceptance: ["Audit claims bind to cited evidence."],
    allowedPaths: ["packages/policy/**"],
  },
  {
    schema: "foreman.execution-child-brief.v1",
    childId: "v050-evidence-contracts",
    tranche: 4,
    packageId: "evidence-contracts",
    dependencyChildIds: ["v050-audit-groundedness-gate"],
    objective: "Ship evidence contracts.",
    acceptance: ["Evidence objects carry the required digest fields."],
    allowedPaths: ["packages/policy/**"],
  },
  {
    schema: "foreman.execution-child-brief.v1",
    childId: "v050-spec-triage-gate",
    tranche: 5,
    packageId: "spec-triage-gate",
    dependencyChildIds: ["v050-lane-runtime-typescript"],
    objective: "Ship the spec triage gate.",
    acceptance: ["Triage admits only five-part specs."],
    allowedPaths: ["packages/orchestration/**"],
  },
  {
    schema: "foreman.execution-child-brief.v1",
    childId: "v050-foreman-discover-lane",
    tranche: 5,
    packageId: "foreman-discover-lane",
    dependencyChildIds: ["v050-lane-runtime-typescript"],
    objective: "Ship the discover lane.",
    acceptance: ["Discover writes a report in its worktree."],
    allowedPaths: ["packages/orchestration/**"],
  },
  {
    schema: "foreman.execution-child-brief.v1",
    childId: "v050-build-determinism",
    tranche: 6,
    packageId: "build-determinism",
    dependencyChildIds: ["v050-lane-runtime-typescript"],
    objective: "Ship build determinism.",
    acceptance: ["Rebuilds produce byte-identical artifacts."],
    allowedPaths: ["packages/orchestration/**"],
  },
  {
    schema: "foreman.execution-child-brief.v1",
    childId: "v050-wsl-preflight",
    tranche: 6,
    packageId: "wsl-preflight",
    dependencyChildIds: ["v050-lane-runtime-typescript"],
    objective: "Ship WSL preflight.",
    acceptance: ["Preflight reports READY or NOT-READY."],
    allowedPaths: ["packages/orchestration/**"],
  },
  {
    schema: "foreman.execution-child-brief.v1",
    childId: "v050-doctrine-reality-drift",
    tranche: 7,
    packageId: "doctrine-reality-drift",
    dependencyChildIds: ["v050-evidence-contracts"],
    objective: "Ship doctrine-reality drift detection.",
    acceptance: ["Drift reports cite the mismatched files."],
    allowedPaths: ["packages/policy/**"],
  },
  {
    schema: "foreman.execution-child-brief.v1",
    childId: "v050-workflow-weight-reduction",
    tranche: 7,
    packageId: "workflow-weight-reduction",
    dependencyChildIds: ["v050-doctrine-reality-drift"],
    objective: "Ship workflow weight reduction.",
    acceptance: ["Workflow steps stay inside the budget."],
    allowedPaths: ["packages/orchestration/**"],
  },
  {
    schema: "foreman.execution-child-brief.v1",
    childId: "v050-release",
    tranche: 8,
    packageId: "v050-release-program",
    dependencyChildIds: [
      "v050-lane-runtime-typescript",
      "v050-launcher-node-port",
      "v050-three-outcome-verdicts",
      "v050-audit-groundedness-gate",
      "v050-evidence-contracts",
      "v050-spec-triage-gate",
      "v050-foreman-discover-lane",
      "v050-build-determinism",
      "v050-wsl-preflight",
      "v050-doctrine-reality-drift",
      "v050-workflow-weight-reduction",
    ],
    objective: "Ship the v0.5 release program.",
    acceptance: ["Publication uses the exact admitted candidate."],
    allowedPaths: ["docs/releases/**"],
  },
] as const satisfies readonly ExecutionChildBriefV1[];

const SOURCE: ExecutionFamilySourceV1 = {
  schema: "foreman.execution-family-source.v1",
  program: "v040",
  familyId: "v040-release-20260822-f1",
  children: CHILDREN,
};

const INPUT = {
  rootContractId: "v040-release-20260822-r5",
  rootContractSha256: ROOT_SHA,
  track1Commit: TRACK1_COMMIT,
  track1Tree: TRACK1_TREE,
  sourceBytes: canonicalFile(SOURCE),
  createdAt: CREATED_AT,
} as const;

function derive(input: typeof INPUT = INPUT) {
  const result = deriveExecutionContractFamilyV2(input);
  if (result._tag !== "Valid") assert.fail(result.reason);
  return result;
}

test("derives the exact eight-child family and package briefs", () => {
  const result = derive();
  assert.deepEqual(result.source, SOURCE);
  assert.equal(result.manifest.schemaVersion, 2);
  assert.equal(result.manifest.familyId, "v040-release-20260822-f1");
  assert.equal(result.manifest.rootContractId, INPUT.rootContractId);
  assert.equal(result.manifest.rootContractSha256, ROOT_SHA);
  assert.equal(result.manifest.track1Commit, TRACK1_COMMIT);
  assert.equal(result.manifest.track1Tree, TRACK1_TREE);
  assert.equal(result.manifest.sourceSha256, sha256Hex(INPUT.sourceBytes));
  assert.equal(result.manifest.createdAt, CREATED_AT);
  assert.equal(result.manifest.deadlineAt, DEADLINE_AT);
  assert.equal(result.manifest.wallTimeMs, 5_184_000_000);
  assert.equal(result.manifest.totalActions, 4096);
  assert.equal(result.manifest.children.length, 8);
  assert.equal(
    result.familySha256,
    executionContractFamilySha256(result.manifest),
  );
  assert.deepEqual(
    Object.keys(result.briefs),
    CHILDREN.map((child) => child.packageId),
  );

  for (const [index, child] of CHILDREN.entries()) {
    const contract = result.manifest.children[index]!;
    assert.equal(contract.childId, child.childId);
    assert.equal(contract.tranche, child.tranche);
    assert.equal(contract.packageId, child.packageId);
    assert.deepEqual(contract.dependencyChildIds, child.dependencyChildIds);
    assert.equal(contract.deadlineAt, DEADLINE_AT);
    assert.equal(
      contract.objectiveSha256,
      sha256Hex(
        canonicalFile({
          schema: "foreman.execution-child-objective.v1",
          childId: child.childId,
          objective: child.objective,
        }),
      ),
    );
    assert.equal(
      contract.acceptanceSha256,
      sha256Hex(
        canonicalFile({
          schema: "foreman.execution-child-acceptance.v1",
          childId: child.childId,
          acceptance: child.acceptance,
        }),
      ),
    );
    assert.equal(
      contract.allowedPathsSha256,
      sha256Hex(
        canonicalFile({
          schema: "foreman.execution-child-paths.v1",
          childId: child.childId,
          allowedPaths: child.allowedPaths,
        }),
      ),
    );
    assert.deepEqual(result.briefs[child.packageId], {
      schema: "foreman.release-package-brief.v1",
      familySha256: result.familySha256,
      childId: child.childId,
      packageId: child.packageId,
      objective: child.objective,
      acceptance: child.acceptance,
      allowedPaths: child.allowedPaths,
    });
    assert.deepEqual(
      contract.requiredMilestones,
      child.tranche === 9
        ? ["checks", "audit", "integrated", "published"]
        : ["checks", "audit", "integrated"],
    );
    if (child.tranche === 8) {
      assert.deepEqual(contract.limits, {
        kind: "evaluation",
        implementationRounds: 10,
        correctionRounds: 5,
        auditRounds: 10,
        councilRounds: 5,
        providerRetries: 8,
        resumeAttempts: 5,
        verificationRunsPerCandidate: 3,
        evaluationRuns: 2000,
        totalActions: 2048,
        wallTimeMs: 3_888_000_000,
        noProgressMs: 3_600_000,
      });
    } else {
      assert.deepEqual(contract.limits, {
        kind: "standard",
        implementationRounds: 30,
        correctionRounds: 20,
        auditRounds: 20,
        councilRounds: 10,
        providerRetries: 10,
        resumeAttempts: 10,
        verificationRunsPerCandidate: 5,
        totalActions: 100,
        wallTimeMs: 1_209_600_000,
        noProductChangeMs: 259_200_000,
      });
    }
  }

  assert.deepEqual(decodeExecutionContractFamilyV2(result.manifest), result.manifest);
});

test("family source and manifest decoders are closed", () => {
  assert.deepEqual(decodeExecutionFamilySourceFileV1(INPUT.sourceBytes), SOURCE);
  for (const bytes of [
    utf8(canonicalize(SOURCE)),
    utf8(`${canonicalize(SOURCE)}\r\n`),
    utf8(`${canonicalize(SOURCE)}\n\n`),
    Uint8Array.of(0xff),
    utf8('{"schema":"foreman.execution-family-source.v1","schema":"foreman.execution-family-source.v1"}\n'),
  ]) {
    assert.equal("reason" in decodeExecutionFamilySourceFileV1(bytes), true);
  }
  const manifest = derive().manifest;
  const manifestMutants: readonly unknown[] = [
    { ...manifest, schemaVersion: 1 },
    { ...manifest, familyId: "other-family" },
    { ...manifest, rootContractSha256: "A".repeat(64) },
    { ...manifest, track1Commit: "A".repeat(40) },
    { ...manifest, deadlineAt: "2026-10-23T12:00:01Z" },
    { ...manifest, wallTimeMs: 5_184_000_001 },
    { ...manifest, totalActions: 4095 },
    { ...manifest, auditReceiptSha256: "f".repeat(64) },
    { ...manifest, children: manifest.children.slice(0, 7) },
    {
      ...manifest,
      children: manifest.children.map((child, index) =>
        index === 0 ? { ...child, packageId: "other-package" } : child,
      ),
    },
    {
      ...manifest,
      children: manifest.children.map((child, index) =>
        index === 0
          ? { ...child, limits: { ...child.limits, kind: "evaluation" } }
          : child,
      ),
    },
    {
      ...manifest,
      children: manifest.children.map((child, index) =>
        index === 6
          ? { ...child, limits: { ...child.limits, noProductChangeMs: 1 } }
          : child,
      ),
    },
  ];
  for (const mutant of manifestMutants) {
    assert.equal("reason" in decodeExecutionContractFamilyV2(mutant), true);
  }
});

test("family source mapping, content, paths, and clock fail closed", () => {
  const sourceMutants: readonly unknown[] = [
    { ...SOURCE, children: SOURCE.children.slice(0, 7) },
    { ...SOURCE, children: [...SOURCE.children, SOURCE.children[0]!] },
    { ...SOURCE, children: [SOURCE.children[1]!, SOURCE.children[0]!, ...SOURCE.children.slice(2)] },
    {
      ...SOURCE,
      children: SOURCE.children.map((child, index) =>
        index === 1 ? { ...child, dependencyChildIds: [] } : child,
      ),
    },
    {
      ...SOURCE,
      children: SOURCE.children.map((child, index) =>
        index === 0 ? { ...child, objective: "" } : child,
      ),
    },
    {
      ...SOURCE,
      children: SOURCE.children.map((child, index) =>
        index === 0 ? { ...child, objective: "bad\robjective" } : child,
      ),
    },
    {
      ...SOURCE,
      children: SOURCE.children.map((child, index) =>
        index === 0 ? { ...child, acceptance: [] } : child,
      ),
    },
    {
      ...SOURCE,
      children: SOURCE.children.map((child, index) =>
        index === 0
          ? { ...child, allowedPaths: ["packages/policy/**", "packages/orchestration/**"] }
          : child,
      ),
    },
    {
      ...SOURCE,
      children: SOURCE.children.map((child, index) =>
        index === 0 ? { ...child, allowedPaths: ["../escape/**"] } : child,
      ),
    },
  ];
  for (const source of sourceMutants) {
    assert.equal(
      deriveExecutionContractFamilyV2({
        ...INPUT,
        sourceBytes: canonicalFile(source),
      })._tag,
      "Invalid",
    );
  }
  for (const createdAt of [
    "2026-08-24T12:00:00.1Z",
    "9999-12-31T23:59:59Z",
  ]) {
    assert.equal(
      deriveExecutionContractFamilyV2({ ...INPUT, createdAt })._tag,
      "Invalid",
    );
  }
});

test("family content and path limits use exact UTF-8 boundaries", () => {
  const withFirstChild = (
    change: Partial<ExecutionChildBriefV1>,
  ): ExecutionFamilySourceV1 => ({
    ...SOURCE,
    children: SOURCE.children.map((child, index) =>
      index === 0 ? { ...child, ...change } : child,
    ),
  });
  for (const source of [
    withFirstChild({ objective: `${"x".repeat(16_382)}é` }),
    withFirstChild({ objective: "line one\nline two" }),
    withFirstChild({ acceptance: ["é".repeat(2_048)] }),
    withFirstChild({
      acceptance: Array.from({ length: 256 }, (_, index) => `a${index}`),
    }),
    withFirstChild({
      allowedPaths: Array.from(
        { length: 256 },
        (_, index) => `packages/p${String(index).padStart(3, "0")}/**`,
      ),
    }),
  ]) {
    assert.equal(
      deriveExecutionContractFamilyV2({
        ...INPUT,
        sourceBytes: canonicalFile(source),
      })._tag,
      "Valid",
    );
  }
  for (const source of [
    withFirstChild({ objective: `${"x".repeat(16_383)}é` }),
    withFirstChild({ acceptance: [`${"x".repeat(4_095)}é`] }),
    withFirstChild({
      acceptance: Array.from({ length: 257 }, (_, index) => `a${index}`),
    }),
    withFirstChild({
      allowedPaths: Array.from(
        { length: 257 },
        (_, index) => `packages/p${String(index).padStart(3, "0")}/**`,
      ),
    }),
  ]) {
    assert.equal(
      deriveExecutionContractFamilyV2({
        ...INPUT,
        sourceBytes: canonicalFile(source),
      })._tag,
      "Invalid",
    );
  }

  assert.equal(executionChildPathMatchesV1("README.md", "README.md"), true);
  assert.equal(executionChildPathMatchesV1("README.md", "README.md/x"), false);
  assert.equal(
    executionChildPathMatchesV1("packages/policy/**", "packages/policy/src/a.ts"),
    true,
  );
  assert.equal(
    executionChildPathMatchesV1("packages/policy/**", "packages/policy"),
    false,
  );
  assert.equal(
    executionChildPathMatchesV1("packages/policy/**", "packages/policy-other/a"),
    false,
  );
  assert.equal(executionChildPathMatchesV1("../escape/**", "escape/a"), false);
});

function v050Source(
  children: readonly ExecutionChildBriefV1[] = V050_CHILDREN,
): ExecutionFamilySourceV1 {
  return {
    ...SOURCE,
    program: "v050",
    children,
  };
}

function deriveV050() {
  return derive({
    ...INPUT,
    sourceBytes: canonicalFile(v050Source()),
  });
}

test("v050 family sources derive and v041 is refused", () => {
  const derived = deriveV050();
  assert.equal(derived.source.program, "v050");
  assert.equal(derived.manifest.program, "v050");
  assert.equal(derived.manifest.children.length, 12);
  for (const [index, child] of V050_CHILDREN.entries()) {
    assert.equal(derived.manifest.children[index]?.childId, child.childId);
    assert.equal(derived.manifest.children[index]?.tranche, child.tranche);
    assert.equal(derived.manifest.children[index]?.packageId, child.packageId);
    assert.equal(derived.manifest.children[index]?.limits.kind, "standard");
    assert.equal(child.childId.startsWith("v050-"), true);
  }
  assert.deepEqual(
    decodeExecutionFamilySourceFileV1(canonicalFile({ ...SOURCE, program: "v041" })),
    { _tag: "ExecutionFamilyFailure", reason: "invalid_source" },
  );
});

test("v050 expected children have twelve distinct package ids and v050-release depends on the other eleven", () => {
  const derived = deriveV050();
  const packageIds = derived.manifest.children.map((child) => child.packageId);
  assert.equal(packageIds.length, 12);
  assert.equal(new Set(packageIds).size, 12);
  const release = derived.manifest.children[11];
  assert.equal(release?.childId, "v050-release");
  assert.equal(release?.packageId, "v050-release-program");
  assert.deepEqual(
    release?.dependencyChildIds,
    V050_CHILDREN.slice(0, 11).map((child) => child.childId),
  );
});

test("v050 family with a tranche 9 child is refused", () => {
  const children = V050_CHILDREN.map((child, index) =>
    index === 0
      ? { ...child, tranche: 9 as const, childId: "v050-9-release" }
      : child,
  );
  assert.deepEqual(
    decodeExecutionFamilySourceFileV1(canonicalFile(v050Source(children))),
    { _tag: "ExecutionFamilyFailure", reason: "invalid_source" },
  );
});

test("v050 family containing v040-t8-evaluation is refused", () => {
  const children = V050_CHILDREN.map((child, index) =>
    index === 0 ? CHILDREN[6]! : child,
  );
  assert.deepEqual(
    decodeExecutionFamilySourceFileV1(canonicalFile(v050Source(children))),
    { _tag: "ExecutionFamilyFailure", reason: "invalid_source" },
  );
});

test("v050 appended and replaced forbidden children return program failures", () => {
  const tranche9Child = {
    ...V050_CHILDREN[0]!,
    tranche: 9 as const,
    childId: "v050-9-release",
  };
  const evaluationChild = CHILDREN[6]!;
  const replacedTranche9 = V050_CHILDREN.map((child, index) =>
    index === 0 ? tranche9Child : child,
  );
  const replacedEvaluation = V050_CHILDREN.map((child, index) =>
    index === 0 ? evaluationChild : child,
  );
  const appendedTranche9 = [...V050_CHILDREN, tranche9Child];
  const appendedEvaluation = [...V050_CHILDREN, evaluationChild];

  for (const children of [
    replacedTranche9,
    replacedEvaluation,
    appendedTranche9,
    appendedEvaluation,
  ]) {
    assert.deepEqual(
      decodeExecutionFamilySourceFileV1(canonicalFile(v050Source(children))),
      { _tag: "ExecutionFamilyFailure", reason: "invalid_source" },
    );
  }

  const derived = deriveV050();
  const tranche9ManifestChild = {
    ...derived.manifest.children[0]!,
    tranche: 9 as const,
    childId: "v050-9-release",
  };
  const evaluationManifestChild = {
    ...derived.manifest.children[0]!,
    childId: "v040-t8-evaluation",
    tranche: 8 as const,
    packageId: "graph-eval-falsification",
  };
  const manifestReplacedTranche9 = derived.manifest.children.map((child, index) =>
    index === 0 ? tranche9ManifestChild : child,
  );
  const manifestReplacedEvaluation = derived.manifest.children.map(
    (child, index) => (index === 0 ? evaluationManifestChild : child),
  );
  const manifestAppendedTranche9 = [
    ...derived.manifest.children,
    tranche9ManifestChild,
  ];
  const manifestAppendedEvaluation = [
    ...derived.manifest.children,
    evaluationManifestChild,
  ];

  for (const children of [
    manifestReplacedTranche9,
    manifestReplacedEvaluation,
    manifestAppendedTranche9,
    manifestAppendedEvaluation,
  ]) {
    assert.deepEqual(decodeExecutionContractFamilyV2({ ...derived.manifest, children }), {
      _tag: "ExecutionFamilyFailure",
      reason: "invalid_manifest",
    });
  }

  assert.deepEqual(
    decodeExecutionContractFamilyV2({
      ...derived.manifest,
      children: [...derived.manifest.children, derived.manifest.children[0]!],
    }),
    { _tag: "ExecutionFamilyFailure", reason: "invalid_children" },
  );
});

test("V1 action and event grammar still excludes evaluate", () => {
  assert.equal(executionActionKinds.includes("evaluate" as never), false);
  const v2EvaluationEvent: ExecutionV2Event = {
    _tag: "ActionReserved",
    action: "evaluate",
    candidateSha256: ROOT_SHA,
    reservationId: "evaluation-1",
    at: CREATED_AT,
  };
  assert.equal(v2EvaluationEvent.action, "evaluate");
});
