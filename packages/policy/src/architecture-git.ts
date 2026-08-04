/**
 * Effect-owned Git reads for architecture policy.
 * Resolve HEAD and merge base once; bind subsequent reads to exact OIDs.
 * Fail closed on Git failure, invalid output, oversized output, replacement
 * refs (via sanitized env + --no-replace-objects), inherited GIT_* redirects,
 * or a moving HEAD. Subprocesses take AbortSignal and clean up on interruption.
 */

import { Context, Effect, Layer } from "effect";
import { execFile, type ChildProcess } from "node:child_process";
import {
  decodeUtf8Fatal,
  isCoreFailure,
  MAX_INPUT_BYTES,
} from "@foreman/core";
import { gitArgv, sanitizedGitEnv } from "./git-env.js";
import {
  failedResult,
  type ArchitectureCheckResult,
  type PolicyReason,
} from "./architecture-schema.js";
import {
  parseNameStatusDelta,
  parseNulPathList,
  type DeltaRecord,
} from "./architecture-delta.js";
import {
  evaluateArchitecturePolicy,
  type EvaluateInput,
} from "./architecture-evaluate.js";
import {
  isRuntimeBundlePath,
  isTypeScriptPath,
  isLegacyExecutablePath,
  isRuntimeManifestPath,
  prohibitedExtensionReason,
  RUNTIME_MANIFEST_PATH,
} from "./architecture-extensions.js";
import { decodeRuntimeManifest } from "./architecture-manifest.js";
import {
  parseLsTreeLine,
  type FileIdentity,
} from "./architecture-executable.js";

const GIT_TIMEOUT_MS = 15_000;
/**
 * Blob bound for runtime bundles (may exceed source-text MAX_INPUT_BYTES).
 * Source and adapter classification still use MAX_INPUT_BYTES after load.
 */
export const MAX_BLOB_BYTES = 32 * 1024 * 1024;

export class ArchitectureGitError {
  readonly _tag = "ArchitectureGitError" as const;
  constructor(readonly reason: PolicyReason) {}
}

export type ResolvedIdentity = {
  readonly head: string;
  readonly base: string;
  readonly mergeBase: string;
};

export class ArchitectureGit extends Context.Tag("ArchitectureGit")<
  ArchitectureGit,
  {
    readonly resolveIdentity: (
      repoRoot: string,
      baseRef: string,
    ) => Effect.Effect<ResolvedIdentity, ArchitectureGitError>;
    readonly nameStatusDelta: (
      repoRoot: string,
      mergeBase: string,
      head: string,
    ) => Effect.Effect<Uint8Array, ArchitectureGitError>;
    readonly listPaths: (
      repoRoot: string,
      commitOid: string,
    ) => Effect.Effect<Uint8Array, ArchitectureGitError>;
    /**
     * Read a blob at commit:path. Returns null only when the path is
     * legitimately absent. All other Git failures are ArchitectureGitError.
     */
    readonly catBlob: (
      repoRoot: string,
      commitOid: string,
      path: string,
    ) => Effect.Effect<Uint8Array | null, ArchitectureGitError>;
    /**
     * Read the exact tree entry mode/type for path at commit.
     * Returns present:false only when the path is legitimately absent.
     */
    readonly treeEntry: (
      repoRoot: string,
      commitOid: string,
      path: string,
    ) => Effect.Effect<FileIdentity, ArchitectureGitError>;
    readonly recheckHead: (
      repoRoot: string,
      expectedHead: string,
    ) => Effect.Effect<void, ArchitectureGitError>;
  }
>() {}

function sha40(s: string): string {
  const t = s.trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(t)) {
    throw new ArchitectureGitError("invalid_git_output");
  }
  return t;
}

type GitRunOk = {
  readonly stdout: Buffer;
  readonly stderr: Buffer;
  readonly status: number;
};

/**
 * Production is always `git` with no prefix. Tests may bind a different
 * executable and fixed prefix args (e.g. process.execPath + fixture.mjs).
 * Callers of ArchitectureGit have no control over this binding.
 */
