import { Effect, Layer } from "effect";
import { execFile } from "node:child_process";
import {
  closeSync,
  constants as fsConstants,
  copyFileSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { MAX_INPUT_BYTES } from "@foreman/core";
import { gitArgv, sanitizedGitEnv } from "./git-env.js";
import {
  FileSystem,
  GitIdentity,
  liveClock,
  noopMutationProbe,
  PolicyFsError,
  PolicyGitError,
  type FileStat,
  type GitCommitSnapshot,
} from "./services.js";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 5_000;
const GIT_MAX_BUFFER = MAX_INPUT_BYTES + 1;

function toStat(s: {
  isFile: () => boolean;
  isDirectory: () => boolean;
  isSymbolicLink: () => boolean;
  size: number;
  nlink: number;
}): FileStat {
  return {
    isFile: s.isFile(),
    isDirectory: s.isDirectory(),
    isSymbolicLink: s.isSymbolicLink(),
    size: s.size,
    nlink: s.nlink,
  };
}

function readFileBoundedSync(path: string, maxBytes: number): Uint8Array {
  const fd = openSync(path, fsConstants.O_RDONLY);
  try {
    const cap = maxBytes + 1;
    const buf = Buffer.allocUnsafe(cap);
    let offset = 0;
    while (offset < cap) {
      const n = readSync(fd, buf, offset, cap - offset, offset);
      if (n === 0) break;
      offset += n;
    }
    if (offset > maxBytes) {
      throw new PolicyFsError("oversize_input");
    }
    return new Uint8Array(buf.buffer, buf.byteOffset, offset);
  } finally {
    closeSync(fd);
  }
}

async function gitText(
  repoRoot: string,
  args: string[],
  maxBuffer = 4096,
): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", gitArgv(args), {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: GIT_TIMEOUT_MS,
      maxBuffer,
      windowsHide: true,
      env: sanitizedGitEnv(),
    });
    return stdout;
  } catch {
    throw new PolicyGitError("internal_failed");
  }
}

async function gitBytes(
  repoRoot: string,
  args: string[],
): Promise<Uint8Array> {
  try {
    const { stdout } = await execFileAsync("git", gitArgv(args), {
      cwd: repoRoot,
      encoding: "buffer",
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER,
      windowsHide: true,
      env: sanitizedGitEnv(),
    });
    const buf = stdout as Buffer;
    if (buf.byteLength > MAX_INPUT_BYTES) {
      throw new PolicyGitError("oversize_input");
    }
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  } catch (e) {
    if (e instanceof PolicyGitError) throw e;
    throw new PolicyGitError("authority_missing");
  }
}

function sha40(s: string): string {
  const t = s.trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(t)) {
    throw new PolicyGitError("internal_failed");
  }
  return t;
}

