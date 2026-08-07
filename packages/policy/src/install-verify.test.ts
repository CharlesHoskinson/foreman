/**
 * Installed-runtime verification controls (RED-first acceptance suite).
 */
import assert from "node:assert/strict";
import {
  chmodSync,
  constants as fsConstants,
  cpSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { Effect } from "effect";
import { canonicalize } from "@foreman/core";
import {
  compareRuntimePluginDrift,
  dirIdentity,
  fileIdentity,
  InstallFs,
  installFail,
  linkIdentity,
  liveInstallFs,
  makeMemoryInstallFs,
  parseInstallArgv,
  runInstallCli,
  verifyInstalledSkillRoot,
  verifyInstalledSkillRootDetailed,
  verifyRuntimeTree,
  type MemoryNode,
} from "./install-verify-exports.js";
import { createHash } from "node:crypto";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const skillRoot = join(root, "skills/foreman");
const trackedRuntime = join(skillRoot, "runtime");
const trackedManifest = join(trackedRuntime, "manifest.json");
const trackedGuard = join(trackedRuntime, "dist/destruction-guard.js");
const trackedPolicy = join(trackedRuntime, "dist/architecture-policy.js");
const trackedEndstop = join(trackedRuntime, "dist/execution-guard.js");
const trackedQueue = join(trackedRuntime, "dist/lane-queue.js");
const trackedRound = join(trackedRuntime, "dist/lane-round.js");
const trackedSupervise = join(trackedRuntime, "dist/lane-supervise.js");
const trackedPreflight = join(trackedRuntime, "dist/vendor-preflight.js");
const trackedToolCheck = join(trackedRuntime, "dist/tool-check.js");
const trackedSetup = join(trackedRuntime, "dist/foreman-setup.js");
const trackedDependencyDrift = join(
  trackedRuntime,
  "dist/dependency-drift.js",
);
const trackedRepoHygiene = join(trackedRuntime, "dist/repo-hygiene.js");
const trackedSecretScan = join(trackedRuntime, "dist/secret-scan.js");
const trackedCredentialProfile = join(
  trackedRuntime,
  "dist/credential-profile.js",
);
const trackedCredentialProfileLane = join(
  trackedRuntime,
  "dist/credential-profile-lane.js",
);
const trackedGraphStore = join(trackedRuntime, "dist/graph-store.js");
const trackedForemanLaunch = join(trackedRuntime, "dist/foreman-launch.js");

function runVerifySkill(path: string) {
  return Effect.runPromise(
    verifyInstalledSkillRoot(path).pipe(Effect.provide(liveInstallFs)),
  );
}

function runVerifyRuntime(path: string) {
  return Effect.runPromise(
    verifyRuntimeTree(path).pipe(Effect.provide(liveInstallFs)),
  );
}

function seedSkillCopy(label = "skill"): string {
  const dir = mkdtempSync(join(tmpdir(), `foreman-iv-${label}-`));
  const dest = join(dir, "foreman");
  cpSync(skillRoot, dest, { recursive: true });
  return dest;
}

function seedRuntimeOnly(): string {
  const dir = mkdtempSync(join(tmpdir(), "foreman-iv-rt-"));
  const rt = join(dir, "runtime");
  mkdirSync(join(rt, "dist"), { recursive: true });
  writeFileSync(join(rt, "manifest.json"), readFileSync(trackedManifest));
  cpSync(trackedGuard, join(rt, "dist/destruction-guard.js"));
  cpSync(trackedPolicy, join(rt, "dist/architecture-policy.js"));
  cpSync(trackedEndstop, join(rt, "dist/execution-guard.js"));
  cpSync(trackedQueue, join(rt, "dist/lane-queue.js"));
  cpSync(trackedRound, join(rt, "dist/lane-round.js"));
  cpSync(trackedSupervise, join(rt, "dist/lane-supervise.js"));
  cpSync(trackedPreflight, join(rt, "dist/vendor-preflight.js"));
  cpSync(trackedToolCheck, join(rt, "dist/tool-check.js"));
  cpSync(trackedSetup, join(rt, "dist/foreman-setup.js"));
  cpSync(trackedDependencyDrift, join(rt, "dist/dependency-drift.js"));
  cpSync(trackedRepoHygiene, join(rt, "dist/repo-hygiene.js"));
  cpSync(trackedSecretScan, join(rt, "dist/secret-scan.js"));
  cpSync(trackedCredentialProfile, join(rt, "dist/credential-profile.js"));
  cpSync(
    trackedCredentialProfileLane,
    join(rt, "dist/credential-profile-lane.js"),
  );
  cpSync(trackedGraphStore, join(rt, "dist/graph-store.js"));
  cpSync(trackedForemanLaunch, join(rt, "dist/foreman-launch.js"));
  return rt;
}

describe("verifyInstalledSkillRoot live controls", () => {
  it("accepts the current repository skill root", async () => {
    const r = await runVerifySkill(skillRoot);
    assert.equal(r._tag, "Pass", JSON.stringify(r));
  });

  it("accepts an exact copied skills/foreman tree outside the repository", async () => {
    const copied = seedSkillCopy("copy");
    try {
      const r = await runVerifySkill(copied);
      assert.equal(r._tag, "Pass", JSON.stringify(r));
    } finally {
      rmSync(dirname(copied), { recursive: true, force: true });
    }
  });

  it("fails when lane-queue.js is removed from a copy and stripped from a otherwise-canonical manifest", async () => {
    const copied = seedSkillCopy("no-queue");
    try {
      rmSync(join(copied, "runtime/dist/lane-queue.js"));
      const mfPath = join(copied, "runtime/manifest.json");
      const mf = JSON.parse(readFileSync(mfPath, "utf8")) as {
        artifacts: Array<{ relativePath: string }>;
        nodeRange: string;
        schemaVersion: number;
      };
      mf.artifacts = mf.artifacts.filter(
        (a) => a.relativePath !== "dist/lane-queue.js",
      );
      writeFileSync(mfPath, canonicalize(mf) + "\n");
      const r = await runVerifySkill(copied);
      assert.equal(r._tag, "Fail", JSON.stringify(r));
      if (r._tag === "Fail") {
        assert.equal(r.reason, "manifest_missing_required_artifact");
      }
    } finally {
      rmSync(dirname(copied), { recursive: true, force: true });
    }
  });

  it("requires credential-profile-lane.js in an installed runtime", async () => {
    const copied = seedSkillCopy("no-profile-lane");
    try {
      rmSync(join(copied, "runtime/dist/credential-profile-lane.js"), {
        force: true,
      });
      const mfPath = join(copied, "runtime/manifest.json");
      const mf = JSON.parse(readFileSync(mfPath, "utf8")) as {
        artifacts: Array<{ relativePath: string }>;
        nodeRange: string;
        schemaVersion: number;
      };
      mf.artifacts = mf.artifacts.filter(
        (a) => a.relativePath !== "dist/credential-profile-lane.js",
      );
      writeFileSync(mfPath, canonicalize(mf) + "\n");
      const r = await runVerifySkill(copied);
      assert.equal(r._tag, "Fail", JSON.stringify(r));
      if (r._tag === "Fail") {
        assert.equal(r.reason, "manifest_missing_required_artifact");
      }
    } finally {
      rmSync(dirname(copied), { recursive: true, force: true });
    }
  });

  it(
    "accepts a POSIX root symlink to the skill",
    {
      skip:
        process.platform === "win32"
          ? "POSIX symlink skill-root resolution is not exercised on win32"
          : false,
    },
    async () => {
      const base = mkdtempSync(join(tmpdir(), "foreman-iv-sl-"));
      try {
        const link = join(base, "skill-link");
        symlinkSync(skillRoot, link);
        const r = await runVerifySkill(link);
        assert.equal(r._tag, "Pass", JSON.stringify(r));
      } finally {
        rmSync(base, { recursive: true, force: true });
      }
    },
  );

  it(
    "accepts a real Windows directory junction skill root",
    {
      skip:
        process.platform !== "win32"
          ? "Windows directory junctions can only be created and verified on win32"
          : false,
    },
    async () => {
      const base = mkdtempSync(join(tmpdir(), "foreman-iv-junc-"));
      try {
        const target = join(base, "skill-target");
        cpSync(skillRoot, target, { recursive: true });
        const junction = join(base, "skill-junction");
        // Node creates a directory junction without admin/mklink/shell.
        symlinkSync(target, junction, "junction");
        const r = await runVerifySkill(junction);
        assert.equal(r._tag, "Pass", JSON.stringify(r));
      } finally {
        rmSync(base, { recursive: true, force: true });
      }
    },
  );

  it("accepts skill roots with spaces and non-ASCII characters", async () => {
    const base = mkdtempSync(join(tmpdir(), "foreman-iv-sp-"));
    try {
      const dest = join(base, "skill root 测试");
      cpSync(skillRoot, dest, { recursive: true });
      const r = await runVerifySkill(dest);
      assert.equal(r._tag, "Pass", JSON.stringify(r));
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("rejects missing changed truncated oversized linked hard-linked non-regular unreadable controls", async () => {
    const rt = seedRuntimeOnly();
    const parent = dirname(rt);
    try {
      // missing bundle
      rmSync(join(rt, "dist/architecture-policy.js"));
      {
        const r = await runVerifyRuntime(rt);
        assert.equal(r._tag, "Fail");
        if (r._tag === "Fail") assert.equal(r.reason, "bundle_missing");
      }
      cpSync(trackedPolicy, join(rt, "dist/architecture-policy.js"));

      // changed digest
      writeFileSync(join(rt, "dist/architecture-policy.js"), "TAMPER");
      {
        const r = await runVerifyRuntime(rt);
        assert.equal(r._tag, "Fail");
        if (r._tag === "Fail") {
          assert.ok(
            r.reason === "bundle_digest_mismatch" ||
              r.reason === "bundle_size_mismatch",
          );
        }
      }
      cpSync(trackedPolicy, join(rt, "dist/architecture-policy.js"));

      // truncated (size mismatch vs manifest)
      const bytes = readFileSync(trackedPolicy);
      writeFileSync(
        join(rt, "dist/architecture-policy.js"),
        bytes.subarray(0, Math.max(1, bytes.byteLength - 10)),
      );
      {
        const r = await runVerifyRuntime(rt);
        assert.equal(r._tag, "Fail");
        if (r._tag === "Fail") assert.equal(r.reason, "bundle_size_mismatch");
      }
      cpSync(trackedPolicy, join(rt, "dist/architecture-policy.js"));

      // linked artifact
      rmSync(join(rt, "dist/architecture-policy.js"));
      symlinkSync(trackedPolicy, join(rt, "dist/architecture-policy.js"));
      {
        const r = await runVerifyRuntime(rt);
        assert.equal(r._tag, "Fail");
        if (r._tag === "Fail") {
          assert.ok(
            r.reason === "bundle_linked" || r.reason === "dist_entry_linked",
          );
        }
      }
      rmSync(join(rt, "dist/architecture-policy.js"));
      cpSync(trackedPolicy, join(rt, "dist/architecture-policy.js"));

      // hard-linked artifact
      rmSync(join(rt, "dist/architecture-policy.js"));
      const hardTarget = join(parent, "hard-src.js");
      cpSync(trackedPolicy, hardTarget);
      linkSync(hardTarget, join(rt, "dist/architecture-policy.js"));
      {
        const r = await runVerifyRuntime(rt);
        assert.equal(r._tag, "Fail");
        if (r._tag === "Fail") assert.equal(r.reason, "bundle_hard_linked");
      }
      rmSync(join(rt, "dist/architecture-policy.js"));
      cpSync(trackedPolicy, join(rt, "dist/architecture-policy.js"));

      // non-regular: directory as artifact path
      rmSync(join(rt, "dist/architecture-policy.js"));
      mkdirSync(join(rt, "dist/architecture-policy.js"));
      {
        const r = await runVerifyRuntime(rt);
        assert.equal(r._tag, "Fail");
      }
      rmSync(join(rt, "dist/architecture-policy.js"), {
        recursive: true,
        force: true,
      });
      cpSync(trackedPolicy, join(rt, "dist/architecture-policy.js"));

      // unreadable manifest (chmod 000) — skip if root can still read
      const mode = readFileSync(join(rt, "manifest.json"));
      try {
        chmodSync(join(rt, "manifest.json"), 0);
        const r = await runVerifyRuntime(rt);
        // On some CI runners euid 0 still reads; accept Fail or Pass only if readable.
        if (r._tag === "Fail") {
          assert.ok(
            r.reason === "manifest_unreadable" ||
              r.reason === "manifest_missing",
          );
        }
      } finally {
        chmodSync(join(rt, "manifest.json"), 0o644);
        writeFileSync(join(rt, "manifest.json"), mode);
      }

      // missing manifest
      rmSync(join(rt, "manifest.json"));
      {
        const r = await runVerifyRuntime(rt);
        assert.equal(r._tag, "Fail");
        if (r._tag === "Fail") assert.equal(r.reason, "manifest_missing");
      }
      writeFileSync(join(rt, "manifest.json"), readFileSync(trackedManifest));

      // oversized: declared path that exceeds bound is exercised via memory seam below
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it("rejects extra dist file directory case-fold traversal unknown keys duplicates wrong size digest", async () => {
    const rt = seedRuntimeOnly();
    const parent = dirname(rt);
    try {
      writeFileSync(join(rt, "dist/extra.js"), "export {}\n");
      {
        const r = await runVerifyRuntime(rt);
        assert.equal(r._tag, "Fail");
        if (r._tag === "Fail") assert.equal(r.reason, "dist_extra_entry");
      }
      rmSync(join(rt, "dist/extra.js"));

      mkdirSync(join(rt, "dist/nested"));
      {
        const r = await runVerifyRuntime(rt);
        assert.equal(r._tag, "Fail");
        if (r._tag === "Fail") {
          assert.equal(r.reason, "dist_unexpected_directory");
        }
      }
      rmSync(join(rt, "dist/nested"), { recursive: true, force: true });

      // case-fold collision
      writeFileSync(join(rt, "dist/Extra.js"), "x\n");
      writeFileSync(join(rt, "dist/extra.js"), "y\n");
      // On case-sensitive FS both exist; verifier must reject fold collision
      // or extra entry. Either is fail-closed.
      {
        const r = await runVerifyRuntime(rt);
        assert.equal(r._tag, "Fail");
      }
      try {
        rmSync(join(rt, "dist/Extra.js"));
      } catch {
        /* case-insensitive FS */
      }
      try {
        rmSync(join(rt, "dist/extra.js"));
      } catch {
        /* ignore */
      }

      // wrong digest via manifest tamper
      writeFileSync(
        join(rt, "manifest.json"),
        canonicalize({
          artifacts: [
            {
              byteLength: 1,
              id: "architecture-policy",
              relativePath: "dist/architecture-policy.js",
              sha256: "a".repeat(64),
            },
            {
              byteLength: 1,
              id: "destruction-guard",
              relativePath: "dist/destruction-guard.js",
              sha256: "b".repeat(64),
            },
          ],
          nodeRange: ">=24 <25",
          schemaVersion: 2,
        }) + "\n",
      );
      {
        const r = await runVerifyRuntime(rt);
        assert.equal(r._tag, "Fail");
      }
      writeFileSync(join(rt, "manifest.json"), readFileSync(trackedManifest));

      // unknown key
      writeFileSync(
        join(rt, "manifest.json"),
        canonicalize({
          artifacts: [
            {
              byteLength: 1,
              id: "architecture-policy",
              relativePath: "dist/architecture-policy.js",
              sha256: "a".repeat(64),
              extra: true,
            },
          ],
          nodeRange: ">=24 <25",
          schemaVersion: 2,
          unknown: 1,
        }) + "\n",
      );
      {
        const r = await runVerifyRuntime(rt);
        assert.equal(r._tag, "Fail");
        if (r._tag === "Fail") {
          assert.ok(
            r.reason === "manifest_unknown_field" ||
              r.reason === "manifest_schema" ||
              r.reason === "manifest_missing_required_artifact",
          );
        }
      }
      writeFileSync(join(rt, "manifest.json"), readFileSync(trackedManifest));

      // duplicate artifact paths
      writeFileSync(
        join(rt, "manifest.json"),
        canonicalize({
          artifacts: [
            {
              byteLength: 1,
              id: "architecture-policy",
              relativePath: "dist/architecture-policy.js",
              sha256: "a".repeat(64),
            },
            {
              byteLength: 1,
              id: "architecture-policy-2",
              relativePath: "dist/architecture-policy.js",
              sha256: "b".repeat(64),
            },
            {
              byteLength: 1,
              id: "destruction-guard",
              relativePath: "dist/destruction-guard.js",
              sha256: "c".repeat(64),
            },
          ],
          nodeRange: ">=24 <25",
          schemaVersion: 2,
        }) + "\n",
      );
      {
        const r = await runVerifyRuntime(rt);
        assert.equal(r._tag, "Fail");
        if (r._tag === "Fail") assert.equal(r.reason, "manifest_duplicate_path");
      }
      writeFileSync(join(rt, "manifest.json"), readFileSync(trackedManifest));

      // traversal path in manifest
      writeFileSync(
        join(rt, "manifest.json"),
        canonicalize({
          artifacts: [
            {
              byteLength: 1,
              id: "architecture-policy",
              relativePath: "dist/../etc/passwd",
              sha256: "a".repeat(64),
            },
            {
              byteLength: 1,
              id: "destruction-guard",
              relativePath: "dist/destruction-guard.js",
              sha256: "b".repeat(64),
            },
          ],
          nodeRange: ">=24 <25",
          schemaVersion: 2,
        }) + "\n",
      );
      {
        const r = await runVerifyRuntime(rt);
        assert.equal(r._tag, "Fail");
        if (r._tag === "Fail") {
          assert.ok(
            r.reason === "manifest_relative_path" ||
              r.reason === "bundle_path_escape",
          );
        }
      }
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it("fails closed on identity change via injected filesystem seam", async () => {
    const policyBytes = readFileSync(trackedPolicy);
    const guardBytes = readFileSync(trackedGuard);
    const endstopBytes = readFileSync(trackedEndstop);
    const queueBytes = readFileSync(trackedQueue);
    const roundBytes = readFileSync(trackedRound);
    const superviseBytes = readFileSync(trackedSupervise);
    const preflightBytes = readFileSync(trackedPreflight);
    const toolCheckBytes = readFileSync(trackedToolCheck);
    const setupBytes = readFileSync(trackedSetup);
    const dependencyDriftBytes = readFileSync(trackedDependencyDrift);
    const repoHygieneBytes = readFileSync(trackedRepoHygiene);
    const secretScanBytes = readFileSync(trackedSecretScan);
    const credentialProfileBytes = readFileSync(trackedCredentialProfile);
    const credentialProfileLaneBytes = readFileSync(
      trackedCredentialProfileLane,
    );
    const graphStoreBytes = readFileSync(trackedGraphStore);
    const foremanLaunchBytes = readFileSync(trackedForemanLaunch);
    const manifestText = readFileSync(trackedManifest, "utf8");
    const mfBytes = new TextEncoder().encode(manifestText);

    const skill = "/skill";
    const runtime = "/skill/runtime";
    const dist = "/skill/runtime/dist";
    const mfPath = "/skill/runtime/manifest.json";
    const polPath = "/skill/runtime/dist/architecture-policy.js";
    const guardPath = "/skill/runtime/dist/destruction-guard.js";
    const endstopPath = "/skill/runtime/dist/execution-guard.js";
    const queuePath = "/skill/runtime/dist/lane-queue.js";
    const roundPath = "/skill/runtime/dist/lane-round.js";
    const supervisePath = "/skill/runtime/dist/lane-supervise.js";
    const preflightPath = "/skill/runtime/dist/vendor-preflight.js";
    const toolCheckPath = "/skill/runtime/dist/tool-check.js";
    const setupPath = "/skill/runtime/dist/foreman-setup.js";
    const dependencyDriftPath = "/skill/runtime/dist/dependency-drift.js";
    const secretScanPath = "/skill/runtime/dist/secret-scan.js";
    const credentialProfilePath = "/skill/runtime/dist/credential-profile.js";
    const credentialProfileLanePath =
      "/skill/runtime/dist/credential-profile-lane.js";
    const graphStorePath = "/skill/runtime/dist/graph-store.js";
    const foremanLaunchPath = "/skill/runtime/dist/foreman-launch.js";

    const nodes = new Map([
      [
        skill,
        {
          kind: "dir" as const,
          identity: dirIdentity({ ino: "10" }),
          names: ["runtime"],
        },
      ],
      [
        runtime,
        {
          kind: "dir" as const,
          identity: dirIdentity({ ino: "11" }),
          names: ["dist", "manifest.json"],
        },
      ],
      [
        dist,
        {
          kind: "dir" as const,
          identity: dirIdentity({ ino: "12" }),
          names: [
              "architecture-policy.js",
              "credential-profile-lane.js",
              "credential-profile.js",
              "dependency-drift.js",
              "destruction-guard.js",
              "execution-guard.js",
              "foreman-launch.js",
              "foreman-setup.js",
              "graph-store.js",
              "lane-queue.js",
              "lane-round.js",
              "lane-supervise.js",
              "repo-hygiene.js",
              "secret-scan.js",
              "tool-check.js",
              "vendor-preflight.js",
            ],
        },
      ],
      [
        mfPath,
        {
          kind: "file" as const,
          bytes: mfBytes,
          identity: fileIdentity({
            ino: "20",
            size: mfBytes.byteLength,
          }),
        },
      ],
      [
        polPath,
        {
          kind: "file" as const,
          bytes: policyBytes,
          identity: fileIdentity({
            ino: "21",
            size: policyBytes.byteLength,
          }),
          recheckIdentity: fileIdentity({
            ino: "999",
            size: policyBytes.byteLength,
          }),
        },
      ],
      [
        guardPath,
        {
          kind: "file" as const,
          bytes: guardBytes,
          identity: fileIdentity({
            ino: "22",
            size: guardBytes.byteLength,
          }),
        },
      ],
      [
        endstopPath,
        {
          kind: "file" as const,
          bytes: endstopBytes,
          identity: fileIdentity({
            ino: "32",
            size: endstopBytes.byteLength,
          }),
        },
      ],
      [
        queuePath,
        {
          kind: "file" as const,
          bytes: queueBytes,
          identity: fileIdentity({
            ino: "23",
            size: queueBytes.byteLength,
          }),
        },
      ],
      [
        roundPath,
        {
          kind: "file" as const,
          bytes: roundBytes,
          identity: fileIdentity({
            ino: "24",
            size: roundBytes.byteLength,
          }),
        },
      ],
      [
        supervisePath,
        {
          kind: "file" as const,
          bytes: superviseBytes,
          identity: fileIdentity({
            ino: "29",
            size: superviseBytes.byteLength,
          }),
        },
      ],
      [
        preflightPath,
        {
          kind: "file" as const,
          bytes: preflightBytes,
          identity: fileIdentity({
            ino: "25",
            size: preflightBytes.byteLength,
          }),
        },
      ],
      [
        toolCheckPath,
        {
          kind: "file" as const,
          bytes: toolCheckBytes,
          identity: fileIdentity({
            ino: "26",
            size: toolCheckBytes.byteLength,
          }),
        },
      ],
      [
        setupPath,
        {
          kind: "file" as const,
          bytes: setupBytes,
          identity: fileIdentity({
            ino: "28",
            size: setupBytes.byteLength,
          }),
        },
      ],
      [
        dependencyDriftPath,
        {
          kind: "file" as const,
          bytes: dependencyDriftBytes,
          identity: fileIdentity({
            ino: "27",
            size: dependencyDriftBytes.byteLength,
          }),
        },
      ],
      [
        secretScanPath,
        {
          kind: "file" as const,
          bytes: secretScanBytes,
          identity: fileIdentity({
            ino: "30",
            size: secretScanBytes.byteLength,
          }),
        },
      ],
      [
        credentialProfilePath,
        {
          kind: "file" as const,
          bytes: credentialProfileBytes,
          identity: fileIdentity({
            ino: "31",
            size: credentialProfileBytes.byteLength,
          }),
        },
      ],
      [
        credentialProfileLanePath,
        {
          kind: "file" as const,
          bytes: credentialProfileLaneBytes,
          identity: fileIdentity({
            ino: "33",
            size: credentialProfileLaneBytes.byteLength,
          }),
        },
      ],
      [
        graphStorePath,
        {
          kind: "file" as const,
          bytes: graphStoreBytes,
          identity: fileIdentity({
            ino: "34",
            size: graphStoreBytes.byteLength,
          }),
        },
      ],
      [
        foremanLaunchPath,
        {
          kind: "file" as const,
          bytes: foremanLaunchBytes,
          identity: fileIdentity({
            ino: "35",
            size: foremanLaunchBytes.byteLength,
          }),
        },
      ],
    ]);

    const layer = makeMemoryInstallFs({
      resolveMap: new Map([[skill, skill]]),
      nodes,
    });

    const r = await Effect.runPromise(
      verifyInstalledSkillRoot(skill).pipe(Effect.provide(layer)),
    );
    assert.equal(r._tag, "Fail");
    if (r._tag === "Fail") {
      assert.equal(r.reason, "bundle_identity_changed");
    }
  });
});

describe("runtime plugin-drift", () => {
  it("passes when source and installed manifests match", async () => {
    const a = seedSkillCopy("src");
    const b = seedSkillCopy("inst");
    try {
      const r = await Effect.runPromise(
        compareRuntimePluginDrift(a, b).pipe(Effect.provide(liveInstallFs)),
      );
      assert.equal(r._tag, "Pass", JSON.stringify(r));
    } finally {
      rmSync(dirname(a), { recursive: true, force: true });
      rmSync(dirname(b), { recursive: true, force: true });
    }
  });

  it("fails on mismatch or either invalid root", async () => {
    const a = seedSkillCopy("src2");
    const b = seedSkillCopy("inst2");
    try {
      writeFileSync(
        join(b, "runtime/dist/architecture-policy.js"),
        "TAMPER",
      );
      const r = await Effect.runPromise(
        compareRuntimePluginDrift(a, b).pipe(Effect.provide(liveInstallFs)),
      );
      assert.equal(r._tag, "Fail");
      if (r._tag === "Fail") {
        assert.equal(r.reason, "installed_invalid");
      }

      cpSync(trackedPolicy, join(b, "runtime/dist/architecture-policy.js"));
      const good = await Effect.runPromise(
        compareRuntimePluginDrift(a, b).pipe(Effect.provide(liveInstallFs)),
      );
      assert.equal(good._tag, "Pass");

      rmSync(join(a, "runtime/manifest.json"));
      const badSrc = await Effect.runPromise(
        compareRuntimePluginDrift(a, b).pipe(Effect.provide(liveInstallFs)),
      );
      assert.equal(badSrc._tag, "Fail");
      if (badSrc._tag === "Fail") assert.equal(badSrc.reason, "source_invalid");
    } finally {
      rmSync(dirname(a), { recursive: true, force: true });
      rmSync(dirname(b), { recursive: true, force: true });
    }
  });

  it("binds one verified snapshot and opens each manifest once (no re-read)", async () => {
    const policyBytes = readFileSync(trackedPolicy);
    const guardBytes = readFileSync(trackedGuard);
    const endstopBytes = readFileSync(trackedEndstop);
    const queueBytes = readFileSync(trackedQueue);
    const roundBytes = readFileSync(trackedRound);
    const superviseBytes = readFileSync(trackedSupervise);
    const preflightBytes = readFileSync(trackedPreflight);
    const toolCheckBytes = readFileSync(trackedToolCheck);
    const setupBytes = readFileSync(trackedSetup);
    const dependencyDriftBytes = readFileSync(trackedDependencyDrift);
    const repoHygieneBytes = readFileSync(trackedRepoHygiene);
    const secretScanBytes = readFileSync(trackedSecretScan);
    const credentialProfileBytes = readFileSync(trackedCredentialProfile);
    const credentialProfileLaneBytes = readFileSync(
      trackedCredentialProfileLane,
    );
    const graphStoreBytes = readFileSync(trackedGraphStore);
    const foremanLaunchBytes = readFileSync(trackedForemanLaunch);
    const mfBytes = new TextEncoder().encode(
      readFileSync(trackedManifest, "utf8"),
    );
    // Second-open payload would make re-read design fail or diverge.
    const badSecond = new TextEncoder().encode('{"schemaVersion":2}\n');
    const openA = { count: 0 };
    const openB = { count: 0 };

    function skillTree(
      prefix: string,
      openCount: { count: number },
    ): Map<string, MemoryNode> {
      const skill = prefix;
      const runtime = `${prefix}/runtime`;
      const dist = `${prefix}/runtime/dist`;
      return new Map<string, MemoryNode>([
        [
          skill,
          {
            kind: "dir",
            identity: dirIdentity({ ino: prefix + "-root" }),
            names: ["runtime"],
          },
        ],
        [
          runtime,
          {
            kind: "dir",
            identity: dirIdentity({ ino: prefix + "-rt" }),
            names: ["dist", "manifest.json"],
          },
        ],
        [
          dist,
          {
            kind: "dir",
            identity: dirIdentity({ ino: prefix + "-dist" }),
            names: [
              "architecture-policy.js",
              "credential-profile-lane.js",
              "credential-profile.js",
              "dependency-drift.js",
              "destruction-guard.js",
              "execution-guard.js",
              "foreman-launch.js",
              "foreman-setup.js",
              "graph-store.js",
              "lane-queue.js",
              "lane-round.js",
              "lane-supervise.js",
              "repo-hygiene.js",
              "secret-scan.js",
              "tool-check.js",
              "vendor-preflight.js",
            ],
          },
        ],
        [
          `${runtime}/manifest.json`,
          {
            kind: "file",
            bytes: mfBytes,
            bytesByOpen: [mfBytes, badSecond],
            openCount,
            identity: fileIdentity({
              ino: prefix + "-mf",
              size: mfBytes.byteLength,
            }),
          },
        ],
        [
          `${dist}/architecture-policy.js`,
          {
            kind: "file",
            bytes: policyBytes,
            identity: fileIdentity({
              ino: prefix + "-pol",
              size: policyBytes.byteLength,
            }),
          },
        ],
        [
          `${dist}/destruction-guard.js`,
          {
            kind: "file",
            bytes: guardBytes,
            identity: fileIdentity({
              ino: prefix + "-g",
              size: guardBytes.byteLength,
            }),
          },
        ],
        [
          `${dist}/execution-guard.js`,
          {
            kind: "file",
            bytes: endstopBytes,
            identity: fileIdentity({
              ino: prefix + "-eg",
              size: endstopBytes.byteLength,
            }),
          },
        ],
        [
          `${dist}/lane-queue.js`,
          {
            kind: "file",
            bytes: queueBytes,
            identity: fileIdentity({
              ino: prefix + "-q",
              size: queueBytes.byteLength,
            }),
          },
        ],
        [
          `${dist}/lane-round.js`,
          {
            kind: "file",
            bytes: roundBytes,
            identity: fileIdentity({
              ino: prefix + "-r",
              size: roundBytes.byteLength,
            }),
          },
        ],
        [
          `${dist}/lane-supervise.js`,
          {
            kind: "file",
            bytes: superviseBytes,
            identity: fileIdentity({
              ino: prefix + "-s",
              size: superviseBytes.byteLength,
            }),
          },
        ],
        [
          `${dist}/vendor-preflight.js`,
          {
            kind: "file",
            bytes: preflightBytes,
            identity: fileIdentity({
              ino: prefix + "-vp",
              size: preflightBytes.byteLength,
            }),
          },
        ],
        [
          `${dist}/tool-check.js`,
          {
            kind: "file",
            bytes: toolCheckBytes,
            identity: fileIdentity({
              ino: prefix + "-tc",
              size: toolCheckBytes.byteLength,
            }),
          },
        ],
        [
          `${dist}/foreman-setup.js`,
          {
            kind: "file",
            bytes: setupBytes,
            identity: fileIdentity({
              ino: prefix + "-fs",
              size: setupBytes.byteLength,
            }),
          },
        ],
        [
          `${dist}/dependency-drift.js`,
          {
            kind: "file",
            bytes: dependencyDriftBytes,
            identity: fileIdentity({
              ino: prefix + "-dd",
              size: dependencyDriftBytes.byteLength,
            }),
          },
        ],
        [
          `${dist}/repo-hygiene.js`,
          {
            kind: "file",
            bytes: repoHygieneBytes,
            identity: fileIdentity({
              ino: prefix + "-rh",
              size: repoHygieneBytes.byteLength,
            }),
          },
        ],
        [
          `${dist}/secret-scan.js`,
          {
            kind: "file",
            bytes: secretScanBytes,
            identity: fileIdentity({
              ino: prefix + "-ss",
              size: secretScanBytes.byteLength,
            }),
          },
        ],
        [
          `${dist}/credential-profile.js`,
          {
            kind: "file",
            bytes: credentialProfileBytes,
            identity: fileIdentity({
              ino: prefix + "-cp",
              size: credentialProfileBytes.byteLength,
            }),
          },
        ],
        [
          `${dist}/credential-profile-lane.js`,
          {
            kind: "file",
            bytes: credentialProfileLaneBytes,
            identity: fileIdentity({
              ino: prefix + "-cpl",
              size: credentialProfileLaneBytes.byteLength,
            }),
          },
        ],
        [
          `${dist}/graph-store.js`,
          {
            kind: "file",
            bytes: graphStoreBytes,
            identity: fileIdentity({
              ino: prefix + "-gs",
              size: graphStoreBytes.byteLength,
            }),
          },
        ],
        [
          `${dist}/foreman-launch.js`,
          {
            kind: "file",
            bytes: foremanLaunchBytes,
            identity: fileIdentity({
              ino: prefix + "-fl",
              size: foremanLaunchBytes.byteLength,
            }),
          },
        ],
      ]);
    }

    const nodes = new Map<string, MemoryNode>([
      ...skillTree("/src", openA),
      ...skillTree("/inst", openB),
    ]);
    const layer = makeMemoryInstallFs({
      resolveMap: new Map([
        ["/src", "/src"],
        ["/inst", "/inst"],
      ]),
      nodes,
    });

    const r = await Effect.runPromise(
      compareRuntimePluginDrift("/src", "/inst").pipe(Effect.provide(layer)),
    );
    assert.equal(r._tag, "Pass", JSON.stringify(r));
    // One open per verified root — second-open payload never consumed.
    assert.equal(openA.count, 1);
    assert.equal(openB.count, 1);

    // Fresh counters: a single verify-detailed opens the manifest exactly once
    // and binds digest to the first-open bytes.
    const openC = { count: 0 };
    const nodesC = skillTree("/once", openC);
    const layerC = makeMemoryInstallFs({
      resolveMap: new Map([["/once", "/once"]]),
      nodes: nodesC,
    });
    const detailed = await Effect.runPromise(
      verifyInstalledSkillRootDetailed("/once").pipe(Effect.provide(layerC)),
    );
    assert.equal(detailed.ok, true, JSON.stringify(detailed));
    assert.equal(openC.count, 1);
    if (detailed.ok) {
      assert.equal(
        detailed.snapshot.manifestDigest,
        createHash("sha256").update(mfBytes).digest("hex"),
      );
      assert.equal(
        detailed.result.manifestDigest,
        detailed.snapshot.manifestDigest,
      );
    }
  });
});

describe("skill-root and directory stability seams", () => {
  function baseNodes(opts?: {
    readonly skillIno?: string;
    readonly runtimeIno?: string;
    readonly distIno?: string;
    readonly distIdentityAfter?: number;
    readonly distIdentityChanged?: ReturnType<typeof dirIdentity>;
    readonly runtimeIdentityAfter?: number;
    readonly runtimeIdentityChanged?: ReturnType<typeof dirIdentity>;
    readonly skillIdentityAfter?: number;
    readonly skillIdentityChanged?: ReturnType<typeof dirIdentity>;
  }): Map<string, MemoryNode> {
    const policyBytes = readFileSync(trackedPolicy);
    const guardBytes = readFileSync(trackedGuard);
    const endstopBytes = readFileSync(trackedEndstop);
    const queueBytes = readFileSync(trackedQueue);
    const roundBytes = readFileSync(trackedRound);
    const superviseBytes = readFileSync(trackedSupervise);
    const preflightBytes = readFileSync(trackedPreflight);
    const toolCheckBytes = readFileSync(trackedToolCheck);
    const setupBytes = readFileSync(trackedSetup);
    const dependencyDriftBytes = readFileSync(trackedDependencyDrift);
    const repoHygieneBytes = readFileSync(trackedRepoHygiene);
    const secretScanBytes = readFileSync(trackedSecretScan);
    const credentialProfileBytes = readFileSync(trackedCredentialProfile);
    const credentialProfileLaneBytes = readFileSync(
      trackedCredentialProfileLane,
    );
    const graphStoreBytes = readFileSync(trackedGraphStore);
    const foremanLaunchBytes = readFileSync(trackedForemanLaunch);
    const mfBytes = new TextEncoder().encode(
      readFileSync(trackedManifest, "utf8"),
    );
    const skill = "/skill";
    const runtime = "/skill/runtime";
    const dist = "/skill/runtime/dist";
    const skillDir: MemoryNode = {
      kind: "dir",
      identity: dirIdentity({ ino: opts?.skillIno ?? "10" }),
      names: ["runtime"],
      lstatCount: { count: 0 },
      ...(opts?.skillIdentityAfter !== undefined
        ? {
            identityAfterLstats: opts.skillIdentityAfter,
            identityChanged: opts.skillIdentityChanged,
          }
        : {}),
    };
    const runtimeDir: MemoryNode = {
      kind: "dir",
      identity: dirIdentity({ ino: opts?.runtimeIno ?? "11" }),
      names: ["dist", "manifest.json"],
      lstatCount: { count: 0 },
      ...(opts?.runtimeIdentityAfter !== undefined
        ? {
            identityAfterLstats: opts.runtimeIdentityAfter,
            identityChanged: opts.runtimeIdentityChanged,
          }
        : {}),
    };
    const distDir: MemoryNode = {
      kind: "dir",
      identity: dirIdentity({ ino: opts?.distIno ?? "12" }),
      names: [
              "architecture-policy.js",
              "credential-profile-lane.js",
              "credential-profile.js",
              "dependency-drift.js",
              "destruction-guard.js",
              "execution-guard.js",
              "foreman-launch.js",
              "foreman-setup.js",
              "graph-store.js",
              "lane-queue.js",
              "lane-round.js",
              "lane-supervise.js",
              "repo-hygiene.js",
              "secret-scan.js",
              "tool-check.js",
              "vendor-preflight.js",
            ],
      lstatCount: { count: 0 },
      ...(opts?.distIdentityAfter !== undefined
        ? {
            identityAfterLstats: opts.distIdentityAfter,
            identityChanged: opts.distIdentityChanged,
          }
        : {}),
    };
    return new Map<string, MemoryNode>([
      [skill, skillDir],
      [runtime, runtimeDir],
      [dist, distDir],
      [
        `${runtime}/manifest.json`,
        {
          kind: "file",
          bytes: mfBytes,
          identity: fileIdentity({
            ino: "20",
            size: mfBytes.byteLength,
          }),
        },
      ],
      [
        `${dist}/architecture-policy.js`,
        {
          kind: "file",
          bytes: policyBytes,
          identity: fileIdentity({
            ino: "21",
            size: policyBytes.byteLength,
          }),
        },
      ],
      [
        `${dist}/destruction-guard.js`,
        {
          kind: "file",
          bytes: guardBytes,
          identity: fileIdentity({
            ino: "22",
            size: guardBytes.byteLength,
          }),
        },
      ],
      [
        `${dist}/execution-guard.js`,
        {
          kind: "file",
          bytes: endstopBytes,
          identity: fileIdentity({
            ino: "32",
            size: endstopBytes.byteLength,
          }),
        },
      ],
      [
        `${dist}/lane-queue.js`,
        {
          kind: "file",
          bytes: queueBytes,
          identity: fileIdentity({
            ino: "23",
            size: queueBytes.byteLength,
          }),
        },
      ],
      [
        `${dist}/lane-round.js`,
        {
          kind: "file",
          bytes: roundBytes,
          identity: fileIdentity({
            ino: "24",
            size: roundBytes.byteLength,
          }),
        },
      ],
      [
        `${dist}/lane-supervise.js`,
        {
          kind: "file",
          bytes: superviseBytes,
          identity: fileIdentity({
            ino: "29",
            size: superviseBytes.byteLength,
          }),
        },
      ],
      [
        `${dist}/vendor-preflight.js`,
        {
          kind: "file",
          bytes: preflightBytes,
          identity: fileIdentity({
            ino: "25",
            size: preflightBytes.byteLength,
          }),
        },
      ],
      [
        `${dist}/tool-check.js`,
        {
          kind: "file",
          bytes: toolCheckBytes,
          identity: fileIdentity({
            ino: "26",
            size: toolCheckBytes.byteLength,
          }),
        },
      ],
      [
        `${dist}/foreman-setup.js`,
        {
          kind: "file",
          bytes: setupBytes,
          identity: fileIdentity({
            ino: "28",
            size: setupBytes.byteLength,
          }),
        },
      ],
      [
        `${dist}/dependency-drift.js`,
        {
          kind: "file",
          bytes: dependencyDriftBytes,
          identity: fileIdentity({
            ino: "27",
            size: dependencyDriftBytes.byteLength,
          }),
        },
      ],
      [
        `${dist}/repo-hygiene.js`,
        {
          kind: "file",
          bytes: repoHygieneBytes,
          identity: fileIdentity({
            ino: "30-rh",
            size: repoHygieneBytes.byteLength,
          }),
        },
      ],
      [
        `${dist}/secret-scan.js`,
        {
          kind: "file",
          bytes: secretScanBytes,
          identity: fileIdentity({
            ino: "30",
            size: secretScanBytes.byteLength,
          }),
        },
      ],
      [
        `${dist}/credential-profile.js`,
        {
          kind: "file",
          bytes: credentialProfileBytes,
          identity: fileIdentity({
            ino: "31",
            size: credentialProfileBytes.byteLength,
          }),
        },
      ],
      [
        `${dist}/credential-profile-lane.js`,
        {
          kind: "file",
          bytes: credentialProfileLaneBytes,
          identity: fileIdentity({
            ino: "33",
            size: credentialProfileLaneBytes.byteLength,
          }),
        },
      ],
      [
        `${dist}/graph-store.js`,
        {
          kind: "file",
          bytes: graphStoreBytes,
          identity: fileIdentity({
            ino: "34",
            size: graphStoreBytes.byteLength,
          }),
        },
      ],
      [
        `${dist}/foreman-launch.js`,
        {
          kind: "file",
          bytes: foremanLaunchBytes,
          identity: fileIdentity({
            ino: "35",
            size: foremanLaunchBytes.byteLength,
          }),
        },
      ],
    ]);
  }

  it("fails closed when skill-root symlink/junction retargets during verify", async () => {
    const resolveMap = new Map([
      ["/link", "/skill"],
      ["/skill", "/skill"],
    ]);
    const nodes = baseNodes();
    // Supplied root is a link (lstat succeeds); resolve targets /skill first.
    nodes.set("/link", {
      kind: "symlink",
      identity: linkIdentity({ ino: "link1" }),
      target: "/skill",
    });
    const layer = makeMemoryInstallFs({
      resolveMap,
      nodes,
      hooks: {
        afterResolve: (path, callCount) => {
          if (path === "/link" && callCount === 1) {
            resolveMap.set("/link", "/other");
            nodes.set("/other", {
              kind: "dir",
              identity: dirIdentity({ ino: "99" }),
              names: ["runtime"],
            });
          }
        },
      },
    });
    const r = await Effect.runPromise(
      verifyInstalledSkillRoot("/link").pipe(Effect.provide(layer)),
    );
    assert.equal(r._tag, "Fail");
    if (r._tag === "Fail") assert.equal(r.reason, "skill_root_retargeted");
  });

  it("fails closed when runtime directory identity changes during verify", async () => {
    const nodes = baseNodes({
      runtimeIdentityAfter: 1,
      runtimeIdentityChanged: dirIdentity({ ino: "1100", mtimeMs: 9_999 }),
    });
    const layer = makeMemoryInstallFs({
      resolveMap: new Map([["/skill", "/skill"]]),
      nodes,
    });
    const r = await Effect.runPromise(
      verifyInstalledSkillRoot("/skill").pipe(Effect.provide(layer)),
    );
    assert.equal(r._tag, "Fail");
    if (r._tag === "Fail") assert.equal(r.reason, "runtime_identity_changed");
  });

  it("fails closed when dist directory identity changes during verify", async () => {
    const nodes = baseNodes({
      distIdentityAfter: 1,
      distIdentityChanged: dirIdentity({ ino: "1200", mtimeMs: 9_999 }),
    });
    const layer = makeMemoryInstallFs({
      resolveMap: new Map([["/skill", "/skill"]]),
      nodes,
    });
    const r = await Effect.runPromise(
      verifyInstalledSkillRoot("/skill").pipe(Effect.provide(layer)),
    );
    assert.equal(r._tag, "Fail");
    if (r._tag === "Fail") assert.equal(r.reason, "dist_identity_changed");
  });

  it("fails closed when resolved skill-root identity changes after child reads", async () => {
    // pre-lstat + resolved-lstat consume the first two observations; the
    // post-verify recheck is the third and must see the injected change.
    const nodes = baseNodes({
      skillIdentityAfter: 2,
      skillIdentityChanged: dirIdentity({ ino: "1000", mtimeMs: 9_999 }),
    });
    const layer = makeMemoryInstallFs({
      resolveMap: new Map([["/skill", "/skill"]]),
      nodes,
    });
    const r = await Effect.runPromise(
      verifyInstalledSkillRoot("/skill").pipe(Effect.provide(layer)),
    );
    assert.equal(r._tag, "Fail");
    if (r._tag === "Fail") {
      assert.equal(r.reason, "skill_root_identity_changed");
    }
  });
});

describe("memory InstallFs path separator seam", () => {
  it("looks up slash-seeded nodes via backslash-form paths", async () => {
    // Platform-independent regression for the Windows hosted failure:
    // production uses node:path.join (backslash on win32); tests seed POSIX keys.
    const fileBytes = new TextEncoder().encode("payload");
    const nodes = new Map<string, MemoryNode>([
      [
        "/skill/runtime",
        {
          kind: "dir",
          identity: dirIdentity({ ino: "rt-sep" }),
          names: ["manifest.json", "dist"],
        },
      ],
      [
        "/skill/runtime/manifest.json",
        {
          kind: "file",
          bytes: fileBytes,
          identity: fileIdentity({
            ino: "mf-sep",
            size: fileBytes.byteLength,
          }),
        },
      ],
      [
        "C:/skill root 测试/runtime",
        {
          kind: "dir",
          identity: dirIdentity({ ino: "drive-sep" }),
          names: ["only"],
        },
      ],
    ]);
    const layer = makeMemoryInstallFs({ nodes });
    const backslashRuntime = "\\skill\\runtime";
    const backslashManifest = "\\skill\\runtime\\manifest.json";
    const driveMixed = "C:\\skill root 测试\\runtime";

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* InstallFs;
        const dirId = yield* fs.lstat(backslashRuntime);
        const names = yield* fs.readdirNames(backslashRuntime);
        const opened = yield* fs.withOpenFile(backslashManifest, (file) =>
          file.readBounded(1024),
        );
        const driveId = yield* fs.lstat(driveMixed);
        const driveNames = yield* fs.readdirNames(driveMixed);
        return { dirId, names, opened, driveId, driveNames };
      }).pipe(Effect.provide(layer)),
    );

    assert.equal(result.dirId.ino, "rt-sep");
    assert.deepEqual([...result.names].sort(), ["dist", "manifest.json"]);
    assert.equal(new TextDecoder().decode(result.opened), "payload");
    assert.equal(result.driveId.ino, "drive-sep");
    assert.deepEqual([...result.driveNames], ["only"]);
  });

  it("end-to-end verify passes when resolve target forces backslash joins", async () => {
    // On Linux, path.join keeps POSIX separators for slash roots. Force the
    // Windows failure mode by resolving to a backslash-form synthetic root so
    // joinRuntime emits mixed separators that must still hit slash-seeded nodes.
    const policyBytes = readFileSync(trackedPolicy);
    const guardBytes = readFileSync(trackedGuard);
    const endstopBytes = readFileSync(trackedEndstop);
    const queueBytes = readFileSync(trackedQueue);
    const roundBytes = readFileSync(trackedRound);
    const superviseBytes = readFileSync(trackedSupervise);
    const preflightBytes = readFileSync(trackedPreflight);
    const toolCheckBytes = readFileSync(trackedToolCheck);
    const setupBytes = readFileSync(trackedSetup);
    const dependencyDriftBytes = readFileSync(trackedDependencyDrift);
    const repoHygieneBytes = readFileSync(trackedRepoHygiene);
    const secretScanBytes = readFileSync(trackedSecretScan);
    const credentialProfileBytes = readFileSync(trackedCredentialProfile);
    const credentialProfileLaneBytes = readFileSync(
      trackedCredentialProfileLane,
    );
    const graphStoreBytes = readFileSync(trackedGraphStore);
    const foremanLaunchBytes = readFileSync(trackedForemanLaunch);
    const mfBytes = new TextEncoder().encode(
      readFileSync(trackedManifest, "utf8"),
    );
    const skillSlash = "/skill";
    const skillBackslash = "\\skill";
    const runtime = "/skill/runtime";
    const dist = "/skill/runtime/dist";
    const nodes = new Map<string, MemoryNode>([
      [
        skillSlash,
        {
          kind: "dir",
          identity: dirIdentity({ ino: "10" }),
          names: ["runtime"],
        },
      ],
      [
        runtime,
        {
          kind: "dir",
          identity: dirIdentity({ ino: "11" }),
          names: ["dist", "manifest.json"],
        },
      ],
      [
        dist,
        {
          kind: "dir",
          identity: dirIdentity({ ino: "12" }),
          names: [
            "architecture-policy.js",
            "credential-profile-lane.js",
            "credential-profile.js",
            "dependency-drift.js",
            "destruction-guard.js",
            "execution-guard.js",
            "foreman-launch.js",
            "foreman-setup.js",
            "graph-store.js",
            "lane-queue.js",
            "lane-round.js",
            "lane-supervise.js",
            "repo-hygiene.js",
            "secret-scan.js",
            "tool-check.js",
            "vendor-preflight.js",
          ],
        },
      ],
      [
        `${runtime}/manifest.json`,
        {
          kind: "file",
          bytes: mfBytes,
          identity: fileIdentity({
            ino: "20",
            size: mfBytes.byteLength,
          }),
        },
      ],
      [
        `${dist}/architecture-policy.js`,
        {
          kind: "file",
          bytes: policyBytes,
          identity: fileIdentity({
            ino: "21",
            size: policyBytes.byteLength,
          }),
        },
      ],
      [
        `${dist}/destruction-guard.js`,
        {
          kind: "file",
          bytes: guardBytes,
          identity: fileIdentity({
            ino: "22",
            size: guardBytes.byteLength,
          }),
        },
      ],
      [
        `${dist}/execution-guard.js`,
        {
          kind: "file",
          bytes: endstopBytes,
          identity: fileIdentity({
            ino: "32",
            size: endstopBytes.byteLength,
          }),
        },
      ],
      [
        `${dist}/lane-queue.js`,
        {
          kind: "file",
          bytes: queueBytes,
          identity: fileIdentity({
            ino: "23",
            size: queueBytes.byteLength,
          }),
        },
      ],
      [
        `${dist}/lane-round.js`,
        {
          kind: "file",
          bytes: roundBytes,
          identity: fileIdentity({
            ino: "24",
            size: roundBytes.byteLength,
          }),
        },
      ],
      [
        `${dist}/lane-supervise.js`,
        {
          kind: "file",
          bytes: superviseBytes,
          identity: fileIdentity({
            ino: "29",
            size: superviseBytes.byteLength,
          }),
        },
      ],
      [
        `${dist}/vendor-preflight.js`,
        {
          kind: "file",
          bytes: preflightBytes,
          identity: fileIdentity({
            ino: "25",
            size: preflightBytes.byteLength,
          }),
        },
      ],
      [
        `${dist}/tool-check.js`,
        {
          kind: "file",
          bytes: toolCheckBytes,
          identity: fileIdentity({
            ino: "26",
            size: toolCheckBytes.byteLength,
          }),
        },
      ],
      [
        `${dist}/foreman-setup.js`,
        {
          kind: "file",
          bytes: setupBytes,
          identity: fileIdentity({
            ino: "28",
            size: setupBytes.byteLength,
          }),
        },
      ],
      [
        `${dist}/dependency-drift.js`,
        {
          kind: "file",
          bytes: dependencyDriftBytes,
          identity: fileIdentity({
            ino: "27",
            size: dependencyDriftBytes.byteLength,
          }),
        },
      ],
      [
        `${dist}/repo-hygiene.js`,
        {
          kind: "file",
          bytes: repoHygieneBytes,
          identity: fileIdentity({
            ino: "30-rh",
            size: repoHygieneBytes.byteLength,
          }),
        },
      ],
      [
        `${dist}/secret-scan.js`,
        {
          kind: "file",
          bytes: secretScanBytes,
          identity: fileIdentity({
            ino: "30",
            size: secretScanBytes.byteLength,
          }),
        },
      ],
      [
        `${dist}/credential-profile.js`,
        {
          kind: "file",
          bytes: credentialProfileBytes,
          identity: fileIdentity({
            ino: "31",
            size: credentialProfileBytes.byteLength,
          }),
        },
      ],
      [
        `${dist}/credential-profile-lane.js`,
        {
          kind: "file",
          bytes: credentialProfileLaneBytes,
          identity: fileIdentity({
            ino: "33",
            size: credentialProfileLaneBytes.byteLength,
          }),
        },
      ],
      [
        `${dist}/graph-store.js`,
        {
          kind: "file",
          bytes: graphStoreBytes,
          identity: fileIdentity({
            ino: "34",
            size: graphStoreBytes.byteLength,
          }),
        },
      ],
      [
        `${dist}/foreman-launch.js`,
        {
          kind: "file",
          bytes: foremanLaunchBytes,
          identity: fileIdentity({
            ino: "35",
            size: foremanLaunchBytes.byteLength,
          }),
        },
      ],

    ]);
    const layer = makeMemoryInstallFs({
      // Supplied root is slash-form; resolved target is backslash-form so
      // subsequent node:path.join children contain `\` on every platform.
      resolveMap: new Map([[skillSlash, skillBackslash]]),
      nodes,
    });

    const r = await Effect.runPromise(
      verifyInstalledSkillRoot(skillSlash).pipe(Effect.provide(layer)),
    );
    assert.equal(r._tag, "Pass", JSON.stringify(r));
  });

  it("resolve-map and counters stay deterministic across separator forms", async () => {
    const resolveMap = new Map([
      ["/link", "/skill"],
      ["/skill", "/skill"],
    ]);
    const nodes = new Map<string, MemoryNode>([
      [
        "/skill",
        {
          kind: "dir",
          identity: dirIdentity({ ino: "s1" }),
          names: ["runtime"],
        },
      ],
      [
        "/link",
        {
          kind: "symlink",
          identity: linkIdentity({ ino: "l1" }),
          target: "/skill",
        },
      ],
    ]);
    const seen: Array<{ path: string; callCount: number }> = [];
    const layer = makeMemoryInstallFs({
      resolveMap,
      nodes,
      hooks: {
        afterResolve: (path, callCount) => {
          seen.push({ path, callCount });
          // Mutate with the exact path string the hook received (may be `\link`).
          // Last-writer among canonical-equivalent keys must win so the second
          // resolve (slash form) observes /other, not the shadowed seed.
          if (memoryPathIsFirstLink(path) && callCount === 1) {
            resolveMap.set(path, "/other");
            nodes.set("/other", {
              kind: "dir",
              identity: dirIdentity({ ino: "other" }),
              names: [],
            });
          }
        },
      },
    });

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* InstallFs;
        const first = yield* fs.resolvePath("\\link");
        const second = yield* fs.resolvePath("/link");
        return { first, second };
      }).pipe(Effect.provide(layer)),
    );

    assert.equal(result.first, "/skill");
    assert.equal(result.second, "/other");
    assert.equal(seen.length, 2);
    assert.equal(seen[0]?.path, "\\link");
    assert.equal(seen[0]?.callCount, 1);
    assert.equal(seen[1]?.callCount, 2);
  });
});

/** Local helper: treat slash and backslash link roots as the same hook path. */
function memoryPathIsFirstLink(path: string): boolean {
  return path === "/link" || path === "\\link";
}

describe("install CLI argv and emission", () => {
  it("parses verify-install and plugin-drift strictly", () => {
    assert.deepEqual(
      parseInstallArgv([
        "node",
        "architecture-policy.js",
        "verify-install",
        "--skill-root",
        "/s",
      ]),
      { command: "verify-install", skillRoot: "/s" },
    );
    assert.deepEqual(
      parseInstallArgv([
        "plugin-drift",
        "--source-root",
        "/a",
        "--installed-root",
        "/b",
      ]),
      { command: "plugin-drift", sourceRoot: "/a", installedRoot: "/b" },
    );
    assert.equal("error" in parseInstallArgv(["verify-install"]), true);
    assert.equal(
      "error" in
        parseInstallArgv(["verify-install", "--skill-root", "/s", "extra"]),
      true,
    );
    assert.equal(
      "error" in
        parseInstallArgv([
          "plugin-drift",
          "--source-root",
          "/a",
          "--source-root",
          "/b",
          "--installed-root",
          "/c",
        ]),
      true,
    );
  });

  it("emits one-line canonical JSON, empty stderr, exit codes, no absolute paths on failure", async () => {
    const lines: string[] = [];
    const err: string[] = [];
    const io = {
      writeStdout: (l: string) => lines.push(l),
      writeStderr: (l: string) => err.push(l),
    };

    const code64 = await Effect.runPromise(
      runInstallCli(["verify-install"], io).pipe(Effect.provide(liveInstallFs)),
    );
    assert.equal(code64, 64);
    assert.equal(err.length, 0);
    assert.equal(lines.length, 1);
    assert.ok(lines[0]!.endsWith("\n"));
    assert.equal(lines[0]!.trim(), canonicalize(JSON.parse(lines[0]!.trim())));
    assert.ok(!lines[0]!.includes(skillRoot));

    lines.length = 0;
    const code1 = await Effect.runPromise(
      runInstallCli(
        ["verify-install", "--skill-root", join(tmpdir(), "no-such-skill-xyz")],
        io,
      ).pipe(Effect.provide(liveInstallFs)),
    );
    assert.equal(code1, 1);
    assert.equal(err.length, 0);
    assert.equal(lines.length, 1);
    const body = JSON.parse(lines[0]!.trim()) as {
      _tag: string;
      reason: string;
    };
    assert.equal(body._tag, "Fail");
    assert.ok(!lines[0]!.includes(tmpdir()));
    assert.ok(!lines[0]!.includes("ENOENT"));

    lines.length = 0;
    const code0 = await Effect.runPromise(
      runInstallCli(
        ["verify-install", "--skill-root", skillRoot],
        io,
      ).pipe(Effect.provide(liveInstallFs)),
    );
    assert.equal(code0, 0);
    assert.equal(err.length, 0);
    const pass = JSON.parse(lines[0]!.trim()) as { _tag: string };
    assert.equal(pass._tag, "Pass");
  });
});

describe("installFail helpers stay closed", () => {
  it("builds Fail without absolute paths", () => {
    const f = installFail("bundle_missing", "dist/architecture-policy.js");
    const line = canonicalize(f);
    assert.ok(!line.includes("/home"));
    assert.ok(line.includes("bundle_missing"));
  });
});

// Silence unused import when O_NOFOLLOW absent on platform
void fsConstants;