export type GitCommandBinding = {
  readonly executable: string;
  readonly prefixArgs: readonly string[];
};

const PRODUCTION_GIT_BINDING: GitCommandBinding = {
  executable: "git",
  prefixArgs: [],
};

let gitCommandBinding: GitCommandBinding = PRODUCTION_GIT_BINDING;

/**
 * Test-only injection. Pass null to restore production binding.
 * Rejects empty/unsafe executable strings fail-closed (restores production).
 */
export function bindGitCommandForTest(
  binding: GitCommandBinding | null,
): void {
  if (binding === null) {
    gitCommandBinding = PRODUCTION_GIT_BINDING;
    return;
  }
  if (
    typeof binding.executable !== "string" ||
    binding.executable.length === 0 ||
    binding.executable.includes("\0") ||
    !Array.isArray(binding.prefixArgs) ||
    binding.prefixArgs.some(
      (a) => typeof a !== "string" || a.includes("\0"),
    )
  ) {
    gitCommandBinding = PRODUCTION_GIT_BINDING;
    return;
  }
  gitCommandBinding = {
    executable: binding.executable,
    prefixArgs: Object.freeze([...binding.prefixArgs]),
  };
}

/** Snapshot of the active binding (tests assert production defaults). */
export function currentGitCommandBinding(): GitCommandBinding {
  return {
    executable: gitCommandBinding.executable,
    prefixArgs: [...gitCommandBinding.prefixArgs],
  };
}

/**
 * Run one Git child with AbortSignal, bounded stdout/stderr, and timeout.
 * Cleanup on Effect interruption aborts the child. Never returns raw stderr
 * to callers — only closed ArchitectureGitError reasons.
 */
function runGit(
  repoRoot: string,
  args: string[],
  maxBytes: number,
): Effect.Effect<GitRunOk, ArchitectureGitError> {
  return Effect.async<GitRunOk, ArchitectureGitError>((resume, signal) => {
    const controller = new AbortController();
    let settled = false;
    let child: ChildProcess | null = null;
    const binding = gitCommandBinding;
    const argv = [...binding.prefixArgs, ...gitArgv(args)];

    const onParentAbort = () => {
      controller.abort();
      if (child && !child.killed) {
        try {
          child.kill("SIGTERM");
        } catch {
          // ignore
        }
      }
    };
    signal.addEventListener("abort", onParentAbort, { once: true });

    const timer = setTimeout(() => {
      controller.abort();
    }, GIT_TIMEOUT_MS);

    const finish = (effect: Effect.Effect<GitRunOk, ArchitectureGitError>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onParentAbort);
      resume(effect);
    };

    try {
      child = execFile(
        binding.executable,
        argv,
        {
          cwd: repoRoot,
          encoding: "buffer",
          maxBuffer: maxBytes + 1,
          windowsHide: true,
          env: sanitizedGitEnv(),
          signal: controller.signal,
        },
        (err, stdout, stderr) => {
          const outBuf = Buffer.isBuffer(stdout)
            ? stdout
            : Buffer.from(stdout ?? "");
          const errBuf = Buffer.isBuffer(stderr)
            ? stderr
            : Buffer.from(stderr ?? "");
          if (controller.signal.aborted || signal.aborted) {
            finish(Effect.fail(new ArchitectureGitError("git_failure")));
            return;
          }
          if (err) {
            const e = err as NodeJS.ErrnoException & {
              code?: string | number;
            };
            if (
              e.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" ||
              /maxBuffer/i.test(String(e.message ?? ""))
            ) {
              finish(Effect.fail(new ArchitectureGitError("oversize_output")));
              return;
            }
            let status = 1;
            if (typeof e.code === "number" && e.code !== 0) {
              status = e.code;
            }
            finish(
              Effect.succeed({
                stdout: outBuf,
                stderr: errBuf,
                status,
              }),
            );
            return;
          }
          if (outBuf.byteLength > maxBytes) {
            finish(Effect.fail(new ArchitectureGitError("oversize_output")));
            return;
          }
          finish(
            Effect.succeed({
              stdout: outBuf,
              stderr: errBuf,
              status: 0,
            }),
          );
        },
      );
    } catch {
      finish(Effect.fail(new ArchitectureGitError("git_failure")));
    }
  });
}

