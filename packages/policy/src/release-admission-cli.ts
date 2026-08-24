import { execFile } from "node:child_process";
import {
  accessSync,
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
  statSync,
} from "node:fs";
import { devNull } from "node:os";
import {
  delimiter,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { promisify } from "node:util";

import {
  canonicalize,
  decodeUtf8Fatal,
  isCoreFailure,
  sha256Hex,
} from "@foreman/core";
import { Effect } from "effect";

import {
  evaluateReleaseEvidenceAfterGitResolutionV1,
  type ReleaseAdmissionFailureReason,
  type ReleaseEvidenceCheckResultV1,
} from "./release-admission.js";
import {
  decodeReleaseAuthorityFileV1,
  type ReleaseActionV1,
  type ReleaseCandidateIdentityV1,
} from "./release-authority.js";
import { gitArgv, sanitizedGitEnv } from "./git-env.js";

const ONE_MIB = 1_048_576;
const ACTIONS: readonly ReleaseActionV1[] = [
  "implement",
  "verify",
  "audit",
  "correct",
  "council",
  "provider_retry",
  "resume",
  "integrate",
  "publish",
  "evaluate",
];
const encoder = new TextEncoder();
const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 15_000;

export const RELEASE_ADMISSION_USAGE =
  "Usage: release-admission check --program v040 --action ACTION --package PACKAGE --repo ABS --candidate-commit SHA40 --evidence ABS\n";

export type ReleaseAdmissionCliIo = {
  readonly writeStdout: (line: string) => void;
  readonly writeStderr: (line: string) => void;
};

export type ReleaseAdmissionGitAuthorityV1 = {
  readonly candidate: ReleaseCandidateIdentityV1;
  readonly designTree: string;
  readonly designLineageValid: boolean;
  readonly approvedOpenSpecBytes: Readonly<Record<string, Uint8Array>>;
  readonly taskPlanBytes: Uint8Array;
};

export type ReleaseAdmissionCliServices = {
  readonly readEvidence: (input: {
    readonly path: string;
    readonly maxBytes: number;
  }) => Effect.Effect<Uint8Array, unknown>;
  readonly loadGitAuthority: (input: {
    readonly repository: string;
    readonly candidateCommit: string;
    readonly designCommit: string;
    readonly packageId: string;
    readonly maxBlobBytes: number;
    readonly maxSpecFiles: number;
    readonly maxRetainedBytes: number;
  }) => Effect.Effect<ReleaseAdmissionGitAuthorityV1, unknown>;
};

type ParsedArgs = {
  readonly action: ReleaseActionV1;
  readonly packageId: string;
  readonly repository: string;
  readonly candidateCommit: string;
  readonly evidencePath: string;
};

function isRunId(value: string): boolean {
  return (
    encoder.encode(value).byteLength >= 1 &&
    encoder.encode(value).byteLength <= 128 &&
    !/[\u0000-\u001f\u007f/\\]/.test(value)
  );
}

function compareUtf8(left: string, right: string): number {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  const length = Math.min(a.byteLength, b.byteLength);
  for (let index = 0; index < length; index += 1) {
    const delta = a[index]! - b[index]!;
    if (delta !== 0) return delta;
  }
  return a.byteLength - b.byteLength;
}

function isSha40(value: string): boolean {
  return /^[0-9a-f]{40}$/.test(value);
}

function commandTail(argv: readonly string[]): readonly string[] {
  if (argv[0] === "check") return argv;
  return argv.slice(2);
}

function parseArgs(argv: readonly string[]): ParsedArgs | null {
  const args = commandTail(argv);
  if (args.length !== 13) return null;
  if (
    args[0] !== "check" ||
    args[1] !== "--program" ||
    args[2] !== "v040" ||
    args[3] !== "--action" ||
    args[5] !== "--package" ||
    args[7] !== "--repo" ||
    args[9] !== "--candidate-commit" ||
    args[11] !== "--evidence"
  ) {
    return null;
  }
  const action = args[4];
  const packageId = args[6];
  const repository = args[8];
  const candidateCommit = args[10];
  const evidencePath = args[12];
  if (
    !ACTIONS.includes(action as ReleaseActionV1) ||
    typeof packageId !== "string" ||
    !isRunId(packageId) ||
    typeof repository !== "string" ||
    !isAbsolute(repository) ||
    typeof candidateCommit !== "string" ||
    !isSha40(candidateCommit) ||
    typeof evidencePath !== "string" ||
    !isAbsolute(evidencePath)
  ) {
    return null;
  }
  return {
    action: action as ReleaseActionV1,
    packageId,
    repository,
    candidateCommit,
    evidencePath,
  };
}

function safeWrite(write: (line: string) => void, line: string): void {
  try {
    write(line);
  } catch {
    // Output failures cannot expose dependency details or make the Effect fail.
  }
}

function writeResult(
  io: ReleaseAdmissionCliIo,
  result: ReleaseEvidenceCheckResultV1,
): number {
  safeWrite(io.writeStdout, `${canonicalize(result)}\n`);
  return result._tag === "EvidenceValid" ? 0 : 1;
}

function invalid(
  reason: ReleaseAdmissionFailureReason,
): ReleaseEvidenceCheckResultV1 {
  return { schemaVersion: 1, _tag: "EvidenceInvalid", reason };
}

export function runReleaseAdmissionCli(
  argv: readonly string[],
  io: ReleaseAdmissionCliIo,
  services: ReleaseAdmissionCliServices,
): Effect.Effect<number, never> {
  const program = Effect.gen(function* () {
    const parsed = parseArgs(argv);
    if (parsed === null) {
      safeWrite(io.writeStderr, RELEASE_ADMISSION_USAGE);
      return 64;
    }

    const evidence = yield* Effect.either(
      Effect.suspend(() =>
        services.readEvidence({
          path: parsed.evidencePath,
          maxBytes: ONE_MIB,
        }),
      ),
    );
    if (evidence._tag === "Left") {
      return writeResult(io, invalid("invalid_evidence"));
    }

    const decoded = decodeReleaseAuthorityFileV1(evidence.right);
    if (
      decoded._tag !== "Valid" ||
      decoded.value.schema !== "foreman.release-evidence-bundle.v1" ||
      decoded.value.receipts[0]?.schema !== "foreman.design-approval.v1"
    ) {
      return writeResult(io, invalid("invalid_evidence"));
    }
    const design = decoded.value.receipts[0];

    const authority = yield* Effect.either(
      Effect.suspend(() =>
        services.loadGitAuthority({
          repository: parsed.repository,
          candidateCommit: parsed.candidateCommit,
          designCommit: design.designCommit,
          packageId: parsed.packageId,
          maxBlobBytes: ONE_MIB,
          maxSpecFiles: 256,
          maxRetainedBytes: 16 * ONE_MIB,
        }),
      ),
    );
    if (authority._tag === "Left") {
      return writeResult(io, invalid("git_resolution_failure"));
    }
    if (authority.right.designTree !== design.designTree) {
      return writeResult(io, invalid("wrong_design_base"));
    }
    if (!authority.right.designLineageValid) {
      return writeResult(io, invalid("wrong_design_base"));
    }
    const candidate = authority.right.candidate;
    if (
      candidate.commit !== parsed.candidateCommit ||
      !isSha40(candidate.commit) ||
      !isSha40(candidate.tree) ||
      candidate.candidateSha256 !== sha256Hex(candidate.commit)
    ) {
      return writeResult(io, invalid("git_resolution_failure"));
    }

    const result = evaluateReleaseEvidenceAfterGitResolutionV1({
      action: parsed.action,
      packageId: parsed.packageId,
      candidate,
      approvedOpenSpecBytes: authority.right.approvedOpenSpecBytes,
      taskPlanBytes: authority.right.taskPlanBytes,
      evidenceBytes: evidence.right,
    });
    return writeResult(io, result);
  });

  return program.pipe(
    Effect.catchAllCause(() =>
      Effect.sync(() => writeResult(io, invalid("git_resolution_failure"))),
    ),
  );
}

function readBoundedRegularFile(path: string, maxBytes: number): Uint8Array {
  const noFollow =
    typeof fsConstants.O_NOFOLLOW === "number" ? fsConstants.O_NOFOLLOW : 0;
  const descriptor = openSync(path, fsConstants.O_RDONLY | noFollow);
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error("authority file is not regular");
    }
    const buffer = Buffer.allocUnsafe(maxBytes + 1);
    let offset = 0;
    while (offset < buffer.byteLength) {
      const count = readSync(
        descriptor,
        buffer,
        offset,
        buffer.byteLength - offset,
        offset,
      );
      if (count === 0) break;
      offset += count;
    }
    if (offset > maxBytes) throw new Error("authority file is oversized");
    return Uint8Array.from(buffer.subarray(0, offset));
  } finally {
    closeSync(descriptor);
  }
}

