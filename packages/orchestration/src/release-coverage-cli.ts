import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
  type Stats,
} from "node:fs";
import { devNull } from "node:os";
import {
  dirname,
  isAbsolute,
  join,
  posix,
  relative,
  resolve,
  sep,
  win32,
} from "node:path";
import { Effect } from "effect";
import { canonicalize, isSha256Hex, sha256Hex } from "@foreman/core";
import {
  inspectReleaseCoverageRegisterV1,
  isReleaseProgram,
  RELEASE_PROGRAMS,
  releaseProgramTable,
  sanitizedGitEnv,
  validateReleaseCoverageV1,
  type ReleaseCoverageFailureReason,
  type ReleaseCoveragePhaseV1,
  type ReleaseCoverageResultV1,
  type ReleasePackageBriefV1,
  type ReleaseProgram,
  type RoadmapAssignmentV1,
} from "@foreman/policy";
import {
  livePathLookup,
  liveProcessExec,
  PathLookup,
  ProcessExec,
  type CapturedProcessResult,
  type RunCapturedOptions,
} from "./queue-services.js";
import { decodeExecutionFamilySourceFileV1, isExecutionFamilyFailure } from "./execution-contract.js";
import { EndstopLedger, makeLiveEndstopLedgerLayer } from "./execution-ledger.js";

const ONE_MIB = 1_048_576;
const EXIT_OK = 0;
const EXIT_EVALUATED = 1;
const EXIT_USAGE = 64;
const USAGE_DIAGNOSTIC = "release-coverage: invalid invocation\n";
const FAMILY_SCHEMA = "foreman.execution-family-source.v1" as const;
const CHILD_SCHEMA = "foreman.execution-child-brief.v1" as const;
const BRIEF_SCHEMA = "foreman.release-package-brief.v1" as const;
const OPENSPEC_CHANGES_PREFIX = "openspec/changes";
const EVIDENCE_FILE_LIMIT = 512;
const ROADMAP_HEADER = "| Coverage key | Scope | Release | Owner |";
const ROADMAP_SEPARATOR = "|---|---|---|---|";
const OPENSPEC_LIST_ARGV = ["list", "--json"] as const;
const SUPERPOWERS_SPECS = "docs/superpowers/specs";
const SUPERPOWERS_PLANS = "docs/superpowers/plans";
const GIT_TIMEOUT_MS = 30_000;
const OPENSPEC_TIMEOUT_MS = 30_000;

const encoder = new TextEncoder();

export type ReleaseCoverageCliIo = {
  readonly writeStdout: (text: string) => void;
  readonly writeStderr: (text: string) => void;
};

export type ReleaseCoveragePathClass =
  | { readonly _tag: "File" }
  | { readonly _tag: "Directory" }
  | { readonly _tag: "NotFound" }
  | { readonly _tag: "Other" };

export type ReleaseCoverageFileReadService = {
  readonly resolveRepositoryRoot: (
    path?: string,
  ) => Effect.Effect<string, unknown>;
  readonly readBounded: (input: {
    readonly path: string;
    readonly maxBytes: number;
    readonly containmentRoot?: string;
  }) => Effect.Effect<Uint8Array, unknown>;
  readonly classifyPath: (input: {
    readonly path: string;
    readonly containmentRoot?: string;
  }) => Effect.Effect<ReleaseCoveragePathClass, unknown>;
  readonly listDirectory: (input: {
    readonly path: string;
    readonly containmentRoot?: string;
  }) => Effect.Effect<readonly string[], unknown>;
};

export type ReleaseCoverageOpenSpecListService = {
  readonly listJson: (input: {
    readonly repository: string;
    readonly argv: readonly ["list", "--json"];
    readonly maxBytes: number;
  }) => Effect.Effect<Uint8Array, unknown>;
};

export type ReleaseCoverageGitError = unknown;

export type ReleaseCoverageGitChangedPathsService = {
  readonly discover: (input: {
    readonly repository: string;
    readonly baselineCommit: string;
    readonly pathPrefixes?: readonly string[];
  }) => Effect.Effect<readonly string[], unknown>;
  readonly readAtCommit: (input: {
    readonly repository: string;
    readonly commit: string;
    readonly path: string;
  }) => Effect.Effect<Uint8Array, unknown>;
  readonly existsAtCommit: (input: {
    readonly repository: string;
    readonly commit: string;
    readonly path: string;
  }) => Effect.Effect<boolean, ReleaseCoverageGitError>;
};

export type ReleaseCoverageChildBriefV1 = {
  readonly schema: "foreman.execution-child-brief.v1";
  readonly childId: string;
  readonly tranche: 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  readonly packageId: string;
  readonly dependencyChildIds: readonly string[];
  readonly objective: string;
  readonly acceptance: readonly string[];
  readonly allowedPaths: readonly string[];
};

export type ReleaseCoverageFamilySourceV1 = {
  readonly schema: "foreman.execution-family-source.v1";
  readonly program: ReleaseProgram;
  readonly familyId: string | null;
  readonly children: readonly ReleaseCoverageChildBriefV1[];
};

export type ReleaseCoverageResolvedFamilyV1 = {
  readonly stateRoot: string;
  readonly contractId: string;
  readonly contractSha256: string;
  readonly familySha256: string;
  readonly source: ReleaseCoverageFamilySourceV1;
};

export type ReleaseCoverageFamilySourceService = {
  readonly resolve: (input: {
    readonly stateRoot: string;
    readonly contractId: string;
    readonly contractSha256: string;
    readonly familySha256: string;
  }) => Effect.Effect<ReleaseCoverageResolvedFamilyV1, unknown>;
};

export type ReleaseCoverageCliServices = {
  readonly fileRead: ReleaseCoverageFileReadService;
  readonly openspecList: ReleaseCoverageOpenSpecListService;
  readonly gitChangedPaths: ReleaseCoverageGitChangedPathsService;
  readonly familySource: ReleaseCoverageFamilySourceService;
};

export type ReleaseCoverageLiveDependencies = {
  readonly runCaptured: (
    input: RunCapturedOptions,
  ) => Effect.Effect<CapturedProcessResult, unknown>;
  readonly which: (
    name: string,
  ) => Effect.Effect<string | null, unknown>;
  readonly realpath: (
    path: string,
  ) => Effect.Effect<string, unknown>;
  readonly findWorktreeRoot: (
    path: string,
  ) => Effect.Effect<string, unknown>;
  readonly nodeExecutable: string;
  readonly platform: NodeJS.Platform;
  readonly comSpec: string | undefined;
  readonly cwd: () => string;
  readonly nullDevice: string;
  readonly baseEnvironment: NodeJS.ProcessEnv;
};

type TrustedGitContext = {
  readonly physicalRepository: string;
  readonly physicalGit: string;
};

function buildTrustedGitEnvironment(
  physicalGit: string,
  platform: NodeJS.Platform,
  nullDevice: string,
): NodeJS.ProcessEnv {
  const pathApi = platform === "win32" ? win32 : posix;
  const environment = sanitizedGitEnv({});
  environment["PATH"] = pathApi.dirname(physicalGit);
  if (platform === "win32") {
    environment["PATHEXT"] = ".EXE";
  }
  environment["LANG"] = "C";
  environment["LC_ALL"] = "C";
  environment["GIT_CONFIG_NOSYSTEM"] = "1";
  environment["GIT_CONFIG_GLOBAL"] = nullDevice;
  return environment;
}

function buildTrustedOpenSpecEnvironment(
  physicalNode: string,
  platform: NodeJS.Platform,
): NodeJS.ProcessEnv {
  const pathApi = platform === "win32" ? win32 : posix;
  return {
    PATH: pathApi.dirname(physicalNode),
    ...(platform === "win32" ? { PATHEXT: ".EXE" } : {}),
    LANG: "C",
    LC_ALL: "C",
    OPENSPEC_TELEMETRY: "0",
    OPENSPEC_NO_UPDATE_CHECK: "1",
    OPEN_SPEC_INTERACTIVE: "0",
    NO_COLOR: "1",
  };
}

function isAbsolutePathForPlatform(
  value: string,
  platform: NodeJS.Platform,
): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  if (value.includes("\0")) return false;
  const pathApi = platform === "win32" ? win32 : posix;
  return pathApi.isAbsolute(value);
}

