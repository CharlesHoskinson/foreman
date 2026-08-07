/**
 * Barrel for install-verify modules used by scripts and the policy package.
 */

export {
  verifyInstalledSkillRoot,
  verifyInstalledSkillRootDetailed,
  verifyRuntimeTree,
  verifyRuntimeTreeDetailed,
} from "./install-verify.js";
export {
  compareRuntimePluginDrift,
  compareVerifiedSnapshots,
} from "./install-plugin-drift.js";
export {
  liveInstallFs,
  InstallFs,
  InstallFsError,
  makeMemoryInstallFs,
  fileIdentity,
  dirIdentity,
  linkIdentity,
  identitiesEqual,
  type InstallFileIdentity,
  type InstallOpenFile,
  type MemoryNode,
  type MemoryInstallFsHooks,
} from "./install-verify-fs.js";
export {
  INSTALL_VERIFY_SCHEMA_VERSION,
  installPass,
  installFail,
  installFailed,
  pluginDriftPass,
  pluginDriftFail,
  pluginDriftFailed,
  snapshotFromPass,
  type InstallVerifyReason,
  type InstallVerifyResult,
  type InstallArtifactDescriptor,
  type VerifiedInstallSnapshot,
  type PluginDriftReason,
  type PluginDriftResult,
} from "./install-verify-schema.js";
export {
  parseInstallArgv,
  runInstallCli,
  isInstallCommand,
  type InstallCliIo,
  type ParsedInstallArgs,
} from "./install-verify-cli.js";
export { decodeInstallManifestText } from "./install-verify-decode.js";