function gitTextEffect(
  repoRoot: string,
  args: string[],
  maxBuffer = 4096,
): Effect.Effect<string, ArchitectureGitError> {
  return Effect.gen(function* () {
    const r = yield* runGit(repoRoot, args, maxBuffer);
    if (r.status !== 0) {
      return yield* Effect.fail(new ArchitectureGitError("git_failure"));
    }
    if (r.stdout.byteLength > maxBuffer) {
      return yield* Effect.fail(new ArchitectureGitError("oversize_output"));
    }
    return r.stdout.toString("utf8");
  });
}

function gitBytesEffect(
  repoRoot: string,
  args: string[],
  maxBytes: number,
): Effect.Effect<Uint8Array, ArchitectureGitError> {
  return Effect.gen(function* () {
    const r = yield* runGit(repoRoot, args, maxBytes);
    if (r.status !== 0) {
      return yield* Effect.fail(new ArchitectureGitError("git_failure"));
    }
    if (r.stdout.byteLength > maxBytes) {
      return yield* Effect.fail(new ArchitectureGitError("oversize_output"));
    }
    return new Uint8Array(
      r.stdout.buffer,
      r.stdout.byteOffset,
      r.stdout.byteLength,
    );
  });
}

/**
 * Classify cat-file / rev-parse failure without exposing stderr text.
 * Legitimate path absence: exit 128 with empty-ish object for cat-file after
 * treeEntry already said absent. Here we only use status codes + emptiness.
 */
function isLikelyAbsentObject(status: number, stderr: Buffer): boolean {
  // Git uses 128 for many fatal errors. Absent path for `cat-file blob A:path`
  // also returns 128. Callers must use treeEntry first for presence.
  // We never treat bare 128 as clean absent at this layer when tree said present.
  void stderr;
  return status === 128;
}

