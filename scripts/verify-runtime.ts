import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { buildTo } from "./build-runtime.js";
import { verifyRuntimeManifest } from "./verify-runtime-manifest.js";
import { canonicalize } from "../packages/core/src/canonical-json.js";
import {
  CANONICAL_REGISTER_ID,
  CANONICAL_REGISTER_RELPATH,
} from "../packages/policy/src/schema.js";
import {
  BEGIN_SENTINEL,
  END_SENTINEL,
} from "../packages/policy/src/register.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function fail(msg: string): never {
  process.stderr.write(msg + "\n");
  process.exit(1);
}

function bytesEqual(a: Buffer, b: Buffer): boolean {
  return a.byteLength === b.byteLength && a.equals(b);
}

function git(repo: string, args: string[]): string {
  const r = spawnSync("git", args, {
    cwd: repo,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    },
  });
  if (r.status !== 0) {
    fail(`git ${args.join(" ")}: ${r.stderr || r.stdout}`);
  }
  return (r.stdout || "").trim();
}

// 1. Tracked runtime
const trackedRuntime = join(root, "skills/foreman/runtime");
const trackedManifestPath = join(trackedRuntime, "manifest.json");
const trackedGuardPath = join(trackedRuntime, "dist/destruction-guard.js");
const trackedPolicyPath = join(trackedRuntime, "dist/architecture-policy.js");
const trackedQueuePath = join(trackedRuntime, "dist/lane-queue.js");
const trackedRoundPath = join(trackedRuntime, "dist/lane-round.js");
const trackedPreflightPath = join(trackedRuntime, "dist/vendor-preflight.js");
const trackedToolCheckPath = join(trackedRuntime, "dist/tool-check.js");
const trackedDependencyDriftPath = join(
  trackedRuntime,
  "dist/dependency-drift.js",
);
const unintendedDistManifest = join(trackedRuntime, "dist/manifest.json");
if (existsSync(unintendedDistManifest)) {
  fail("unintended dist/manifest.json present");
}
const trackedCheck = verifyRuntimeManifest(trackedRuntime);
if (!trackedCheck.ok) {
  fail("tracked runtime manifest: " + trackedCheck.reason);
}
const trackedManifest = readFileSync(trackedManifestPath);
const trackedGuard = readFileSync(trackedGuardPath);
const trackedPolicy = readFileSync(trackedPolicyPath);
const trackedQueue = readFileSync(trackedQueuePath);
const trackedRound = readFileSync(trackedRoundPath);
const trackedPreflight = readFileSync(trackedPreflightPath);
const trackedToolCheck = readFileSync(trackedToolCheckPath);
const trackedDependencyDrift = readFileSync(trackedDependencyDriftPath);

// No extra files under dist/
{
  const distFiles = readdirSync(join(trackedRuntime, "dist")).sort();
  const expected = [
    "architecture-policy.js",
    "dependency-drift.js",
    "destruction-guard.js",
    "lane-queue.js",
    "lane-round.js",
    "tool-check.js",
    "vendor-preflight.js",
  ];
  if (JSON.stringify(distFiles) !== JSON.stringify(expected)) {
    fail("unexpected dist files: " + distFiles.join(","));
  }
}

