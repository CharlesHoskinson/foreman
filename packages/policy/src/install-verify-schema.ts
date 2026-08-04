/**
 * Closed result schema for installed-runtime verification and runtime plugin
 * drift. No absolute roots, stack traces, file content, or raw system errors.
 */

export const INSTALL_VERIFY_SCHEMA_VERSION = 1 as const;

/** Closed reason codes for verify-install / runtime tree verification. */
export type InstallVerifyReason =
  | "skill_root_missing"
  | "skill_root_not_directory"
  | "skill_root_unreadable"
  | "skill_root_identity_changed"
  | "skill_root_retargeted"
  | "runtime_missing"
  | "runtime_not_directory"
  | "runtime_linked"
  | "runtime_unreadable"
  | "runtime_identity_changed"
  | "manifest_missing"
  | "manifest_linked"
  | "manifest_not_file"
  | "manifest_hard_linked"
  | "manifest_oversize"
  | "manifest_unreadable"
  | "manifest_identity_changed"
  | "manifest_missing_trailing_lf"
  | "manifest_invalid_json"
  | "manifest_non_canonical"
  | "manifest_schema"
  | "manifest_unknown_field"
  | "manifest_node_range"
  | "manifest_relative_path"
  | "manifest_sha256"
  | "manifest_byte_length"
  | "manifest_duplicate_path"
  | "manifest_missing_required_artifact"
  | "bundle_missing"
  | "bundle_linked"
  | "bundle_not_file"
  | "bundle_hard_linked"
  | "bundle_oversize"
  | "bundle_unreadable"
  | "bundle_identity_changed"
  | "bundle_size_mismatch"
  | "bundle_digest_mismatch"
  | "bundle_path_escape"
  | "dist_missing"
  | "dist_linked"
  | "dist_not_directory"
  | "dist_unreadable"
  | "dist_identity_changed"
  | "dist_entry_linked"
  | "dist_unexpected_directory"
  | "dist_entry_not_file"
  | "dist_duplicate_path"
  | "dist_path_escape"
  | "dist_extra_entry"
  | "dist_case_fold_collision"
  | "schema_mismatch"
  | "internal_failed";

export type InstallArtifactDescriptor = {
  readonly relativePath: string;
  readonly sha256: string;
  readonly byteLength: number;
};

/**
 * Public Pass: digest of the exact verified manifest bytes plus stable
 * artifact descriptors. Never includes manifest text or absolute paths.
 */
export type InstallVerifyPass = {
  readonly schemaVersion: typeof INSTALL_VERIFY_SCHEMA_VERSION;
  readonly _tag: "Pass";
  /** SHA-256 of the exact manifest file bytes read in this verification pass. */
  readonly manifestDigest: string;
  readonly artifacts: readonly InstallArtifactDescriptor[];
};

export type InstallVerifyFail = {
  readonly schemaVersion: typeof INSTALL_VERIFY_SCHEMA_VERSION;
  readonly _tag: "Fail";
  readonly reason: InstallVerifyReason;
  readonly artifact: string | null;
};

export type InstallVerifyFailed = {
  readonly schemaVersion: typeof INSTALL_VERIFY_SCHEMA_VERSION;
  readonly _tag: "Failed";
  readonly reason: InstallVerifyReason;
  readonly artifact: null;
};

export type InstallVerifyResult =
  | InstallVerifyPass
  | InstallVerifyFail
  | InstallVerifyFailed;

/**
 * Internal verified snapshot from one descriptor-bound pass. Used by runtime
 * plugin-drift so a second resolve/read is never required.
 */
export type VerifiedInstallSnapshot = {
  readonly manifestDigest: string;
  readonly artifacts: readonly InstallArtifactDescriptor[];
};

export function installPass(
  manifestDigest: string,
  artifacts: readonly InstallArtifactDescriptor[],
): InstallVerifyPass {
  const sorted = [...artifacts].sort((a, b) =>
    a.relativePath < b.relativePath
      ? -1
      : a.relativePath > b.relativePath
        ? 1
        : 0,
  );
  return {
    schemaVersion: INSTALL_VERIFY_SCHEMA_VERSION,
    _tag: "Pass",
    manifestDigest,
    artifacts: sorted,
  };
}

export function installFail(
  reason: InstallVerifyReason,
  artifact: string | null = null,
): InstallVerifyFail {
  return {
    schemaVersion: INSTALL_VERIFY_SCHEMA_VERSION,
    _tag: "Fail",
    reason,
    artifact,
  };
}

export function installFailed(
  reason: InstallVerifyReason = "schema_mismatch",
): InstallVerifyFailed {
  return {
    schemaVersion: INSTALL_VERIFY_SCHEMA_VERSION,
    _tag: "Failed",
    reason,
    artifact: null,
  };
}

/** Closed reasons for runtime plugin-drift. */
export type PluginDriftReason =
  | "source_invalid"
  | "installed_invalid"
  | "manifest_mismatch"
  | "artifact_set_mismatch"
  | "schema_mismatch"
  | "internal_failed";

export type PluginDriftPass = {
  readonly schemaVersion: typeof INSTALL_VERIFY_SCHEMA_VERSION;
  readonly _tag: "Pass";
};

export type PluginDriftFail = {
  readonly schemaVersion: typeof INSTALL_VERIFY_SCHEMA_VERSION;
  readonly _tag: "Fail";
  readonly reason: PluginDriftReason;
  readonly sourceReason: InstallVerifyReason | null;
  readonly installedReason: InstallVerifyReason | null;
};

export type PluginDriftFailed = {
  readonly schemaVersion: typeof INSTALL_VERIFY_SCHEMA_VERSION;
  readonly _tag: "Failed";
  readonly reason: PluginDriftReason;
  readonly sourceReason: null;
  readonly installedReason: null;
};

export type PluginDriftResult =
  | PluginDriftPass
  | PluginDriftFail
  | PluginDriftFailed;

export function pluginDriftPass(): PluginDriftPass {
  return {
    schemaVersion: INSTALL_VERIFY_SCHEMA_VERSION,
    _tag: "Pass",
  };
}

export function pluginDriftFail(args: {
  readonly reason: PluginDriftReason;
  readonly sourceReason?: InstallVerifyReason | null;
  readonly installedReason?: InstallVerifyReason | null;
}): PluginDriftFail {
  return {
    schemaVersion: INSTALL_VERIFY_SCHEMA_VERSION,
    _tag: "Fail",
    reason: args.reason,
    sourceReason: args.sourceReason ?? null,
    installedReason: args.installedReason ?? null,
  };
}

export function pluginDriftFailed(
  reason: PluginDriftReason = "schema_mismatch",
): PluginDriftFailed {
  return {
    schemaVersion: INSTALL_VERIFY_SCHEMA_VERSION,
    _tag: "Failed",
    reason,
    sourceReason: null,
    installedReason: null,
  };
}

export function snapshotFromPass(
  pass: InstallVerifyPass,
): VerifiedInstallSnapshot {
  return {
    manifestDigest: pass.manifestDigest,
    artifacts: pass.artifacts,
  };
}
