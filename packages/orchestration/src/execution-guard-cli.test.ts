import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { canonicalize } from "@foreman/core";
import { Effect } from "effect";
import {
  deriveExecutionContractFamilyV2,
  executionContractSha256,
  strictEndstopLimits,
  type ExecutionContractV1,
  type ExecutionFamilySourceV1,
} from "./execution-contract.js";
import {
  EndstopLedger,
  makeLiveEndstopLedgerLayer,
} from "./execution-ledger.js";
import { parseEndstopArgv, runEndstopCli } from "./execution-guard-cli.js";

const A = "a".repeat(64);
const B = "b".repeat(64);

function contract(): ExecutionContractV1 {
  return {
    schemaVersion: 1,
    contractId: "endstop-cli-1",
    packageId: "package-cli",
    objectiveSha256: A,
    acceptanceSha256: B,
    baseCommit: "1".repeat(40),
    allowedPathsSha256: A,
    dependencyContractIds: [],
    authorizationSha256: A,
    createdAt: "2026-08-05T12:00:00Z",
    deadlineAt: "2026-08-05T14:00:00Z",
    limits: strictEndstopLimits,
    requiredMilestones: ["checks"],
  };
}

function familySource(): ExecutionFamilySourceV1 {
  const rows = [
    [2, "v040-t2-project-registry", "project-registry", []],
    [3, "v040-t3-memory-index", "external-memory-index", ["v040-t2-project-registry"]],
    [4, "v040-t4-appliance", "hermetic-foreman-appliance", []],
    [5, "v040-t5-graphify", "knowledge-plane-refresh", []],
    [6, "v040-t6-work-dag", "work-dag-projection", ["v040-t5-graphify"]],
    [7, "v040-t7-context", "graph-context-builder", ["v040-t6-work-dag"]],
    [8, "v040-t8-evaluation", "graph-eval-falsification", [
      "v040-t3-memory-index",
      "v040-t4-appliance",
      "v040-t7-context",
    ]],
    [9, "v040-t9-release", "v040-release-program", [
      "v040-t2-project-registry",
      "v040-t3-memory-index",
      "v040-t4-appliance",
      "v040-t5-graphify",
      "v040-t6-work-dag",
      "v040-t7-context",
      "v040-t8-evaluation",
    ]],
  ] as const;
  return {
    schema: "foreman.execution-family-source.v1",
    program: "v040",
    familyId: "v040-release-20260822-f1",
    children: rows.map(([tranche, childId, packageId, dependencyChildIds]) => ({
      schema: "foreman.execution-child-brief.v1",
      childId,
      tranche,
      packageId,
      objective: `Complete ${packageId}.`,
      acceptance: [`${packageId} passes its release checks.`],
      allowedPaths: [`packages/${packageId}/**`],
      dependencyChildIds,
    })),
  };
}

function writeCanonical(path: string, value: unknown): void {
  writeFileSync(path, `${canonicalize(value)}\n`);
}

