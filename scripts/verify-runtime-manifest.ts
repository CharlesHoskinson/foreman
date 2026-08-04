/**
 * Compatibility adapter: verify a runtime tree via the shared
 * @foreman/policy installed-runtime verifier.
 *
 * Supports schemaVersion 1 (single bundle) and 2 (artifacts array).
 * Link-aware: the manifest must be one regular non-link file. The `dist/`
 * directory is enumerated without following links and must contain exactly the
 * declared regular bundle files — no extras, nested dirs, or specials.
 */
import { Effect } from "effect";
import {
  liveInstallFs,
  verifyRuntimeTree,
  type InstallVerifyReason,
  type InstallVerifyResult,
} from "../packages/policy/src/install-verify-exports.js";

export type ManifestVerifyOk = {
  readonly ok: true;
  readonly artifacts: readonly {
    readonly relativePath: string;
    readonly sha256: string;
    readonly byteLength: number;
  }[];
};

export type ManifestVerifyFail = {
  readonly ok: false;
  readonly reason: string;
};

export type ManifestVerifyResult = ManifestVerifyOk | ManifestVerifyFail;

function mapResult(r: InstallVerifyResult): ManifestVerifyResult {
  if (r._tag === "Pass") {
    return {
      ok: true,
      artifacts: r.artifacts.map((a) => ({
        relativePath: a.relativePath,
        sha256: a.sha256,
        byteLength: a.byteLength,
      })),
    };
  }
  const reason: InstallVerifyReason = r.reason;
  return { ok: false, reason };
}

/**
 * Verify `runtimeRoot/manifest.json` against every artifact it names and
 * ensure `dist/` contains exactly those regular files.
 */
export function verifyRuntimeManifest(
  runtimeRoot: string,
): ManifestVerifyResult {
  const result = Effect.runSync(
    verifyRuntimeTree(runtimeRoot).pipe(Effect.provide(liveInstallFs)),
  );
  return mapResult(result);
}
