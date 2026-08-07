/**
 * Shared installed-runtime verifier.
 * Verifies skill-root/runtime against the canonical digest manifest.
 * Never resolves repository siblings or root node_modules.
 *
 * One verification pass binds a verified snapshot (manifestDigest + artifacts).
 * Resolved skill-root, runtime, and dist directory identities are rechecked
 * after child reads; the supplied skill-root is re-resolved at the end.
 */

import { Effect, type Context } from "effect";
import { join } from "node:path";
import {
  decodeUtf8Fatal,
  isCoreFailure,
  MAX_INPUT_BYTES,
  sha256Hex,
} from "@foreman/core";
import { MAX_BLOB_BYTES } from "./architecture-git.js";
import { decodeInstallManifestText } from "./install-verify-decode.js";
import {
  InstallFs,
  InstallFsError,
  identitiesEqual,
  type InstallFileIdentity,
} from "./install-verify-fs.js";
import {
  installFail,
  installPass,
  type InstallArtifactDescriptor,
  type InstallVerifyReason,
  type InstallVerifyResult,
  type VerifiedInstallSnapshot,
} from "./install-verify-schema.js";

function mapFsMissing(
  e: InstallFsError,
  missing: InstallVerifyReason,
  unreadable: InstallVerifyReason,
): InstallVerifyResult {
  if (e.kind === "missing") return installFail(missing);
  if (e.kind === "oversize") return installFail("manifest_oversize");
  return installFail(unreadable);
}

function joinRuntime(runtimeRoot: string, ...parts: string[]): string {
  return join(runtimeRoot, ...parts);
}

function isHardLinked(id: InstallFileIdentity): boolean {
  return id.nlink > 1;
}

export type VerifyRuntimeTreeOk = {
  readonly ok: true;
  readonly result: InstallVerifyResult & { readonly _tag: "Pass" };
  readonly snapshot: VerifiedInstallSnapshot;
};

export type VerifyRuntimeTreeOutcome =
  | VerifyRuntimeTreeOk
  | { readonly ok: false; readonly result: InstallVerifyResult };

/**
 * Verify a resolved runtime tree (directory containing manifest.json + dist/).
 * Rechecks runtime and dist directory identities after child reads.
 */
export function verifyRuntimeTreeDetailed(
  runtimeRoot: string,
): Effect.Effect<VerifyRuntimeTreeOutcome, never, InstallFs> {
  return Effect.gen(function* () {
    const fs = yield* InstallFs;

    const rtStatE = yield* Effect.either(fs.lstat(runtimeRoot));
    if (rtStatE._tag === "Left") {
      return {
        ok: false as const,
        result: mapFsMissing(
          rtStatE.left,
          "runtime_missing",
          "runtime_unreadable",
        ),
      };
    }
    const rtStat = rtStatE.right;
    if (rtStat.isSymbolicLink) {
      return { ok: false as const, result: installFail("runtime_linked") };
    }
    if (!rtStat.isDirectory) {
      return {
        ok: false as const,
        result: installFail("runtime_not_directory"),
      };
    }

    const distDir = joinRuntime(runtimeRoot, "dist");
    const distPreE = yield* Effect.either(fs.lstat(distDir));
    if (distPreE._tag === "Left") {
      if (distPreE.left.kind === "missing") {
        return { ok: false as const, result: installFail("dist_missing") };
      }
      return { ok: false as const, result: installFail("dist_unreadable") };
    }
    const distPre = distPreE.right;
    if (distPre.isSymbolicLink) {
      return { ok: false as const, result: installFail("dist_linked") };
    }
    if (!distPre.isDirectory) {
      return {
        ok: false as const,
        result: installFail("dist_not_directory"),
      };
    }

    const manifestPath = joinRuntime(runtimeRoot, "manifest.json");
    const manifestRead = yield* readRegularFile(fs, {
      path: manifestPath,
      maxBytes: MAX_INPUT_BYTES,
      linked: "manifest_linked",
      notFile: "manifest_not_file",
      hardLinked: "manifest_hard_linked",
      oversize: "manifest_oversize",
      unreadable: "manifest_unreadable",
      missing: "manifest_missing",
      identityChanged: "manifest_identity_changed",
      artifact: null,
    });
    if (!manifestRead.ok) {
      return { ok: false as const, result: manifestRead.result };
    }

    const manifestDigest = sha256Hex(manifestRead.bytes);
    const text = decodeUtf8Fatal(manifestRead.bytes);
    if (isCoreFailure(text)) {
      return {
        ok: false as const,
        result: installFail("manifest_invalid_json"),
      };
    }
    const decoded = decodeInstallManifestText(text);
    if (!decoded.ok) {
      return { ok: false as const, result: installFail(decoded.reason) };
    }

    const artifacts = decoded.manifest.artifacts;

    for (const art of artifacts) {
      const one = yield* verifyOneArtifact(fs, runtimeRoot, art);
      if (one !== null) return { ok: false as const, result: one };
    }

    const dist = yield* enumerateDistExact(fs, runtimeRoot, distPre);
    if (!dist.ok) return { ok: false as const, result: dist.result };

    const declared = new Set(artifacts.map((a) => a.relativePath));
    for (const name of dist.names) {
      if (!declared.has(name)) {
        return {
          ok: false as const,
          result: installFail("dist_extra_entry", name),
        };
      }
    }
    for (const name of declared) {
      if (!dist.names.has(name)) {
        return {
          ok: false as const,
          result: installFail("bundle_missing", name),
        };
      }
    }

    // Recheck runtime and dist directory identities after all child work.
    const rtPostE = yield* Effect.either(fs.lstat(runtimeRoot));
    if (rtPostE._tag === "Left" || !identitiesEqual(rtStat, rtPostE.right)) {
      return {
        ok: false as const,
        result: installFail("runtime_identity_changed"),
      };
    }
    const distPostE = yield* Effect.either(fs.lstat(distDir));
    if (
      distPostE._tag === "Left" ||
      !identitiesEqual(distPre, distPostE.right)
    ) {
      return {
        ok: false as const,
        result: installFail("dist_identity_changed"),
      };
    }

    const pass = installPass(manifestDigest, artifacts);
    return {
      ok: true as const,
      result: pass,
      snapshot: {
        manifestDigest: pass.manifestDigest,
        artifacts: pass.artifacts,
      },
    };
  });
}