export const liveArchitectureGit = Layer.succeed(ArchitectureGit, {
  resolveIdentity: (repoRoot, baseRef) =>
    Effect.gen(function* () {
      if (
        baseRef.length === 0 ||
        baseRef.includes("\0") ||
        baseRef.startsWith("-")
      ) {
        return yield* Effect.fail(new ArchitectureGitError("schema_mismatch"));
      }
      const headRaw = yield* gitTextEffect(repoRoot, ["rev-parse", "HEAD"]);
      const head = sha40(headRaw);
      const baseRaw = yield* gitTextEffect(repoRoot, [
        "rev-parse",
        "--verify",
        baseRef,
      ]);
      const base = sha40(baseRaw);
      const mbRaw = yield* gitTextEffect(repoRoot, [
        "merge-base",
        base,
        head,
      ]);
      const mergeBase = sha40(mbRaw);
      return { head, base, mergeBase };
    }).pipe(
      Effect.mapError((e) =>
        e instanceof ArchitectureGitError
          ? e
          : new ArchitectureGitError("git_failure"),
      ),
    ),

  nameStatusDelta: (repoRoot, mergeBase, head) =>
    gitBytesEffect(
      repoRoot,
      ["diff", "--name-status", "-z", mergeBase, head],
      MAX_INPUT_BYTES,
    ),

  listPaths: (repoRoot, commitOid) =>
    gitBytesEffect(
      repoRoot,
      ["ls-tree", "-r", "-z", "--name-only", commitOid],
      MAX_INPUT_BYTES,
    ),

  treeEntry: (repoRoot, commitOid, path) =>
    Effect.gen(function* () {
      // -z for path safety; single entry query
      const r = yield* runGit(
        repoRoot,
        ["ls-tree", "-z", commitOid, "--", path],
        65_536,
      );
      if (r.status !== 0) {
        // Nonexistent repo, bad commit, etc. — never "absent path"
        return yield* Effect.fail(new ArchitectureGitError("git_failure"));
      }
      // Empty stdout with status 0 → path legitimately absent
      if (r.stdout.byteLength === 0) {
        return {
          present: false,
          mode: null,
          isExecutable: false,
          isSymlink: false,
          isSpecial: false,
        } satisfies FileIdentity;
      }
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(r.stdout);
      } catch {
        return yield* Effect.fail(
          new ArchitectureGitError("invalid_git_output"),
        );
      }
      // One record, optional trailing NUL
      const line = text.split("\0").find((p) => p.length > 0) ?? "";
      const parsed = parseLsTreeLine(line);
      if ("error" in parsed) {
        return yield* Effect.fail(
          new ArchitectureGitError("invalid_git_output"),
        );
      }
      return parsed;
    }),

  catBlob: (repoRoot, commitOid, path) =>
    Effect.gen(function* () {
      // Presence probe first — distinguishes absent path from repo failure
      const entry = yield* Effect.gen(function* () {
        const r = yield* runGit(
          repoRoot,
          ["ls-tree", "-z", commitOid, "--", path],
          65_536,
        );
        if (r.status !== 0) {
          return yield* Effect.fail(new ArchitectureGitError("git_failure"));
        }
        return r.stdout.byteLength === 0 ? ("absent" as const) : ("present" as const);
      });
      if (entry === "absent") {
        return null;
      }

      const maxBytes =
        path.startsWith("skills/foreman/runtime/dist/") && path.endsWith(".js")
          ? MAX_BLOB_BYTES
          : MAX_INPUT_BYTES;
      const r = yield* runGit(
        repoRoot,
        ["cat-file", "blob", `${commitOid}:${path}`],
        maxBytes,
      );
      if (r.status !== 0) {
        // Path was present in tree; cat-file failure is not "clean absent"
        if (isLikelyAbsentObject(r.status, r.stderr)) {
          return yield* Effect.fail(new ArchitectureGitError("git_failure"));
        }
        return yield* Effect.fail(new ArchitectureGitError("git_failure"));
      }
      if (r.stdout.byteLength > maxBytes) {
        return yield* Effect.fail(new ArchitectureGitError("oversize_output"));
      }
      return new Uint8Array(
        r.stdout.buffer,
        r.stdout.byteOffset,
        r.stdout.byteLength,
      );
    }),

  recheckHead: (repoRoot, expectedHead) =>
    Effect.gen(function* () {
      const headRaw = yield* gitTextEffect(repoRoot, ["rev-parse", "HEAD"]);
      const head = sha40(headRaw);
      if (head !== expectedHead) {
        return yield* Effect.fail(new ArchitectureGitError("head_moved"));
      }
    }),
});

function needsHeadBlob(path: string): boolean {
  // All added/modified product paths may need shebang/mode classification.
  // Always load when extensionless or known executable families / TS / runtime.
  if (isTypeScriptPath(path)) return true;
  if (isLegacyExecutablePath(path)) return true;
  if (isRuntimeBundlePath(path)) return true;
  if (isRuntimeManifestPath(path)) return true;
  if (
    path.endsWith(".js") ||
    path.endsWith(".jsx") ||
    path.endsWith(".mjs") ||
    path.endsWith(".cjs")
  ) {
    return true;
  }
  if (prohibitedExtensionReason(path) !== null) return true;
  // Extensionless or unknown — still load (shebang / mode)
  return true;
}

/**
 * Full architecture check bound to exact OIDs.
 */
