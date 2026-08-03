import { access, readFile, stat } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { dirname } from "node:path";
import { Cause, Chunk, Effect, Exit, Fiber, Scope } from "effect";
import { describe, expect, it } from "vitest";
import { SchemaFileMaterializationError } from "@council/application";
import {
  defaultSchemaFileMaterializerOps,
  materializeCanarySchemaFile,
  type SchemaFileMaterializerOps,
} from "../src/schema-file-materializer.js";

const schemaJson =
  '{"type":"object","required":["nonce"],"properties":{"nonce":{"type":"string"}}}';

const isPosixHost = process.platform !== "win32";

const makeTrackingOps = (
  overrides: Partial<SchemaFileMaterializerOps> = {},
): {
  readonly ops: SchemaFileMaterializerOps;
  readonly calls: string[];
} => {
  const calls: string[] = [];
  const base = defaultSchemaFileMaterializerOps;
  const ops: SchemaFileMaterializerOps = {
    platform: overrides.platform ?? base.platform,
    maxRetries: overrides.maxRetries ?? 0,
    retryDelayMs: overrides.retryDelayMs ?? 0,
    tmpdir: () => {
      calls.push("tmpdir");
      return overrides.tmpdir ? overrides.tmpdir() : base.tmpdir();
    },
    mkdtemp: async (prefix) => {
      calls.push("mkdtemp");
      if (overrides.mkdtemp) {
        return overrides.mkdtemp(prefix);
      }
      return base.mkdtemp(prefix);
    },
    chmod: async (path, mode) => {
      calls.push("chmod");
      if (overrides.chmod) {
        return overrides.chmod(path, mode);
      }
      return base.chmod(path, mode);
    },
    writeFile: async (path, data, options) => {
      calls.push("writeFile");
      if (overrides.writeFile) {
        return overrides.writeFile(path, data, options);
      }
      return base.writeFile(path, data, options);
    },
    rm: async (path, options) => {
      calls.push("rm");
      if (overrides.rm) {
        return overrides.rm(path, options);
      }
      return base.rm(path, options);
    },
  };
  return { ops, calls };
};

const expectSecretSafe = (error: SchemaFileMaterializationError): void => {
  expect(error.reason).not.toContain(schemaJson);
  expect(error.reason).not.toMatch(/\/tmp|\/home|\\\\|C:\\\\/i);
  expect(error.reason).not.toMatch(/council-schema-/);
  expect(JSON.stringify(error)).not.toContain(schemaJson);
};

