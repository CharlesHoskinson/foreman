import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  symlinkSync,
  linkSync,
  renameSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { canonicalize, sha256Hex } from "@foreman/core";
import { Effect } from "effect";
import { verifyRuntimeTree } from "./install-verify.js";
import { liveInstallFs } from "./install-verify-fs.js";
import {
  decodeRuntimeManifest,
  matchGeneratedBundle,
} from "./architecture-manifest.js";
const asset = "assets/pel/default-authoring-snapshot.json";
const source = Buffer.from('{"schemaVersion":1}\n');
function fixture(assetPath = asset) {
  const dir = mkdtempSync(join(tmpdir(), "pel-asset-"));
  mkdirSync(join(dir, "dist"));
  mkdirSync(join(dir, "assets", "pel"), { recursive: true });
  const paths = [
    "dist/architecture-policy.js",
    "dist/credential-profile-lane.js",
    "dist/destruction-guard.js",
    "dist/execution-guard.js",
    "dist/lane-queue.js",
    "dist/lane-round.js",
    "dist/vendor-preflight.js",
    assetPath,
  ];
  const artifacts = paths.map((relativePath) => ({
    relativePath,
    byteLength: source.length,
    sha256: sha256Hex(source),
  }));
  for (const path of paths) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), source);
  }
  const manifest =
    canonicalize({ schemaVersion: 2, nodeRange: ">=24 <25", artifacts }) + "\n";
  writeFileSync(join(dir, "manifest.json"), manifest);
  return {
    dir,
    manifest,
    verify: () =>
      Effect.runSync(
        verifyRuntimeTree(dir).pipe(Effect.provide(liveInstallFs)),
      ),
  };
}
test("installed manifest and architecture policy admit the exact hashed Pel snapshot asset", () => {
  const f = fixture();
  try {
    const result = f.verify();
    assert.equal(result._tag, "Pass", JSON.stringify(result));
    const parsed = decodeRuntimeManifest(f.manifest);
    assert.ok(parsed.ok, JSON.stringify(parsed));
    assert.deepEqual(
      matchGeneratedBundle({
        repoPath: `skills/foreman/runtime/${asset}`,
        blobBytes: source,
        manifest: parsed.manifest,
        isLink: false,
      }),
      { ok: true },
    );
    assert.deepEqual(
      matchGeneratedBundle({
        repoPath: `skills/foreman/runtime/${asset}`,
        blobBytes: source,
        manifest: parsed.manifest,
        isLink: true,
      }),
      { ok: false, reason: "manifest_bundle_linked" },
    );
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});
test("asset verification rejects tampered bytes, leaf links, parent links, and hard links", () => {
  for (const mode of ["bytes", "leaf", "parent", "hard"] as const) {
    const f = fixture();
    try {
      const path = join(f.dir, asset);
      if (mode === "bytes") writeFileSync(path, Buffer.alloc(source.length));
      else if (mode === "parent") {
        renameSync(join(f.dir, "assets", "pel"), join(f.dir, "saved"));
        symlinkSync(join(f.dir, "saved"), join(f.dir, "assets", "pel"));
      } else {
        rmSync(path);
        if (mode === "leaf")
          symlinkSync(join(f.dir, "dist", "lane-queue.js"), path);
        else {
          const target = join(f.dir, "outside.json");
          writeFileSync(target, source);
          linkSync(target, path);
        }
      }
      const result = f.verify();
      assert.equal(result._tag, "Fail");
      if (result._tag === "Fail") {
        assert.equal(result.artifact, asset);
        assert.match(
          result.reason,
          /bundle_(digest_mismatch|linked|hard_linked)/,
          JSON.stringify(result),
        );
      }
    } finally {
      rmSync(f.dir, { recursive: true, force: true });
    }
  }
});
test("other asset paths do not broaden the installed artifact allowlist", () => {
  const f = fixture("assets/pel/other.json");
  try {
    const result = f.verify();
    assert.equal(result._tag, "Fail");
    if (result._tag === "Fail")
      assert.equal(result.reason, "manifest_relative_path");
    assert.equal(decodeRuntimeManifest(f.manifest).ok, false);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});
