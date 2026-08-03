import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { CanaryChallengeV1, ContentHash } from "@council/schema";
import { Data, Effect, type Scope } from "effect";
import { encodeUtf8, stringifyCanonicalJson } from "./canonical-json.js";
import { sha256Hex } from "./digest.js";

const STATIC_FAILURE_REASON = "canary prompt materialization failed";
const STATIC_CLEANUP_REASON = "canary prompt cleanup failed";
const STATIC_UNSUPPORTED_PLATFORM_REASON =
  "native Windows canary prompt materialization is unsupported";

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 10;

const CANARY_PROMPT_FORMAT = "council-canary-v1";
const CANARY_TRUSTED_PROFILE = "council-ace-1";
const CANARY_TRUSTED_RULES = [
  "Every reviewer must return exactly one response.",
  "Every reviewer must copy the nonce.",
  "Every reviewer must solve the check.",
  "No reviewer may use a tool.",
] as const;

export type CanaryMaterializationErrorCategory =
  "create_failed" | "write_failed" | "cleanup_failed" | "unsupported_platform";

/**
 * Static, secret-safe materialization failure. Reasons never include paths,
 * prompt bytes, nonces, or raw exception text.
 */
export class CanaryMaterializationError extends Data.TaggedError(
  "CanaryMaterializationError",
)<{
  readonly category: CanaryMaterializationErrorCategory;
  readonly reason: string;
}> {}

export type CanaryWriteOptions = {
  readonly mode: number;
  readonly flag: "wx";
};

export type CanaryRmOptions = {
  readonly recursive: true;
  readonly force: true;
};

/**
 * Injectable filesystem seam for canary prompt materialization.
 * Default production ops use Node mkdtemp, chmod, exclusive binary writeFile,
 * and recursive rm with bounded retries.
 */
export type CanaryMaterializerOps = {
  readonly platform: string;
  readonly tmpdir: () => string;
  readonly mkdtemp: (prefix: string) => Promise<string>;
  readonly chmod: (path: string, mode: number) => Promise<void>;
  readonly writeFile: (
    path: string,
    data: Uint8Array,
    options: CanaryWriteOptions,
  ) => Promise<void>;
  readonly rm: (path: string, options: CanaryRmOptions) => Promise<void>;
  readonly maxRetries: number;
  readonly retryDelayMs: number;
};

export type CanaryMaterial = {
  readonly promptBytes: Uint8Array;
  readonly schemaJson: string;
  readonly canarySchemaVariantHash: ContentHash;
};

const closedCanaryResponseSchema = (expectedCheckResult: string) => ({
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "nonce", "checkResult", "status"],
  properties: {
    schemaVersion: { type: "integer", enum: [1] },
    nonce: { type: "string" },
    checkResult: { type: "string", enum: [expectedCheckResult] },
    status: { type: "string", enum: ["ready"] },
  },
});

/**
 * Build deterministic canary prompt bytes and the closed response schema
 * bound to the challenge expected check result. Hash is over exact UTF-8
 * schema JSON bytes as branded ContentHash `sha256:<digest>`.
 */
export const buildCanaryMaterial = (
  challenge: CanaryChallengeV1,
): CanaryMaterial => {
  const envelope = {
    format: CANARY_PROMPT_FORMAT,
    trustedAuthority: {
      profile: CANARY_TRUSTED_PROFILE,
      rules: [...CANARY_TRUSTED_RULES],
    },
    taskData: {
      schemaVersion: challenge.schemaVersion,
      nonce: challenge.nonce,
      checkExpression: challenge.checkExpression,
      expectedCheckResult: challenge.expectedCheckResult,
    },
  };
  const promptBytes = encodeUtf8(stringifyCanonicalJson(envelope));
  const schemaJson = stringifyCanonicalJson(
    closedCanaryResponseSchema(challenge.expectedCheckResult),
  );
  const digest = sha256Hex(encodeUtf8(schemaJson));
  const canarySchemaVariantHash = `sha256:${digest}` as ContentHash;
  return { promptBytes, schemaJson, canarySchemaVariantHash };
};