function physicalNodeBasenameIsTrusted(
  physicalNode: string,
  platform: NodeJS.Platform,
): boolean {
  if (platform === "win32") {
    return win32.basename(physicalNode).toLowerCase() === "node.exe";
  }
  return posix.basename(physicalNode) === "node";
}

function findWorktreeRootLive(startPath: string): string {
  let physical: string;
  try {
    physical = realpathSync(resolve(startPath));
  } catch {
    throw Object.assign(new Error("worktree start path is unreadable"), {
      _tag: "WorktreeRootUnavailable" as const,
    });
  }
  let stats: Stats;
  try {
    stats = lstatSync(physical);
  } catch {
    throw Object.assign(new Error("worktree start path is unreadable"), {
      _tag: "WorktreeRootUnavailable" as const,
    });
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw Object.assign(new Error("worktree start path is not a directory"), {
      _tag: "WorktreeRootUnavailable" as const,
    });
  }

  let current = physical;
  for (;;) {
    const marker = join(current, ".git");
    let markerStats: Stats | undefined;
    try {
      markerStats = lstatSync(marker);
    } catch (error) {
      if (!isEnoentLive(error)) {
        throw Object.assign(new Error("worktree marker is unreadable"), {
          _tag: "WorktreeRootUnavailable" as const,
        });
      }
    }
    if (markerStats !== undefined) {
      if (markerStats.isSymbolicLink()) {
        throw Object.assign(new Error("worktree marker must not be a symlink"), {
          _tag: "WorktreeRootUnavailable" as const,
        });
      }
      if (markerStats.isFile() || markerStats.isDirectory()) {
        return current;
      }
      throw Object.assign(new Error("worktree marker is not a regular marker"), {
        _tag: "WorktreeRootUnavailable" as const,
      });
    }
    const parent = dirname(current);
    if (parent === current) {
      throw Object.assign(new Error("no worktree root found"), {
        _tag: "WorktreeRootUnavailable" as const,
      });
    }
    current = parent;
  }
}

export function makeLiveReleaseCoverageCliServices(
  dependencies: ReleaseCoverageLiveDependencies,
): ReleaseCoverageCliServices {
  const gitArguments = (
    repository: string,
    args: readonly string[],
  ): string[] =>
    gitArgv([
      "-c",
      "core.fsmonitor=false",
      "-c",
      `core.excludesFile=${dependencies.nullDevice}`,
      "-C",
      repository,
      ...args,
    ]);

  const resolvePhysicalGit = (): Effect.Effect<string, unknown> =>
    Effect.gen(function* () {
      const resolved = yield* dependencies.which("git");
      if (resolved === null || !isAbsolutePathForPlatform(resolved, dependencies.platform)) {
        return yield* Effect.fail({ _tag: "GitUnavailable" as const });
      }
      return yield* dependencies.realpath(resolved);
    });

  const requireGitOutsideRepository = (
    physicalRepository: string,
    physicalGit: string,
  ): Effect.Effect<void, unknown> => {
    if (
      isPhysicallyInsideRepository(
        physicalRepository,
        physicalGit,
        dependencies.platform,
      )
    ) {
      return Effect.fail({ _tag: "GitInsideRepository" as const });
    }
    return Effect.void;
  };

  /**
   * Shared trusted-repository + trusted-Git validation (no subprocess).
   * `mode: "bootstrap"` allows the input below the root; explicit requires equality.
   */
  const resolveTrustedGitContext = (
    inputPath: string,
    mode: "bootstrap" | "explicit",
  ): Effect.Effect<TrustedGitContext, unknown> =>
    Effect.gen(function* () {
      const discovered = yield* dependencies.findWorktreeRoot(inputPath);
      const physicalInput = yield* dependencies.realpath(inputPath);
      const physicalRoot = yield* dependencies.realpath(discovered);

      if (mode === "explicit") {
        if (physicalInput !== physicalRoot) {
          return yield* Effect.fail({ _tag: "RepositoryRootMismatch" as const });
        }
      } else if (
        !isPhysicallyInsideRepository(
          physicalRoot,
          physicalInput,
          dependencies.platform,
        )
      ) {
        return yield* Effect.fail({ _tag: "RepositoryRootMismatch" as const });
      }

      const physicalGit = yield* resolvePhysicalGit();
      yield* requireGitOutsideRepository(physicalRoot, physicalGit);
      return {
        physicalRepository: physicalRoot,
        physicalGit,
      };
    });

  const confirmGitReportedRoot = (
    trusted: TrustedGitContext,
  ): Effect.Effect<string, unknown> =>
    Effect.gen(function* () {
      const captured = yield* dependencies.runCaptured({
        command: trusted.physicalGit,
        args: gitArguments(trusted.physicalRepository, [
          "rev-parse",
          "--show-toplevel",
        ]),
        env: buildTrustedGitEnvironment(
          trusted.physicalGit,
          dependencies.platform,
          dependencies.nullDevice,
        ),
        maxOutputBytes: ONE_MIB,
        timeoutMs: GIT_TIMEOUT_MS,
      });
      const bytes = yield* requireCapturedStdoutBytes(captured);
      const top = parseGitTopLevel(bytes, dependencies.platform);
      if (top === null) {
        return yield* Effect.fail({ _tag: "GitTopLevelInvalid" as const });
      }
      const physicalReported = yield* dependencies.realpath(top);
      if (physicalReported !== trusted.physicalRepository) {
        return yield* Effect.fail({ _tag: "GitTopLevelMismatch" as const });
      }
      return trusted.physicalRepository;
    });

  return {
    fileRead: {
      resolveRepositoryRoot: (path?: string) =>
        Effect.gen(function* () {
          const trusted =
            path === undefined
              ? yield* resolveTrustedGitContext(dependencies.cwd(), "bootstrap")
              : yield* resolveTrustedGitContext(path, "explicit");
          return yield* confirmGitReportedRoot(trusted);
        }),
      readBounded: (input) =>
        Effect.try({
          try: () =>
            readBoundedBytesLive(
              input.path,
              input.maxBytes,
              input.containmentRoot,
            ),
          catch: (error) => error,
        }),
      classifyPath: (input) =>
        Effect.try({
          try: () => classifyPathLive(input.path, input.containmentRoot),
          catch: (error) => error,
        }),
      listDirectory: (input) =>
        Effect.try({
          try: () => listDirectoryLive(input.path, input.containmentRoot),
          catch: (error) => error,
        }),
    },
    openspecList: {
      listJson: (input) =>
        Effect.gen(function* () {
          const discovered = yield* dependencies.findWorktreeRoot(input.repository);
          const physicalRepository = yield* dependencies.realpath(input.repository);
          const physicalRoot = yield* dependencies.realpath(discovered);
          if (physicalRepository !== physicalRoot) {
            return yield* Effect.fail({ _tag: "RepositoryRootMismatch" as const });
          }

          const resolved = yield* dependencies.which("openspec");
          if (
            resolved === null ||
            !isAbsolutePathForPlatform(resolved, dependencies.platform)
          ) {
            return yield* Effect.fail({ _tag: "OpenSpecUnavailable" as const });
          }
          const physicalOpenSpec = yield* dependencies.realpath(resolved);
          const physicalNode = yield* dependencies.realpath(
            dependencies.nodeExecutable,
          );
          if (
            !physicalNodeBasenameIsTrusted(physicalNode, dependencies.platform)
          ) {
            return yield* Effect.fail({ _tag: "NodeUntrusted" as const });
          }

          let physicalComSpec: string | undefined;
          if (dependencies.platform === "win32") {
            if (
              typeof dependencies.comSpec !== "string" ||
              dependencies.comSpec.length === 0
            ) {
              return yield* Effect.fail({ _tag: "OpenSpecUnavailable" as const });
            }
            physicalComSpec = yield* dependencies.realpath(dependencies.comSpec);
          }

          for (const authority of [
            physicalOpenSpec,
            physicalNode,
            ...(physicalComSpec !== undefined ? [physicalComSpec] : []),
          ]) {
            if (
              isPhysicallyInsideRepository(
                physicalRepository,
                authority,
                dependencies.platform,
              )
            ) {
              return yield* Effect.fail({
                _tag: "OpenSpecInsideRepository" as const,
              });
            }
          }

          const plan = planOpenSpecInvocationV1({
            platform: dependencies.platform,
            comSpec: physicalComSpec,
            resolvedOpenSpec: physicalOpenSpec,
          });
          if (plan._tag === "Invalid") {
            return yield* Effect.fail({ _tag: "OpenSpecUnavailable" as const });
          }

          const captured = yield* dependencies.runCaptured({
            command: plan.command,
            args: plan.args,
            cwd: physicalRepository,
            env: buildTrustedOpenSpecEnvironment(
              physicalNode,
              dependencies.platform,
            ),
            maxOutputBytes: input.maxBytes,
            timeoutMs: OPENSPEC_TIMEOUT_MS,
          });
          return yield* requireCapturedStdoutBytes(captured);
        }),
    },
    gitChangedPaths: {
      discover: (input) =>
        Effect.gen(function* () {
          const trusted = yield* resolveTrustedGitContext(
            input.repository,
            "explicit",
          );
          const env = buildTrustedGitEnvironment(
            trusted.physicalGit,
            dependencies.platform,
            dependencies.nullDevice,
          );
          const prefixes = input.pathPrefixes ?? [
            SUPERPOWERS_SPECS,
            SUPERPOWERS_PLANS,
          ];
          const tracked = yield* dependencies.runCaptured({
            command: trusted.physicalGit,
            args: gitArguments(trusted.physicalRepository, [
              "diff",
              "--name-only",
              "-z",
              "--no-ext-diff",
              "--no-textconv",
              input.baselineCommit,
              "--",
              ...prefixes,
            ]),
            env,
            maxOutputBytes: ONE_MIB,
            timeoutMs: GIT_TIMEOUT_MS,
          });
          const trackedBytes = yield* requireCapturedStdoutBytes(tracked);
          const trackedPaths = parseNulDelimitedGitPaths(trackedBytes);
          if (trackedPaths === null) {
            return yield* Effect.fail({ _tag: "GitPathsInvalid" as const });
          }

          const untracked = yield* dependencies.runCaptured({
            command: trusted.physicalGit,
            args: gitArguments(trusted.physicalRepository, [
              "ls-files",
              "--others",
              "-z",
              "--",
              ...prefixes,
            ]),
            env,
            maxOutputBytes: ONE_MIB,
            timeoutMs: GIT_TIMEOUT_MS,
          });
          const untrackedBytes = yield* requireCapturedStdoutBytes(untracked);
          const untrackedPaths = parseNulDelimitedGitPaths(untrackedBytes);
          if (untrackedPaths === null) {
            return yield* Effect.fail({ _tag: "GitPathsInvalid" as const });
          }
          return dedupeUtf8ByteOrder([...trackedPaths, ...untrackedPaths]);
        }),
      readAtCommit: (input) =>
        Effect.gen(function* () {
          const trusted = yield* resolveTrustedGitContext(
            input.repository,
            "explicit",
          );
          const env = buildTrustedGitEnvironment(
            trusted.physicalGit,
            dependencies.platform,
            dependencies.nullDevice,
          );
          if (
            typeof input.path !== "string" ||
            input.path.length === 0 ||
            input.path.includes("\0") ||
            input.path.includes("\\") ||
            input.path.startsWith("/") ||
            input.path.includes(":")
          ) {
            return yield* Effect.fail({ _tag: "GitPathsInvalid" as const });
          }
          const captured = yield* dependencies.runCaptured({
            command: trusted.physicalGit,
            args: gitArguments(trusted.physicalRepository, [
              "show",
              `${input.commit}:${input.path}`,
            ]),
            env,
            maxOutputBytes: ONE_MIB,
            timeoutMs: GIT_TIMEOUT_MS,
          });
          return yield* requireCapturedStdoutBytes(captured);
        }),
      existsAtCommit: (input) =>
        Effect.gen(function* () {
          const trusted = yield* resolveTrustedGitContext(
            input.repository,
            "explicit",
          );
          const env = buildTrustedGitEnvironment(
            trusted.physicalGit,
            dependencies.platform,
            dependencies.nullDevice,
          );
          if (
            typeof input.path !== "string" ||
            input.path.length === 0 ||
            input.path.includes("\0") ||
            input.path.includes("\\") ||
            input.path.startsWith("/") ||
            input.path.includes(":")
          ) {
            return yield* Effect.fail({ _tag: "GitPathsInvalid" as const });
          }
          const tree = yield* dependencies.runCaptured({
            command: trusted.physicalGit,
            args: gitArguments(trusted.physicalRepository, [
              "cat-file",
              "-e",
              `${input.commit}^{tree}`,
            ]),
            env,
            maxOutputBytes: ONE_MIB,
            timeoutMs: GIT_TIMEOUT_MS,
          });
          if (tree.exitCode !== 0) {
            return yield* Effect.fail({ _tag: "GitError" as const });
          }
          const listing = yield* dependencies.runCaptured({
            command: trusted.physicalGit,
            args: gitArguments(trusted.physicalRepository, [
              "ls-tree",
              "--name-only",
              input.commit,
              "--",
              input.path,
            ]),
            env,
            maxOutputBytes: ONE_MIB,
            timeoutMs: GIT_TIMEOUT_MS,
          });
          const stderrText = capturedStderrText(listing);
          if (listing.exitCode !== 0 || stderrText.includes("fatal:")) {
            return yield* Effect.fail({ _tag: "GitError" as const });
          }
          const stdoutBytes =
            listing.stdoutBytes ?? encoder.encode(listing.stdout);
          return stdoutBytes.byteLength > 0;
        }),
    },
    familySource: {
      resolve: () =>
        Effect.fail({
          _tag: "FamilySourceUnavailable" as const,
        }),
    },
  };
}