export function runArchitectureCheck(
  repoRoot: string,
  baseRef: string,
): Effect.Effect<ArchitectureCheckResult, never, ArchitectureGit> {
  return Effect.gen(function* () {
    const git = yield* ArchitectureGit;

    const identityE = yield* Effect.either(
      git.resolveIdentity(repoRoot, baseRef),
    );
    if (identityE._tag === "Left") {
      return failedResult(identityE.left.reason);
    }
    const { head, base, mergeBase } = identityE.right;

    const deltaE = yield* Effect.either(
      git.nameStatusDelta(repoRoot, mergeBase, head),
    );
    if (deltaE._tag === "Left") {
      return failedResult(deltaE.left.reason, { base, mergeBase, head });
    }
    const parsed = parseNameStatusDelta(deltaE.right);
    if (!parsed.ok) {
      return failedResult(parsed.reason, { base, mergeBase, head });
    }
    const records: readonly DeltaRecord[] = parsed.records;

    const mbPathsE = yield* Effect.either(git.listPaths(repoRoot, mergeBase));
    if (mbPathsE._tag === "Left") {
      return failedResult(mbPathsE.left.reason, { base, mergeBase, head });
    }
    const mbList = parseNulPathList(mbPathsE.right);
    if (!mbList.ok || !("paths" in mbList)) {
      return failedResult(
        !mbList.ok ? mbList.reason : "invalid_git_output",
        { base, mergeBase, head },
      );
    }

    const headPathsE = yield* Effect.either(git.listPaths(repoRoot, head));
    if (headPathsE._tag === "Left") {
      return failedResult(headPathsE.left.reason, { base, mergeBase, head });
    }
    const headList = parseNulPathList(headPathsE.right);
    if (!headList.ok || !("paths" in headList)) {
      return failedResult(
        !headList.ok ? headList.reason : "invalid_git_output",
        { base, mergeBase, head },
      );
    }

    const blobs = new Map<string, Uint8Array>();
    const identities = new Map<string, FileIdentity>();
    const linkPaths = new Set<string>();

    const pathsToLoad = new Set<string>();
    for (const rec of records) {
      if (rec.kind === "deleted") continue;
      if (needsHeadBlob(rec.path) || isRuntimeManifestPath(rec.path)) {
        pathsToLoad.add(rec.path);
      }
      if (rec.path.endsWith(".js")) pathsToLoad.add(rec.path);
    }
    pathsToLoad.add(RUNTIME_MANIFEST_PATH);

    const loadPath = (path: string) =>
      Effect.gen(function* () {
        const entry = yield* git.treeEntry(repoRoot, head, path);
        identities.set(`${head}:${path}`, entry);
        if (entry.isSymlink) {
          linkPaths.add(`${head}:${path}`);
        }
        if (!entry.present) {
          return undefined;
        }
        if (entry.isSpecial) {
          // No blob load for gitlink/tree; evaluate rejects special mode
          return undefined;
        }
        const b = yield* git.catBlob(repoRoot, head, path);
        if (b) {
          blobs.set(`${head}:${path}`, b);
        }
        return undefined;
      });

    for (const path of pathsToLoad) {
      const loaded = yield* Effect.either(loadPath(path));
      if (loaded._tag === "Left") {
        return failedResult(loaded.left.reason, { base, mergeBase, head });
      }
    }

    // When the head manifest decodes, bind every declared artifact blob
    {
      const mfBytes = blobs.get(`${head}:${RUNTIME_MANIFEST_PATH}`);
      if (mfBytes && !linkPaths.has(`${head}:${RUNTIME_MANIFEST_PATH}`)) {
        const text = decodeUtf8Fatal(mfBytes);
        if (!isCoreFailure(text)) {
          const decoded = decodeRuntimeManifest(text);
          if (decoded.ok) {
            for (const art of decoded.manifest.artifacts) {
              const repoPath = `skills/foreman/runtime/${art.relativePath}`;
              if (!identities.has(`${head}:${repoPath}`)) {
                const loaded = yield* Effect.either(loadPath(repoPath));
                if (loaded._tag === "Left") {
                  return failedResult(loaded.left.reason, {
                    base,
                    mergeBase,
                    head,
                  });
                }
              }
            }
          }
        }
      }
    }

    const recheck = yield* Effect.either(git.recheckHead(repoRoot, head));
    if (recheck._tag === "Left") {
      return failedResult(recheck.left.reason, { base, mergeBase, head });
    }

    const input: EvaluateInput = {
      base,
      mergeBase,
      head,
      records,
      mergeBasePaths: mbList.paths,
      headPaths: headList.paths,
      blobs,
      identities,
      linkPaths,
    };
    return evaluateArchitecturePolicy(input);
  });
}
