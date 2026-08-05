import { Effect, Layer } from "effect";
import { execFile } from "node:child_process";
import {
  closeSync,
  constants as fsConstants,
  copyFileSync,
  existsSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
  type Stats,
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

function idStr(v: number | bigint): string {
  return typeof v === "bigint" ? v.toString() : String(v);
}

function toStat(s: Stats): FileStat {
  return {
    isFile: s.isFile(),
    isDirectory: s.isDirectory(),
    isSymbolicLink: s.isSymbolicLink(),
    size: s.size,
    nlink: s.nlink,
    mode: s.mode,
    dev: idStr(s.dev),
    ino: idStr(s.ino),
  };
}

function readFdBounded(fd: number, maxBytes: number): Uint8Array {
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
}

function writeFdFull(fd: number, data: Uint8Array): void {
  let offset = 0;
  while (offset < data.byteLength) {
    const n = writeSync(
      fd,
      data,
      offset,
      data.byteLength - offset,
      offset,
    );
    if (n <= 0) {
      throw new PolicyFsError("mutation_rejected");
    }
    offset += n;
  }
}

function readFileBoundedSync(path: string, maxBytes: number): Uint8Array {
  const fd = openSync(path, fsConstants.O_RDONLY);
  try {
    return readFdBounded(fd, maxBytes);
  } finally {
    closeSync(fd);
  }
}

function readFileNoFollowSync(
  path: string,
  maxBytes: number,
): { bytes: Uint8Array; stat: FileStat } {
  const flags = fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW;
  let fd: number;
  try {
    fd = openSync(path, flags);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ELOOP" || err.code === "EINVAL") {
      throw new PolicyFsError("source_is_symlink");
    }
    if (err.code === "ENOENT") {
      throw new PolicyFsError("target_missing");
    }
    throw new PolicyFsError("internal_failed");
  }
  try {
    const st = toStat(fstatSync(fd));
    if (st.isSymbolicLink) {
      throw new PolicyFsError("source_is_symlink");
    }
    if (!st.isFile || st.isDirectory) {
      throw new PolicyFsError("source_not_regular_file");
    }
    const bytes = readFdBounded(fd, maxBytes);
    return { bytes, stat: { ...st, size: bytes.byteLength } };
  } finally {
    closeSync(fd);
  }
}