type ParsedFlags = {
  readonly phase: "bootstrap" | "lane" | "release";
  readonly owner: string | undefined;
  readonly register: string;
  readonly repo: string | undefined;
  readonly stateRoot: string | undefined;
  readonly contractId: string | undefined;
  readonly contractSha: string | undefined;
  readonly familySha: string | undefined;
  readonly evidence: string | undefined;
};

type ParsedCli =
  | {
      readonly _tag: "Ok";
      readonly program: ReleaseProgram;
      readonly phase: ReleaseCoveragePhaseV1;
      readonly register: string;
      readonly repo: string | undefined;
      readonly stateRoot: string | undefined;
      readonly contractId: string | undefined;
      readonly contractSha: string | undefined;
      readonly familySha: string | undefined;
      readonly evidence: string | undefined;
    }
  | { readonly _tag: "WrongProgram" }
  | { readonly _tag: "Invalid" };

function invalidResult(
  reason: ReleaseCoverageFailureReason,
): ReleaseCoverageResultV1 {
  return { schemaVersion: 1, _tag: "Invalid", reason };
}

function dependencyFailure(): ReleaseCoverageResultV1 {
  return invalidResult("dependency_failure");
}

function emitEvaluated(
  io: ReleaseCoverageCliIo,
  result: ReleaseCoverageResultV1,
): number {
  io.writeStdout(`${canonicalize(result)}\n`);
  return result._tag === "Valid" ? EXIT_OK : EXIT_EVALUATED;
}

function utf8ByteLength(text: string): number {
  return encoder.encode(text).byteLength;
}

function isRunId(value: string): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  if (utf8ByteLength(value) > 128) return false;
  if (value.includes("/") || value.includes("\\") || value.includes("\0")) {
    return false;
  }
  return true;
}

function isNativeAbsolutePath(value: string): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  if (value.includes("\0")) return false;
  return isAbsolute(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isNotFoundError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    Object.prototype.hasOwnProperty.call(error, "_tag") &&
    (error as { readonly _tag?: unknown })._tag === "NotFound"
  );
}

function hasExactOwnKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const own = Object.keys(value);
  if (own.length !== keys.length) return false;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) return false;
  }
  return true;
}

function decodeUtf8Fatal(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch {
    return null;
  }
}

function hasAnyControl(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function hasControlExcludingLf(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 0x0a) continue;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function isPrintableAscii(text: string): boolean {
  if (text.length === 0) return false;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x20 || code > 0x7e) return false;
  }
  return true;
}

function compareUtf8Bytes(a: string, b: string): number {
  const ab = encoder.encode(a);
  const bb = encoder.encode(b);
  const n = Math.min(ab.length, bb.length);
  for (let i = 0; i < n; i++) {
    if (ab[i] !== bb[i]) return ab[i]! - bb[i]!;
  }
  return ab.length - bb.length;
}