type TrustedGitContext = {
  readonly repository: string;
  readonly executable: string;
};

function isContainedPath(root: string, path: string): boolean {
  const rel = relative(root, path);
  return (
    rel.length === 0 ||
    (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`))
  );
}

function resolveTrustedGitContext(repository: string): TrustedGitContext {
  const physicalRepository = realpathSync(repository);
  const searchPath = process.env.PATH;
  if (searchPath === undefined) throw new Error("Git path is unavailable");
  const executableNames = process.platform === "win32" ? ["git.exe"] : ["git"];

  for (const entry of searchPath.split(delimiter)) {
    const directory =
      entry.length === 0
        ? repository
        : isAbsolute(entry)
          ? entry
          : resolve(repository, entry);
    for (const name of executableNames) {
      const candidate = resolve(directory, name);
      try {
        lstatSync(candidate);
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          (error as { readonly code?: unknown }).code === "ENOENT"
        ) {
          continue;
        }
        throw error;
      }
      const physicalExecutable = realpathSync(candidate);
      if (
        isContainedPath(repository, candidate) ||
        isContainedPath(physicalRepository, physicalExecutable)
      ) {
        throw new Error("repository-selected Git is forbidden");
      }
      if (!statSync(physicalExecutable).isFile()) {
        throw new Error("Git executable is not a regular file");
      }
      accessSync(
        physicalExecutable,
        process.platform === "win32" ? fsConstants.F_OK : fsConstants.X_OK,
      );
      return {
        repository: physicalRepository,
        executable: physicalExecutable,
      };
    }
  }
  throw new Error("Git executable is unavailable");
}

function closedGitEnvironment(executable: string): NodeJS.ProcessEnv {
  const base: NodeJS.ProcessEnv = { PATH: dirname(executable) };
  if (process.platform === "win32") base["PATHEXT"] = ".EXE";
  const environment = sanitizedGitEnv(base);
  environment["GIT_CONFIG_NOSYSTEM"] = "1";
  environment["GIT_CONFIG_GLOBAL"] = devNull;
  return environment;
}

async function runGitBytes(
  context: TrustedGitContext,
  args: readonly string[],
  maxBytes: number,
): Promise<Uint8Array> {
  const result = await execFileAsync(
    context.executable,
    gitArgv([
      "-c",
      "core.fsmonitor=false",
      "-c",
      `core.excludesFile=${devNull}`,
      ...args,
    ]),
    {
      cwd: context.repository,
      encoding: "buffer",
      env: closedGitEnvironment(context.executable),
      maxBuffer: maxBytes + 1,
      timeout: GIT_TIMEOUT_MS,
      windowsHide: true,
    },
  );
  const stdout = Buffer.isBuffer(result.stdout)
    ? result.stdout
    : Buffer.from(result.stdout ?? "");
  if (stdout.byteLength > maxBytes) throw new Error("Git output is oversized");
  return Uint8Array.from(stdout);
}

async function resolveGitObject(
  context: TrustedGitContext,
  expression: string,
): Promise<string> {
  const bytes = await runGitBytes(
    context,
    ["rev-parse", "--verify", expression],
    64,
  );
  const text = decodeUtf8Fatal(bytes);
  if (isCoreFailure(text) || !/^[0-9a-f]{40}\n$/.test(text)) {
    throw new Error("Git object identity is invalid");
  }
  return text.slice(0, -1);
}

async function isLinearDesignDescendant(
  context: TrustedGitContext,
  designCommit: string,
  candidateCommit: string,
): Promise<boolean> {
  if (candidateCommit === designCommit) return true;
  const bytes = await runGitBytes(
    context,
    [
      "rev-list",
      "--ancestry-path",
      "--parents",
      `${designCommit}..${candidateCommit}`,
    ],
    ONE_MIB,
  );
  const text = decodeUtf8Fatal(bytes);
  if (isCoreFailure(text) || text.length === 0 || !text.endsWith("\n")) {
    return false;
  }
  const parents = new Map<string, string>();
  for (const line of text.slice(0, -1).split("\n")) {
    const fields = line.split(" ");
    if (
      fields.length !== 2 ||
      !isSha40(fields[0]!) ||
      !isSha40(fields[1]!)
    ) {
      return false;
    }
    parents.set(fields[0]!, fields[1]!);
  }
  const visited = new Set<string>();
  let cursor = candidateCommit;
  while (cursor !== designCommit) {
    if (visited.has(cursor)) return false;
    visited.add(cursor);
    const parent = parents.get(cursor);
    if (parent === undefined) return false;
    cursor = parent;
  }
  return true;
}

function parseNulPaths(bytes: Uint8Array): readonly string[] {
  if (bytes.byteLength === 0) return [];
  const text = decodeUtf8Fatal(bytes);
  if (isCoreFailure(text) || !text.endsWith("\0")) {
    throw new Error("Git path frame is invalid");
  }
  const paths = text.slice(0, -1).split("\0");
  if (
    paths.some(
      (path) =>
        path.length === 0 ||
        /[\u0000-\u001f\u007f\\]/.test(path) ||
        path.split("/").some((segment) => segment === "" || segment === "." || segment === ".."),
    )
  ) {
    throw new Error("Git path is invalid");
  }
  return paths;
}

async function loadGitAuthorityLive(input: {
  readonly repository: string;
  readonly candidateCommit: string;
  readonly designCommit: string;
  readonly packageId: string;
  readonly maxBlobBytes: number;
  readonly maxSpecFiles: number;
  readonly maxRetainedBytes: number;
}): Promise<ReleaseAdmissionGitAuthorityV1> {
  const context = resolveTrustedGitContext(input.repository);
  const candidateCommit = await resolveGitObject(
    context,
    `${input.candidateCommit}^{commit}`,
  );
  if (candidateCommit !== input.candidateCommit) {
    throw new Error("candidate identity changed");
  }
  const candidateTree = await resolveGitObject(
    context,
    `${candidateCommit}^{tree}`,
  );
  const designCommit = await resolveGitObject(
    context,
    `${input.designCommit}^{commit}`,
  );
  if (designCommit !== input.designCommit) {
    throw new Error("design identity changed");
  }
  const designTree = await resolveGitObject(
    context,
    `${designCommit}^{tree}`,
  );
  const designLineageValid = await isLinearDesignDescendant(
    context,
    designCommit,
    candidateCommit,
  );

  const prefix = `openspec/changes/${input.packageId}/`;
  const listed = parseNulPaths(
    await runGitBytes(
      context,
      ["ls-tree", "-r", "-z", "--name-only", designCommit, "--", prefix],
      ONE_MIB,
    ),
  );
  const retainedPaths: string[] = [];
  let specCount = 0;
  for (const path of listed) {
    if (!path.startsWith(prefix)) throw new Error("Git path escaped package");
    const relative = path.slice(prefix.length);
    if (
      relative === "proposal.md" ||
      relative === "design.md" ||
      relative === "tasks.md" ||
      relative.startsWith("specs/")
    ) {
      retainedPaths.push(path);
      if (relative.startsWith("specs/")) specCount += 1;
    }
  }
  if (specCount > input.maxSpecFiles) throw new Error("too many specifications");

  let retainedBytes = 0;
  let taskPlanBytes: Uint8Array | null = null;
  const approvedRows: Array<{ readonly path: string; readonly bytes: Uint8Array }> = [];
  for (const path of retainedPaths) {
    const bytes = await runGitBytes(
      context,
      ["cat-file", "blob", `${designCommit}:${path}`],
      input.maxBlobBytes,
    );
    retainedBytes += bytes.byteLength;
    if (retainedBytes > input.maxRetainedBytes) {
      throw new Error("retained authority is oversized");
    }
    const relative = path.slice(prefix.length);
    if (relative === "tasks.md") {
      taskPlanBytes = bytes;
    } else {
      approvedRows.push({ path: relative, bytes });
    }
  }
  if (taskPlanBytes === null) throw new Error("task plan is missing");
  approvedRows.sort((left, right) => compareUtf8(left.path, right.path));
  const approvedOpenSpecBytes: Record<string, Uint8Array> = {};
  for (const row of approvedRows) approvedOpenSpecBytes[row.path] = row.bytes;

  return {
    candidate: {
      commit: candidateCommit,
      tree: candidateTree,
      candidateSha256: sha256Hex(candidateCommit),
    },
    designTree,
    designLineageValid,
    approvedOpenSpecBytes,
    taskPlanBytes,
  };
}

export const liveReleaseAdmissionCliServices: ReleaseAdmissionCliServices = {
  readEvidence: (input) =>
    Effect.try({
      try: () => readBoundedRegularFile(input.path, input.maxBytes),
      catch: (error) => error,
    }),
  loadGitAuthority: (input) =>
    Effect.tryPromise({
      try: () => loadGitAuthorityLive(input),
      catch: (error) => error,
    }),
};
