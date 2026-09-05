import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { canonicalize, sha256Hex } from "@foreman/core";
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
import {
  parseEndstopArgv,
  resolveProductChangeLive,
  runEndstopCli,
} from "./execution-guard-cli.js";
import { liveReleaseCoverageCliServices } from "./release-coverage-cli.js";

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

  it("parses all six fixed child lifecycle forms", () => {
    const common = [
      "--state-root", "/state",
      "--contract-id", "root-contract",
      "--contract-sha", A,
      "--family-sha", B,
      "--child-id", "v040-t2-project-registry",
    ];
    const cases = [
      [
        "ChildRecordProductChange",
        [
          "child-record-product-change", ...common,
          "--reservation-id", "reservation-1",
          "--repo", "/repo",
          "--candidate-commit", "1".repeat(40),
        ],
      ],
      [
        "ChildRecordMilestone",
        [
          "child-record-milestone", ...common,
          "--milestone", "checks",
          "--outcome", "/outcome.json",
        ],
      ],
      ["ChildRecordBlocking", ["child-record-blocking", ...common, "--outcome", "/outcome.json"]],
      [
        "ChildRecordExternalFailure",
        ["child-record-external-failure", ...common, "--outcome", "/outcome.json"],
      ],
      ["ChildCancel", ["child-cancel", ...common, "--approval", "/approval.json"]],
      ["ChildInvalidate", ["child-invalidate", ...common, "--approval", "/approval.json"]],
    ] as const;
    for (const [expected, argv] of cases) {
      assert.equal(parseEndstopArgv(argv)._tag, expected);
    }
  });

  it("resolves one live direct-parent product change inside allowed paths", async () => {
    const root = mkdtempSync(join(tmpdir(), "endstop-product-git-"));
    try {
      const repository = join(root, "repo");
      mkdirSync(join(repository, "packages", "project-registry"), {
        recursive: true,
      });
      const git = (args: readonly string[]): string => {
        const result = spawnSync("git", args, {
          cwd: repository,
          encoding: "utf8",
          env: {
            PATH: process.env.PATH,
            LANG: "C",
            LC_ALL: "C",
            GIT_CONFIG_NOSYSTEM: "1",
            GIT_CONFIG_GLOBAL: "/dev/null",
            GIT_AUTHOR_NAME: "Foreman Test",
            GIT_AUTHOR_EMAIL: "foreman@example.invalid",
            GIT_COMMITTER_NAME: "Foreman Test",
            GIT_COMMITTER_EMAIL: "foreman@example.invalid",
          },
          timeout: 30_000,
        });
        assert.equal(result.error, undefined);
        assert.equal(result.status, 0, result.stderr);
        return result.stdout.trim();
      };
      git(["init", "--object-format=sha1"]);
      git(["config", "core.hooksPath", "/dev/null"]);
      const file = join(repository, "packages", "project-registry", "value.txt");
      writeFileSync(file, "base\n");
      git(["add", "."]);
      git(["commit", "-m", "base"]);
      const baseCommit = git(["rev-parse", "HEAD"]);
      const baseTree = git(["rev-parse", "HEAD^{tree}"]);
      writeFileSync(file, "next\n");
      git(["add", "."]);
      git(["commit", "-m", "next"]);
      const candidateCommit = git(["rev-parse", "HEAD"]);
      const candidateTree = git(["rev-parse", "HEAD^{tree}"]);

      const resolved = await Effect.runPromise(
        resolveProductChangeLive({
          repository,
          baseCandidate: {
            commit: baseCommit,
            tree: baseTree,
            candidateSha256: sha256Hex(baseCommit),
          },
          candidateCommit,
          allowedPaths: ["packages/project-registry/**"],
        }),
      );
      assert.deepEqual(resolved, {
        commit: candidateCommit,
        tree: candidateTree,
        candidateSha256: sha256Hex(candidateCommit),
      });

      writeFileSync(join(repository, "README.md"), "outside\n");
      git(["add", "."]);
      git(["commit", "-m", "outside"]);
      const refused = await Effect.runPromise(
        resolveProductChangeLive({
          repository,
          baseCandidate: resolved,
          candidateCommit: git(["rev-parse", "HEAD"]),
          allowedPaths: ["packages/project-registry/**"],
        }).pipe(Effect.either),
      );
      assert.equal(refused._tag, "Left");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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
      const resolvedFamily = await Effect.runPromise(
        liveReleaseCoverageCliServices.familySource.resolve({
          stateRoot: root,
          contractId: value.contractId,
          contractSha256: rootContractSha256,
          familySha256: derived.familySha256,
        }),
      );
      assert.equal(resolvedFamily.source.children.length, 8);
      assert.equal(
        resolvedFamily.source.children[0]?.packageId,
        "project-registry",
      );

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

      const baseCommit = "2".repeat(40);
      const baseCandidate = {
        commit: baseCommit,
        tree: "3".repeat(40),
        candidateSha256: sha256Hex(baseCommit),
      };
      const outputCommit = "4".repeat(40);
      const outputCandidate = {
        commit: outputCommit,
        tree: "5".repeat(40),
        candidateSha256: sha256Hex(outputCommit),
      };
      const layer = makeLiveEndstopLedgerLayer(root);
      await Effect.runPromise(
        Effect.gen(function* () {
          const ledger = yield* EndstopLedger;
          yield* ledger.registerChildAuthority({
            rootContractId: value.contractId,
            rootContractSha256,
            familySha256: derived.familySha256,
            childId: "v040-t2-project-registry",
            action: "implement",
            effectiveAction: "implement",
            priorReservationId: null,
            originReservationId: null,
            candidate: baseCandidate,
            taskPlanSha256: A,
            bundleSha256: B,
            receiptSchemas: ["foreman.design-approval.v1"],
            receiptSha256s: [A],
            evaluationManifestSha256: null,
            registeredAt: "2026-08-24T12:03:00Z",
          });
          return yield* ledger.executeChild({
            rootContractId: value.contractId,
            rootContractSha256,
            familySha256: derived.familySha256,
            childId: "v040-t2-project-registry",
            operation: {
              _tag: "ReserveAction",
              reservationId: "implement-1",
              reservationAction: "implement",
              effectiveAction: "implement",
              originReservationId: "implement-1",
              candidate: baseCandidate,
              taskPlanSha256: A,
              authorityBundleSha256: B,
            },
            at: "2026-08-24T12:04:00Z",
          });
        }).pipe(Effect.provide(layer)),
      );

      stdout = "";
      const productCode = await Effect.runPromise(
        runEndstopCli(
          [
            "child-record-product-change",
            "--state-root", root,
            "--contract-id", value.contractId,
            "--contract-sha", rootContractSha256,
            "--family-sha", derived.familySha256,
            "--child-id", "v040-t2-project-registry",
            "--reservation-id", "implement-1",
            "--repo", root,
            "--candidate-commit", outputCommit,
          ],
          io,
          {
            now: () => "2026-08-24T12:05:00Z",
            resolveProductChange: (input) => {
              assert.deepEqual(input.baseCandidate, baseCandidate);
              assert.equal(input.candidateCommit, outputCommit);
              assert.deepEqual(input.allowedPaths, ["packages/project-registry/**"]);
              return Effect.succeed(outputCandidate);
            },
          },
        ),
      );
      assert.equal(productCode, 0, stderr);
      assert.match(stdout, new RegExp(outputCandidate.candidateSha256));

      const outcome = {
        schema: "foreman.release-action-outcome.v1",
        program: "v040",
        rootContractId: value.contractId,
        rootContractSha256,
        familySha256: derived.familySha256,
        childId: "v040-t2-project-registry",
        packageId: "project-registry",
        reservationAction: "verify",
        effectiveAction: "verify",
        reservationId: "verify-1",
        originReservationId: "verify-1",
        candidateSha256: outputCandidate.candidateSha256,
        status: "PASS",
        evidenceSha256: A,
        issuedAt: "2026-08-24T12:08:00Z",
      } as const;
      const outcomeFile = join(inputs, "outcome.json");
      const outcomeBytes = new TextEncoder().encode(`${canonicalize(outcome)}\n`);
      writeFileSync(outcomeFile, outcomeBytes);
      await Effect.runPromise(
        Effect.gen(function* () {
          const ledger = yield* EndstopLedger;
          yield* ledger.registerChildAuthority({
            rootContractId: value.contractId,
            rootContractSha256,
            familySha256: derived.familySha256,
            childId: "v040-t2-project-registry",
            action: "verify",
            effectiveAction: "verify",
            priorReservationId: null,
            originReservationId: null,
            candidate: outputCandidate,
            taskPlanSha256: A,
            bundleSha256: B,
            receiptSchemas: ["foreman.design-approval.v1"],
            receiptSha256s: [A],
            evaluationManifestSha256: null,
            registeredAt: "2026-08-24T12:06:00Z",
          });
          yield* ledger.executeChild({
            rootContractId: value.contractId,
            rootContractSha256,
            familySha256: derived.familySha256,
            childId: "v040-t2-project-registry",
            operation: {
              _tag: "ReserveAction",
              reservationId: "verify-1",
              reservationAction: "verify",
              effectiveAction: "verify",
              originReservationId: "verify-1",
              candidate: outputCandidate,
              taskPlanSha256: A,
              authorityBundleSha256: B,
            },
            at: "2026-08-24T12:07:00Z",
          });
          return yield* ledger.registerChildOutcome({
            rootContractId: value.contractId,
            rootContractSha256,
            familySha256: derived.familySha256,
            childId: "v040-t2-project-registry",
            reservationId: "verify-1",
            originReservationId: "verify-1",
            reservationAction: "verify",
            effectiveAction: "verify",
            candidateSha256: outputCandidate.candidateSha256,
            outcomeSha256: sha256Hex(outcomeBytes),
            outcomeSchema: "foreman.release-action-outcome.v1",
            registeredAt: "2026-08-24T12:09:00Z",
          });
        }).pipe(Effect.provide(layer)),
      );

      stdout = "";
      const milestoneCode = await Effect.runPromise(
        runEndstopCli(
          [
            "child-record-milestone",
            "--state-root", root,
            "--contract-id", value.contractId,
            "--contract-sha", rootContractSha256,
            "--family-sha", derived.familySha256,
            "--child-id", "v040-t2-project-registry",
            "--milestone", "checks",
            "--outcome", outcomeFile,
          ],
          io,
          { now: () => "2026-08-24T12:10:00Z" },
        ),
      );
      assert.equal(milestoneCode, 0, stderr);
      assert.match(stdout, new RegExp(sha256Hex(outcomeBytes)));

      const registerOutcomeCase = async (input: {
        childId: string;
        packageId: string;
        action: "implement" | "verify";
        status: "BLOCKING" | "EXTERNAL_FAILURE";
        reservationId: string;
        file: string;
      }): Promise<void> => {
        const value = {
          schema: "foreman.release-action-outcome.v1",
          program: "v040",
          rootContractId: contract().contractId,
          rootContractSha256,
          familySha256: derived.familySha256,
          childId: input.childId,
          packageId: input.packageId,
          reservationAction: input.action,
          effectiveAction: input.action,
          reservationId: input.reservationId,
          originReservationId: input.reservationId,
          candidateSha256: baseCandidate.candidateSha256,
          status: input.status,
          evidenceSha256: A,
          issuedAt: "2026-08-24T12:13:00Z",
        } as const;
        const bytes = new TextEncoder().encode(`${canonicalize(value)}\n`);
        writeFileSync(input.file, bytes);
        await Effect.runPromise(
          Effect.gen(function* () {
            const ledger = yield* EndstopLedger;
            yield* ledger.registerChildAuthority({
              rootContractId: contract().contractId,
              rootContractSha256,
              familySha256: derived.familySha256,
              childId: input.childId,
              action: input.action,
              effectiveAction: input.action,
              priorReservationId: null,
              originReservationId: null,
              candidate: baseCandidate,
              taskPlanSha256: A,
              bundleSha256: B,
              receiptSchemas: ["foreman.design-approval.v1"],
              receiptSha256s: [A],
              evaluationManifestSha256: null,
              registeredAt: "2026-08-24T12:11:00Z",
            });
            yield* ledger.executeChild({
              rootContractId: contract().contractId,
              rootContractSha256,
              familySha256: derived.familySha256,
              childId: input.childId,
              operation: {
                _tag: "ReserveAction",
                reservationId: input.reservationId,
                reservationAction: input.action,
                effectiveAction: input.action,
                originReservationId: input.reservationId,
                candidate: baseCandidate,
                taskPlanSha256: A,
                authorityBundleSha256: B,
              },
              at: "2026-08-24T12:12:00Z",
            });
            return yield* ledger.registerChildOutcome({
              rootContractId: contract().contractId,
              rootContractSha256,
              familySha256: derived.familySha256,
              childId: input.childId,
              reservationId: input.reservationId,
              originReservationId: input.reservationId,
              reservationAction: input.action,
              effectiveAction: input.action,
              candidateSha256: baseCandidate.candidateSha256,
              outcomeSha256: sha256Hex(bytes),
              outcomeSchema: "foreman.release-action-outcome.v1",
              registeredAt: "2026-08-24T12:14:00Z",
            });
          }).pipe(Effect.provide(layer)),
        );
      };

      for (const item of [
        {
          command: "child-record-blocking",
          childId: "v040-t4-appliance",
          packageId: "hermetic-foreman-appliance",
          action: "verify",
          status: "BLOCKING",
          reservationId: "blocking-1",
        },
        {
          command: "child-record-external-failure",
          childId: "v040-t5-graphify",
          packageId: "knowledge-plane-refresh",
          action: "implement",
          status: "EXTERNAL_FAILURE",
          reservationId: "external-1",
        },
      ] as const) {
        const file = join(inputs, `${item.reservationId}.json`);
        await registerOutcomeCase({ ...item, file });
        stdout = "";
        const code: number = await Effect.runPromise(
          runEndstopCli(
            [
              item.command,
              "--state-root", root,
              "--contract-id", contract().contractId,
              "--contract-sha", rootContractSha256,
              "--family-sha", derived.familySha256,
              "--child-id", item.childId,
              "--outcome", file,
            ],
            io,
            { now: () => "2026-08-24T12:15:00Z" },
          ),
        );
        assert.equal(code, 0, stderr);
        assert.match(stdout, new RegExp(item.childId));
      }

      for (const item of [
        {
          command: "child-invalidate",
          schema: "foreman.execution-child-invalidate.v1",
          childId: "v040-t7-context",
          expectedState: "Running",
          observedFamilySha256: derived.familySha256,
        },
        {
          command: "child-cancel",
          schema: "foreman.execution-child-cancel.v1",
          childId: "v040-t6-work-dag",
          expectedState: "Cancelled",
          observedFamilySha256: undefined,
        },
      ] as const) {
        const approval = {
          schema: item.schema,
          program: "v040",
          rootContractId: contract().contractId,
          rootContractSha256,
          familySha256: derived.familySha256,
          childId: item.childId,
          ...(item.observedFamilySha256 === undefined
            ? {}
            : { observedFamilySha256: item.observedFamilySha256 }),
          reasonSha256: B,
          issuedAt: "2026-08-24T12:16:00Z",
        };
        const file = join(inputs, `${item.childId}-approval.json`);
        writeCanonical(file, approval);
        stdout = "";
        const code: number = await Effect.runPromise(
          runEndstopCli(
            [
              item.command,
              "--state-root", root,
              "--contract-id", contract().contractId,
              "--contract-sha", rootContractSha256,
              "--family-sha", derived.familySha256,
              "--child-id", item.childId,
              "--approval", file,
            ],
            io,
            { now: () => "2026-08-24T12:17:00Z" },
          ),
        );
        assert.equal(code, 0, stderr);
        assert.match(stdout, new RegExp(`"state":"${item.expectedState}"`));
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses v041 family receipts with invalid_family_authority", async () => {
    const root = mkdtempSync(join(tmpdir(), "endstop-v041-family-"));
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
        program: "v041",
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
        program: "v041",
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
        }).pipe(Effect.provide(makeLiveEndstopLedgerLayer(root))),
      );
      let stderr = "";
      const code = await Effect.runPromise(
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
          {
            writeStdout: () => undefined,
            writeStderr: (text) => {
              stderr += text;
            },
          },
          { now: () => "2026-08-24T12:01:00Z" },
        ),
      );
      assert.equal(code, 1);
      assert.match(stderr, /invalid_family_authority/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("registers a v050 family and refuses a cross-program receipt", async () => {
    const root = mkdtempSync(join(tmpdir(), "endstop-v050-family-"));
    try {
      const inputs = join(root, "inputs");
      const briefs = join(inputs, "briefs");
      mkdirSync(briefs, { recursive: true });
      const value = contract();
      const rootContractSha256 = executionContractSha256(value);
      const source = { ...familySource(), program: "v050" as const };
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
      assert.equal(derived.manifest.program, "v050");
      const manifestFile = join(inputs, "manifest.json");
      const sourceFile = join(inputs, "source.json");
      const auditFile = join(inputs, "audit.json");
      const userFile = join(inputs, "user.json");
      writeCanonical(manifestFile, derived.manifest);
      writeFileSync(sourceFile, sourceBytes);
      for (const [packageId, brief] of Object.entries(derived.briefs)) {
        writeCanonical(join(briefs, `${packageId}.json`), brief);
      }
      const receiptBase = {
        familyId: derived.manifest.familyId,
        manifestSha256: derived.familySha256,
        track1Commit: derived.manifest.track1Commit,
        track1Tree: derived.manifest.track1Tree,
        issuedAt: "2026-08-24T12:00:00Z",
      } as const;
      writeCanonical(auditFile, {
        schema: "foreman.execution-family-audit.v1",
        program: "v050",
        ...receiptBase,
        verdict: "APPROVED",
        findings: [],
        evidenceSha256: A,
      });
      writeCanonical(userFile, {
        schema: "foreman.execution-family-user-approval.v1",
        program: "v050",
        ...receiptBase,
        approvalStatementSha256: B,
      });

      await Effect.runPromise(
        Effect.gen(function* () {
          const ledger = yield* EndstopLedger;
          return yield* ledger.create(value);
        }).pipe(Effect.provide(makeLiveEndstopLedgerLayer(root))),
      );
      let stdout = "";
      let stderr = "";
      const io = {
        writeStdout: (text: string) => {
          stdout += text;
        },
        writeStderr: (text: string) => {
          stderr += text;
        },
      };
      const argv = [
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
      ];
      const registerCode = await Effect.runPromise(
        runEndstopCli(argv, io, { now: () => "2026-08-24T12:01:00Z" }),
      );
      assert.equal(registerCode, 0, stderr);
      assert.match(stdout, /"familySha256"/);

      writeCanonical(auditFile, {
        schema: "foreman.execution-family-audit.v1",
        program: "v040",
        ...receiptBase,
        verdict: "APPROVED",
        findings: [],
        evidenceSha256: A,
      });
      stdout = "";
      stderr = "";
      const crossCode = await Effect.runPromise(
        runEndstopCli(argv, io, { now: () => "2026-08-24T12:01:00Z" }),
      );
      assert.equal(crossCode, 1);
      assert.match(stderr, /invalid_family_authority/);
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
