import { access, readFile, stat } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { dirname } from "node:path";
import type { CanaryChallengeV1, ContentHash } from "@council/schema";
import { Cause, Chunk, Effect, Exit, Fiber, Scope } from "effect";
import { describe, expect, it } from "vitest";
import { encodeUtf8, stringifyCanonicalJson } from "../src/canonical-json.js";
import { sha256Hex } from "../src/digest.js";
import {
  buildCanaryMaterial,
  CanaryMaterializationError,
  defaultCanaryMaterializerOps,
  materializeCanaryPromptFile,
  type CanaryMaterializerOps,
} from "../src/canary-materializer.js";

const challenge = (): CanaryChallengeV1 => ({
  schemaVersion: 1,
  nonce: "nonce-canary-test-001",
  checkExpression: "1+1",
  expectedCheckResult: "2",
});

const expectedSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "nonce", "checkResult", "status"],
  properties: {
    schemaVersion: { type: "integer", enum: [1] },
    nonce: { type: "string", enum: ["nonce-canary-test-001"] },
    checkResult: { type: "string", enum: ["2"] },
    status: { type: "string", enum: ["ready"] },
  },
};

const isPosixHost = process.platform !== "win32";

const makeTrackingOps = (
  overrides: Partial<CanaryMaterializerOps> = {},
): {
  readonly ops: CanaryMaterializerOps;
  readonly calls: string[];
} => {
  const calls: string[] = [];
  const base = defaultCanaryMaterializerOps;
  const ops: CanaryMaterializerOps = {
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

const expectSecretSafe = (error: CanaryMaterializationError): void => {
  expect(error.reason).not.toMatch(/\/tmp|\/home|\\\\|C:\\\\/i);
  expect(error.reason).not.toMatch(/council-canary-/);
  expect(error.reason).not.toContain("nonce-canary-test-001");
  expect(JSON.stringify(error)).not.toMatch(/\/tmp|\/home/);
};

describe("buildCanaryMaterial", () => {
  it("is deterministic for the same challenge", () => {
    const a = buildCanaryMaterial(challenge());
    const b = buildCanaryMaterial(challenge());
    expect(Buffer.from(a.promptBytes).equals(Buffer.from(b.promptBytes))).toBe(
      true,
    );
    expect(a.schemaJson).toBe(b.schemaJson);
    expect(a.canarySchemaVariantHash).toBe(b.canarySchemaVariantHash);
  });

  it("embeds the challenge nonce in canonical prompt bytes", () => {
    const material = buildCanaryMaterial(challenge());
    const text = new TextDecoder().decode(material.promptBytes);
    expect(text).toContain("nonce-canary-test-001");
    const parsed = JSON.parse(text) as {
      format: string;
      trustedAuthority: {
        profile: string;
        rules: readonly string[];
      };
      taskData: CanaryChallengeV1;
    };
    expect(parsed.format).toBe("council-canary-v1");
    expect(parsed.trustedAuthority.profile).toBe("council-ace-1");
    expect(parsed.trustedAuthority.rules).toEqual([
      "Every reviewer must return exactly one response.",
      "Every reviewer must copy the nonce.",
      "Every reviewer must solve the check.",
      "No reviewer may use a tool.",
    ]);
    expect(parsed.taskData.nonce).toBe("nonce-canary-test-001");
    expect(parsed.taskData.checkExpression).toBe("1+1");
    expect(parsed.taskData.expectedCheckResult).toBe("2");
  });

  it("binds schemaJson to the closed canary response schema", () => {
    const material = buildCanaryMaterial(challenge());
    expect(material.schemaJson).toBe(stringifyCanonicalJson(expectedSchema));
    const parsed = JSON.parse(material.schemaJson) as {
      additionalProperties: boolean;
      required: readonly string[];
      properties: Record<string, unknown>;
    };
    expect(parsed.additionalProperties).toBe(false);
    expect(parsed.required).toEqual([
      "schemaVersion",
      "nonce",
      "checkResult",
      "status",
    ]);
    expect(parsed.properties).toEqual(expectedSchema.properties);
  });

  it("hashes exact UTF-8 schemaJson bytes as ContentHash", () => {
    const material = buildCanaryMaterial(challenge());
    const digest = sha256Hex(encodeUtf8(material.schemaJson));
    const expected = `sha256:${digest}` as ContentHash;
    expect(material.canarySchemaVariantHash).toBe(expected);
    expect(material.canarySchemaVariantHash.startsWith("sha256:")).toBe(true);
  });

  it("changes schema bytes and hash when the challenge nonce changes", () => {
    const first = buildCanaryMaterial(challenge());
    const second = buildCanaryMaterial({
      ...challenge(),
      nonce: "nonce-canary-test-002",
    });

    expect(first.schemaJson).not.toBe(second.schemaJson);
    expect(first.canarySchemaVariantHash).not.toBe(
      second.canarySchemaVariantHash,
    );
  });
});

describe("materializeCanaryPromptFile", () => {
  it.runIf(isPosixHost)(
    "writes exact prompt bytes to a private temporary .txt file",
    async () => {
      const material = buildCanaryMaterial(challenge());
      const program = Effect.gen(function* () {
        const path = yield* materializeCanaryPromptFile(material.promptBytes);
        const bytes = yield* Effect.promise(() => readFile(path));
        expect(
          Buffer.from(bytes).equals(Buffer.from(material.promptBytes)),
        ).toBe(true);
        expect(path.endsWith(".txt")).toBe(true);
        expect(path.endsWith("prompt.txt")).toBe(true);
        const fileStat = yield* Effect.promise(() => stat(path));
        expect(fileStat.mode & 0o777).toBe(0o600);
        const dirStat = yield* Effect.promise(() => stat(dirname(path)));
        expect(dirStat.mode & 0o777).toBe(0o700);
        return path;
      }).pipe(Effect.scoped);

      const path = await Effect.runPromise(program);
      await expect(access(path, fsConstants.F_OK)).rejects.toBeTruthy();
      await expect(
        access(dirname(path), fsConstants.F_OK),
      ).rejects.toBeTruthy();
    },
  );

  it.runIf(isPosixHost)(
    "deletes the temporary directory on scoped success",
    async () => {
      const material = buildCanaryMaterial(challenge());
      let materializedPath = "";
      await Effect.runPromise(
        Effect.gen(function* () {
          materializedPath = yield* materializeCanaryPromptFile(
            material.promptBytes,
          );
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
      const material = buildCanaryMaterial(challenge());
      let materializedPath = "";
      const exit = await Effect.runPromiseExit(
        Effect.gen(function* () {
          materializedPath = yield* materializeCanaryPromptFile(
            material.promptBytes,
          );
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
      const material = buildCanaryMaterial(challenge());
      let materializedPath = "";
      const fiber = Effect.runFork(
        Effect.gen(function* () {
          materializedPath = yield* materializeCanaryPromptFile(
            material.promptBytes,
          );
          yield* Effect.promise(() =>
            access(materializedPath, fsConstants.F_OK),
          );
          yield* Effect.never;
        }).pipe(Effect.scoped),
      );

      for (let i = 0; i < 50 && materializedPath.length === 0; i += 1) {
        await Effect.runPromise(Effect.sleep("10 millis"));
      }
      expect(materializedPath.length).toBeGreaterThan(0);
      await Effect.runPromise(Fiber.interrupt(fiber));
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

  it("refuses native Windows before any filesystem mutation", async () => {
    const material = buildCanaryMaterial(challenge());
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
      materializeCanaryPromptFile(material.promptBytes, ops).pipe(
        Effect.scoped,
      ),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const error = Cause.failureOption(exit.cause);
      expect(error._tag).toBe("Some");
      if (error._tag === "Some") {
        expect(error.value).toBeInstanceOf(CanaryMaterializationError);
        const typed = error.value;
        expect(typed.category).toBe("unsupported_platform");
        expect(typed.reason).toBe(
          "native Windows canary prompt materialization is unsupported",
        );
        expectSecretSafe(typed);
      }
    }
    expect(calls).toEqual([]);
  });

  it("cleans up after directory permission failure and reports create_failed", async () => {
    const material = buildCanaryMaterial(challenge());
    let createdDir = "";
    let rmCount = 0;
    const { ops } = makeTrackingOps({
      platform: "linux",
      mkdtemp: async (prefix) => {
        createdDir = await defaultCanaryMaterializerOps.mkdtemp(prefix);
        return createdDir;
      },
      chmod: () => Promise.reject(new Error("chmod denied")),
      rm: async (path, options) => {
        rmCount += 1;
        return defaultCanaryMaterializerOps.rm(path, options);
      },
    });

    const exit = await Effect.runPromiseExit(
      materializeCanaryPromptFile(material.promptBytes, ops).pipe(
        Effect.scoped,
      ),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const error = Cause.failureOption(exit.cause);
      expect(error._tag).toBe("Some");
      if (error._tag === "Some") {
        const typed = error.value;
        expect(typed.category).toBe("create_failed");
        expect(typed.reason).toBe("canary prompt materialization failed");
        expectSecretSafe(typed);
      }
    }
    expect(createdDir.length).toBeGreaterThan(0);
    expect(rmCount).toBeGreaterThanOrEqual(1);
    await expect(access(createdDir, fsConstants.F_OK)).rejects.toBeTruthy();
  });

  it("cleans up after write failure and reports write_failed", async () => {
    const material = buildCanaryMaterial(challenge());
    let createdDir = "";
    let rmCount = 0;
    const { ops } = makeTrackingOps({
      platform: "linux",
      mkdtemp: async (prefix) => {
        createdDir = await defaultCanaryMaterializerOps.mkdtemp(prefix);
        return createdDir;
      },
      writeFile: () => Promise.reject(new Error("write denied")),
      rm: async (path, options) => {
        rmCount += 1;
        return defaultCanaryMaterializerOps.rm(path, options);
      },
    });

    const exit = await Effect.runPromiseExit(
      materializeCanaryPromptFile(material.promptBytes, ops).pipe(
        Effect.scoped,
      ),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const error = Cause.failureOption(exit.cause);
      expect(error._tag).toBe("Some");
      if (error._tag === "Some") {
        const typed = error.value;
        expect(typed.category).toBe("write_failed");
        expect(typed.reason).toBe("canary prompt materialization failed");
        expectSecretSafe(typed);
      }
    }
    expect(rmCount).toBeGreaterThanOrEqual(1);
    await expect(access(createdDir, fsConstants.F_OK)).rejects.toBeTruthy();
  });

  it("reports cleanup_failed when write-failure cleanup cannot remove the directory", async () => {
    const material = buildCanaryMaterial(challenge());
    let createdDir = "";
    const { ops } = makeTrackingOps({
      platform: "linux",
      maxRetries: 1,
      retryDelayMs: 0,
      mkdtemp: async (prefix) => {
        createdDir = await defaultCanaryMaterializerOps.mkdtemp(prefix);
        return createdDir;
      },
      writeFile: () => Promise.reject(new Error("write denied")),
      rm: () => Promise.reject(new Error("rm denied")),
    });

    const exit = await Effect.runPromiseExit(
      materializeCanaryPromptFile(material.promptBytes, ops).pipe(
        Effect.scoped,
      ),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const error = Cause.failureOption(exit.cause);
      expect(error._tag).toBe("Some");
      if (error._tag === "Some") {
        const typed = error.value;
        expect(typed.category).toBe("cleanup_failed");
        expect(typed.reason).toBe("canary prompt cleanup failed");
        expectSecretSafe(typed);
      }
    }
    expect(createdDir.length).toBeGreaterThan(0);
    await access(createdDir, fsConstants.F_OK);
    await defaultCanaryMaterializerOps.rm(createdDir, {
      recursive: true,
      force: true,
    });
  });

  it("fails scope close with a static secret-safe defect when finalizer cleanup fails", async () => {
    const material = buildCanaryMaterial(challenge());
    let createdDir = "";
    let rmAttempts = 0;
    const { ops } = makeTrackingOps({
      platform: "linux",
      maxRetries: 1,
      retryDelayMs: 0,
      mkdtemp: async (prefix) => {
        createdDir = await defaultCanaryMaterializerOps.mkdtemp(prefix);
        return createdDir;
      },
      rm: () => {
        rmAttempts += 1;
        return Promise.reject(new Error("rm denied in finalizer"));
      },
    });

    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const path = yield* materializeCanaryPromptFile(
          material.promptBytes,
          ops,
        );
        expect(path.length).toBeGreaterThan(0);
      }).pipe(Effect.scoped),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const defects = Chunk.toReadonlyArray(Cause.defects(exit.cause));
      expect(defects.length).toBeGreaterThan(0);
      const defect = defects[0];
      expect(defect).toBeInstanceOf(Error);
      const message = defect instanceof Error ? defect.message : String(defect);
      expect(message).toBe("canary prompt cleanup failed");
      expect(message).not.toMatch(/\/tmp|\/home|council-canary-/);
      expect(Cause.failureOption(exit.cause)._tag).toBe("None");
    }
    expect(rmAttempts).toBeGreaterThan(1);
    expect(createdDir.length).toBeGreaterThan(0);
    await access(createdDir, fsConstants.F_OK);
    await defaultCanaryMaterializerOps.rm(createdDir, {
      recursive: true,
      force: true,
    });
  });

  it.runIf(isPosixHost)(
    "does not retain the materialized path outside the open scope",
    async () => {
      const material = buildCanaryMaterial(challenge());
      const scope = await Effect.runPromise(Scope.make());
      const path = await Effect.runPromise(
        materializeCanaryPromptFile(material.promptBytes).pipe(
          Scope.extend(scope),
        ),
      );
      await Effect.runPromise(
        Effect.promise(() => access(path, fsConstants.F_OK)),
      );
      await Effect.runPromise(Scope.close(scope, Exit.void));
      await expect(access(path, fsConstants.F_OK)).rejects.toBeTruthy();
    },
  );
});