const delay = (ms: number): Promise<void> =>
  ms <= 0
    ? Promise.resolve()
    : new Promise((resolve) => {
        setTimeout(resolve, ms);
      });

export const defaultCanaryMaterializerOps: CanaryMaterializerOps = {
  platform: process.platform,
  tmpdir,
  mkdtemp,
  chmod,
  writeFile: (path, data, options) => writeFile(path, data, options),
  rm: (path, options) => rm(path, options),
  maxRetries: DEFAULT_MAX_RETRIES,
  retryDelayMs: DEFAULT_RETRY_DELAY_MS,
};

const createFailed = (): CanaryMaterializationError =>
  new CanaryMaterializationError({
    category: "create_failed",
    reason: STATIC_FAILURE_REASON,
  });

const writeFailed = (): CanaryMaterializationError =>
  new CanaryMaterializationError({
    category: "write_failed",
    reason: STATIC_FAILURE_REASON,
  });

const cleanupFailed = (): CanaryMaterializationError =>
  new CanaryMaterializationError({
    category: "cleanup_failed",
    reason: STATIC_CLEANUP_REASON,
  });

const unsupportedPlatform = (): CanaryMaterializationError =>
  new CanaryMaterializationError({
    category: "unsupported_platform",
    reason: STATIC_UNSUPPORTED_PLATFORM_REASON,
  });

const removeWithRetry = async (
  directory: string,
  ops: CanaryMaterializerOps,
): Promise<void> => {
  const maxRetries = Math.max(0, ops.maxRetries);
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      await ops.rm(directory, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        await delay(ops.retryDelayMs);
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(STATIC_CLEANUP_REASON);
};

const ensureRemoved = async (
  directory: string,
  ops: CanaryMaterializerOps,
): Promise<void> => {
  try {
    await removeWithRetry(directory, ops);
  } catch {
    throw cleanupFailed();
  }
};

/**
 * Materialize exact canary prompt bytes into a private temporary `prompt.txt`.
 *
 * Supported on POSIX hosts including WSL. Native Windows is refused before any
 * filesystem mutation until an ACL-aware backend exists. Creates a restricted
 * temporary directory, writes the exact binary prompt with owner-only file
 * permissions, and returns the path while the Effect scope remains open.
 * Deletes the exact temporary directory on success, typed failure, or
 * interruption. Errors are static and secret-safe — never include prompt
 * bytes, nonces, temporary paths, or home paths.
 */
export const materializeCanaryPromptFile = (
  promptBytes: Uint8Array,
  ops: CanaryMaterializerOps = defaultCanaryMaterializerOps,
): Effect.Effect<string, CanaryMaterializationError, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.tryPromise({
      try: async () => {
        // Fail closed on native Windows before tmpdir/mkdtemp/chmod/write/rm.
        if (ops.platform === "win32") {
          throw unsupportedPlatform();
        }

        let directory: string;
        try {
          directory = await ops.mkdtemp(join(ops.tmpdir(), "council-canary-"));
        } catch {
          throw createFailed();
        }

        try {
          await ops.chmod(directory, 0o700);
        } catch {
          // mkdtemp succeeded: always attempt cleanup before returning error.
          await ensureRemoved(directory, ops);
          throw createFailed();
        }

        const filePath = join(directory, "prompt.txt");
        try {
          await ops.writeFile(filePath, promptBytes, {
            mode: 0o600,
            flag: "wx",
          });
          await ops.chmod(filePath, 0o600);
        } catch {
          // Operations are an untrusted platform seam. Once mkdtemp succeeds,
          // no operation error may bypass removal of the scoped directory.
          await ensureRemoved(directory, ops);
          throw writeFailed();
        }

        return filePath;
      },
      catch: (error) => {
        if (error instanceof CanaryMaterializationError) {
          return error;
        }
        return createFailed();
      },
    }),
    (filePath) =>
      Effect.tryPromise({
        try: async () => {
          const directory = dirname(filePath);
          await removeWithRetry(directory, ops);
        },
        catch: () => new Error(STATIC_CLEANUP_REASON),
      }).pipe(Effect.orDie),
  );