describe("execution-guard CLI", () => {
  it("rejects incomplete and unknown argument vectors", () => {
    assert.equal(parseEndstopArgv([])._tag, "Invalid");
    assert.equal(parseEndstopArgv(["create", "--nope"])._tag, "Invalid");
    assert.equal(parseEndstopArgv(["status", "--state-root", "/x"])._tag, "Invalid");
  });

  it("parses fixed family and child status forms", () => {
    assert.deepEqual(
      parseEndstopArgv([
        "family-status",
        "--state-root",
        "/state",
        "--contract-id",
        "root-contract",
        "--contract-sha",
        A,
        "--family-sha",
        B,
      ]),
      {
        _tag: "FamilyStatus",
        stateRoot: "/state",
        contractId: "root-contract",
        contractSha256: A,
        familySha256: B,
      },
    );
    assert.deepEqual(
      parseEndstopArgv([
        "child-status",
        "--state-root",
        "/state",
        "--contract-id",
        "root-contract",
        "--contract-sha",
        A,
        "--family-sha",
        B,
        "--child-id",
        "v040-t2-project-registry",
      ])._tag,
      "ChildStatus",
    );
    assert.equal(
      parseEndstopArgv([
        "family-status",
        "--contract-id",
        "root-contract",
        "--state-root",
        "/state",
        "--contract-sha",
        A,
        "--family-sha",
        B,
      ])._tag,
      "Invalid",
    );
  });

  it("parses fixed family registration and activation forms", () => {
    assert.equal(
      parseEndstopArgv([
        "register-family-authority",
        "--state-root",
        "/state",
        "--contract-id",
        "root-contract",
        "--contract-sha",
        A,
        "--manifest",
        "/inputs/manifest.json",
        "--source",
        "/inputs/source.json",
        "--briefs",
        "/inputs/briefs",
        "--audit-receipt",
        "/inputs/audit.json",
        "--user-receipt",
        "/inputs/user.json",
      ])._tag,
      "RegisterFamilyAuthority",
    );
    assert.equal(
      parseEndstopArgv([
        "activate-family",
        "--state-root",
        "/state",
        "--contract-id",
        "root-contract",
        "--contract-sha",
        A,
        "--manifest",
        "/inputs/manifest.json",
      ])._tag,
      "ActivateFamily",
    );
  });

  it("creates and recovers one persistent Endstop contract", async () => {
    const root = mkdtempSync(join(tmpdir(), "endstop-cli-"));
    try {
      const file = join(root, "contract.json");
      writeFileSync(file, JSON.stringify(contract()) + "\n");
      let stdout = "";
      let stderr = "";
      const io = {
        writeStdout: (text: string) => { stdout += text; },
        writeStderr: (text: string) => { stderr += text; },
      };
      const createCode = await Effect.runPromise(
        runEndstopCli(["create", "--state-root", root, "--contract-file", file], io),
      );
      assert.equal(createCode, 0);
      assert.match(stdout, /"state":"Running"/);
      assert.equal(stderr, "");

      stdout = "";
      const statusCode = await Effect.runPromise(
        runEndstopCli(["status", "--state-root", root, "--contract-id", contract().contractId], io),
      );
      assert.equal(statusCode, 0);
      assert.match(stdout, /"state":"Running"/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("registers, publishes, activates, and reads a family", async () => {
    const root = mkdtempSync(join(tmpdir(), "endstop-family-cli-"));
    try {
      const inputs = join(root, "inputs");
      const briefs = join(inputs, "briefs");
      mkdirSync(briefs, { recursive: true });
      const value = contract();
      const rootContractSha256 = executionContractSha256(value);
      const source = familySource();
      const sourceBytes = new TextEncoder().encode(`${canonicalize(source)}\n`);
      const derived = deriveExecutionContractFamilyV2({
        rootContractId: value.contractId,
        rootContractSha256,
        track1Commit: "6".repeat(40),
        track1Tree: "7".repeat(40),
        sourceBytes,
        createdAt: "2026-08-24T12:00:00Z",
      });
      assert.equal(derived._tag, "Valid");
      if (derived._tag !== "Valid") return;
      const manifestFile = join(inputs, "manifest.json");
      const sourceFile = join(inputs, "source.json");
      const auditFile = join(inputs, "audit.json");
      const userFile = join(inputs, "user.json");
      writeCanonical(manifestFile, derived.manifest);
      writeFileSync(sourceFile, sourceBytes);
      for (const [packageId, brief] of Object.entries(derived.briefs)) {
        writeCanonical(join(briefs, `${packageId}.json`), brief);
      }
      writeCanonical(auditFile, {
        schema: "foreman.execution-family-audit.v1",
        program: "v040",
        familyId: derived.manifest.familyId,
        manifestSha256: derived.familySha256,
        track1Commit: derived.manifest.track1Commit,
        track1Tree: derived.manifest.track1Tree,
        verdict: "APPROVED",
        findings: [],
        evidenceSha256: A,
        issuedAt: "2026-08-24T12:00:00Z",
      });
      writeCanonical(userFile, {
        schema: "foreman.execution-family-user-approval.v1",
        program: "v040",
        familyId: derived.manifest.familyId,
        manifestSha256: derived.familySha256,
        track1Commit: derived.manifest.track1Commit,
        track1Tree: derived.manifest.track1Tree,
        approvalStatementSha256: B,
        issuedAt: "2026-08-24T12:00:00Z",
      });

      await Effect.runPromise(
        Effect.gen(function* () {
          const ledger = yield* EndstopLedger;
          return yield* ledger.create(value);
        }).pipe(
          Effect.provide(makeLiveEndstopLedgerLayer(root)),
        ),
      );
      let stdout = "";
      let stderr = "";
      const io = {
        writeStdout: (text: string) => { stdout += text; },
        writeStderr: (text: string) => { stderr += text; },
      };
      const registerCode = await Effect.runPromise(
        runEndstopCli(
          [
            "register-family-authority",
            "--state-root",
            root,
            "--contract-id",
            value.contractId,
            "--contract-sha",
            rootContractSha256,
            "--manifest",
            manifestFile,
            "--source",
            sourceFile,
            "--briefs",
            briefs,
            "--audit-receipt",
            auditFile,
            "--user-receipt",
            userFile,
          ],
          io,
          { now: () => "2026-08-24T12:01:00Z" },
        ),
      );
      assert.equal(registerCode, 0, stderr);
      assert.match(stdout, /"familySha256"/);
      assert.deepEqual(
        readdirSync(join(root, "release-families", derived.familySha256)).sort(),
        ["briefs", "manifest.json", "source.json"],
      );

      stdout = "";
      const activateCode = await Effect.runPromise(
        runEndstopCli(
          [
            "activate-family",
            "--state-root",
            root,
            "--contract-id",
            value.contractId,
            "--contract-sha",
            rootContractSha256,
            "--manifest",
            manifestFile,
          ],
          io,
          { now: () => "2026-08-24T12:02:00Z" },
        ),
      );
      assert.equal(activateCode, 0, stderr);
      assert.match(stdout, /"state":"Running"/);

      stdout = "";
      const statusCode = await Effect.runPromise(
        runEndstopCli(
          [
            "child-status",
            "--state-root",
            root,
            "--contract-id",
            value.contractId,
            "--contract-sha",
            rootContractSha256,
            "--family-sha",
            derived.familySha256,
            "--child-id",
            "v040-t2-project-registry",
          ],
          io,
        ),
      );
      assert.equal(statusCode, 0, stderr);
      assert.match(stdout, /"childId":"v040-t2-project-registry"/);
      assert.match(stdout, /"state":"Running"/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns a generic failure without paths for a missing contract", async () => {
    const root = mkdtempSync(join(tmpdir(), "endstop-cli-"));
    try {
      let stderr = "";
      const code = await Effect.runPromise(
        runEndstopCli(
          ["status", "--state-root", root, "--contract-id", "missing-contract"],
          { writeStdout: () => undefined, writeStderr: (text) => { stderr += text; } },
        ),
      );
      assert.equal(code, 1);
      assert.equal(stderr, "Foreman Endstop: missing_contract\n");
      assert.equal(stderr.includes(root), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
