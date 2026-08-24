/**
 * Copied-tree runtime manifest verifier negative controls.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, it } from "node:test";
import { verifyRuntimeManifest } from "./verify-runtime-manifest.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const trackedRuntime = join(root, "skills/foreman/runtime");
const trackedManifest = join(trackedRuntime, "manifest.json");
const trackedPolicy = join(trackedRuntime, "dist/architecture-policy.js");
const tsxLoader = pathToFileURL(
  createRequire(import.meta.url).resolve("tsx"),
).href;

function seedCleanCopy(): string {
  const dir = mkdtempSync(join(tmpdir(), "foreman-vrm-"));
  const rt = join(dir, "runtime");
  mkdirSync(join(rt, "dist"), { recursive: true });
  const manifestBytes = readFileSync(trackedManifest);
  writeFileSync(join(rt, "manifest.json"), manifestBytes);
  const manifest = JSON.parse(manifestBytes.toString("utf8")) as {
    readonly artifacts: ReadonlyArray<{ readonly relativePath: string }>;
  };
  for (const artifact of manifest.artifacts) {
    const destination = join(rt, artifact.relativePath);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(join(trackedRuntime, artifact.relativePath), destination);
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
    for (const path of [
      "dist/release-coverage.js",
      "dist/release-admission.js",
      "dist/release-authority.js",
      "dist/release-policy.js",
      "dist/graphify-qualification.js",
    ]) {
      assert.equal(
        manifest.artifacts.some((artifact) => artifact.relativePath === path),
        true,
        path,
      );
    }
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

  it("runs every copied v0.4 release entry point byte-for-byte like source", () => {
    const rt = seedCleanCopy();
    try {
      for (const [artifact, source] of [
        ["release-coverage.js", "packages/orchestration/src/release-coverage-main.ts"],
        ["release-admission.js", "packages/policy/src/release-admission-main.ts"],
        ["release-authority.js", "packages/orchestration/src/release-authority-main.ts"],
        ["release-policy.js", "packages/orchestration/src/release-policy-main.ts"],
        ["graphify-qualification.js", "packages/orchestration/src/graphify-qualification-main.ts"],
      ] as const) {
        const expected = spawnSync(
          process.execPath,
          ["--import", tsxLoader, join(root, source)],
          { cwd: root, encoding: "utf8", timeout: 30_000 },
        );
        const installed = spawnSync(
          process.execPath,
          [join(rt, "dist", artifact)],
          { cwd: dirname(rt), encoding: "utf8", timeout: 30_000 },
        );
        assert.equal(expected.error, undefined, source);
        assert.equal(installed.error, undefined, artifact);
        assert.equal(installed.status, expected.status, artifact);
        assert.equal(installed.stdout, expected.stdout, artifact);
        assert.equal(installed.stderr, expected.stderr, artifact);
      }
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
