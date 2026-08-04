/**
 * Copied-tree runtime manifest verifier negative controls.
 */
import assert from "node:assert/strict";
import {
  cpSync,
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
const trackedQueue = join(trackedRuntime, "dist/lane-queue.js");
const trackedRound = join(trackedRuntime, "dist/lane-round.js");
const trackedPreflight = join(trackedRuntime, "dist/vendor-preflight.js");
const trackedToolCheck = join(trackedRuntime, "dist/tool-check.js");

function seedCleanCopy(): string {
  const dir = mkdtempSync(join(tmpdir(), "foreman-vrm-"));
  const rt = join(dir, "runtime");
  mkdirSync(join(rt, "dist"), { recursive: true });
  writeFileSync(join(rt, "manifest.json"), readFileSync(trackedManifest));
  cpSync(trackedGuard, join(rt, "dist/destruction-guard.js"));
  cpSync(trackedPolicy, join(rt, "dist/architecture-policy.js"));
  cpSync(trackedQueue, join(rt, "dist/lane-queue.js"));
  cpSync(trackedRound, join(rt, "dist/lane-round.js"));
  cpSync(trackedPreflight, join(rt, "dist/vendor-preflight.js"));
  cpSync(trackedToolCheck, join(rt, "dist/tool-check.js"));
  return rt;
}

describe("verifyRuntimeManifest copied-tree negatives", () => {
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