function isAllowedPathValue(path: string): boolean {
  if (!isPrintableAscii(path)) return false;
  if (path.includes("\\")) return false;
  if (path.startsWith("/")) return false;
  if (/^[A-Za-z]:\//.test(path)) return false;
  let body = path;
  let directoryPrefix = false;
  if (body.endsWith("/**")) {
    directoryPrefix = true;
    body = body.slice(0, -3);
    if (body.length === 0) return false;
  }
  if (body.includes("*") || body.includes("?") || body.includes("[")) {
    return false;
  }
  const segments = body.split("/");
  if (segments.length === 0) return false;
  for (const segment of segments) {
    if (segment.length === 0) return false;
    if (segment === "." || segment === "..") return false;
  }
  if (directoryPrefix && path !== `${body}/**`) return false;
  return true;
}

function isValidObjective(value: string): boolean {
  const bytes = utf8ByteLength(value);
  if (bytes < 1 || bytes > 16384) return false;
  return !hasControlExcludingLf(value);
}

function isValidAcceptanceItem(value: string): boolean {
  const bytes = utf8ByteLength(value);
  if (bytes < 1 || bytes > 4096) return false;
  return !hasAnyControl(value);
}

function parseArgv(argv: ReadonlyArray<string>): ParsedCli {
  const args = argv.slice(2);
  if (args.length === 0 || args[0] !== "check") return { _tag: "Invalid" };

  const rest = args.slice(1);
  if (rest.length % 2 !== 0) return { _tag: "Invalid" };

  const seen = new Set<string>();
  const raw: Record<string, string> = {};
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i]!;
    const value = rest[i + 1];
    if (!flag.startsWith("--") || flag.length < 3) return { _tag: "Invalid" };
    if (value === undefined || value.startsWith("--")) return { _tag: "Invalid" };
    if (seen.has(flag)) return { _tag: "Invalid" };
    seen.add(flag);
    raw[flag] = value;
  }

  const program = raw["--program"];
  const phase = raw["--phase"];
  const register = raw["--register"];
  if (typeof program !== "string") return { _tag: "Invalid" };
  if (!isReleaseProgram(program)) return { _tag: "WrongProgram" };
  if (phase !== "bootstrap" && phase !== "lane" && phase !== "release") {
    return { _tag: "Invalid" };
  }
  if (typeof register !== "string" || !isNativeAbsolutePath(register)) {
    return { _tag: "Invalid" };
  }
  const table = releaseProgramTable(program);

  const owner = raw["--owner"];
  const repo = raw["--repo"];
  const stateRoot = raw["--state-root"];
  const contractId = raw["--contract-id"];
  const contractSha = raw["--contract-sha"];
  const familySha = raw["--family-sha"];
  const evidence = raw["--evidence"];

  const flags: ParsedFlags = {
    phase,
    owner,
    register,
    repo,
    stateRoot,
    contractId,
    contractSha,
    familySha,
    evidence,
  };

  if (phase === "bootstrap") {
    const allowed = new Set([
      "--program",
      "--phase",
      "--owner",
      "--register",
    ]);
    for (const key of Object.keys(raw)) {
      if (!allowed.has(key)) return { _tag: "Invalid" };
    }
    if (owner !== table.bootstrapOwner) return { _tag: "Invalid" };
    if (
      repo !== undefined ||
      stateRoot !== undefined ||
      contractId !== undefined ||
      contractSha !== undefined ||
      familySha !== undefined
    ) {
      return { _tag: "Invalid" };
    }
    return {
      _tag: "Ok",
      program,
      phase: { _tag: "Bootstrap", owner: table.bootstrapOwner },
      register,
      repo: undefined,
      stateRoot: undefined,
      contractId: undefined,
      contractSha: undefined,
      familySha: undefined,
      evidence: undefined,
    };
  }

  if (phase === "lane") {
    const allowed = new Set([
      "--program",
      "--phase",
      "--owner",
      "--repo",
      "--state-root",
      "--contract-id",
      "--contract-sha",
      "--family-sha",
      "--register",
    ]);
    for (const key of Object.keys(raw)) {
      if (!allowed.has(key)) return { _tag: "Invalid" };
    }
    if (typeof owner !== "string" || !isRunId(owner)) return { _tag: "Invalid" };
    if (typeof repo !== "string" || !isNativeAbsolutePath(repo)) {
      return { _tag: "Invalid" };
    }
    if (typeof stateRoot !== "string" || !isNativeAbsolutePath(stateRoot)) {
      return { _tag: "Invalid" };
    }
    if (typeof contractId !== "string" || !isRunId(contractId)) {
      return { _tag: "Invalid" };
    }
    if (typeof contractSha !== "string" || !isSha256Hex(contractSha)) {
      return { _tag: "Invalid" };
    }
    if (typeof familySha !== "string" || !isSha256Hex(familySha)) {
      return { _tag: "Invalid" };
    }
    return {
      _tag: "Ok",
      program,
      phase: { _tag: "Lane", owner },
      register: flags.register,
      repo,
      stateRoot,
      contractId,
      contractSha,
      familySha,
      evidence: undefined,
    };
  }

  const isV050 = program !== RELEASE_PROGRAMS[0];
  const allowed = new Set([
    "--program",
    "--phase",
    "--repo",
    "--state-root",
    "--contract-id",
    "--contract-sha",
    "--family-sha",
    "--register",
    ...(isV050 ? ["--evidence"] : []),
  ]);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) return { _tag: "Invalid" };
  }
  if (owner !== undefined) return { _tag: "Invalid" };
  if (typeof repo !== "string" || !isNativeAbsolutePath(repo)) {
    return { _tag: "Invalid" };
  }
  if (typeof stateRoot !== "string" || !isNativeAbsolutePath(stateRoot)) {
    return { _tag: "Invalid" };
  }
  if (typeof contractId !== "string" || !isRunId(contractId)) {
    return { _tag: "Invalid" };
  }
  if (typeof contractSha !== "string" || !isSha256Hex(contractSha)) {
    return { _tag: "Invalid" };
  }
  if (typeof familySha !== "string" || !isSha256Hex(familySha)) {
    return { _tag: "Invalid" };
  }
  if (isV050) {
    if (typeof evidence !== "string" || !isNativeAbsolutePath(evidence)) {
      return { _tag: "Invalid" };
    }
  } else if (evidence !== undefined) {
    return { _tag: "Invalid" };
  }
  return {
    _tag: "Ok",
    program,
    phase: { _tag: "Release" },
    register: flags.register,
    repo,
    stateRoot,
    contractId,
    contractSha,
    familySha,
    evidence: isV050 ? evidence : undefined,
  };
}

type PortRead =
  | { readonly _tag: "Ok"; readonly bytes: Uint8Array }
  | { readonly _tag: "NotFound" }
  | { readonly _tag: "Fail" };

function readBoundedPort(
  fileRead: ReleaseCoverageFileReadService,
  path: string,
  containmentRoot?: string,
): Effect.Effect<PortRead, never> {
  return Effect.suspend(() =>
    fileRead.readBounded({
      path,
      maxBytes: ONE_MIB,
      ...(containmentRoot !== undefined ? { containmentRoot } : {}),
    }),
  ).pipe(
    Effect.map((bytes): PortRead => ({ _tag: "Ok", bytes })),
    Effect.catchAll((error): Effect.Effect<PortRead, never> =>
      Effect.succeed(isNotFoundError(error) ? { _tag: "NotFound" } : { _tag: "Fail" }),
    ),
    Effect.catchAllDefect((): Effect.Effect<PortRead, never> =>
      Effect.succeed({ _tag: "Fail" }),
    ),
  );
}

function callPort<A>(
  create: () => Effect.Effect<A, unknown>,
): Effect.Effect<A, "dependency_failure"> {
  return Effect.suspend(() => create()).pipe(
    Effect.mapError((): "dependency_failure" => "dependency_failure"),
    Effect.catchAllDefect((): Effect.Effect<A, "dependency_failure"> =>
      Effect.fail("dependency_failure"),
    ),
  );
}