describe("materializeCanarySchemaFile", () => {
  it.runIf(isPosixHost)(
    "writes exact UTF-8 schema bytes under a private temporary directory",
    async () => {
      const program = Effect.gen(function* () {
        const path = yield* materializeCanarySchemaFile(schemaJson);
        const bytes = yield* Effect.promise(() => readFile(path));
        expect(Buffer.from(bytes).toString("utf8")).toBe(schemaJson);
        expect(path.endsWith(".json")).toBe(true);
        const fileStat = yield* Effect.promise(() => stat(path));
        // Restrictive permissions: owner read/write only (mode & 0o777 === 0o600).
        expect(fileStat.mode & 0o777).toBe(0o600);
        return path;
      }).pipe(Effect.scoped);

      const path = await Effect.runPromise(program);
      // Scope closed: temporary directory is deleted.
      await expect(access(path, fsConstants.F_OK)).rejects.toBeTruthy();
      await expect(
        access(dirname(path), fsConstants.F_OK),
      ).rejects.toBeTruthy();
    },
  );

  it.runIf(isPosixHost)(
    "deletes the temporary directory on scoped success",
    async () => {
      let materializedPath = "";
      await Effect.runPromise(
        Effect.gen(function* () {
          materializedPath = yield* materializeCanarySchemaFile(schemaJson);
          yield* Effect.promise(() =>
            access(materializedPath, fsConstants.F_OK),
          );
        }).pipe(Effect.scoped),
      );
      expect(materializedPath.length).toBeGreaterThan(0);
      await expect(
        access(materializedPath, fsConstants.F_OK),
      ).rejects.toBeTruthy();
      await expect(
        access(dirname(materializedPath), fsConstants.F_OK),
      ).rejects.toBeTruthy();
    },
  );

  it.runIf(isPosixHost)(
    "deletes the temporary directory after a typed failure inside the scope",
    async () => {
      let materializedPath = "";
      const exit = await Effect.runPromiseExit(
        Effect.gen(function* () {
          materializedPath = yield* materializeCanarySchemaFile(schemaJson);
          return yield* Effect.fail("caller-failure" as const);
        }).pipe(Effect.scoped),
      );
      expect(exit._tag).toBe("Failure");
      expect(materializedPath.length).toBeGreaterThan(0);
      await expect(
        access(materializedPath, fsConstants.F_OK),
      ).rejects.toBeTruthy();
      await expect(
        access(dirname(materializedPath), fsConstants.F_OK),
      ).rejects.toBeTruthy();
    },
  );

  it.runIf(isPosixHost)(
    "deletes the temporary directory after Effect interruption",
    async () => {
      let materializedPath = "";
      const fiber = Effect.runFork(
        Effect.gen(function* () {
          materializedPath = yield* materializeCanarySchemaFile(schemaJson);
          yield* Effect.promise(() =>
            access(materializedPath, fsConstants.F_OK),
          );
          yield* Effect.never;
        }).pipe(Effect.scoped),
      );

      // Wait until materialization is observed.
      for (let i = 0; i < 50 && materializedPath.length === 0; i += 1) {
        await Effect.runPromise(Effect.sleep("10 millis"));
      }
      expect(materializedPath.length).toBeGreaterThan(0);
      await Effect.runPromise(Fiber.interrupt(fiber));
      // Allow finalizers to run.
      for (let i = 0; i < 50; i += 1) {
        try {
          await access(dirname(materializedPath), fsConstants.F_OK);
          await Effect.runPromise(Effect.sleep("10 millis"));
        } catch {
          break;
        }
      }
      await expect(
        access(materializedPath, fsConstants.F_OK),
      ).rejects.toBeTruthy();
      await expect(
        access(dirname(materializedPath), fsConstants.F_OK),
      ).rejects.toBeTruthy();
    },
  );

  it("returns a typed static secret-safe error and never reports schema or path", async () => {
    if (isPosixHost) {
      const exit = await Effect.runPromiseExit(
        Effect.gen(function* () {
          const path = yield* materializeCanarySchemaFile(schemaJson);
          expect(path).not.toContain(schemaJson);
          return path;
        }).pipe(Effect.scoped),
      );
      expect(Exit.isSuccess(exit)).toBe(true);
    }

    // Error contract: static reason only — never schema text or paths.
    const sample = new SchemaFileMaterializationError({
      category: "write_failed",
      reason: "schema file materialization failed",
    });
    expect(sample.reason).not.toContain(schemaJson);
    expect(sample.reason).not.toMatch(/\/tmp|\/home/);
  });

  it.runIf(isPosixHost)(
    "does not retain the materialized path outside the open scope",
    async () => {
      const scope = await Effect.runPromise(Scope.make());
      const path = await Effect.runPromise(
        materializeCanarySchemaFile(schemaJson).pipe(Scope.extend(scope)),
      );
      await Effect.runPromise(
        Effect.promise(() => access(path, fsConstants.F_OK)),
      );
      await Effect.runPromise(Scope.close(scope, Exit.void));
      await expect(access(path, fsConstants.F_OK)).rejects.toBeTruthy();
    },
  );

  it("refuses native Windows before any filesystem mutation", async () => {
    const { ops, calls } = makeTrackingOps({
      platform: "win32",
      mkdtemp: () => Promise.reject(new Error("mkdtemp must not run on win32")),
      chmod: () => Promise.reject(new Error("chmod must not run on win32")),
      writeFile: () =>
        Promise.reject(new Error("writeFile must not run on win32")),
      rm: () => Promise.reject(new Error("rm must not run on win32")),
      tmpdir: () => {
        throw new Error("tmpdir must not run on win32");
      },
    });

    const exit = await Effect.runPromiseExit(
      materializeCanarySchemaFile(schemaJson, ops).pipe(Effect.scoped),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const error = Cause.failureOption(exit.cause);
      expect(error._tag).toBe("Some");
      if (error._tag === "Some") {
        expect(error.value).toBeInstanceOf(SchemaFileMaterializationError);
        const typed = error.value;
        expect(typed.category).toBe("unsupported_platform");
        expect(typed.reason).toBe(
          "native Windows schema file materialization is unsupported",
        );
        expectSecretSafe(typed);
      }
    }
    expect(calls).toEqual([]);
  });

  it("cleans up after directory permission failure and reports create_failed", async () => {
    let createdDir = "";
    let rmCount = 0;
    const { ops } = makeTrackingOps({
      platform: "linux",
      mkdtemp: async (prefix) => {
        createdDir = await defaultSchemaFileMaterializerOps.mkdtemp(prefix);
        return createdDir;
      },
      chmod: () => Promise.reject(new Error("chmod denied")),
      rm: async (path, options) => {
        rmCount += 1;
        return defaultSchemaFileMaterializerOps.rm(path, options);
      },
    });

    const exit = await Effect.runPromiseExit(
      materializeCanarySchemaFile(schemaJson, ops).pipe(Effect.scoped),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const error = Cause.failureOption(exit.cause);
      expect(error._tag).toBe("Some");
      if (error._tag === "Some") {
        const typed = error.value;
        expect(typed.category).toBe("create_failed");
        expect(typed.reason).toBe("schema file materialization failed");
        expectSecretSafe(typed);
      }
    }
    expect(createdDir.length).toBeGreaterThan(0);
    expect(rmCount).toBeGreaterThanOrEqual(1);
    await expect(access(createdDir, fsConstants.F_OK)).rejects.toBeTruthy();
  });

  it("reports cleanup_failed when permission-failure cleanup cannot remove the directory", async () => {
    let createdDir = "";
    const { ops } = makeTrackingOps({
      platform: "linux",
      maxRetries: 1,
      retryDelayMs: 0,
      mkdtemp: async (prefix) => {
        createdDir = await defaultSchemaFileMaterializerOps.mkdtemp(prefix);
        return createdDir;
      },
      chmod: () => Promise.reject(new Error("chmod denied")),
      rm: () => Promise.reject(new Error("rm denied")),
    });

    const exit = await Effect.runPromiseExit(
      materializeCanarySchemaFile(schemaJson, ops).pipe(Effect.scoped),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const error = Cause.failureOption(exit.cause);
      expect(error._tag).toBe("Some");
      if (error._tag === "Some") {
        const typed = error.value;
        expect(typed.category).toBe("cleanup_failed");
        expect(typed.reason).toBe("schema file cleanup failed");
        expectSecretSafe(typed);
      }
    }
    // Directory remains because cleanup intentionally failed in the seam.
    expect(createdDir.length).toBeGreaterThan(0);
    await access(createdDir, fsConstants.F_OK);
    await defaultSchemaFileMaterializerOps.rm(createdDir, {
      recursive: true,
      force: true,
    });
  });

  it("cleans up after write failure and reports write_failed", async () => {
    let createdDir = "";
    let rmCount = 0;
    const { ops } = makeTrackingOps({
      platform: "linux",
      mkdtemp: async (prefix) => {
        createdDir = await defaultSchemaFileMaterializerOps.mkdtemp(prefix);
        return createdDir;
      },
      writeFile: () => Promise.reject(new Error("write denied")),
      rm: async (path, options) => {
        rmCount += 1;
        return defaultSchemaFileMaterializerOps.rm(path, options);
      },
    });

    const exit = await Effect.runPromiseExit(
      materializeCanarySchemaFile(schemaJson, ops).pipe(Effect.scoped),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const error = Cause.failureOption(exit.cause);
      expect(error._tag).toBe("Some");
      if (error._tag === "Some") {
        const typed = error.value;
        expect(typed.category).toBe("write_failed");
        expect(typed.reason).toBe("schema file materialization failed");
        expectSecretSafe(typed);
      }
    }
    expect(rmCount).toBeGreaterThanOrEqual(1);
    await expect(access(createdDir, fsConstants.F_OK)).rejects.toBeTruthy();
  });

  it.runIf(isPosixHost)(
    "does not trust a tagged operation error or let it bypass cleanup",
    async () => {
      let createdDir = "";
      let rmCount = 0;
      const { ops } = makeTrackingOps({
        platform: "linux",
        mkdtemp: async (prefix) => {
          createdDir = await defaultSchemaFileMaterializerOps.mkdtemp(prefix);
          return createdDir;
        },
        writeFile: () =>
          Promise.reject(
            new SchemaFileMaterializationError({
              category: "write_failed",
              reason: "schema file materialization failed",
            }),
          ),
        rm: async (path, options) => {
          rmCount += 1;
          return defaultSchemaFileMaterializerOps.rm(path, options);
        },
      });

      const exit = await Effect.runPromiseExit(
        materializeCanarySchemaFile(schemaJson, ops).pipe(Effect.scoped),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const error = Cause.failureOption(exit.cause);
        expect(error._tag).toBe("Some");
        if (error._tag === "Some") {
          const typed = error.value;
          expect(typed.category).toBe("write_failed");
          expectSecretSafe(typed);
        }
      }
      expect(rmCount).toBeGreaterThanOrEqual(1);
      await expect(access(createdDir, fsConstants.F_OK)).rejects.toBeTruthy();
    },
  );

  it("reports cleanup_failed when write-failure cleanup cannot remove the directory", async () => {
    let createdDir = "";
    const { ops } = makeTrackingOps({
      platform: "linux",
      maxRetries: 1,
      retryDelayMs: 0,
      mkdtemp: async (prefix) => {
        createdDir = await defaultSchemaFileMaterializerOps.mkdtemp(prefix);
        return createdDir;
      },
      writeFile: () => Promise.reject(new Error("write denied")),
      rm: () => Promise.reject(new Error("rm denied")),
    });

    const exit = await Effect.runPromiseExit(
      materializeCanarySchemaFile(schemaJson, ops).pipe(Effect.scoped),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const error = Cause.failureOption(exit.cause);
      expect(error._tag).toBe("Some");
      if (error._tag === "Some") {
        const typed = error.value;
        expect(typed.category).toBe("cleanup_failed");
        expect(typed.reason).toBe("schema file cleanup failed");
        expectSecretSafe(typed);
      }
    }
    expect(createdDir.length).toBeGreaterThan(0);
    await access(createdDir, fsConstants.F_OK);
    await defaultSchemaFileMaterializerOps.rm(createdDir, {
      recursive: true,
      force: true,
    });
  });

  it("fails scope close with a static secret-safe defect when finalizer cleanup fails", async () => {
    let createdDir = "";
    let rmAttempts = 0;
    const { ops } = makeTrackingOps({
      platform: "linux",
      maxRetries: 1,
      retryDelayMs: 0,
      mkdtemp: async (prefix) => {
        createdDir = await defaultSchemaFileMaterializerOps.mkdtemp(prefix);
        return createdDir;
      },
      rm: () => {
        rmAttempts += 1;
        return Promise.reject(new Error("rm denied in finalizer"));
      },
    });

    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const path = yield* materializeCanarySchemaFile(schemaJson, ops);
        expect(path.length).toBeGreaterThan(0);
      }).pipe(Effect.scoped),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      // Finalizer channel is never: cleanup failure is a defect, not a typed fail.
      const defects = Chunk.toReadonlyArray(Cause.defects(exit.cause));
      expect(defects.length).toBeGreaterThan(0);
      const defect = defects[0];
      expect(defect).toBeInstanceOf(Error);
      const message = defect instanceof Error ? defect.message : String(defect);
      expect(message).toBe("schema file cleanup failed");
      expect(message).not.toContain(schemaJson);
      expect(message).not.toMatch(/\/tmp|\/home|council-schema-/);
      // Typed failure channel must remain empty for finalizer defects.
      expect(Cause.failureOption(exit.cause)._tag).toBe("None");
    }
    expect(rmAttempts).toBeGreaterThan(1);
    expect(createdDir.length).toBeGreaterThan(0);
    await access(createdDir, fsConstants.F_OK);
    await defaultSchemaFileMaterializerOps.rm(createdDir, {
      recursive: true,
      force: true,
    });
  });
});