// 2. Two temp builds match tracked
const tmpA = mkdtempSync(join(tmpdir(), "foreman-build-a-"));
const tmpB = mkdtempSync(join(tmpdir(), "foreman-build-b-"));
try {
  const a = await buildTo({ runtimeRoot: tmpA });
  const b = await buildTo({ runtimeRoot: tmpB });
  const aGuard = readFileSync(join(tmpA, "dist/destruction-guard.js"));
  const bGuard = readFileSync(join(tmpB, "dist/destruction-guard.js"));
  const aPolicy = readFileSync(join(tmpA, "dist/architecture-policy.js"));
  const bPolicy = readFileSync(join(tmpB, "dist/architecture-policy.js"));
  const aQueue = readFileSync(join(tmpA, "dist/lane-queue.js"));
  const bQueue = readFileSync(join(tmpB, "dist/lane-queue.js"));
  const aRound = readFileSync(join(tmpA, "dist/lane-round.js"));
  const bRound = readFileSync(join(tmpB, "dist/lane-round.js"));
  const aPreflight = readFileSync(join(tmpA, "dist/vendor-preflight.js"));
  const bPreflight = readFileSync(join(tmpB, "dist/vendor-preflight.js"));
  const aToolCheck = readFileSync(join(tmpA, "dist/tool-check.js"));
  const bToolCheck = readFileSync(join(tmpB, "dist/tool-check.js"));
  const aDependencyDrift = readFileSync(join(tmpA, "dist/dependency-drift.js"));
  const bDependencyDrift = readFileSync(join(tmpB, "dist/dependency-drift.js"));
  if (!bytesEqual(aGuard, bGuard)) fail("non-deterministic destruction-guard");
  if (!bytesEqual(aPolicy, bPolicy)) fail("non-deterministic architecture-policy");
  if (!bytesEqual(aQueue, bQueue)) fail("non-deterministic lane-queue");
  if (!bytesEqual(aRound, bRound)) fail("non-deterministic lane-round");
  if (!bytesEqual(aPreflight, bPreflight)) {
    fail("non-deterministic vendor-preflight");
  }
  if (!bytesEqual(aToolCheck, bToolCheck)) {
    fail("non-deterministic tool-check");
  }
  if (!bytesEqual(aDependencyDrift, bDependencyDrift)) {
    fail("non-deterministic dependency-drift");
  }
  if (!bytesEqual(aGuard, trackedGuard)) fail("destruction-guard drift");
  if (!bytesEqual(aPolicy, trackedPolicy)) fail("architecture-policy drift");
  if (!bytesEqual(aQueue, trackedQueue)) fail("lane-queue drift");
  if (!bytesEqual(aRound, trackedRound)) fail("lane-round drift");
  if (!bytesEqual(aPreflight, trackedPreflight)) fail("vendor-preflight drift");
  if (!bytesEqual(aToolCheck, trackedToolCheck)) fail("tool-check drift");
  if (!bytesEqual(aDependencyDrift, trackedDependencyDrift)) {
    fail("dependency-drift drift");
  }
  if (!bytesEqual(readFileSync(a.manifestPath), trackedManifest)) {
    fail("manifest drift");
  }
  if (!bytesEqual(readFileSync(b.manifestPath), trackedManifest)) {
    fail("manifest drift b");
  }
} finally {
  rmSync(tmpA, { recursive: true, force: true });
  rmSync(tmpB, { recursive: true, force: true });
}

