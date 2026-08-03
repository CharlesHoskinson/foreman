import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { SchemaFileMaterializationError } from "@council/application";
import { Effect, type Scope } from "effect";

const STATIC_FAILURE_REASON = "schema file materialization failed";
const STATIC_CLEANUP_REASON = "schema file cleanup failed";
const STATIC_UNSUPPORTED_PLATFORM_REASON =
  "native Windows schema file materialization is unsupported";

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 10;

export type SchemaFileWriteOptions = {
  readonly encoding: "utf8";
  readonly mode: number;
  readonly flag: "wx";
};

export type SchemaFileRmOptions = {
  readonly recursive: true;
  readonly force: true;
};

/**
 * Small injectable filesystem seam for schema-file materialization.
 * Default production ops use Node mkdtemp, chmod, exclusive UTF-8 writeFile,
 * and recursive rm with bounded retries.
 */
export type SchemaFileMaterializerOps = {
  readonly platform: string;
  readonly tmpdir: () => string;
  readonly mkdtemp: (prefix: string) => Promise<string>;
  readonly chmod: (path: string, mode: number) => Promise<void>;
  readonly writeFile: (
    path: string,
    data: string,
    options: SchemaFileWriteOptions,
  ) => Promise<void>;
  readonly rm: (path: string, options: SchemaFileRmOptions) => Promise<void>;
  readonly maxRetries: number;
  readonly retryDelayMs: number;
};

const delay = (ms: number): Promise<void> =>
  ms <= 0
    ? Promise.resolve()
    : new Promise((resolve) => {
        setTimeout(resolve, ms);
      });

export const defaultSchemaFileMaterializerOps: SchemaFileMaterializerOps = {
  platform: process.platform,
  tmpdir,
  mkdtemp,
  chmod,
  writeFile: (path, data, options) => writeFile(path, data, options),
  rm: (path, options) => rm(path, options),
  maxRetries: DEFAULT_MAX_RETRIES,
  retryDelayMs: DEFAULT_RETRY_DELAY_MS,
};

const createFailed = (): SchemaFileMaterializationError =>
  new SchemaFileMaterializationError({
    category: "create_failed",
    reason: STATIC_FAILURE_REASON,
  });

const writeFailed = (): SchemaFileMaterializationError =>
  new SchemaFileMaterializationError({
    category: "write_failed",
    reason: STATIC_FAILURE_REASON,
  });

const cleanupFailed = (): SchemaFileMaterializationError =>
  new SchemaFileMaterializationError({
    category: "cleanup_failed",
    reason: STATIC_CLEANUP_REASON,
  });

const unsupportedPlatform = (): SchemaFileMaterializationError =>
  new SchemaFileMaterializationError({
    category: "unsupported_platform",
    reason: STATIC_UNSUPPORTED_PLATFORM_REASON,
  });

const removeWithRetry = async (
  directory: string,
  ops: SchemaFileMaterializerOps,
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
  ops: SchemaFileMaterializerOps,
): Promise<void> => {
  try {
    await removeWithRetry(directory, ops);
  } catch {
    throw cleanupFailed();
  }
};

/**
 * Materialize canary schema JSON into a private temporary `.json` file.
 *
 * Supported on POSIX hosts including WSL. Native Windows is refused before any
 * filesystem mutation until an ACL-aware backend exists. Creates a restricted
 * temporary directory, writes the exact UTF-8 schema bytes with owner-only
 * file permissions, and returns the path while the Effect scope remains open.
 * Deletes the exact temporary directory on success, typed failure, or
 * interruption. Errors are static and secret-safe — never include schema text,
 * temporary paths, or home paths.
 */
export const materializeCanarySchemaFile = (
  schemaJson: string,
  ops: SchemaFileMaterializerOps = defaultSchemaFileMaterializerOps,
): Effect.Effect<string, SchemaFileMaterializationError, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.tryPromise({
      try: async () => {
        // Fail closed on native Windows before tmpdir/mkdtemp/chmod/write/rm.
        if (ops.platform === "win32") {
          throw unsupportedPlatform();
        }

        let directory: string;
        try {
          directory = await ops.mkdtemp(join(ops.tmpdir(), "council-schema-"));
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

        const filePath = join(directory, "schema.json");
        try {
          await ops.writeFile(filePath, schemaJson, {
            encoding: "utf8",
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
        if (error instanceof SchemaFileMaterializationError) {
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