/**
 * Verify a resolved runtime tree; public InstallVerifyResult only.
 */
export function verifyRuntimeTree(
  runtimeRoot: string,
): Effect.Effect<InstallVerifyResult, never, InstallFs> {
  return Effect.gen(function* () {
    const r = yield* verifyRuntimeTreeDetailed(runtimeRoot);
    return r.result;
  });
}

export type VerifySkillRootOk = {
  readonly ok: true;
  readonly result: InstallVerifyResult & { readonly _tag: "Pass" };
  readonly snapshot: VerifiedInstallSnapshot;
};

export type VerifySkillRootOutcome =
  | VerifySkillRootOk
  | { readonly ok: false; readonly result: InstallVerifyResult };

/**
 * Verify an installed skill root: resolve once (root link allowed), verify
 * `<resolved>/runtime`, recheck root/runtime/dist identities, re-resolve the
 * original skill-root and require the same target.
 */
export function verifyInstalledSkillRootDetailed(
  skillRoot: string,
): Effect.Effect<VerifySkillRootOutcome, never, InstallFs> {
  return Effect.gen(function* () {
    const fs = yield* InstallFs;

    const preE = yield* Effect.either(fs.lstat(skillRoot));
    if (preE._tag === "Left") {
      return {
        ok: false as const,
        result: mapFsMissing(
          preE.left,
          "skill_root_missing",
          "skill_root_unreadable",
        ),
      };
    }

    const resolvedE = yield* Effect.either(fs.resolvePath(skillRoot));
    if (resolvedE._tag === "Left") {
      return {
        ok: false as const,
        result: installFail("skill_root_unreadable"),
      };
    }
    const resolved = resolvedE.right;

    const rootStatE = yield* Effect.either(fs.lstat(resolved));
    if (rootStatE._tag === "Left") {
      return {
        ok: false as const,
        result: mapFsMissing(
          rootStatE.left,
          "skill_root_missing",
          "skill_root_unreadable",
        ),
      };
    }
    const rootStat = rootStatE.right;
    if (rootStat.isSymbolicLink || !rootStat.isDirectory) {
      return {
        ok: false as const,
        result: installFail("skill_root_not_directory"),
      };
    }

    const runtimeRoot = joinRuntime(resolved, "runtime");
    const tree = yield* verifyRuntimeTreeDetailed(runtimeRoot);
    if (!tree.ok) return tree;

    // Recheck resolved skill-root identity after child verification.
    const rootPostE = yield* Effect.either(fs.lstat(resolved));
    if (
      rootPostE._tag === "Left" ||
      !identitiesEqual(rootStat, rootPostE.right)
    ) {
      return {
        ok: false as const,
        result: installFail("skill_root_identity_changed"),
      };
    }

    // Re-resolve the original supplied root; target must be unchanged.
    const resolvedAgainE = yield* Effect.either(fs.resolvePath(skillRoot));
    if (resolvedAgainE._tag === "Left") {
      return {
        ok: false as const,
        result: installFail("skill_root_retargeted"),
      };
    }
    if (resolvedAgainE.right !== resolved) {
      return {
        ok: false as const,
        result: installFail("skill_root_retargeted"),
      };
    }

    return {
      ok: true as const,
      result: tree.result,
      snapshot: tree.snapshot,
    };
  });
}