export const liveFileSystem = Layer.succeed(FileSystem, {
  readFile: (path, maxBytes) =>
    Effect.try({
      try: () => readFileBoundedSync(path, maxBytes),
      catch: (e) =>
        e instanceof PolicyFsError ? e : new PolicyFsError("internal_failed"),
    }),
  writeExclusive: (path, data) =>
    Effect.try({
      try: () => {
        const fd = openSync(
          path,
          fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL,
          0o600,
        );
        try {
          writeSync(fd, data);
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
      },
      catch: () => new PolicyFsError("mutation_rejected"),
    }),
  lstat: (path) =>
    Effect.try({
      try: () => toStat(lstatSync(path)),
      catch: () => new PolicyFsError("internal_failed"),
    }),
  stat: (path) =>
    Effect.try({
      try: () => toStat(statSync(path)),
      catch: () => new PolicyFsError("internal_failed"),
    }),
  exists: (path) => Effect.sync(() => existsSync(path)),
  unlink: (path) =>
    Effect.try({
      try: () => {
        unlinkSync(path);
      },
      catch: () => new PolicyFsError("mutation_rejected"),
    }),
  rename: (from, to) =>
    Effect.try({
      try: () => {
        renameSync(from, to);
      },
      catch: () => new PolicyFsError("mutation_rejected"),
    }),
  copyFile: (from, to) =>
    Effect.try({
      try: () => {
        copyFileSync(from, to);
      },
      catch: () => new PolicyFsError("mutation_rejected"),
    }),
  fsyncPath: (path) =>
    Effect.try({
      try: () => {
        const fd = openSync(path, fsConstants.O_RDONLY);
        try {
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
      },
      catch: () => new PolicyFsError("internal_failed"),
    }),
  parentDirExists: (path) =>
    Effect.sync(() => {
      const parent = dirname(path);
      try {
        return statSync(parent).isDirectory();
      } catch {
        return false;
      }
    }),
});

export const liveGitIdentity = Layer.succeed(GitIdentity, {
  snapshotAuthority: (repoRoot, relativePath) =>
    Effect.tryPromise({
      try: async () => {
        if (
          relativePath.includes("..") ||
          relativePath.startsWith("/") ||
          relativePath.includes("\\")
        ) {
          throw new PolicyGitError("authority_missing");
        }

        const commitC = sha40(await gitText(repoRoot, ["rev-parse", "HEAD"]));
        const treeC = sha40(
          await gitText(repoRoot, ["rev-parse", `${commitC}^{tree}`]),
        );

        const parentLine = (
          await gitText(repoRoot, ["show", "-s", "--format=%P", commitC])
        ).trim();
        const parents = parentLine.length === 0 ? [] : parentLine.split(/\s+/);
        let parentP: string | null = null;
        let treeP: string | null = null;
        let approvalCommitEligible = false;
        let parentBlobBytes: Uint8Array | null = null;

        if (parents.length === 1) {
          parentP = sha40(parents[0]!);
          treeP = sha40(
            await gitText(repoRoot, ["rev-parse", `${parentP}^{tree}`]),
          );
          const diffOut = await gitText(
            repoRoot,
            ["diff", "--name-only", "-z", parentP, commitC],
            65_536,
          );
          const paths =
            diffOut.length === 0
              ? []
              : diffOut.split("\0").filter((p) => p.length > 0);
          approvalCommitEligible =
            paths.length === 1 && paths[0] === relativePath;

          // Parent register blob for approval-delta (bounded); missing is ok
          // for non-approval denials — mark null.
          try {
            parentBlobBytes = await gitBytes(repoRoot, [
              "show",
              `${parentP}:${relativePath}`,
            ]);
          } catch {
            parentBlobBytes = null;
            // If path-only change claimed but parent blob missing, ineligible
            if (approvalCommitEligible) {
              approvalCommitEligible = false;
            }
          }
        }

        const porcelain = await gitText(
          repoRoot,
          ["status", "--porcelain", "--", relativePath],
          65_536,
        );
        if (porcelain.trim().length > 0) {
          throw new PolicyGitError("authority_dirty");
        }

        const commitBlobBytes = await gitBytes(repoRoot, [
          "show",
          `${commitC}:${relativePath}`,
        ]);

        const abs = join(repoRoot, relativePath);
        let worktreeBytes: Uint8Array;
        try {
          worktreeBytes = readFileBoundedSync(abs, MAX_INPUT_BYTES);
        } catch (e) {
          if (e instanceof PolicyFsError) {
            throw new PolicyGitError(e.reason);
          }
          throw new PolicyGitError("authority_missing");
        }
        if (
          worktreeBytes.byteLength !== commitBlobBytes.byteLength ||
          !bytesEqual(worktreeBytes, commitBlobBytes)
        ) {
          throw new PolicyGitError("authority_dirty");
        }

        const headEnd = sha40(await gitText(repoRoot, ["rev-parse", "HEAD"]));
        if (headEnd !== commitC) {
          throw new PolicyGitError("authority_dirty");
        }

        const snapshot: GitCommitSnapshot = {
          commitC,
          treeC,
          parentP,
          treeP,
          approvalCommitEligible,
          parentBlobBytes,
        };
        return { snapshot, commitBlobBytes, worktreeBytes };
      },
      catch: (e) =>
        e instanceof PolicyGitError ? e : new PolicyGitError("internal_failed"),
    }),
});

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export const liveServices = Layer.mergeAll(
  liveFileSystem,
  liveGitIdentity,
  liveClock,
  noopMutationProbe,
);