function createFileExclusiveSync(
  path: string,
  data: Uint8Array,
  mode: number,
): void {
  let fd: number;
  try {
    fd = openSync(
      path,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL,
      mode,
    );
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "EEXIST") {
      throw new PolicyFsError("mutation_rejected");
    }
    throw new PolicyFsError("mutation_rejected");
  }
  try {
    writeFdFull(fd, data);
    // Override umask-applied bits with the exact approved mode.
    fchmodSync(fd, mode);
    fsyncSync(fd);
    const st = fstatSync(fd);
    if (st.size !== data.byteLength) {
      throw new PolicyFsError("mutation_rejected");
    }
    if ((st.mode & 0o777) !== (mode & 0o777)) {
      throw new PolicyFsError("mutation_rejected");
    }
  } catch (e) {
    try {
      closeSync(fd);
    } catch {
      /* ignore */
    }
    try {
      unlinkSync(path);
    } catch {
      /* ignore */
    }
    if (e instanceof PolicyFsError) throw e;
    throw new PolicyFsError("mutation_rejected");
  }
  closeSync(fd);
  // Post-close no-follow verify of restored identity and bytes.
  const verify = readFileNoFollowSync(path, data.byteLength);
  if (verify.bytes.byteLength !== data.byteLength) {
    throw new PolicyFsError("mutation_rejected");
  }
  for (let i = 0; i < data.byteLength; i += 1) {
    if (verify.bytes[i] !== data[i]) {
      throw new PolicyFsError("mutation_rejected");
    }
  }
  if ((verify.stat.mode & 0o777) !== (mode & 0o777)) {
    throw new PolicyFsError("mutation_rejected");
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

function rejectBadRelPath(relativePath: string): void {
  if (
    relativePath.includes("..") ||
    relativePath.startsWith("/") ||
    relativePath.includes("\\") ||
    relativePath.length === 0
  ) {
    throw new PolicyGitError("invalid_path");
  }
}

export const liveFileSystem = Layer.succeed(FileSystem, {
  readFile: (path, maxBytes) =>
    Effect.try({
      try: () => readFileBoundedSync(path, maxBytes),
      catch: (e) =>
        e instanceof PolicyFsError ? e : new PolicyFsError("internal_failed"),
    }),
  readFileNoFollow: (path, maxBytes) =>
    Effect.try({
      try: () => readFileNoFollowSync(path, maxBytes),
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
          writeFdFull(fd, data);
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
      },
      catch: () => new PolicyFsError("mutation_rejected"),
    }),
  createFile: (path, data, mode) =>
    Effect.try({
      try: () => createFileExclusiveSync(path, data, mode),
      catch: (e) =>
        e instanceof PolicyFsError ? e : new PolicyFsError("mutation_rejected"),
    }),
  lstat: (path) =>
    Effect.try({
      try: () => toStat(lstatSync(path)),
      catch: (e) => {
        const err = e as NodeJS.ErrnoException;
        if (err.code === "ENOENT") return new PolicyFsError("target_missing");
        return new PolicyFsError("internal_failed");
      },
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

          try {
            parentBlobBytes = await gitBytes(repoRoot, [
              "show",
              `${parentP}:${relativePath}`,
            ]);
          } catch {
            parentBlobBytes = null;
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
  inspectTrackedAtCommit: (repoRoot, commitSha, relativePath) =>
    Effect.tryPromise({
      try: async () => {
        rejectBadRelPath(relativePath);
        const commit = sha40(commitSha);
        const out = await gitText(
          repoRoot,
          ["ls-tree", "-z", commit, "--", relativePath],
          65_536,
        );
        if (out.length === 0) {
          throw new PolicyGitError("target_untracked");
        }
        const rec = out.split("\0").find((p) => p.length > 0) ?? "";
        const tab = rec.indexOf("\t");
        if (tab < 0) throw new PolicyGitError("internal_failed");
        const meta = rec.slice(0, tab);
        const pathPart = rec.slice(tab + 1);
        if (pathPart !== relativePath) {
          throw new PolicyGitError("internal_failed");
        }
        const parts = meta.split(" ");
        if (parts.length !== 3) throw new PolicyGitError("internal_failed");
        const mode = parts[0]!;
        const type = parts[1]!;
        const blobSha1 = sha40(parts[2]!);
        if (type === "commit") {
          throw new PolicyGitError("target_is_submodule");
        }
        if (type !== "blob") {
          throw new PolicyGitError("source_not_regular_file");
        }
        if (mode === "160000") {
          throw new PolicyGitError("target_is_submodule");
        }
        if (mode === "120000") {
          throw new PolicyGitError("source_is_symlink");
        }
        const sizeText = (
          await gitText(repoRoot, ["cat-file", "-s", blobSha1], 4096)
        ).trim();
        const size = Number(sizeText);
        if (!Number.isInteger(size) || size < 0) {
          throw new PolicyGitError("internal_failed");
        }
        if (size > MAX_INPUT_BYTES) {
          throw new PolicyGitError("oversize_input");
        }
        return { mode, blobSha1, size };
      },
      catch: (e) =>
        e instanceof PolicyGitError ? e : new PolicyGitError("internal_failed"),
    }),
  assertHeadCommit: (repoRoot, commitSha) =>
    Effect.tryPromise({
      try: async () => {
        const expected = sha40(commitSha);
        const head = sha40(await gitText(repoRoot, ["rev-parse", "HEAD"]));
        if (head !== expected) {
          throw new PolicyGitError("authority_dirty");
        }
      },
      catch: (e) =>
        e instanceof PolicyGitError ? e : new PolicyGitError("internal_failed"),
    }),
  assertTrackedIndexClean: (repoRoot, commitSha, relativePath, expected) =>
    Effect.tryPromise({
      try: async () => {
        rejectBadRelPath(relativePath);
        const commit = sha40(commitSha);
        const head = sha40(await gitText(repoRoot, ["rev-parse", "HEAD"]));
        if (head !== commit) {
          throw new PolicyGitError("authority_dirty");
        }
        const porcelain = await gitText(
          repoRoot,
          ["status", "--porcelain", "--", relativePath],
          65_536,
        );
        if (porcelain.trim().length > 0) {
          throw new PolicyGitError("working_tree_mismatch");
        }
        // Index stage-0 entry must match approved mode + blob.
        const ls = (
          await gitText(
            repoRoot,
            ["ls-files", "-s", "-z", "--", relativePath],
            65_536,
          )
        ).replace(/\0$/, "");
        if (ls.length === 0) {
          throw new PolicyGitError("target_untracked");
        }
        // Format: <mode> <sha> <stage>\t<path>
        const tab = ls.indexOf("\t");
        if (tab < 0) throw new PolicyGitError("internal_failed");
        const meta = ls.slice(0, tab);
        const pathPart = ls.slice(tab + 1);
        if (pathPart !== relativePath) {
          throw new PolicyGitError("internal_failed");
        }
        const m = meta.match(/^([0-7]{6}) ([0-9a-f]{40}) ([0-3])$/i);
        if (!m) throw new PolicyGitError("internal_failed");
        const indexMode = m[1]!;
        const indexBlob = m[2]!.toLowerCase();
        const stage = m[3]!;
        if (stage !== "0") {
          throw new PolicyGitError("working_tree_mismatch");
        }
        if (indexMode !== expected.mode) {
          throw new PolicyGitError("mode_mismatch");
        }
        if (indexBlob !== expected.blobSha1.toLowerCase()) {
          throw new PolicyGitError("source_digest_mismatch");
        }
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