/**
 * Verify an installed skill root; public InstallVerifyResult only.
 */
export function verifyInstalledSkillRoot(
  skillRoot: string,
): Effect.Effect<InstallVerifyResult, never, InstallFs> {
  return Effect.gen(function* () {
    const r = yield* verifyInstalledSkillRootDetailed(skillRoot);
    return r.result;
  });
}

type ReadOk = { readonly ok: true; readonly bytes: Uint8Array };
type ReadFail = { readonly ok: false; readonly result: InstallVerifyResult };

function readRegularFile(
  fs: Context.Tag.Service<typeof InstallFs>,
  args: {
    readonly path: string;
    readonly maxBytes: number;
    readonly linked: InstallVerifyReason;
    readonly notFile: InstallVerifyReason;
    readonly hardLinked: InstallVerifyReason;
    readonly oversize: InstallVerifyReason;
    readonly unreadable: InstallVerifyReason;
    readonly missing: InstallVerifyReason;
    readonly identityChanged: InstallVerifyReason;
    readonly artifact: string | null;
  },
): Effect.Effect<ReadOk | ReadFail, never> {
  return Effect.gen(function* () {
    const preE = yield* Effect.either(fs.lstat(args.path));
    if (preE._tag === "Left") {
      if (preE.left.kind === "missing") {
        return {
          ok: false as const,
          result: installFail(args.missing, args.artifact),
        };
      }
      return {
        ok: false as const,
        result: installFail(args.unreadable, args.artifact),
      };
    }
    const pre = preE.right;
    if (pre.isSymbolicLink) {
      return {
        ok: false as const,
        result: installFail(args.linked, args.artifact),
      };
    }
    if (!pre.isFile) {
      return {
        ok: false as const,
        result: installFail(args.notFile, args.artifact),
      };
    }
    if (isHardLinked(pre)) {
      return {
        ok: false as const,
        result: installFail(args.hardLinked, args.artifact),
      };
    }
    if (pre.size > args.maxBytes) {
      return {
        ok: false as const,
        result: installFail(args.oversize, args.artifact),
      };
    }

    const opened = yield* Effect.either(
      fs.withOpenFile(args.path, (file) =>
        Effect.gen(function* () {
          if (!identitiesEqual(pre, file.identity)) {
            return yield* Effect.fail(new InstallFsError("identity_changed"));
          }
          if (file.identity.isSymbolicLink || !file.identity.isFile) {
            return yield* Effect.fail(new InstallFsError("unreadable"));
          }
          if (isHardLinked(file.identity)) {
            return yield* Effect.fail(new InstallFsError("hard_linked"));
          }
          const bytes = yield* file.readBounded(args.maxBytes);
          const after = yield* file.recheckIdentity();
          if (!identitiesEqual(file.identity, after)) {
            return yield* Effect.fail(new InstallFsError("identity_changed"));
          }
          return { bytes, identity: file.identity };
        }),
      ),
    );

    if (opened._tag === "Left") {
      const e = opened.left;
      if (e.kind === "missing") {
        return {
          ok: false as const,
          result: installFail(args.missing, args.artifact),
        };
      }
      if (e.kind === "oversize") {
        return {
          ok: false as const,
          result: installFail(args.oversize, args.artifact),
        };
      }
      if (e.kind === "hard_linked") {
        return {
          ok: false as const,
          result: installFail(args.hardLinked, args.artifact),
        };
      }
      if (e.kind === "identity_changed") {
        return {
          ok: false as const,
          result: installFail(args.identityChanged, args.artifact),
        };
      }
      return {
        ok: false as const,
        result: installFail(args.unreadable, args.artifact),
      };
    }

    return { ok: true as const, bytes: opened.right.bytes };
  });
}