function parseOpenSpecNames(bytes: Uint8Array): readonly string[] | null {
  const text = decodeUtf8Fatal(bytes);
  if (text === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  if (!isPlainObject(parsed)) return null;
  const changes = parsed["changes"];
  if (!Array.isArray(changes)) return null;
  const names: string[] = [];
  for (const item of changes) {
    if (!isPlainObject(item)) return null;
    const name = item["name"];
    if (typeof name !== "string") return null;
    names.push(name);
  }
  return names;
}

function parseRoadmapRows(
  text: string,
): readonly RoadmapAssignmentV1[] | null {
  const lines = text.split(/\r?\n/);
  let headerIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === ROADMAP_HEADER) {
      if (headerIndex !== -1) return null;
      headerIndex = i;
    }
  }
  if (headerIndex < 0) return null;
  if (lines[headerIndex + 1] !== ROADMAP_SEPARATOR) return null;
  for (let i = 0; i < lines.length; i++) {
    if (i !== headerIndex + 1 && lines[i] === ROADMAP_SEPARATOR) return null;
  }

  const rows: RoadmapAssignmentV1[] = [];
  for (let i = headerIndex + 2; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.length === 0) break;
    const match =
      /^\| `([^`]+)` \| ([^|]+) \| `(v0\.[456])` \| `([^`]+)` \|$/.exec(line);
    if (match === null) return null;
    rows.push({
      key: match[1]!,
      scope: match[2]!,
      release: match[3] as "v0.4" | "v0.5" | "v0.6",
      owner: match[4]!,
    });
  }
  return rows;
}

function extractWorkflowSchema(text: string): string | null {
  const lines = text.split(/\r?\n/);
  let found: string | null = null;
  for (const line of lines) {
    if (line.length === 0) continue;
    if (/^\s/.test(line)) continue;
    const match = /^schema:\s*(\S+)\s*$/.exec(line);
    if (match === null) continue;
    if (found !== null) return null;
    found = match[1]!;
  }
  return found;
}

function repositoryRelativePosixPath(
  repository: string,
  absoluteFile: string,
): string | null {
  const rel = relative(repository, absoluteFile);
  if (rel.length === 0) return null;
  if (isAbsolute(rel)) return null;
  if (rel === "..") return null;
  if (rel.startsWith(`..${sep}`)) return null;
  return rel.split(sep).join("/");
}

function evidenceFileNameIsIncluded(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith(".json") || lower.endsWith(".md");
}

function resolveContainedPath(
  repository: string,
  segments: readonly string[],
): string | null {
  for (const segment of segments) {
    if (segment.includes("\\") || segment.includes("\0")) return null;
    if (segment.includes("/")) return null;
    if (segment === "." || segment === "..") return null;
  }
  const absolute = resolve(repository, ...segments);
  const rel = relative(repository, absolute);
  if (rel.length === 0) return null;
  if (isAbsolute(rel)) return null;
  if (rel === "..") return null;
  if (rel.startsWith(`..${sep}`)) return null;
  return absolute;
}

function trancheSequence(program: ReleaseProgram): readonly number[] {
  const [min, max] = releaseProgramTable(program).trancheRange;
  const values: number[] = [];
  for (let value = min; value <= max; value += 1) values.push(value);
  return values;
}

function validateFamilySource(
  source: unknown,
  program: ReleaseProgram,
): source is ReleaseCoverageFamilySourceV1 {
  if (!isPlainObject(source)) return false;
  if (
    !hasExactOwnKeys(source, ["schema", "program", "familyId", "children"])
  ) {
    return false;
  }
  if (source["schema"] !== FAMILY_SCHEMA) return false;
  if (source["program"] !== program) return false;
  if (source["familyId"] !== releaseProgramTable(program).familyId) return false;
  const children = source["children"];
  const expectedTranches = trancheSequence(program);
  const isDefaultProgram = program === RELEASE_PROGRAMS[0];
  if (!Array.isArray(children)) return false;
  if (isDefaultProgram && children.length !== expectedTranches.length) return false;
  if (!isDefaultProgram && children.length < 1) return false;

  const childIds = new Set<string>();
  const packageIds = new Set<string>();

  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (!isPlainObject(child)) return false;
    if (
      !hasExactOwnKeys(child, [
        "schema",
        "childId",
        "tranche",
        "packageId",
        "dependencyChildIds",
        "objective",
        "acceptance",
        "allowedPaths",
      ])
    ) {
      return false;
    }
    if (child["schema"] !== CHILD_SCHEMA) return false;
    const childId = child["childId"];
    const tranche = child["tranche"];
    const packageId = child["packageId"];
    const dependencyChildIds = child["dependencyChildIds"];
    const objective = child["objective"];
    const acceptance = child["acceptance"];
    const allowedPaths = child["allowedPaths"];
    if (typeof childId !== "string" || !isRunId(childId)) return false;
    if (isDefaultProgram) {
      if (tranche !== expectedTranches[i]) return false;
    } else {
      const [min, max] = releaseProgramTable(program).trancheRange;
      if (typeof tranche !== "number" || tranche < min || tranche > max) {
        return false;
      }
    }
    if (typeof packageId !== "string" || !isRunId(packageId)) return false;
    if (childIds.has(childId) || packageIds.has(packageId)) return false;
    childIds.add(childId);
    packageIds.add(packageId);
    if (!Array.isArray(dependencyChildIds)) return false;
    for (const dep of dependencyChildIds) {
      if (typeof dep !== "string" || !isRunId(dep)) return false;
    }
    if (typeof objective !== "string" || !isValidObjective(objective)) {
      return false;
    }
    if (
      !Array.isArray(acceptance) ||
      acceptance.length < 1 ||
      acceptance.length > 256
    ) {
      return false;
    }
    for (const item of acceptance) {
      if (typeof item !== "string" || !isValidAcceptanceItem(item)) return false;
    }
    if (
      !Array.isArray(allowedPaths) ||
      allowedPaths.length < 1 ||
      allowedPaths.length > 256
    ) {
      return false;
    }
    const seenPaths = new Set<string>();
    let previous: string | null = null;
    for (const path of allowedPaths) {
      if (typeof path !== "string" || !isAllowedPathValue(path)) return false;
      if (seenPaths.has(path)) return false;
      seenPaths.add(path);
      if (previous !== null && compareUtf8Bytes(previous, path) > 0) return false;
      previous = path;
    }
  }
  return true;
}

function deriveBrief(
  child: ReleaseCoverageChildBriefV1,
  familySha256: string,
): ReleasePackageBriefV1 {
  return {
    schema: BRIEF_SCHEMA,
    familySha256,
    childId: child.childId,
    packageId: child.packageId,
    objective: child.objective,
    acceptance: child.acceptance,
    allowedPaths: child.allowedPaths,
  };
}

