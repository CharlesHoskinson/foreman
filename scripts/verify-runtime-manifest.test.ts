/**
 * Copied-tree runtime manifest verifier negative controls.
 */
import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
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
import { verifyRuntimeManifest } from "./verify-runtime-manifest.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const trackedRuntime = join(root, "skills/foreman/runtime");
const trackedManifest = join(trackedRuntime, "manifest.json");
const trackedGuard = join(trackedRuntime, "dist/destruction-guard.js");
const trackedPolicy = join(trackedRuntime, "dist/architecture-policy.js");
const trackedEndstop = join(trackedRuntime, "dist/execution-guard.js");
const trackedQueue = join(trackedRuntime, "dist/lane-queue.js");
const trackedRound = join(trackedRuntime, "dist/lane-round.js");
const trackedSupervise = join(trackedRuntime, "dist/lane-supervise.js");
const trackedPreflight = join(trackedRuntime, "dist/vendor-preflight.js");
const trackedToolCheck = join(trackedRuntime, "dist/tool-check.js");
const trackedTier2Collect = join(trackedRuntime, "dist/tier2-collect.js");
const trackedTier2Compare = join(trackedRuntime, "dist/tier2-compare.js");
const trackedDependencyDrift = join(
  trackedRuntime,
  "dist/dependency-drift.js",
);
const trackedForemanSetup = join(trackedRuntime, "dist/foreman-setup.js");
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
const trackedFmSession = join(trackedRuntime, "dist/fm-session.js");

function seedCleanCopy(): string {
  const dir = mkdtempSync(join(tmpdir(), "foreman-vrm-"));
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
  cpSync(trackedDependencyDrift, join(rt, "dist/dependency-drift.js"));
  cpSync(trackedForemanSetup, join(rt, "dist/foreman-setup.js"));
  cpSync(trackedRepoHygiene, join(rt, "dist/repo-hygiene.js"));
  cpSync(trackedSecretScan, join(rt, "dist/secret-scan.js"));
  cpSync(trackedCredentialProfile, join(rt, "dist/credential-profile.js"));
  cpSync(
    trackedCredentialProfileLane,
    join(rt, "dist/credential-profile-lane.js"),
  );
  if (existsSync(trackedGraphStore)) {
    cpSync(trackedGraphStore, join(rt, "dist/graph-store.js"));
  }
  if (existsSync(trackedForemanLaunch)) {
    cpSync(trackedForemanLaunch, join(rt, "dist/foreman-launch.js"));
  }
  if (existsSync(trackedFmSession)) {
    cpSync(trackedFmSession, join(rt, "dist/fm-session.js"));
  }
  if (existsSync(trackedTier2Collect)) {
    cpSync(trackedTier2Collect, join(rt, "dist/tier2-collect.js"));
  }
  if (existsSync(trackedTier2Compare)) {
    cpSync(trackedTier2Compare, join(rt, "dist/tier2-compare.js"));
  }
  return rt;
}

describe("verifyRuntimeManifest copied-tree negatives", () => {
  it("tracks the profile-bound lane admission runtime", () => {
    const manifest = JSON.parse(readFileSync(trackedManifest, "utf8")) as {
      readonly artifacts: ReadonlyArray<{ readonly relativePath: string }>;
    };
    assert.equal(
      manifest.artifacts.some(
        (artifact) =>
          artifact.relativePath === "dist/credential-profile-lane.js",
      ),
      true,
    );
  });

  it("accepts a clean exact copy", () => {
    const rt = seedCleanCopy();
    try {
      const r = verifyRuntimeManifest(rt);
      assert.equal(r.ok, true, JSON.stringify(r));
    } finally {
      rmSync(dirname(rt), { recursive: true, force: true });
    }
  });

  it("rejects missing bundle", () => {
    const rt = seedCleanCopy();
    try {
      rmSync(join(rt, "dist/architecture-policy.js"));
      const r = verifyRuntimeManifest(rt);
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.reason, "bundle_missing");
    } finally {
      rmSync(dirname(rt), { recursive: true, force: true });
    }
  });

  it("rejects tampered bundle", () => {
    const rt = seedCleanCopy();
    try {
      writeFileSync(join(rt, "dist/architecture-policy.js"), "TAMPER");
      const r = verifyRuntimeManifest(rt);
      assert.equal(r.ok, false);
    } finally {
      rmSync(dirname(rt), { recursive: true, force: true });
    }
  });

  it("rejects extra undeclared bundle file", () => {
    const rt = seedCleanCopy();
    try {
      writeFileSync(join(rt, "dist/extra.js"), "export {}\n");
      const r = verifyRuntimeManifest(rt);
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.reason, "dist_extra_entry");
    } finally {
      rmSync(dirname(rt), { recursive: true, force: true });
    }
  });

  it("rejects bundle symlink", () => {
    const rt = seedCleanCopy();
    try {
      rmSync(join(rt, "dist/architecture-policy.js"));
      symlinkSync(trackedPolicy, join(rt, "dist/architecture-policy.js"));
      const r = verifyRuntimeManifest(rt);
      assert.equal(r.ok, false);
      if (!r.ok) {
        assert.ok(
          r.reason === "bundle_linked" || r.reason === "dist_entry_linked",
        );
      }
    } finally {
      rmSync(dirname(rt), { recursive: true, force: true });
    }
  });

  it("rejects manifest symlink even to same bytes", () => {
    const rt = seedCleanCopy();
    try {
      const real = join(rt, "manifest.real.json");
      const bytes = readFileSync(join(rt, "manifest.json"));
      writeFileSync(real, bytes);
      rmSync(join(rt, "manifest.json"));
      symlinkSync(real, join(rt, "manifest.json"));
      const r = verifyRuntimeManifest(rt);
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.reason, "manifest_linked");
    } finally {
      rmSync(dirname(rt), { recursive: true, force: true });
    }
  });

  it("rejects unexpected directory under dist", () => {
    const rt = seedCleanCopy();
    try {
      mkdirSync(join(rt, "dist/nested"), { recursive: true });
      writeFileSync(join(rt, "dist/nested/x.js"), "1\n");
      const r = verifyRuntimeManifest(rt);
      assert.equal(r.ok, false);
      if (!r.ok) {
        assert.ok(
          r.reason === "dist_unexpected_directory" ||
            r.reason === "dist_extra_entry",
        );
      }
    } finally {
      rmSync(dirname(rt), { recursive: true, force: true });
    }
  });

  it("rejects unexpected non-bundle file under dist", () => {
    const rt = seedCleanCopy();
    try {
      writeFileSync(join(rt, "dist/README.txt"), "no\n");
      const r = verifyRuntimeManifest(rt);
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.reason, "dist_extra_entry");
    } finally {
      rmSync(dirname(rt), { recursive: true, force: true });
    }
  });
});
