import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { canonicalize, sha256Hex } from "@foreman/core";
import type { RegisteredReleaseAuthorityV1 } from "@foreman/policy";
import { Effect } from "effect";
import {
  parseReleaseAuthorityArgv,
  runReleaseAuthorityCli,
  type ReleaseAuthorityCliServices,
} from "./release-authority-cli.js";

const A = "a".repeat(64);
const B = "b".repeat(64);
const CANDIDATE = {
  commit: "1".repeat(40),
  tree: "2".repeat(40),
  candidateSha256: sha256Hex("1".repeat(40)),
};

describe("release-authority digest registration CLI", () => {
  it("parses only the fixed register vector", () => {
    assert.equal(
      parseReleaseAuthorityArgv([
        "register",
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
        "--action",
        "implement",
        "--evidence",
        "/evidence.json",
      ])._tag,
      "Register",
    );
    assert.equal(
      parseReleaseAuthorityArgv(["register", "--state-root", "/state"])._tag,
      "Invalid",
    );
    for (const [command, flag, childId, expected] of [
      ["register-outcome", "--outcome", "v040-t2-project-registry", "RegisterOutcome"],
      [
        "register-evaluation-verdict",
        "--verdict",
        "v040-t8-evaluation",
        "RegisterEvaluationVerdict",
      ],
    ] as const) {
      assert.equal(
        parseReleaseAuthorityArgv([
          command,
          "--state-root",
          "/state",
          "--contract-id",
          "root-contract",
          "--contract-sha",
          A,
          "--family-sha",
          B,
          "--child-id",
          childId,
          flag,
          "/authority.json",
        ])._tag,
        expected,
      );
    }
  });

  it("registers one canonical evidence digest without signing", async () => {
    const root = mkdtempSync(join(tmpdir(), "release-authority-cli-"));
    try {
      const design = {
        schema: "foreman.design-approval.v1",
        program: "v040",
        packageId: "project-registry",
        designCommit: CANDIDATE.commit,
        designTree: CANDIDATE.tree,
        approvedOpenSpecSha256: A,
        taskPlanSha256: B,
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
        action: "implement",
        candidate: CANDIDATE,
        taskPlanSha256: B,
        receipts: [design],
        issuedAt: "2026-08-24T12:00:01Z",
      } as const;
      const evidence = join(root, "evidence.json");
      writeFileSync(evidence, `${canonicalize(bundle)}\n`);
      const registrations: RegisteredReleaseAuthorityV1[] = [];
      const services: ReleaseAuthorityCliServices = {
        now: () => "2026-08-24T12:00:02Z",
        registerChildAuthority: (_stateRoot, registration) => {
          registrations.push(registration);
          return Effect.succeed(registration);
        },
        registerChildOutcome: () => Effect.die("unexpected outcome"),
        registerEvaluationVerdict: () => Effect.die("unexpected verdict"),
      };
      let stdout = "";
      let stderr = "";
      const code = await Effect.runPromise(
        runReleaseAuthorityCli(
          [
            "register",
            "--state-root",
            root,
            "--contract-id",
            bundle.rootContractId,
            "--contract-sha",
            bundle.rootContractSha256,
            "--family-sha",
            bundle.familySha256,
            "--child-id",
            bundle.childId,
            "--action",
            bundle.action,
            "--evidence",
            evidence,
          ],
          {
            writeStdout: (text) => { stdout += text; },
            writeStderr: (text) => { stderr += text; },
          },
          services,
        ),
      );
      assert.equal(code, 0, stderr);
      assert.equal(registrations.length, 1);
      assert.equal(registrations[0]?.bundleSha256, sha256Hex(`${canonicalize(bundle)}\n`));
      assert.deepEqual(registrations[0]?.receiptSchemas, [design.schema]);
      assert.match(stdout, /"bundleSha256"/);
      assert.equal(stderr, "");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
