/**
 * Runtime plugin-drift: verify source and installed skill roots once each,
 * then compare the bound verified snapshots (manifestDigest + artifact set).
 *
 * Does not re-resolve or re-read manifests after verification. This is runtime
 * plugin drift only — not whole-skill parity with tools/plugin-drift.sh.
 */

import { Effect } from "effect";
import type { InstallFs } from "./install-verify-fs.js";
import { verifyInstalledSkillRootDetailed } from "./install-verify.js";
import {
  pluginDriftFail,
  pluginDriftPass,
  type InstallArtifactDescriptor,
  type InstallVerifyResult,
  type PluginDriftResult,
  type VerifiedInstallSnapshot,
} from "./install-verify-schema.js";

function artifactKey(a: InstallArtifactDescriptor): string {
  return `${a.relativePath}\0${a.sha256}\0${a.byteLength}`;
}

function artifactSetEqual(
  a: readonly InstallArtifactDescriptor[],
  b: readonly InstallArtifactDescriptor[],
): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a]
    .map(artifactKey)
    .sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
  const sb = [...b]
    .map(artifactKey)
    .sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
  for (let i = 0; i < sa.length; i += 1) {
    if (sa[i] !== sb[i]) return false;
  }
  return true;
}

function failReasonOf(
  r: InstallVerifyResult,
): import("./install-verify-schema.js").InstallVerifyReason {
  if (r._tag === "Pass") return "internal_failed";
  return r.reason;
}

/**
 * Compare two verified snapshots from independent verification passes.
 * Pure: no filesystem access.
 */
export function compareVerifiedSnapshots(
  source: VerifiedInstallSnapshot,
  installed: VerifiedInstallSnapshot,
): PluginDriftResult {
  if (source.manifestDigest !== installed.manifestDigest) {
    return pluginDriftFail({ reason: "manifest_mismatch" });
  }
  if (!artifactSetEqual(source.artifacts, installed.artifacts)) {
    return pluginDriftFail({ reason: "artifact_set_mismatch" });
  }
  return pluginDriftPass();
}

/**
 * Verify each skill root once and compare bound snapshots. Either
 * verification failure fails drift. No second resolvePath or manifest open.
 */
export function compareRuntimePluginDrift(
  sourceRoot: string,
  installedRoot: string,
): Effect.Effect<PluginDriftResult, never, InstallFs> {
  return Effect.gen(function* () {
    const source = yield* verifyInstalledSkillRootDetailed(sourceRoot);
    if (!source.ok) {
      return pluginDriftFail({
        reason: "source_invalid",
        sourceReason: failReasonOf(source.result),
      });
    }
    const installed = yield* verifyInstalledSkillRootDetailed(installedRoot);
    if (!installed.ok) {
      return pluginDriftFail({
        reason: "installed_invalid",
        installedReason: failReasonOf(installed.result),
      });
    }
    return compareVerifiedSnapshots(source.snapshot, installed.snapshot);
  });
}