function evaluateReleaseCoverage(
  parsed: Extract<ParsedCli, { readonly _tag: "Ok" }>,
  services: ReleaseCoverageCliServices,
): Effect.Effect<ReleaseCoverageResultV1, never> {
  return Effect.gen(function* () {
    const registerRead = yield* readBoundedPort(
      services.fileRead,
      parsed.register,
    );
    if (registerRead._tag !== "Ok") return dependencyFailure();
    const registerText = decodeUtf8Fatal(registerRead.bytes);
    if (registerText === null) return dependencyFailure();

    const inspection = inspectReleaseCoverageRegisterV1({
      registerText,
      phase: parsed.phase,
      program: parsed.program,
    });
    if (inspection._tag === "Invalid") {
      return invalidResult("invalid_register");
    }

    let repository: string;
    if (parsed.phase._tag === "Bootstrap") {
      const root = yield* callPort(() =>
        services.fileRead.resolveRepositoryRoot(),
      ).pipe(Effect.either);
      if (root._tag === "Left") return dependencyFailure();
      repository = root.right;
      if (!isNativeAbsolutePath(repository)) return dependencyFailure();
    } else {
      const root = yield* callPort(() =>
        services.fileRead.resolveRepositoryRoot(parsed.repo!),
      ).pipe(Effect.either);
      if (root._tag === "Left") return dependencyFailure();
      repository = root.right;
      if (!isNativeAbsolutePath(repository)) return dependencyFailure();
    }

    const openspecBytes = yield* callPort(() =>
      services.openspecList.listJson({
        repository,
        argv: OPENSPEC_LIST_ARGV,
        maxBytes: ONE_MIB,
      }),
    ).pipe(Effect.either);
    if (openspecBytes._tag === "Left") return dependencyFailure();
    const activeChangeNames = parseOpenSpecNames(openspecBytes.right);
    if (activeChangeNames === null) return dependencyFailure();

    const roadmapPath = resolveContainedPath(repository, ["ROADMAP.md"]);
    if (roadmapPath === null) return dependencyFailure();
    const roadmapRead = yield* readBoundedPort(
      services.fileRead,
      roadmapPath,
      repository,
    );
    if (roadmapRead._tag !== "Ok") return dependencyFailure();
    const roadmapBytes = roadmapRead.bytes;
    const roadmapText = decodeUtf8Fatal(roadmapBytes);
    if (roadmapText === null) return invalidResult("invalid_roadmap");
    const roadmapRows = parseRoadmapRows(roadmapText);
    if (roadmapRows === null) return invalidResult("invalid_roadmap");

    const changed = yield* callPort(() =>
      services.gitChangedPaths.discover({
        repository,
        baselineCommit: inspection.baselineCommit,
        ...(parsed.program !== RELEASE_PROGRAMS[0]
          ? {
              pathPrefixes: [
                SUPERPOWERS_SPECS,
                SUPERPOWERS_PLANS,
                OPENSPEC_CHANGES_PREFIX,
              ],
            }
          : {}),
      }),
    ).pipe(Effect.either);
    if (changed._tag === "Left") return dependencyFailure();

    const workflowOwners =
      parsed.program !== RELEASE_PROGRAMS[0] && parsed.phase._tag === "Bootstrap"
        ? inspection.v050OwnerPackageNames
        : inspection.selectedOwners;
    const workflowByChange: Record<string, string | null> = {};
    for (const owner of workflowOwners) {
      const workflowPath = resolveContainedPath(repository, [
        "openspec",
        "changes",
        owner,
        ".openspec.yaml",
      ]);
      if (workflowPath === null) {
        workflowByChange[owner] = null;
        continue;
      }
      const workflowRead = yield* readBoundedPort(
        services.fileRead,
        workflowPath,
        repository,
      );
      if (workflowRead._tag === "Fail") return dependencyFailure();
      if (workflowRead._tag === "NotFound") {
        workflowByChange[owner] = null;
        continue;
      }
      const workflowText = decodeUtf8Fatal(workflowRead.bytes);
      if (workflowText === null) {
        workflowByChange[owner] = null;
        continue;
      }
      workflowByChange[owner] = extractWorkflowSchema(workflowText);
    }

    let expectedBriefByOwner: Record<string, ReleasePackageBriefV1> = {};
    let packageBriefBytesByOwner: Record<string, Uint8Array> = {};

    if (parsed.phase._tag !== "Bootstrap") {
      const family = yield* callPort(() =>
        services.familySource.resolve({
          stateRoot: parsed.stateRoot!,
          contractId: parsed.contractId!,
          contractSha256: parsed.contractSha!,
          familySha256: parsed.familySha!,
        }),
      ).pipe(Effect.either);
      if (family._tag === "Left") return dependencyFailure();
      const resolved = family.right;
      if (!isPlainObject(resolved as unknown as Record<string, unknown>)) {
        return dependencyFailure();
      }
      if (
        resolved.stateRoot !== parsed.stateRoot ||
        resolved.contractId !== parsed.contractId ||
        resolved.contractSha256 !== parsed.contractSha ||
        resolved.familySha256 !== parsed.familySha
      ) {
        return dependencyFailure();
      }
      if (!validateFamilySource(resolved.source, parsed.program)) {
        return dependencyFailure();
      }

      const children = resolved.source.children;
      expectedBriefByOwner = {};
      packageBriefBytesByOwner = {};

      for (const owner of inspection.selectedOwners) {
        const matches = children.filter((child) => child.packageId === owner);
        if (matches.length !== 1) {
          return invalidResult("brief_mismatch");
        }
        const child = matches[0]!;
        if (!isRunId(child.packageId)) {
          return dependencyFailure();
        }
        const briefPath = resolveContainedPath(repository, [
          "openspec",
          "changes",
          child.packageId,
          "release-brief.json",
        ]);
        if (briefPath === null) return dependencyFailure();
        const briefRead = yield* readBoundedPort(
          services.fileRead,
          briefPath,
          repository,
        );
        if (briefRead._tag === "NotFound") {
          return invalidResult("brief_mismatch");
        }
        if (briefRead._tag !== "Ok") return dependencyFailure();
        expectedBriefByOwner[owner] = deriveBrief(child, parsed.familySha!);
        packageBriefBytesByOwner[owner] = briefRead.bytes;
      }
    }

    const tasksMarkdownByOwner: Record<string, string> = {};
    if (parsed.program !== RELEASE_PROGRAMS[0] && parsed.phase._tag === "Lane") {
      for (const owner of inspection.selectedOwners) {
        const tasksPath = resolveContainedPath(repository, [
          "openspec",
          "changes",
          owner,
          "tasks.md",
        ]);
        if (tasksPath === null) continue;
        const tasksRead = yield* readBoundedPort(
          services.fileRead,
          tasksPath,
          repository,
        );
        if (tasksRead._tag === "Fail") return dependencyFailure();
        if (tasksRead._tag === "NotFound") continue;
        const tasksText = decodeUtf8Fatal(tasksRead.bytes);
        if (tasksText === null) continue;
        tasksMarkdownByOwner[owner] = tasksText;
      }
    }

    let baselineRegisterText: string | undefined;
    let baselineRegisterAbsent = false;
    if (
      parsed.program !== RELEASE_PROGRAMS[0] &&
      (parsed.phase._tag === "Bootstrap" || parsed.phase._tag === "Release")
    ) {
      const relativeRegister = repositoryRelativePosixPath(
        repository,
        parsed.register,
      );
      if (relativeRegister === null) return dependencyFailure();
      const baselineBytes = yield* callPort(() =>
        services.gitChangedPaths.readAtCommit({
          repository,
          commit: inspection.baselineCommit,
          path: relativeRegister,
        }),
      ).pipe(Effect.either);
      if (baselineBytes._tag === "Right") {
        const baselineText = decodeUtf8Fatal(baselineBytes.right);
        if (baselineText === null) return dependencyFailure();
        baselineRegisterText = baselineText;
      } else {
        const present = yield* callPort(() =>
          services.gitChangedPaths.existsAtCommit({
            repository,
            commit: inspection.baselineCommit,
            path: relativeRegister,
          }),
        ).pipe(Effect.either);
        if (present._tag === "Left" || present.right) {
          return dependencyFailure();
        }
        baselineRegisterAbsent = true;
      }
    }

    const evidenceArtifacts: Array<{ path: string; text: string }> = [];
    if (parsed.program !== RELEASE_PROGRAMS[0] && parsed.phase._tag === "Release") {
      const evidencePath = parsed.evidence;
      if (typeof evidencePath !== "string" || !isNativeAbsolutePath(evidencePath)) {
        return dependencyFailure();
      }
      const classified = yield* callPort(() =>
        services.fileRead.classifyPath({
          path: evidencePath,
        }),
      ).pipe(Effect.either);
      if (classified._tag === "Left") return dependencyFailure();
      const kind = classified.right;
      if (kind._tag === "NotFound" || kind._tag === "Other") {
        return dependencyFailure();
      }
      const collected: string[] = [];
      let evidenceBound: string;
      if (kind._tag === "File") {
        const parent = dirname(evidencePath);
        if (!isNativeAbsolutePath(parent)) return dependencyFailure();
        evidenceBound = parent;
        collected.push(evidencePath);
      } else {
        evidenceBound = evidencePath;
        const pending: string[] = [evidencePath];
        while (pending.length > 0) {
          const directory = pending.pop()!;
          const listed = yield* callPort(() =>
            services.fileRead.listDirectory({
              path: directory,
              containmentRoot: evidenceBound,
            }),
          ).pipe(Effect.either);
          if (listed._tag === "Left") return dependencyFailure();
          const names = [...listed.right].sort(compareUtf8Bytes);
          for (const name of names) {
            if (name.includes("/") || name.includes("\\") || name.includes("\0")) {
              return dependencyFailure();
            }
            if (name === "." || name === "..") continue;
            const child = join(directory, name);
            const childKind = yield* callPort(() =>
              services.fileRead.classifyPath({
                path: child,
                containmentRoot: evidenceBound,
              }),
            ).pipe(Effect.either);
            if (childKind._tag === "Left") return dependencyFailure();
            if (childKind.right._tag === "Directory") {
              pending.push(child);
              continue;
            }
            if (childKind.right._tag !== "File") continue;
            if (!evidenceFileNameIsIncluded(name)) continue;
            collected.push(child);
            if (collected.length > EVIDENCE_FILE_LIMIT) {
              return dependencyFailure();
            }
          }
        }
        collected.sort(compareUtf8Bytes);
      }
      for (const filePath of collected) {
        const evidenceRead = yield* readBoundedPort(
          services.fileRead,
          filePath,
          evidenceBound,
        );
        if (evidenceRead._tag !== "Ok") return dependencyFailure();
        const evidenceText = decodeUtf8Fatal(evidenceRead.bytes);
        if (evidenceText === null) return dependencyFailure();
        evidenceArtifacts.push({ path: filePath, text: evidenceText });
      }
    }

    return validateReleaseCoverageV1({
      phase: parsed.phase,
      registerText,
      roadmapBytes,
      activeChangeNames,
      roadmapRows,
      workflowByChange,
      changedSuperpowersPaths: changed.right,
      expectedBriefByOwner,
      packageBriefBytesByOwner,
      program: parsed.program,
      ...(Object.keys(tasksMarkdownByOwner).length > 0
        ? { tasksMarkdownByOwner }
        : {}),
      ...(baselineRegisterText !== undefined ? { baselineRegisterText } : {}),
      ...(baselineRegisterAbsent ? { baselineRegisterAbsent: true } : {}),
      ...(evidenceArtifacts.length > 0 ? { evidenceArtifacts } : {}),
    });
  }).pipe(
    Effect.catchAll((): Effect.Effect<ReleaseCoverageResultV1, never> =>
      Effect.succeed(dependencyFailure()),
    ),
    Effect.catchAllDefect((): Effect.Effect<ReleaseCoverageResultV1, never> =>
      Effect.succeed(dependencyFailure()),
    ),
  );
}