// 3. Negative manifest probes
{
  const probe = mkdtempSync(join(tmpdir(), "foreman-mf-"));
  try {
    const rt = join(probe, "runtime");
    mkdirSync(join(rt, "dist"), { recursive: true });
    writeFileSync(join(rt, "manifest.json"), trackedManifest);
    const miss = verifyRuntimeManifest(rt);
    if (miss.ok || miss.reason !== "bundle_missing") {
      fail("expected bundle_missing got " + JSON.stringify(miss));
    }
    writeFileSync(join(rt, "dist/destruction-guard.js"), "TAMPER");
    writeFileSync(join(rt, "dist/architecture-policy.js"), trackedPolicy);
    writeFileSync(join(rt, "dist/lane-queue.js"), trackedQueue);
    writeFileSync(join(rt, "dist/lane-round.js"), trackedRound);
    writeFileSync(join(rt, "dist/vendor-preflight.js"), trackedPreflight);
    writeFileSync(join(rt, "dist/tool-check.js"), trackedToolCheck);
    writeFileSync(join(rt, "dist/dependency-drift.js"), trackedDependencyDrift);
    if (verifyRuntimeManifest(rt).ok) fail("tampered guard should fail");
    cpSync(trackedGuardPath, join(rt, "dist/destruction-guard.js"));
    writeFileSync(join(rt, "dist/architecture-policy.js"), "TAMPER");
    if (verifyRuntimeManifest(rt).ok) fail("tampered policy should fail");
    cpSync(trackedPolicyPath, join(rt, "dist/architecture-policy.js"));
    writeFileSync(join(rt, "dist/lane-queue.js"), "TAMPER");
    if (verifyRuntimeManifest(rt).ok) fail("tampered lane-queue should fail");
    cpSync(trackedQueuePath, join(rt, "dist/lane-queue.js"));
    writeFileSync(join(rt, "dist/lane-round.js"), "TAMPER");
    if (verifyRuntimeManifest(rt).ok) fail("tampered lane-round should fail");
    cpSync(trackedRoundPath, join(rt, "dist/lane-round.js"));
    writeFileSync(join(rt, "dist/vendor-preflight.js"), "TAMPER");
    if (verifyRuntimeManifest(rt).ok) fail("tampered vendor-preflight should fail");
    cpSync(trackedPreflightPath, join(rt, "dist/vendor-preflight.js"));
    writeFileSync(join(rt, "dist/tool-check.js"), "TAMPER");
    if (verifyRuntimeManifest(rt).ok) fail("tampered tool-check should fail");
    cpSync(trackedToolCheckPath, join(rt, "dist/tool-check.js"));
    writeFileSync(join(rt, "dist/dependency-drift.js"), "TAMPER");
    if (verifyRuntimeManifest(rt).ok) fail("tampered dependency-drift should fail");
    cpSync(trackedDependencyDriftPath, join(rt, "dist/dependency-drift.js"));
    // Extra undeclared file under dist must fail
    writeFileSync(join(rt, "dist/extra.js"), "export {}\n");
    {
      const extra = verifyRuntimeManifest(rt);
      if (extra.ok || extra.reason !== "dist_extra_entry") {
        fail("expected dist_extra_entry got " + JSON.stringify(extra));
      }
    }
    rmSync(join(rt, "dist/extra.js"));
    // Manifest symlink to same bytes must fail
    {
      const real = join(rt, "manifest.real.json");
      writeFileSync(real, trackedManifest);
      rmSync(join(rt, "manifest.json"));
      symlinkSync(real, join(rt, "manifest.json"));
      const linked = verifyRuntimeManifest(rt);
      if (linked.ok || linked.reason !== "manifest_linked") {
        fail("expected manifest_linked got " + JSON.stringify(linked));
      }
      rmSync(join(rt, "manifest.json"));
      writeFileSync(join(rt, "manifest.json"), trackedManifest);
    }
    // Linked lane-round bundle must fail
    {
      const realRound = join(rt, "lane-round.real.js");
      writeFileSync(realRound, trackedRound);
      rmSync(join(rt, "dist/lane-round.js"));
      symlinkSync(realRound, join(rt, "dist/lane-round.js"));
      const linkedRound = verifyRuntimeManifest(rt);
      if (linkedRound.ok) fail("linked lane-round should fail");
      rmSync(join(rt, "dist/lane-round.js"));
      writeFileSync(join(rt, "dist/lane-round.js"), trackedRound);
    }
    // Linked vendor-preflight bundle must fail
    {
      const realPreflight = join(rt, "vendor-preflight.real.js");
      writeFileSync(realPreflight, trackedPreflight);
      rmSync(join(rt, "dist/vendor-preflight.js"));
      symlinkSync(realPreflight, join(rt, "dist/vendor-preflight.js"));
      const linkedPreflight = verifyRuntimeManifest(rt);
      if (linkedPreflight.ok) fail("linked vendor-preflight should fail");
      rmSync(join(rt, "dist/vendor-preflight.js"));
      writeFileSync(join(rt, "dist/vendor-preflight.js"), trackedPreflight);
    }
    // Linked tool-check bundle must fail
    {
      const realToolCheck = join(rt, "tool-check.real.js");
      writeFileSync(realToolCheck, trackedToolCheck);
      rmSync(join(rt, "dist/tool-check.js"));
      symlinkSync(realToolCheck, join(rt, "dist/tool-check.js"));
      const linkedToolCheck = verifyRuntimeManifest(rt);
      if (linkedToolCheck.ok) fail("linked tool-check should fail");
      rmSync(join(rt, "dist/tool-check.js"));
      writeFileSync(join(rt, "dist/tool-check.js"), trackedToolCheck);
    }
    // Missing lane-round must fail
    {
      rmSync(join(rt, "dist/lane-round.js"));
      const missRound = verifyRuntimeManifest(rt);
      if (missRound.ok || missRound.reason !== "bundle_missing") {
        fail("expected bundle_missing for lane-round got " + JSON.stringify(missRound));
      }
      writeFileSync(join(rt, "dist/lane-round.js"), trackedRound);
    }
    // Missing vendor-preflight must fail
    {
      rmSync(join(rt, "dist/vendor-preflight.js"));
      const missPreflight = verifyRuntimeManifest(rt);
      if (missPreflight.ok || missPreflight.reason !== "bundle_missing") {
        fail(
          "expected bundle_missing for vendor-preflight got " +
            JSON.stringify(missPreflight),
        );
      }
      writeFileSync(join(rt, "dist/vendor-preflight.js"), trackedPreflight);
    }
    // Missing tool-check must fail
    {
      rmSync(join(rt, "dist/tool-check.js"));
      const missToolCheck = verifyRuntimeManifest(rt);
      if (missToolCheck.ok || missToolCheck.reason !== "bundle_missing") {
        fail(
          "expected bundle_missing for tool-check got " +
            JSON.stringify(missToolCheck),
        );
      }
      writeFileSync(join(rt, "dist/tool-check.js"), trackedToolCheck);
    }
    // Missing dependency-drift must fail
    {
      rmSync(join(rt, "dist/dependency-drift.js"));
      const missDrift = verifyRuntimeManifest(rt);
      if (missDrift.ok || missDrift.reason !== "bundle_missing") {
        fail(
          "expected bundle_missing for dependency-drift got " +
            JSON.stringify(missDrift),
        );
      }
      writeFileSync(join(rt, "dist/dependency-drift.js"), trackedDependencyDrift);
    }
    // Linked dependency-drift bundle must fail
    {
      const realDrift = join(rt, "dependency-drift.real.js");
      writeFileSync(realDrift, trackedDependencyDrift);
      rmSync(join(rt, "dist/dependency-drift.js"));
      symlinkSync(realDrift, join(rt, "dist/dependency-drift.js"));
      const linkedDrift = verifyRuntimeManifest(rt);
      if (linkedDrift.ok) fail("linked dependency-drift should fail");
      rmSync(join(rt, "dist/dependency-drift.js"));
      writeFileSync(join(rt, "dist/dependency-drift.js"), trackedDependencyDrift);
    }
    // Tamper manifest digests
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
            id: "dependency-drift",
            relativePath: "dist/dependency-drift.js",
            sha256: "g".repeat(64),
          },
          {
            byteLength: 1,
            id: "destruction-guard",
            relativePath: "dist/destruction-guard.js",
            sha256: "b".repeat(64),
          },
          {
            byteLength: 1,
            id: "lane-queue",
            relativePath: "dist/lane-queue.js",
            sha256: "c".repeat(64),
          },
          {
            byteLength: 1,
            id: "lane-round",
            relativePath: "dist/lane-round.js",
            sha256: "d".repeat(64),
          },
          {
            byteLength: 1,
            id: "tool-check",
            relativePath: "dist/tool-check.js",
            sha256: "f".repeat(64),
          },
          {
            byteLength: 1,
            id: "vendor-preflight",
            relativePath: "dist/vendor-preflight.js",
            sha256: "e".repeat(64),
          },
        ],
        nodeRange: ">=24 <25",
        schemaVersion: 2,
      }) + "\n",
    );
    if (verifyRuntimeManifest(rt).ok) fail("tampered manifest should fail");
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
}

