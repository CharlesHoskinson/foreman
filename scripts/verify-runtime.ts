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
const trackedApplianceDoctorPath = join(
  trackedRuntime,
  "dist/appliance-doctor.js",
);
const trackedGraphifyQualificationPath = join(
  trackedRuntime,
  "dist/graphify-qualification.js",
);
const trackedGuardPath = join(trackedRuntime, "dist/destruction-guard.js");
const trackedPolicyPath = join(trackedRuntime, "dist/architecture-policy.js");
const trackedEndstopPath = join(trackedRuntime, "dist/execution-guard.js");
const trackedQueuePath = join(trackedRuntime, "dist/lane-queue.js");
const trackedRoundPath = join(trackedRuntime, "dist/lane-round.js");
const trackedSupervisePath = join(trackedRuntime, "dist/lane-supervise.js");
const trackedPreflightPath = join(trackedRuntime, "dist/vendor-preflight.js");
const trackedFmSessionPath = join(trackedRuntime, "dist/fm-session.js");
const trackedTier2CollectPath = join(trackedRuntime, "dist/tier2-collect.js");
const trackedTier2ComparePath = join(trackedRuntime, "dist/tier2-compare.js");
const trackedToolCheckPath = join(trackedRuntime, "dist/tool-check.js");
const trackedDependencyDriftPath = join(
  trackedRuntime,
  "dist/dependency-drift.js",
);
const trackedForemanSetupPath = join(
  trackedRuntime,
  "dist/foreman-setup.js",
);
const trackedRepoHygienePath = join(trackedRuntime, "dist/repo-hygiene.js");
const trackedSecretScanPath = join(trackedRuntime, "dist/secret-scan.js");
const trackedCredentialProfilePath = join(
  trackedRuntime,
  "dist/credential-profile.js",
);
const trackedCredentialProfileLanePath = join(
  trackedRuntime,
  "dist/credential-profile-lane.js",
);
const trackedGraphStorePath = join(trackedRuntime, "dist/graph-store.js");
const trackedForemanLaunchPath = join(trackedRuntime, "dist/foreman-launch.js");
const trackedReleaseAdmissionPath = join(
  trackedRuntime,
  "dist/release-admission.js",
);
const trackedReleaseAuthorityPath = join(
  trackedRuntime,
  "dist/release-authority.js",
);
const trackedReleaseCoveragePath = join(
  trackedRuntime,
  "dist/release-coverage.js",
);
const trackedReleasePolicyPath = join(
  trackedRuntime,
  "dist/release-policy.js",
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
const trackedApplianceDoctor = readFileSync(trackedApplianceDoctorPath);
const trackedGraphifyQualification = readFileSync(
  trackedGraphifyQualificationPath,
);
const trackedGuard = readFileSync(trackedGuardPath);
const trackedPolicy = readFileSync(trackedPolicyPath);
const trackedEndstop = readFileSync(trackedEndstopPath);
const trackedQueue = readFileSync(trackedQueuePath);
const trackedRound = readFileSync(trackedRoundPath);
const trackedSupervise = readFileSync(trackedSupervisePath);
const trackedPreflight = readFileSync(trackedPreflightPath);
const trackedFmSession = readFileSync(trackedFmSessionPath);
const trackedTier2Collect = readFileSync(trackedTier2CollectPath);
const trackedTier2Compare = readFileSync(trackedTier2ComparePath);
const trackedToolCheck = readFileSync(trackedToolCheckPath);
const trackedDependencyDrift = readFileSync(trackedDependencyDriftPath);
const trackedForemanSetup = readFileSync(trackedForemanSetupPath);
const trackedRepoHygiene = readFileSync(trackedRepoHygienePath);
const trackedSecretScan = readFileSync(trackedSecretScanPath);
const trackedCredentialProfile = readFileSync(trackedCredentialProfilePath);
const trackedCredentialProfileLane = readFileSync(
  trackedCredentialProfileLanePath,
);
const trackedGraphStore = readFileSync(trackedGraphStorePath);
const trackedForemanLaunch = readFileSync(trackedForemanLaunchPath);
const trackedReleaseAdmission = readFileSync(trackedReleaseAdmissionPath);
const trackedReleaseAuthority = readFileSync(trackedReleaseAuthorityPath);
const trackedReleaseCoverage = readFileSync(trackedReleaseCoveragePath);
const trackedReleasePolicy = readFileSync(trackedReleasePolicyPath);

// No extra files under dist/
{
  const distFiles = readdirSync(join(trackedRuntime, "dist")).sort();
  const expected = [
    "appliance-doctor.js",
    "architecture-policy.js",
    "credential-profile-lane.js",
    "credential-profile.js",
    "dependency-drift.js",
    "destruction-guard.js",
    "execution-guard.js",
    "fm-session.js",
    "foreman-launch.js",
    "foreman-setup.js",
    "graph-store.js",
    "graphify-qualification.js",
    "lane-queue.js",
    "lane-round.js",
    "lane-supervise.js",
    "release-admission.js",
    "release-authority.js",
    "release-coverage.js",
    "release-policy.js",
    "repo-hygiene.js",
    "secret-scan.js",
    "tier2-collect.js",
    "tier2-compare.js",
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
  const aApplianceDoctor = readFileSync(
    join(tmpA, "dist/appliance-doctor.js"),
  );
  const bApplianceDoctor = readFileSync(
    join(tmpB, "dist/appliance-doctor.js"),
  );
  const aGraphifyQualification = readFileSync(
    join(tmpA, "dist/graphify-qualification.js"),
  );
  const bGraphifyQualification = readFileSync(
    join(tmpB, "dist/graphify-qualification.js"),
  );
  const aPolicy = readFileSync(join(tmpA, "dist/architecture-policy.js"));
  const bPolicy = readFileSync(join(tmpB, "dist/architecture-policy.js"));
  const aEndstop = readFileSync(join(tmpA, "dist/execution-guard.js"));
  const bEndstop = readFileSync(join(tmpB, "dist/execution-guard.js"));
  const aQueue = readFileSync(join(tmpA, "dist/lane-queue.js"));
  const bQueue = readFileSync(join(tmpB, "dist/lane-queue.js"));
  const aRound = readFileSync(join(tmpA, "dist/lane-round.js"));
  const bRound = readFileSync(join(tmpB, "dist/lane-round.js"));
  const aSupervise = readFileSync(join(tmpA, "dist/lane-supervise.js"));
  const bSupervise = readFileSync(join(tmpB, "dist/lane-supervise.js"));
  const aPreflight = readFileSync(join(tmpA, "dist/vendor-preflight.js"));
  const bPreflight = readFileSync(join(tmpB, "dist/vendor-preflight.js"));
  const aFmSession = readFileSync(join(tmpA, "dist/fm-session.js"));
  const bFmSession = readFileSync(join(tmpB, "dist/fm-session.js"));
  const aTier2Collect = readFileSync(join(tmpA, "dist/tier2-collect.js"));
  const bTier2Collect = readFileSync(join(tmpB, "dist/tier2-collect.js"));
  const aTier2Compare = readFileSync(join(tmpA, "dist/tier2-compare.js"));
  const bTier2Compare = readFileSync(join(tmpB, "dist/tier2-compare.js"));
  const aToolCheck = readFileSync(join(tmpA, "dist/tool-check.js"));
  const bToolCheck = readFileSync(join(tmpB, "dist/tool-check.js"));
  const aDependencyDrift = readFileSync(join(tmpA, "dist/dependency-drift.js"));
  const bDependencyDrift = readFileSync(join(tmpB, "dist/dependency-drift.js"));
  const aForemanSetup = readFileSync(join(tmpA, "dist/foreman-setup.js"));
  const bForemanSetup = readFileSync(join(tmpB, "dist/foreman-setup.js"));
  const aSecretScan = readFileSync(join(tmpA, "dist/secret-scan.js"));
  const bSecretScan = readFileSync(join(tmpB, "dist/secret-scan.js"));
  const aCredentialProfile = readFileSync(
    join(tmpA, "dist/credential-profile.js"),
  );
  const bCredentialProfile = readFileSync(
    join(tmpB, "dist/credential-profile.js"),
  );
  const aCredentialProfileLane = readFileSync(
    join(tmpA, "dist/credential-profile-lane.js"),
  );
  const bCredentialProfileLane = readFileSync(
    join(tmpB, "dist/credential-profile-lane.js"),
  );
  const aGraphStore = readFileSync(join(tmpA, "dist/graph-store.js"));
  const bGraphStore = readFileSync(join(tmpB, "dist/graph-store.js"));
  const aForemanLaunch = readFileSync(join(tmpA, "dist/foreman-launch.js"));
  const bForemanLaunch = readFileSync(join(tmpB, "dist/foreman-launch.js"));
  const aReleaseAdmission = readFileSync(
    join(tmpA, "dist/release-admission.js"),
  );
  const bReleaseAdmission = readFileSync(
    join(tmpB, "dist/release-admission.js"),
  );
  const aReleaseAuthority = readFileSync(
    join(tmpA, "dist/release-authority.js"),
  );
  const bReleaseAuthority = readFileSync(
    join(tmpB, "dist/release-authority.js"),
  );
  const aReleaseCoverage = readFileSync(
    join(tmpA, "dist/release-coverage.js"),
  );
  const bReleaseCoverage = readFileSync(
    join(tmpB, "dist/release-coverage.js"),
  );
  const aReleasePolicy = readFileSync(join(tmpA, "dist/release-policy.js"));
  const bReleasePolicy = readFileSync(join(tmpB, "dist/release-policy.js"));
  if (!bytesEqual(aApplianceDoctor, bApplianceDoctor)) {
    fail("non-deterministic appliance-doctor");
  }
  if (!bytesEqual(aGraphifyQualification, bGraphifyQualification)) {
    fail("non-deterministic graphify-qualification");
  }
  if (!bytesEqual(aGuard, bGuard)) fail("non-deterministic destruction-guard");
  if (!bytesEqual(aPolicy, bPolicy)) fail("non-deterministic architecture-policy");
  if (!bytesEqual(aEndstop, bEndstop)) fail("non-deterministic execution-guard");
  if (!bytesEqual(aQueue, bQueue)) fail("non-deterministic lane-queue");
  if (!bytesEqual(aRound, bRound)) fail("non-deterministic lane-round");
  if (!bytesEqual(aSupervise, bSupervise)) fail("non-deterministic lane-supervise");
  if (!bytesEqual(aPreflight, bPreflight)) {
    fail("non-deterministic vendor-preflight");
  }
  if (!bytesEqual(aFmSession, bFmSession)) fail("non-deterministic fm-session");
  if (!bytesEqual(aTier2Collect, bTier2Collect))
    fail("non-deterministic tier2-collect");
  if (!bytesEqual(aTier2Compare, bTier2Compare))
    fail("non-deterministic tier2-compare");
  if (!bytesEqual(aToolCheck, bToolCheck)) {
    fail("non-deterministic tool-check");
  }
  if (!bytesEqual(aDependencyDrift, bDependencyDrift)) {
    fail("non-deterministic dependency-drift");
  }
  if (!bytesEqual(aForemanSetup, bForemanSetup)) {
    fail("non-deterministic foreman-setup");
  }
  if (!bytesEqual(aSecretScan, bSecretScan)) {
    fail("non-deterministic secret-scan");
  }
  if (!bytesEqual(aCredentialProfile, bCredentialProfile)) {
    fail("non-deterministic credential-profile");
  }
  if (!bytesEqual(aCredentialProfileLane, bCredentialProfileLane)) {
    fail("non-deterministic credential-profile-lane");
  }
  if (!bytesEqual(aGraphStore, bGraphStore)) {
    fail("non-deterministic graph-store");
  }
  if (!bytesEqual(aForemanLaunch, bForemanLaunch)) {
    fail("non-deterministic foreman-launch");
  }
  if (!bytesEqual(aReleaseAdmission, bReleaseAdmission)) {
    fail("non-deterministic release-admission");
  }
  if (!bytesEqual(aReleaseAuthority, bReleaseAuthority)) {
    fail("non-deterministic release-authority");
  }
  if (!bytesEqual(aReleaseCoverage, bReleaseCoverage)) {
    fail("non-deterministic release-coverage");
  }
  if (!bytesEqual(aReleasePolicy, bReleasePolicy)) {
    fail("non-deterministic release-policy");
  }
  if (!bytesEqual(aApplianceDoctor, trackedApplianceDoctor)) {
    fail("appliance-doctor drift");
  }
  if (!bytesEqual(aGraphifyQualification, trackedGraphifyQualification)) {
    fail("graphify-qualification drift");
  }
  if (!bytesEqual(aGuard, trackedGuard)) fail("destruction-guard drift");
  if (!bytesEqual(aPolicy, trackedPolicy)) fail("architecture-policy drift");
  if (!bytesEqual(aEndstop, trackedEndstop)) fail("execution-guard drift");
  if (!bytesEqual(aQueue, trackedQueue)) fail("lane-queue drift");
  if (!bytesEqual(aRound, trackedRound)) fail("lane-round drift");
  if (!bytesEqual(aSupervise, trackedSupervise)) fail("lane-supervise drift");
  if (!bytesEqual(aPreflight, trackedPreflight)) fail("vendor-preflight drift");
  if (!bytesEqual(aFmSession, trackedFmSession)) fail("fm-session drift");
  if (!bytesEqual(aToolCheck, trackedToolCheck)) fail("tool-check drift");
  if (!bytesEqual(aDependencyDrift, trackedDependencyDrift)) {
    fail("dependency-drift drift");
  }
  if (!bytesEqual(aForemanSetup, trackedForemanSetup)) {
    fail("foreman-setup drift");
  }
  if (!bytesEqual(aSecretScan, trackedSecretScan)) {
    fail("secret-scan drift");
  }
  if (!bytesEqual(aCredentialProfile, trackedCredentialProfile)) {
    fail("credential-profile drift");
  }
  if (!bytesEqual(aCredentialProfileLane, trackedCredentialProfileLane)) {
    fail("credential-profile-lane drift");
  }
  if (!bytesEqual(aGraphStore, trackedGraphStore)) {
    fail("graph-store drift");
  }
  if (!bytesEqual(aForemanLaunch, trackedForemanLaunch)) {
    fail("foreman-launch drift");
  }
  if (!bytesEqual(aReleaseAdmission, trackedReleaseAdmission)) {
    fail("release-admission drift");
  }
  if (!bytesEqual(aReleaseAuthority, trackedReleaseAuthority)) {
    fail("release-authority drift");
  }
  if (!bytesEqual(aReleaseCoverage, trackedReleaseCoverage)) {
    fail("release-coverage drift");
  }
  if (!bytesEqual(aReleasePolicy, trackedReleasePolicy)) {
    fail("release-policy drift");
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
    writeFileSync(
      join(rt, "dist/appliance-doctor.js"),
      trackedApplianceDoctor,
    );
    writeFileSync(
      join(rt, "dist/graphify-qualification.js"),
      trackedGraphifyQualification,
    );
    writeFileSync(join(rt, "dist/architecture-policy.js"), trackedPolicy);
    writeFileSync(join(rt, "dist/execution-guard.js"), trackedEndstop);
    writeFileSync(join(rt, "dist/lane-queue.js"), trackedQueue);
    writeFileSync(join(rt, "dist/lane-round.js"), trackedRound);
    writeFileSync(join(rt, "dist/lane-supervise.js"), trackedSupervise);
    writeFileSync(join(rt, "dist/vendor-preflight.js"), trackedPreflight);
    writeFileSync(join(rt, "dist/fm-session.js"), trackedFmSession);
    writeFileSync(join(rt, "dist/tier2-collect.js"), trackedTier2Collect);
    writeFileSync(join(rt, "dist/tier2-compare.js"), trackedTier2Compare);
    writeFileSync(join(rt, "dist/tool-check.js"), trackedToolCheck);
    writeFileSync(join(rt, "dist/dependency-drift.js"), trackedDependencyDrift);
    writeFileSync(join(rt, "dist/foreman-setup.js"), trackedForemanSetup);
    writeFileSync(join(rt, "dist/repo-hygiene.js"), trackedRepoHygiene);
    writeFileSync(join(rt, "dist/secret-scan.js"), trackedSecretScan);
    writeFileSync(join(rt, "dist/credential-profile.js"), trackedCredentialProfile);
    writeFileSync(
      join(rt, "dist/credential-profile-lane.js"),
      trackedCredentialProfileLane,
    );
    writeFileSync(join(rt, "dist/graph-store.js"), trackedGraphStore);
    writeFileSync(join(rt, "dist/foreman-launch.js"), trackedForemanLaunch);
    writeFileSync(
      join(rt, "dist/release-admission.js"),
      trackedReleaseAdmission,
    );
    writeFileSync(
      join(rt, "dist/release-authority.js"),
      trackedReleaseAuthority,
    );
    writeFileSync(
      join(rt, "dist/release-coverage.js"),
      trackedReleaseCoverage,
    );
    writeFileSync(join(rt, "dist/release-policy.js"), trackedReleasePolicy);
    if (verifyRuntimeManifest(rt).ok) fail("tampered guard should fail");
    cpSync(trackedGuardPath, join(rt, "dist/destruction-guard.js"));
    writeFileSync(join(rt, "dist/appliance-doctor.js"), "TAMPER");
    if (verifyRuntimeManifest(rt).ok) {
      fail("tampered appliance-doctor should fail");
    }
    cpSync(
      trackedApplianceDoctorPath,
      join(rt, "dist/appliance-doctor.js"),
    );
    writeFileSync(join(rt, "dist/architecture-policy.js"), "TAMPER");
    if (verifyRuntimeManifest(rt).ok) fail("tampered policy should fail");
    cpSync(trackedPolicyPath, join(rt, "dist/architecture-policy.js"));
    writeFileSync(join(rt, "dist/execution-guard.js"), "TAMPER");
    if (verifyRuntimeManifest(rt).ok) fail("tampered execution-guard should fail");
    cpSync(trackedEndstopPath, join(rt, "dist/execution-guard.js"));
    writeFileSync(join(rt, "dist/lane-queue.js"), "TAMPER");
    if (verifyRuntimeManifest(rt).ok) fail("tampered lane-queue should fail");
    cpSync(trackedQueuePath, join(rt, "dist/lane-queue.js"));
    writeFileSync(join(rt, "dist/lane-round.js"), "TAMPER");
    if (verifyRuntimeManifest(rt).ok) fail("tampered lane-round should fail");
    cpSync(trackedRoundPath, join(rt, "dist/lane-round.js"));
    writeFileSync(join(rt, "dist/lane-supervise.js"), "TAMPER");
    if (verifyRuntimeManifest(rt).ok) fail("tampered lane-supervise should fail");
    cpSync(trackedSupervisePath, join(rt, "dist/lane-supervise.js"));
    writeFileSync(join(rt, "dist/vendor-preflight.js"), "TAMPER");
    if (verifyRuntimeManifest(rt).ok) fail("tampered vendor-preflight should fail");
    cpSync(trackedPreflightPath, join(rt, "dist/vendor-preflight.js"));
    writeFileSync(join(rt, "dist/tool-check.js"), "TAMPER");
    if (verifyRuntimeManifest(rt).ok) fail("tampered tool-check should fail");
    writeFileSync(join(rt, "dist/fm-session.js"), "TAMPER");
    if (verifyRuntimeManifest(rt).ok) fail("tampered fm-session should fail");
    cpSync(trackedFmSessionPath, join(rt, "dist/fm-session.js"));
    cpSync(trackedTier2CollectPath, join(rt, "dist/tier2-collect.js"));
    cpSync(trackedTier2ComparePath, join(rt, "dist/tier2-compare.js"));
    cpSync(trackedToolCheckPath, join(rt, "dist/tool-check.js"));
    writeFileSync(join(rt, "dist/dependency-drift.js"), "TAMPER");
    if (verifyRuntimeManifest(rt).ok) fail("tampered dependency-drift should fail");
    cpSync(trackedDependencyDriftPath, join(rt, "dist/dependency-drift.js"));
    writeFileSync(join(rt, "dist/foreman-setup.js"), "TAMPER");
    if (verifyRuntimeManifest(rt).ok) fail("tampered foreman-setup should fail");
    cpSync(trackedForemanSetupPath, join(rt, "dist/foreman-setup.js"));
    writeFileSync(join(rt, "dist/repo-hygiene.js"), "TAMPER");
    if (verifyRuntimeManifest(rt).ok) fail("tampered repo-hygiene should fail");
    cpSync(trackedRepoHygienePath, join(rt, "dist/repo-hygiene.js"));
    writeFileSync(join(rt, "dist/secret-scan.js"), "TAMPER");
    if (verifyRuntimeManifest(rt).ok) fail("tampered secret-scan should fail");
    cpSync(trackedSecretScanPath, join(rt, "dist/secret-scan.js"));
    writeFileSync(join(rt, "dist/credential-profile.js"), "TAMPER");
    if (verifyRuntimeManifest(rt).ok) fail("tampered credential-profile should fail");
    cpSync(trackedCredentialProfilePath, join(rt, "dist/credential-profile.js"));
    writeFileSync(join(rt, "dist/credential-profile-lane.js"), "TAMPER");
    if (verifyRuntimeManifest(rt).ok) {
      fail("tampered credential-profile-lane should fail");
    }
    cpSync(
      trackedCredentialProfileLanePath,
      join(rt, "dist/credential-profile-lane.js"),
    );
    writeFileSync(join(rt, "dist/graph-store.js"), "TAMPER");
    if (verifyRuntimeManifest(rt).ok) {
      fail("tampered graph-store should fail");
    }
    cpSync(trackedGraphStorePath, join(rt, "dist/graph-store.js"));
    writeFileSync(join(rt, "dist/foreman-launch.js"), "TAMPER");
    if (verifyRuntimeManifest(rt).ok) {
      fail("tampered foreman-launch should fail");
    }
    cpSync(trackedForemanLaunchPath, join(rt, "dist/foreman-launch.js"));
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
    // Linked lane-supervise bundle must fail
    {
      const realSupervise = join(rt, "lane-supervise.real.js");
      writeFileSync(realSupervise, trackedSupervise);
      rmSync(join(rt, "dist/lane-supervise.js"));
      symlinkSync(realSupervise, join(rt, "dist/lane-supervise.js"));
      const linkedSupervise = verifyRuntimeManifest(rt);
      if (linkedSupervise.ok) fail("linked lane-supervise should fail");
      rmSync(join(rt, "dist/lane-supervise.js"));
      writeFileSync(join(rt, "dist/lane-supervise.js"), trackedSupervise);
    }
    // Missing lane-supervise must fail
    {
      rmSync(join(rt, "dist/lane-supervise.js"));
      const missSupervise = verifyRuntimeManifest(rt);
      if (missSupervise.ok || missSupervise.reason !== "bundle_missing") {
        fail(
          "expected bundle_missing for lane-supervise got " +
            JSON.stringify(missSupervise),
        );
      }
      writeFileSync(join(rt, "dist/lane-supervise.js"), trackedSupervise);
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
    // Linked fm-session bundle must fail
    {
      const realFm = join(rt, "fm-session.real.js");
      writeFileSync(realFm, trackedFmSession);
      rmSync(join(rt, "dist/fm-session.js"));
      symlinkSync(realFm, join(rt, "dist/fm-session.js"));
      const linkedFm = verifyRuntimeManifest(rt);
      if (linkedFm.ok) fail("linked fm-session should fail");
      rmSync(join(rt, "dist/fm-session.js"));
      writeFileSync(join(rt, "dist/fm-session.js"), trackedFmSession);
      writeFileSync(join(rt, "dist/tier2-collect.js"), trackedTier2Collect);
      writeFileSync(join(rt, "dist/tier2-compare.js"), trackedTier2Compare);
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
      writeFileSync(join(rt, "dist/fm-session.js"), trackedFmSession);
      writeFileSync(join(rt, "dist/tier2-collect.js"), trackedTier2Collect);
      writeFileSync(join(rt, "dist/tier2-compare.js"), trackedTier2Compare);
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
    // Missing fm-session must fail
    {
      rmSync(join(rt, "dist/fm-session.js"));
      const missFm = verifyRuntimeManifest(rt);
      if (missFm.ok || missFm.reason !== "bundle_missing") {
        fail("expected bundle_missing for fm-session got " + JSON.stringify(missFm));
      }
      writeFileSync(join(rt, "dist/fm-session.js"), trackedFmSession);
      writeFileSync(join(rt, "dist/tier2-collect.js"), trackedTier2Collect);
      writeFileSync(join(rt, "dist/tier2-compare.js"), trackedTier2Compare);
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
      writeFileSync(join(rt, "dist/fm-session.js"), trackedFmSession);
      writeFileSync(join(rt, "dist/tier2-collect.js"), trackedTier2Collect);
      writeFileSync(join(rt, "dist/tier2-compare.js"), trackedTier2Compare);
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
    // Missing foreman-setup must fail
    {
      rmSync(join(rt, "dist/foreman-setup.js"));
      const missSetup = verifyRuntimeManifest(rt);
      if (missSetup.ok || missSetup.reason !== "bundle_missing") {
        fail(
          "expected bundle_missing for foreman-setup got " +
            JSON.stringify(missSetup),
        );
      }
      writeFileSync(join(rt, "dist/foreman-setup.js"), trackedForemanSetup);
    }
    // Linked foreman-setup bundle must fail
    {
      const realSetup = join(rt, "foreman-setup.real.js");
      writeFileSync(realSetup, trackedForemanSetup);
      rmSync(join(rt, "dist/foreman-setup.js"));
      symlinkSync(realSetup, join(rt, "dist/foreman-setup.js"));
      const linkedSetup = verifyRuntimeManifest(rt);
      if (linkedSetup.ok) fail("linked foreman-setup should fail");
      rmSync(join(rt, "dist/foreman-setup.js"));
      writeFileSync(join(rt, "dist/foreman-setup.js"), trackedForemanSetup);
    }
    // Linked secret-scan bundle must fail
    {
      const realSecret = join(rt, "secret-scan.real.js");
      writeFileSync(realSecret, trackedSecretScan);
      rmSync(join(rt, "dist/secret-scan.js"));
      symlinkSync(realSecret, join(rt, "dist/secret-scan.js"));
      const linkedSecret = verifyRuntimeManifest(rt);
      if (linkedSecret.ok) fail("linked secret-scan should fail");
      rmSync(join(rt, "dist/secret-scan.js"));
      writeFileSync(join(rt, "dist/repo-hygiene.js"), trackedRepoHygiene);
    writeFileSync(join(rt, "dist/secret-scan.js"), trackedSecretScan);
    }
    // Missing secret-scan must fail
    {
      rmSync(join(rt, "dist/secret-scan.js"));
      const missSecret = verifyRuntimeManifest(rt);
      if (missSecret.ok || missSecret.reason !== "bundle_missing") {
        fail(
          "expected bundle_missing for secret-scan got " +
            JSON.stringify(missSecret),
        );
      }
      writeFileSync(join(rt, "dist/repo-hygiene.js"), trackedRepoHygiene);
    writeFileSync(join(rt, "dist/secret-scan.js"), trackedSecretScan);
    }
    // Linked credential-profile bundle must fail
    {
      const realCp = join(rt, "credential-profile.real.js");
      writeFileSync(realCp, trackedCredentialProfile);
      rmSync(join(rt, "dist/credential-profile.js"));
      symlinkSync(realCp, join(rt, "dist/credential-profile.js"));
      const linkedCp = verifyRuntimeManifest(rt);
      if (linkedCp.ok) fail("linked credential-profile should fail");
      rmSync(join(rt, "dist/credential-profile.js"));
      writeFileSync(join(rt, "dist/credential-profile.js"), trackedCredentialProfile);
    }
    // Missing credential-profile must fail
    {
      rmSync(join(rt, "dist/credential-profile.js"));
      const missCp = verifyRuntimeManifest(rt);
      if (missCp.ok || missCp.reason !== "bundle_missing") {
        fail(
          "expected bundle_missing for credential-profile got " +
            JSON.stringify(missCp),
        );
      }
      writeFileSync(join(rt, "dist/credential-profile.js"), trackedCredentialProfile);
    }
    // Linked credential-profile-lane bundle must fail
    {
      const realLane = join(rt, "credential-profile-lane.real.js");
      writeFileSync(realLane, trackedCredentialProfileLane);
      rmSync(join(rt, "dist/credential-profile-lane.js"));
      symlinkSync(realLane, join(rt, "dist/credential-profile-lane.js"));
      const linkedLane = verifyRuntimeManifest(rt);
      if (linkedLane.ok) fail("linked credential-profile-lane should fail");
      rmSync(join(rt, "dist/credential-profile-lane.js"));
      writeFileSync(
        join(rt, "dist/credential-profile-lane.js"),
        trackedCredentialProfileLane,
      );
    }
    // Missing credential-profile-lane must fail
    {
      rmSync(join(rt, "dist/credential-profile-lane.js"));
      const missLane = verifyRuntimeManifest(rt);
      if (missLane.ok || missLane.reason !== "bundle_missing") {
        fail(
          "expected bundle_missing for credential-profile-lane got " +
            JSON.stringify(missLane),
        );
      }
      writeFileSync(
        join(rt, "dist/credential-profile-lane.js"),
        trackedCredentialProfileLane,
      );
    }
    // Linked graph-store bundle must fail
    {
      const realGs = join(rt, "graph-store.real.js");
      writeFileSync(realGs, trackedGraphStore);
      rmSync(join(rt, "dist/graph-store.js"));
      symlinkSync(realGs, join(rt, "dist/graph-store.js"));
      const linkedGs = verifyRuntimeManifest(rt);
      if (linkedGs.ok) fail("linked graph-store should fail");
      rmSync(join(rt, "dist/graph-store.js"));
      writeFileSync(join(rt, "dist/graph-store.js"), trackedGraphStore);
    }
    // Missing graph-store must fail
    {
      rmSync(join(rt, "dist/graph-store.js"));
      const missGs = verifyRuntimeManifest(rt);
      if (missGs.ok || missGs.reason !== "bundle_missing") {
        fail(
          "expected bundle_missing for graph-store got " +
            JSON.stringify(missGs),
        );
      }
      writeFileSync(join(rt, "dist/graph-store.js"), trackedGraphStore);
    }
    // Linked foreman-launch bundle must fail
    {
      const realFl = join(rt, "foreman-launch.real.js");
      writeFileSync(realFl, trackedForemanLaunch);
      rmSync(join(rt, "dist/foreman-launch.js"));
      symlinkSync(realFl, join(rt, "dist/foreman-launch.js"));
      const linkedFl = verifyRuntimeManifest(rt);
      if (linkedFl.ok) fail("linked foreman-launch should fail");
      rmSync(join(rt, "dist/foreman-launch.js"));
      writeFileSync(join(rt, "dist/foreman-launch.js"), trackedForemanLaunch);
    }
    // Missing foreman-launch must fail
    {
      rmSync(join(rt, "dist/foreman-launch.js"));
      const missFl = verifyRuntimeManifest(rt);
      if (missFl.ok || missFl.reason !== "bundle_missing") {
        fail(
          "expected bundle_missing for foreman-launch got " +
            JSON.stringify(missFl),
        );
      }
      writeFileSync(join(rt, "dist/foreman-launch.js"), trackedForemanLaunch);
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
            id: "credential-profile",
            relativePath: "dist/credential-profile.js",
            sha256: "k".repeat(64),
          },
          {
            byteLength: 1,
            id: "credential-profile-lane",
            relativePath: "dist/credential-profile-lane.js",
            sha256: "l".repeat(64),
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
            id: "execution-guard",
            relativePath: "dist/execution-guard.js",
            sha256: "m".repeat(64),
          },
          {
            byteLength: 1,
            id: "fm-session",
            relativePath: "dist/fm-session.js",
            sha256: "x".repeat(64),
          },
          {
            byteLength: 1,
            id: "foreman-launch",
            relativePath: "dist/foreman-launch.js",
            sha256: "o".repeat(64),
          },
          {
            byteLength: 1,
            id: "foreman-setup",
            relativePath: "dist/foreman-setup.js",
            sha256: "h".repeat(64),
          },
          {
            byteLength: 1,
            id: "graph-store",
            relativePath: "dist/graph-store.js",
            sha256: "n".repeat(64),
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
            id: "lane-supervise",
            relativePath: "dist/lane-supervise.js",
            sha256: "i".repeat(64),
          },
          {
            byteLength: 1,
            id: "secret-scan",
            relativePath: "dist/secret-scan.js",
            sha256: "j".repeat(64),
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

  // Copied foreman-launch without repository node_modules
  const launchBundle = join(copiedRuntime, "dist/foreman-launch.js");
  const fl = spawnSync(
    process.execPath,
    [launchBundle, "--version"],
    {
      cwd: emptyCwd,
      encoding: "utf8",
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
      },
    },
  );
  if (fl.status !== 0) {
    fail(`copied foreman-launch exit ${fl.status}: ${fl.stdout} ${fl.stderr}`);
  }
  if (!(fl.stdout || "").includes("foreman-launch") || !(fl.stdout || "").includes("node ")) {
    fail("copied foreman-launch version: " + fl.stdout);
  }
  if ((fl.stdout || "").includes("bun")) {
    fail("copied foreman-launch must not name bun");
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

process.stdout.write("verify-runtime: ok\n");