function verifyOneArtifact(
  fs: Context.Tag.Service<typeof InstallFs>,
  runtimeRoot: string,
  art: InstallArtifactDescriptor,
): Effect.Effect<InstallVerifyResult | null, never> {
  return Effect.gen(function* () {
    if (
      art.relativePath.includes("..") ||
      art.relativePath.includes("\\") ||
      !art.relativePath.startsWith("dist/")
    ) {
      return installFail("bundle_path_escape", art.relativePath);
    }
    const rest = art.relativePath.slice("dist/".length);
    if (rest.includes("/") || rest.length === 0) {
      return installFail("bundle_path_escape", art.relativePath);
    }

    const full = joinRuntime(runtimeRoot, art.relativePath);
    const read = yield* readRegularFile(fs, {
      path: full,
      maxBytes: MAX_BLOB_BYTES,
      linked: "bundle_linked",
      notFile: "bundle_not_file",
      hardLinked: "bundle_hard_linked",
      oversize: "bundle_oversize",
      unreadable: "bundle_unreadable",
      missing: "bundle_missing",
      identityChanged: "bundle_identity_changed",
      artifact: art.relativePath,
    });
    if (!read.ok) return read.result;

    if (read.bytes.byteLength !== art.byteLength) {
      return installFail("bundle_size_mismatch", art.relativePath);
    }
    const dig = sha256Hex(read.bytes);
    if (dig !== art.sha256) {
      return installFail("bundle_digest_mismatch", art.relativePath);
    }
    return null;
  });
}

function enumerateDistExact(
  fs: Context.Tag.Service<typeof InstallFs>,
  runtimeRoot: string,
  distPre: InstallFileIdentity,
): Effect.Effect<
  | { readonly ok: true; readonly names: Set<string> }
  | { readonly ok: false; readonly result: InstallVerifyResult },
  never
> {
  return Effect.gen(function* () {
    const distDir = joinRuntime(runtimeRoot, "dist");
    // Identity must still match the pre-snapshot taken before child reads.
    const stE = yield* Effect.either(fs.lstat(distDir));
    if (stE._tag === "Left") {
      return {
        ok: false as const,
        result: installFail("dist_identity_changed"),
      };
    }
    if (!identitiesEqual(distPre, stE.right)) {
      return {
        ok: false as const,
        result: installFail("dist_identity_changed"),
      };
    }

    const namesE = yield* Effect.either(fs.readdirNames(distDir));
    if (namesE._tag === "Left") {
      return { ok: false as const, result: installFail("dist_unreadable") };
    }

    const names = new Set<string>();
    const fold = new Map<string, string>();

    for (const entName of namesE.right) {
      if (
        entName.includes("/") ||
        entName.includes("\\") ||
        entName.includes("\0") ||
        entName === ".." ||
        entName === "."
      ) {
        return {
          ok: false as const,
          result: installFail("dist_path_escape", `dist/${entName}`),
        };
      }
      const rel = `dist/${entName}`;
      const folded = entName.toLowerCase();
      const prior = fold.get(folded);
      if (prior !== undefined && prior !== entName) {
        return {
          ok: false as const,
          result: installFail("dist_case_fold_collision", rel),
        };
      }
      fold.set(folded, entName);

      const full = joinRuntime(distDir, entName);
      const estE = yield* Effect.either(fs.lstat(full));
      if (estE._tag === "Left") {
        return { ok: false as const, result: installFail("dist_unreadable") };
      }
      const est = estE.right;
      if (est.isSymbolicLink) {
        return {
          ok: false as const,
          result: installFail("dist_entry_linked", rel),
        };
      }
      if (est.isDirectory) {
        return {
          ok: false as const,
          result: installFail("dist_unexpected_directory", rel),
        };
      }
      if (!est.isFile) {
        return {
          ok: false as const,
          result: installFail("dist_entry_not_file", rel),
        };
      }
      if (names.has(rel)) {
        return {
          ok: false as const,
          result: installFail("dist_duplicate_path", rel),
        };
      }
      names.add(rel);
    }

    return { ok: true as const, names };
  });
}