// 4. pathToFileURL
{
  const href = pathToFileURL(
    join(root, "packages/core/src/canonical-json.ts"),
  ).href;
  if (!href.startsWith("file:")) fail("pathToFileURL");
  const core = await import(href);
  if (typeof core.canonicalize !== "function") fail("dynamic import");
}

// 5. Copied skill + isolated git with blocked DST-0060 + policy smoke
const tmp = mkdtempSync(join(tmpdir(), "foreman-copied-"));
try {
  const copiedSkill = join(tmp, "skill-copy", "foreman");
  mkdirSync(dirname(copiedSkill), { recursive: true });
  cpSync(join(root, "skills/foreman"), copiedSkill, { recursive: true });
  const copiedRuntime = join(copiedSkill, "runtime");
  const copiedOk = verifyRuntimeManifest(copiedRuntime);
  if (!copiedOk.ok) fail("copied runtime: " + copiedOk.reason);

  const repo = join(tmp, "iso-repo");
  mkdirSync(repo, { recursive: true });
  git(repo, ["init"]);
  git(repo, ["config", "user.email", "t@t"]);
  git(repo, ["config", "user.name", "t"]);
  git(repo, ["config", "commit.gpgsign", "false"]);

  const regJson = canonicalize({
    currentEntries: [
      {
        actionKind: "artifact_relocate",
        artifactRelocate: {
          byteLength: 5359,
          recoveryPath: "/r",
          sha256:
            "90b74c67fcafccb4c04b1402ba6b275e6809debd4aa096efdc7b23b7c97275db",
          sourcePath: "/s",
        },
        evidence: "e",
        id: "DST-0060",
        owner: "Sprint 0 architect",
        recordedAt: "2026-08-04T00:00:41-06:00",
        recoveryStatus: "external_path_pending_guard",
        requiredCondition: "guard",
        state: "blocked",
        targetOrAction: "spec",
      },
    ],
    historicalIncidents: [],
    registerId: CANONICAL_REGISTER_ID,
    schemaVersion: 1,
  });
  const regPath = join(repo, CANONICAL_REGISTER_RELPATH);
  mkdirSync(dirname(regPath), { recursive: true });
  writeFileSync(
    regPath,
    ["# log", BEGIN_SENTINEL, regJson, END_SENTINEL, "", "Prose.", ""].join(
      "\n",
    ),
    "utf8",
  );
  // base commit (clean TypeScript tree for architecture-policy smoke)
  mkdirSync(join(repo, "packages"), { recursive: true });
  writeFileSync(join(repo, "packages/a.ts"), "export const a = 1;\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-m", "blocked"]);
  const base = git(repo, ["rev-parse", "HEAD"]);
  writeFileSync(join(repo, "packages/b.ts"), "export const b = 1;\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-m", "head"]);

  const emptyCwd = join(tmp, "empty-cwd");
  mkdirSync(emptyCwd, { recursive: true });
  const bundleCopied = join(copiedRuntime, "dist/destruction-guard.js");
  const run = spawnSync(
    process.execPath,
    [bundleCopied, "check", "--repo-root", repo],
    {
      cwd: emptyCwd,
      encoding: "utf8",
      input: canonicalize({ entryId: "DST-0060", schemaVersion: 1 }),
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
      },
    },
  );
  if (run.status !== 1) {
    fail(`copied check exit ${run.status}: ${run.stdout} ${run.stderr}`);
  }
  const line = (run.stdout || "").trim();
  const expected = canonicalize({
    _tag: "Denied",
    entryId: "DST-0060",
    reason: "state_blocked",
    schemaVersion: 1,
  });
  if (line !== expected) fail("copied check output: " + line);
  if ((run.stderr || "").length > 0) fail("copied check stderr not empty");

  // Copied architecture-policy against the isolated repo
  const policyBundle = join(copiedRuntime, "dist/architecture-policy.js");
  const pol = spawnSync(
    process.execPath,
    [policyBundle, "check", "--base", base, "--repo-root", repo],
    {
      cwd: emptyCwd,
      encoding: "utf8",
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
      },
    },
  );
  if (pol.status !== 0) {
    fail(`copied policy exit ${pol.status}: ${pol.stdout} ${pol.stderr}`);
  }
  const polBody = JSON.parse((pol.stdout || "").trim());
  if (polBody._tag !== "Pass") {
    fail("copied policy not Pass: " + pol.stdout);
  }
  if ((pol.stderr || "").length > 0) fail("copied policy stderr not empty");

  // Compiled verify-install on the copied skill (no NODE_PATH / repo modules)
  const vi = spawnSync(
    process.execPath,
    [policyBundle, "verify-install", "--skill-root", copiedSkill],
    {
      cwd: emptyCwd,
      encoding: "utf8",
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
      },
    },
  );
  if (vi.status !== 0) {
    fail(`copied verify-install exit ${vi.status}: ${vi.stdout} ${vi.stderr}`);
  }
  const viBody = JSON.parse((vi.stdout || "").trim());
  if (viBody._tag !== "Pass") {
    fail("copied verify-install not Pass: " + vi.stdout);
  }
  if ((vi.stderr || "").length > 0) {
    fail("copied verify-install stderr not empty");
  }
  // Runtime plugin-drift: source skill vs copied skill must match
  const pd = spawnSync(
    process.execPath,
    [
      policyBundle,
      "plugin-drift",
      "--source-root",
      join(root, "skills/foreman"),
      "--installed-root",
      copiedSkill,
    ],
    {
      cwd: emptyCwd,
      encoding: "utf8",
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
      },
    },
  );
  if (pd.status !== 0) {
    fail(`copied plugin-drift exit ${pd.status}: ${pd.stdout} ${pd.stderr}`);
  }
  const pdBody = JSON.parse((pd.stdout || "").trim());
  if (pdBody._tag !== "Pass") {
    fail("copied plugin-drift not Pass: " + pd.stdout);
  }
  if ((pd.stderr || "").length > 0) {
    fail("copied plugin-drift stderr not empty");
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

process.stdout.write("verify-runtime: ok\n");