export function runReleaseCoverageCli(
  argv: ReadonlyArray<string>,
  io: ReleaseCoverageCliIo,
  services: ReleaseCoverageCliServices,
): Effect.Effect<number, never> {
  return Effect.gen(function* () {
    const parsed = parseArgv(argv);
    if (parsed._tag === "Invalid") {
      io.writeStderr(USAGE_DIAGNOSTIC);
      return EXIT_USAGE;
    }
    if (parsed._tag === "WrongProgram") {
      return emitEvaluated(io, invalidResult("wrong_program"));
    }
    const result = yield* evaluateReleaseCoverage(parsed, services);
    return emitEvaluated(io, result);
  }).pipe(
    Effect.catchAllDefect(() =>
      Effect.sync(() => emitEvaluated(io, dependencyFailure())),
    ),
  );
}

function boundedReadOpenFlagsLive(): number {
  let flags = fsConstants.O_RDONLY;
  const c = fsConstants as Record<string, number | undefined>;
  if (typeof c.O_NONBLOCK === "number") flags |= c.O_NONBLOCK;
  if (typeof c.O_NOFOLLOW === "number") flags |= c.O_NOFOLLOW;
  return flags;
}

function isEnoentLive(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}

function isInsideRootLive(root: string, path: string): boolean {
  const rel = relative(root, path);
  if (rel.length === 0) return true;
  if (isAbsolute(rel)) return false;
  if (rel === "..") return false;
  return !rel.startsWith(`..${sep}`);
}

function readFailureLive(
  tag:
    | "Containment"
    | "IdentityChanged"
    | "NotFile"
    | "NotFound"
    | "Oversize"
    | "Symlink"
    | "Unreadable",
  message: string,
): never {
  throw Object.assign(new Error(message), { _tag: tag });
}

