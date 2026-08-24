import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canonicalize, sha256Hex } from "@foreman/core";
import {
  buildApprovedOpenSpecManifestV1,
  type RegisteredReleaseAuthorityV1,
  type ReleaseCandidateIdentityV1,
  type ReleaseCoverageResultV1,
} from "@foreman/policy";
import { Effect } from "effect";
import {
  parseReleasePolicyArgv,
  runReleasePolicyCli,
  type ReleasePolicyFamilyViewV1,
  type ReleasePolicyServices,
} from "./release-policy.js";

const A = "a".repeat(64);
const B = "b".repeat(64);
const COMMIT = "1".repeat(40);
const TREE = "2".repeat(40);
const CANDIDATE: ReleaseCandidateIdentityV1 = {
  commit: COMMIT,
  tree: TREE,
  candidateSha256: sha256Hex(COMMIT),
};

const block = (evidence = "/authority/evidence.json") => [
  "check",
  "--endstop-state-root", "/state",
  "--endstop-contract-id", "root-contract",
  "--endstop-contract-sha", A,
  "--endstop-family-sha", B,
  "--endstop-child-id", "v040-t2-project-registry",
  "--endstop-action", "verify",
  "--endstop-candidate-sha", CANDIDATE.candidateSha256,
  "--release-program", "v040",
  "--release-phase", "lane",
  "--release-owner", "project-registry",
  "--release-repo", "/repo",
  "--release-candidate-commit", COMMIT,
  "--release-register", "/register/coverage.toml",
  "--release-evidence", evidence,
] as const;

function fixture() {
  const files = [
    { path: "design.md", bytes: new TextEncoder().encode("design\n") },
    { path: "proposal.md", bytes: new TextEncoder().encode("proposal\n") },
    { path: "specs/core/spec.md", bytes: new TextEncoder().encode("spec\n") },
  ] as const;
  const manifest = buildApprovedOpenSpecManifestV1({
    workflow: "foreman-architectural",
    files,
  });
  assert.equal(manifest._tag, "Valid");
  if (manifest._tag !== "Valid") throw new Error("fixture manifest");
  const taskPlanBytes = new TextEncoder().encode("tasks\n");
  const design = {
    schema: "foreman.design-approval.v1",
    program: "v040",
    packageId: "project-registry",
    designCommit: COMMIT,
    designTree: TREE,
    approvedOpenSpecSha256: manifest.sha256,
    taskPlanSha256: sha256Hex(taskPlanBytes),
    approvalStatementSha256: A,
    issuedAt: "2026-08-24T12:00:00Z",
  } as const;
  const bundle = {
    schema: "foreman.release-evidence-bundle.v1",
    program: "v040",
    rootContractId: "root-contract",
    rootContractSha256: A,
    familySha256: B,
    childId: "v040-t2-project-registry",
    packageId: "project-registry",
    action: "verify",
    candidate: CANDIDATE,
    taskPlanSha256: sha256Hex(taskPlanBytes),
    receipts: [design],
    issuedAt: "2026-08-24T12:01:00Z",
  } as const;
  const evidenceBytes = new TextEncoder().encode(`${canonicalize(bundle)}\n`);
  const receiptBytes = new TextEncoder().encode(`${canonicalize(design)}\n`);
  const registered: RegisteredReleaseAuthorityV1 = {
    rootContractId: bundle.rootContractId,
    rootContractSha256: bundle.rootContractSha256,
    familySha256: bundle.familySha256,
    childId: bundle.childId,
    action: bundle.action,
    effectiveAction: bundle.action,
    priorReservationId: null,
    originReservationId: null,
    candidate: CANDIDATE,
    taskPlanSha256: bundle.taskPlanSha256,
    bundleSha256: sha256Hex(evidenceBytes),
    receiptSchemas: [design.schema],
    receiptSha256s: [sha256Hex(receiptBytes)],
    evaluationManifestSha256: null,
    registeredAt: "2026-08-24T12:02:00Z",
  };
  const approvedOpenSpecBytes = Object.fromEntries(
    files.map((row) => [row.path, row.bytes]),
  );
  return {
    evidenceBytes,
    taskPlanBytes,
    approvedOpenSpecBytes,
    registered,
  };
}

describe("release-policy", () => {
  it("parses one exact fixed release block", () => {
    const parsed = parseReleasePolicyArgv(block());
    assert.equal(parsed._tag, "Check");
    if (parsed._tag !== "Check") return;
    assert.equal(parsed.block.childId, "v040-t2-project-registry");
    assert.equal(parsed.block.action, "verify");
    assert.equal(parseReleasePolicyArgv([...block(), "extra"])._tag, "Invalid");
    const reordered = [...block()];
    [reordered[1], reordered[3]] = [reordered[3]!, reordered[1]!];
    assert.equal(parseReleasePolicyArgv(reordered)._tag, "Invalid");
  });

  it("runs coverage first and admits only the matching activated registration", async () => {
    const data = fixture();
    const calls: string[] = [];
    const coverage: ReleaseCoverageResultV1 = {
      schemaVersion: 1,
      _tag: "Valid",
      activeInventorySha256: A,
      roadmapSha256: B,
      entryCount: 1,
    };
    const family: ReleasePolicyFamilyViewV1 = {
      packageId: "project-registry",
      currentCandidate: CANDIDATE,
      registrations: [data.registered],
    };
    const services: ReleasePolicyServices = {
      checkCoverage: () => {
        calls.push("coverage");
        return Effect.succeed(coverage);
      },
      readEvidence: () => {
        calls.push("evidence");
        return Effect.succeed(data.evidenceBytes);
      },
      loadGitAuthority: () => {
        calls.push("git");
        return Effect.succeed({
          candidate: CANDIDATE,
          designTree: TREE,
          designLineageValid: true,
          approvedOpenSpecBytes: data.approvedOpenSpecBytes,
          taskPlanBytes: data.taskPlanBytes,
        });
      },
      resolveFamily: () => {
        calls.push("family");
        return Effect.succeed(family);
      },
    };
    let stdout = "";
    let stderr = "";
    const code = await Effect.runPromise(
      runReleasePolicyCli(block(), {
        writeStdout: (text) => { stdout += text; },
        writeStderr: (text) => { stderr += text; },
      }, services),
    );
    assert.equal(code, 0, stderr);
    assert.deepEqual(calls, ["coverage", "evidence", "git", "family"]);
    assert.equal(stdout, '{"_tag":"Admitted","schemaVersion":1}\n');
  });

  it("stops before evidence and ledger lookup when coverage refuses", async () => {
    let laterCalls = 0;
    const services: ReleasePolicyServices = {
      checkCoverage: () => Effect.succeed({
        schemaVersion: 1,
        _tag: "Invalid",
        reason: "brief_mismatch",
      }),
      readEvidence: () => { laterCalls += 1; return Effect.die("late"); },
      loadGitAuthority: () => { laterCalls += 1; return Effect.die("late"); },
      resolveFamily: () => { laterCalls += 1; return Effect.die("late"); },
    };
    let stdout = "";
    const code = await Effect.runPromise(
      runReleasePolicyCli(block(), {
        writeStdout: (text) => { stdout += text; },
        writeStderr: () => undefined,
      }, services),
    );
    assert.equal(code, 1);
    assert.equal(laterCalls, 0);
    assert.equal(stdout.includes("brief_mismatch"), true);
  });
});
