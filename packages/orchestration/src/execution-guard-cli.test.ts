import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { Effect } from "effect";
import { strictEndstopLimits, type ExecutionContractV1 } from "./execution-contract.js";
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

describe("execution-guard CLI", () => {
  it("rejects incomplete and unknown argument vectors", () => {
    assert.equal(parseEndstopArgv([])._tag, "Invalid");
    assert.equal(parseEndstopArgv(["create", "--nope"])._tag, "Invalid");
    assert.equal(parseEndstopArgv(["status", "--state-root", "/x"])._tag, "Invalid");
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