function sameRegularFileIdentityLive(left: Stats, right: Stats): boolean {
  return (
    left.isFile() &&
    right.isFile() &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

function validateContainmentLive(path: string, containmentRoot: string): void {
  const absoluteRoot = resolve(containmentRoot);
  const absolutePath = resolve(path);
  if (!isInsideRootLive(absoluteRoot, absolutePath)) {
    readFailureLive("Containment", "path escapes containment root");
  }
  const rel = relative(absoluteRoot, absolutePath);
  if (rel.length !== 0) {
    const segments = rel.split(sep);
    let current = absoluteRoot;
    for (let index = 0; index < segments.length; index++) {
      current = resolve(current, segments[index]!);
      let component: Stats;
      try {
        component = lstatSync(current);
      } catch (error) {
        if (isEnoentLive(error)) {
          readFailureLive("NotFound", "file not found");
        }
        throw error;
      }
      if (component.isSymbolicLink()) {
        readFailureLive("Symlink", "symlink below containment root");
      }
      if (index < segments.length - 1 && !component.isDirectory()) {
        readFailureLive("Unreadable", "intermediate component is not a directory");
      }
    }
  }
  let physicalRoot: string;
  try {
    physicalRoot = realpathSync(absoluteRoot);
  } catch {
    readFailureLive("Unreadable", "containment root is unreadable");
  }
  let physicalRootStats: Stats;
  try {
    physicalRootStats = lstatSync(physicalRoot);
  } catch {
    readFailureLive("Unreadable", "physical containment root is unreadable");
  }
  if (!physicalRootStats.isDirectory()) {
    readFailureLive("Containment", "containment root is not a directory");
  }
  let physicalPath: string;
  try {
    physicalPath = realpathSync(absolutePath);
  } catch (error) {
    if (isEnoentLive(error)) readFailureLive("NotFound", "file not found");
    throw error;
  }
  if (!isInsideRootLive(physicalRoot, physicalPath)) {
    readFailureLive("Containment", "physical path escapes containment root");
  }
}

function readBoundedBytesLive(
  path: string,
  maxBytes: number,
  containmentRoot?: string,
): Uint8Array {
  let fd: number | undefined;
  try {
    if (containmentRoot !== undefined) {
      validateContainmentLive(path, containmentRoot);
    }
    let before: Stats;
    try {
      before = lstatSync(path);
    } catch (error) {
      if (isEnoentLive(error)) readFailureLive("NotFound", "file not found");
      throw error;
    }
    if (before.isSymbolicLink()) readFailureLive("Symlink", "leaf is a symlink");
    if (!before.isFile()) readFailureLive("NotFile", "leaf is not a regular file");
    try {
      fd = openSync(path, boundedReadOpenFlagsLive());
    } catch (error) {
      if (isEnoentLive(error)) {
        readFailureLive("IdentityChanged", "leaf changed before open");
      }
      throw error;
    }
    const opened = fstatSync(fd);
    if (!sameRegularFileIdentityLive(before, opened)) {
      readFailureLive("IdentityChanged", "leaf identity changed during open");
    }
    const cap = maxBytes + 1;
    const buffer = Buffer.allocUnsafe(cap);
    let offset = 0;
    while (offset < cap) {
      const count = readSync(fd, buffer, offset, cap - offset, offset);
      if (count === 0) break;
      offset += count;
    }
    if (offset > maxBytes) readFailureLive("Oversize", "file exceeds the read bound");
    let afterOpen: Stats;
    try {
      afterOpen = fstatSync(fd);
    } catch {
      readFailureLive("IdentityChanged", "opened descriptor became unreadable");
    }
    let afterPath: Stats;
    try {
      afterPath = lstatSync(path);
    } catch {
      readFailureLive("IdentityChanged", "leaf changed after read");
    }
    if (
      afterPath.isSymbolicLink() ||
      !sameRegularFileIdentityLive(opened, afterOpen) ||
      !sameRegularFileIdentityLive(opened, afterPath)
    ) {
      readFailureLive("IdentityChanged", "leaf identity changed during read");
    }
    if (containmentRoot !== undefined) {
      validateContainmentLive(path, containmentRoot);
    }
    return Uint8Array.from(buffer.subarray(0, offset));
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

function classifyPathLive(
  path: string,
  containmentRoot?: string,
): ReleaseCoveragePathClass {
  if (containmentRoot !== undefined) {
    try {
      validateContainmentLive(path, containmentRoot);
    } catch (error) {
      if (isNotFoundError(error)) return { _tag: "NotFound" };
      throw error;
    }
  }
  let stats: Stats;
  try {
    stats = lstatSync(path);
  } catch (error) {
    if (isEnoentLive(error)) return { _tag: "NotFound" };
    throw error;
  }
  if (stats.isSymbolicLink()) return { _tag: "Other" };
  if (stats.isFile()) return { _tag: "File" };
  if (stats.isDirectory()) return { _tag: "Directory" };
  return { _tag: "Other" };
}

function listDirectoryLive(
  path: string,
  containmentRoot?: string,
): readonly string[] {
  if (containmentRoot !== undefined) {
    validateContainmentLive(path, containmentRoot);
  }
  let stats: Stats;
  try {
    stats = lstatSync(path);
  } catch (error) {
    if (isEnoentLive(error)) readFailureLive("NotFound", "directory not found");
    throw error;
  }
  if (stats.isSymbolicLink()) readFailureLive("Symlink", "directory is a symlink");
  if (!stats.isDirectory()) {
    readFailureLive("NotFile", "path is not a directory");
  }
  const names: string[] = [];
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    names.push(entry.name);
  }
  return names;
}

function isWindowsSafeAbsolutePath(
  value: string,
  expectedBasename?: string,
): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  if (!win32.isAbsolute(value)) return false;
  if (expectedBasename !== undefined) {
    if (win32.basename(value).toLowerCase() !== expectedBasename) return false;
  }
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) return false;
  }
  return !/["%!^&|<>()]/u.test(value);
}

/**
 * Pure OpenSpec argv planner. Live services resolve `openspec` on PATH, then
 * execute only a plan this helper returns.
 */
export function planOpenSpecInvocationV1(input: {
  readonly platform: NodeJS.Platform;
  readonly comSpec: string | undefined;
  readonly resolvedOpenSpec: string;
}):
  | { readonly _tag: "Ok"; readonly command: string; readonly args: readonly string[] }
  | { readonly _tag: "Invalid" } {
  const resolved = input.resolvedOpenSpec;
  if (typeof resolved !== "string" || resolved.length === 0) {
    return { _tag: "Invalid" };
  }
  if (resolved.includes("\0")) return { _tag: "Invalid" };

  if (input.platform === "win32") {
    const comSpec = input.comSpec;
    if (typeof comSpec !== "string" || comSpec.length === 0) {
      return { _tag: "Invalid" };
    }
    if (!isWindowsSafeAbsolutePath(comSpec, "cmd.exe")) {
      return { _tag: "Invalid" };
    }
    if (!isWindowsSafeAbsolutePath(resolved)) return { _tag: "Invalid" };
    if (!/\.cmd$/i.test(resolved)) return { _tag: "Invalid" };
    return {
      _tag: "Ok",
      command: comSpec,
      args: ["/d", "/s", "/c", `"${resolved}" list --json`],
    };
  }

  if (!posix.isAbsolute(resolved)) return { _tag: "Invalid" };
  return {
    _tag: "Ok",
    command: resolved,
    args: ["list", "--json"],
  };
}

function isPhysicallyInsideRepository(
  repository: string,
  absolutePath: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const pathApi = platform === "win32" ? win32 : posix;
  const rel = pathApi.relative(repository, absolutePath);
  if (rel.length === 0) return true;
  if (pathApi.isAbsolute(rel)) return false;
  if (rel === "..") return false;
  if (rel.startsWith(`..${pathApi.sep}`)) return false;
  return true;
}

function isSafeRelativeGitPath(path: string): boolean {
  if (path.length === 0) return false;
  if (path.includes("\0")) return false;
  if (isAbsolute(path)) return false;
  if (path.startsWith("/")) return false;
  if (/^[A-Za-z]:[\\/]/.test(path)) return false;
  if (path.includes("\\")) return false;
  const segments = path.split("/");
  for (const segment of segments) {
    if (segment.length === 0) return false;
    if (segment === "." || segment === "..") return false;
  }
  return true;
}

/**
 * Parse git `-z` stdout: empty → [], otherwise require a terminal NUL, fatal
 * UTF-8, no empty path fields, and only safe relative paths.
 */
function parseNulDelimitedGitPaths(
  bytes: Uint8Array,
): readonly string[] | null {
  if (bytes.byteLength === 0) return [];
  if (bytes[bytes.byteLength - 1] !== 0) return null;
  const text = decodeUtf8Fatal(bytes);
  if (text === null) return null;
  const parts = text.split("\0");
  if (parts.length < 2) return null;
  if (parts[parts.length - 1] !== "") return null;
  const paths = parts.slice(0, -1);
  for (const path of paths) {
    if (!isSafeRelativeGitPath(path)) return null;
  }
  return paths;
}

function dedupeUtf8ByteOrder(paths: readonly string[]): readonly string[] {
  const sorted = [...paths].sort(compareUtf8Bytes);
  const out: string[] = [];
  let previous: string | undefined;
  for (const path of sorted) {
    if (previous !== undefined && previous === path) continue;
    out.push(path);
    previous = path;
  }
  return out;
}

function parseGitTopLevel(
  bytes: Uint8Array,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const text = decodeUtf8Fatal(bytes);
  if (text === null || !text.endsWith("\n") || text.endsWith("\r\n")) {
    return null;
  }
  const line = text.slice(0, -1);
  if (line.length === 0) return null;
  if (line.includes("\n") || line.includes("\r")) return null;
  if (hasAnyControl(line)) return null;
  const pathApi = platform === "win32" ? win32 : posix;
  if (!pathApi.isAbsolute(line)) return null;
  return line;
}

function gitArgv(args: readonly string[]): string[] {
  return ["--no-replace-objects", ...args];
}

function capturedStderrText(result: CapturedProcessResult): string {
  if (result.stderrBytes === undefined) return result.stderr;
  const decoded = decodeUtf8Fatal(result.stderrBytes);
  return decoded === null ? "fatal:" : decoded;
}

function requireCapturedStdoutBytes(
  result: CapturedProcessResult,
): Effect.Effect<Uint8Array, unknown> {
  if (result.exitCode !== 0) {
    return Effect.fail({ _tag: "NonZeroExit" as const });
  }
  if (result.stdoutBytes === undefined) {
    return Effect.fail({ _tag: "MissingStdoutBytes" as const });
  }
  return Effect.succeed(result.stdoutBytes);
}

const baseLiveReleaseCoverageCliServices = makeLiveReleaseCoverageCliServices({
    runCaptured: (input) =>
      Effect.gen(function* () {
        const exec = yield* ProcessExec;
        return yield* exec.runCaptured(input);
      }).pipe(Effect.provide(liveProcessExec)),
    which: (name) =>
      Effect.gen(function* () {
        const lookup = yield* PathLookup;
        return yield* lookup.which(name);
      }).pipe(Effect.provide(livePathLookup)),
    realpath: (path) =>
      Effect.try({
        try: () => realpathSync(path),
        catch: (error) => error,
      }),
    findWorktreeRoot: (path) =>
      Effect.try({
        try: () => findWorktreeRootLive(path),
        catch: (error) => error,
      }),
    nodeExecutable: process.execPath,
    platform: process.platform,
    comSpec: process.env.ComSpec ?? process.env.COMSPEC,
    cwd: () => process.cwd(),
    nullDevice: devNull,
    baseEnvironment: process.env,
  });

export const liveReleaseCoverageCliServices: ReleaseCoverageCliServices = {
  ...baseLiveReleaseCoverageCliServices,
  familySource: {
    resolve: (input) =>
      Effect.gen(function* () {
        const ledger = yield* EndstopLedger;
        const status = yield* ledger.familyStatus({
          rootContractId: input.contractId,
          rootContractSha256: input.contractSha256,
          familySha256: input.familySha256,
        });
        const sourcePath = join(
          input.stateRoot,
          "release-families",
          input.familySha256,
          "source.json",
        );
        const sourceBytes = yield* Effect.try({
          try: () => readBoundedBytesLive(sourcePath, ONE_MIB),
          catch: (error) => error,
        });
        if (
          sha256Hex(sourceBytes) !== status.authority.sourceSha256 ||
          status.family.manifest.sourceSha256 !== status.authority.sourceSha256
        ) {
          return yield* Effect.fail({ _tag: "FamilySourceMismatch" as const });
        }
        const source = decodeExecutionFamilySourceFileV1(sourceBytes);
        if (isExecutionFamilyFailure(source)) {
          return yield* Effect.fail({ _tag: "FamilySourceInvalid" as const });
        }
        return {
          stateRoot: input.stateRoot,
          contractId: input.contractId,
          contractSha256: input.contractSha256,
          familySha256: input.familySha256,
          source,
        };
      }).pipe(
        Effect.provide(makeLiveEndstopLedgerLayer(input.stateRoot)),
      ),
  },
};
