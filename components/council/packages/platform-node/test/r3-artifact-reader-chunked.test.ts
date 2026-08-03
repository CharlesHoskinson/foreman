import {
  closeSync,
  fstatSync,
  mkdtempSync,
  openSync,
  readSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import {
  decodeStrictSync,
  ReviewBundleIdentityV1,
  type ReviewArtifactDescriptorV1,
} from "@council/schema";
import {
  ArtifactLimitExceeded,
  ArtifactMissing,
  ArtifactReadError,
  type PromptMaterializerInput,
} from "@council/application";
import { createFilesystemArtifactReader } from "../src/artifact-reader.js";
import { stringifyCanonicalJson, sortJsonKeys } from "../src/canonical-json.js";
import { NodePromptMaterializer } from "../src/prompt-materializer.js";

/**
 * Local ops seam type. Checkpoint B ignores a second constructor argument;
 * corrected production must accept this injection for close-on-failure and
 * post-stat-growth probes.
 */
type FilesystemOps = {
  openSync: (path: string, flags: string) => number;
  fstatSync: (fileDescriptor: number) => { readonly size: number };
  readSync: (
    fileDescriptor: number,
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ) => number;
  closeSync: (fileDescriptor: number) => void;
};

const descriptor = (
  artifactId: string,
  byteLength: number,
): ReviewArtifactDescriptorV1 =>
  ({
    schemaVersion: 1,
    alias: "sample",
    mediaType: "text/plain",
    byteLength,
    digest: "ab".repeat(32),
    artifactId,
  }) as ReviewArtifactDescriptorV1;

const isTaggedLimit = (error: unknown): boolean =>
  error instanceof ArtifactLimitExceeded ||
  (error as { _tag?: string })._tag === "ArtifactLimitExceeded";

const isTaggedRead = (error: unknown): boolean =>
  error instanceof ArtifactReadError ||
  error instanceof ArtifactMissing ||
  (error as { _tag?: string })._tag === "ArtifactReadError" ||
  (error as { _tag?: string })._tag === "ArtifactMissing" ||
  isTaggedLimit(error);

const firstFail = (cause: unknown): unknown => {
  if (cause === null || typeof cause !== "object") return undefined;
  const tagged = cause as {
    _tag?: string;
    error?: unknown;
    left?: unknown;
    right?: unknown;
  };
  if (tagged._tag === "Fail" && tagged.error !== undefined) return tagged.error;
  if (tagged._tag === "Parallel" || tagged._tag === "Sequential") {
    return firstFail(tagged.left) ?? firstFail(tagged.right);
  }
  return undefined;
};

const extractFail = <E>(exit: Exit.Exit<unknown, E>): E => {
  if (exit._tag !== "Failure") throw new Error("expected failure");
  const error = firstFail(exit.cause);
  if (error !== undefined) return error as E;
  throw new Error(`unexpected cause ${exit.cause._tag}`);
};

describe("chunked filesystem reader", () => {
  it("reads a small file when maxBytes is Number.MAX_SAFE_INTEGER", async () => {
    const root = mkdtempSync(join(tmpdir(), "council-chunk-small-"));
    const filePath = join(root, "tiny.bin");
    const payload = Buffer.from("hello-chunked");
    writeFileSync(filePath, payload);
    const artifactId = "sha256:" + "11".repeat(32);
    try {
      const reader = createFilesystemArtifactReader(
        new Map([[artifactId, filePath]]),
      );
      const exit = await Effect.runPromiseExit(
        reader.read({
          descriptor: descriptor(artifactId, payload.byteLength),
          maxBytes: Number.MAX_SAFE_INTEGER,
        }),
      );
      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        expect(Buffer.from(exit.value).toString("utf8")).toBe("hello-chunked");
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reads multi-chunk content under a modest bound and counts multiple readSync calls", async () => {
    const root = mkdtempSync(join(tmpdir(), "council-chunk-multi-"));
    const filePath = join(root, "multi.bin");
    // Large enough to force more than one fixed-size chunk read.
    const payload = Buffer.alloc(200_000, 0x42);
    writeFileSync(filePath, payload);
    const artifactId = "sha256:" + "22".repeat(32);
    let readCalls = 0;
    const ops: FilesystemOps = {
      openSync: (path, flags) => openSync(path, flags),
      fstatSync: (fd) => fstatSync(fd),
      readSync: (fd, buffer, offset, length, position) => {
        readCalls += 1;
        return readSync(fd, buffer, offset, length, position);
      },
      closeSync: (fd) => {
        closeSync(fd);
      },
    };
    try {
      const reader = createFilesystemArtifactReader(
        new Map([[artifactId, filePath]]),
        ops,
      );
      const exit = await Effect.runPromiseExit(
        reader.read({
          descriptor: descriptor(artifactId, payload.byteLength),
          maxBytes: 250_000,
        }),
      );
      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        expect(exit.value.byteLength).toBe(200_000);
      }
      // Multi-chunk vector must perform more than one readSync.
      expect(readCalls).toBeGreaterThan(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("accepts exact-bound reads with exact bytes", async () => {
    const root = mkdtempSync(join(tmpdir(), "council-chunk-exact-"));
    const filePath = join(root, "exact.bin");
    const payload = Buffer.alloc(64, 0x41);
    writeFileSync(filePath, payload);
    const artifactId = "sha256:" + "33".repeat(32);
    try {
      const reader = createFilesystemArtifactReader(
        new Map([[artifactId, filePath]]),
      );
      const exit = await Effect.runPromiseExit(
        reader.read({
          descriptor: descriptor(artifactId, 64),
          maxBytes: 64,
        }),
      );
      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        expect(exit.value.byteLength).toBe(64);
        expect(Buffer.from(exit.value).equals(payload)).toBe(true);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects one-byte-over-bound content with specific tagged oversize error", async () => {
    const root = mkdtempSync(join(tmpdir(), "council-chunk-over-"));
    const filePath = join(root, "over.bin");
    writeFileSync(filePath, Buffer.alloc(65, 0x41));
    const artifactId = "sha256:" + "44".repeat(32);
    try {
      const reader = createFilesystemArtifactReader(
        new Map([[artifactId, filePath]]),
      );
      const exit = await Effect.runPromiseExit(
        reader.read({
          descriptor: descriptor(artifactId, 65),
          maxBytes: 64,
        }),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(exit.cause._tag).toBe("Fail");
        const error = extractFail(exit);
        expect(isTaggedLimit(error)).toBe(true);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects invalid maxBytes bounds before open or allocation", async () => {
    // Use a real file so an open-before-validate implementation would open
    // successfully — failure must be the bound check, not a missing path.
    const root = mkdtempSync(join(tmpdir(), "council-chunk-bound-"));
    const filePath = join(root, "bound.bin");
    writeFileSync(filePath, Buffer.from("x"));
    const artifactId = "sha256:" + "55".repeat(32);
    let opened = 0;
    const ops: FilesystemOps = {
      openSync: (path, flags) => {
        opened += 1;
        return openSync(path, flags);
      },
      fstatSync: (fd) => fstatSync(fd),
      readSync: (fd, buffer, offset, length, position) =>
        readSync(fd, buffer, offset, length, position),
      closeSync: (fd) => {
        closeSync(fd);
      },
    };
    try {
      const reader = createFilesystemArtifactReader(
        new Map([[artifactId, filePath]]),
        ops,
      );
      const invalidBounds = [
        0,
        -1,
        -100,
        1.5,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        Number.MAX_SAFE_INTEGER + 1,
      ];
      for (const maxBytes of invalidBounds) {
        opened = 0;
        const exit = await Effect.runPromiseExit(
          reader.read({
            descriptor: descriptor(artifactId, 1),
            maxBytes,
          }),
        );
        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          expect(exit.cause._tag).toBe("Fail");
          const error = extractFail(exit) as {
            _tag?: string;
            reason?: string;
            observedBytes?: number;
          };
          expect(isTaggedRead(error)).toBe(true);
          // Bound validation is distinct from post-open oversize: the public
          // reason must identify an invalid bound, not only "exceeds maximum"
          // after opening a valid one-byte file.
          const reason = error.reason ?? "";
          expect(reason).toMatch(
            /invalid|not a (positive|safe)|non-?finite|maxBytes|bound/i,
          );
          expect(reason).not.toMatch(/exceeds configured maximum/i);
        }
        // When the ops seam is live, invalid bounds fail before open.
        expect(opened).toBe(0);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("closes the descriptor on success and on injected post-open failure", async () => {
    const root = mkdtempSync(join(tmpdir(), "council-chunk-close-"));
    const filePath = join(root, "close.bin");
    writeFileSync(filePath, Buffer.from("x"));
    const artifactId = "sha256:" + "66".repeat(32);
    let openCount = 0;
    let closeCount = 0;
    const ops: FilesystemOps = {
      openSync: (path, flags) => {
        openCount += 1;
        return openSync(path, flags);
      },
      fstatSync: (fd) => fstatSync(fd),
      readSync: (fd, buffer, offset, length, position) =>
        readSync(fd, buffer, offset, length, position),
      closeSync: (fd) => {
        closeCount += 1;
        closeSync(fd);
      },
    };
    try {
      const reader = createFilesystemArtifactReader(
        new Map([[artifactId, filePath]]),
        ops,
      );
      const ok = await Effect.runPromiseExit(
        reader.read({
          descriptor: descriptor(artifactId, 1),
          maxBytes: 10,
        }),
      );
      expect(Exit.isSuccess(ok)).toBe(true);
      expect(openCount).toBe(1);
      expect(closeCount).toBe(1);

      // Failure path: valid positive safe bound with injected post-open fstat failure.
      openCount = 0;
      closeCount = 0;
      const failOps: FilesystemOps = {
        openSync: (path, flags) => {
          openCount += 1;
          return openSync(path, flags);
        },
        fstatSync: () => {
          const err = new Error("EIO injected") as NodeJS.ErrnoException;
          err.code = "EIO";
          throw err;
        },
        readSync: (fd, buffer, offset, length, position) =>
          readSync(fd, buffer, offset, length, position),
        closeSync: (fd) => {
          closeCount += 1;
          closeSync(fd);
        },
      };
      const failingReader = createFilesystemArtifactReader(
        new Map([[artifactId, filePath]]),
        failOps,
      );
      const fail = await Effect.runPromiseExit(
        failingReader.read({
          descriptor: descriptor(artifactId, 1),
          maxBytes: 10,
        }),
      );
      expect(Exit.isFailure(fail)).toBe(true);
      if (Exit.isFailure(fail)) {
        expect(fail.cause._tag).toBe("Fail");
        expect(isTaggedRead(extractFail(fail))).toBe(true);
      }
      expect(openCount).toBe(1);
      expect(closeCount).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects post-stat growth via injected filesystem ops after readSync over limit", async () => {
    const artifactId = "sha256:" + "77".repeat(32);
    let readRan = false;
    let readReturned = 0;
    let closed = false;
    const fakeFd = 99;
    const ops: FilesystemOps = {
      openSync: () => fakeFd,
      fstatSync: () =>
        // Report in-limit size so the reader proceeds to read.
        ({ size: 4 }),
      readSync: (_fd, buffer, offset, length) => {
        readRan = true;
        // Return more than the limit after an in-limit stat result.
        const view = buffer as Buffer;
        const budget = Math.min(length, 8);
        for (let i = 0; i < budget; i += 1) {
          view[offset + i] = 0x41;
        }
        readReturned = budget;
        return budget;
      },
      closeSync: () => {
        closed = true;
      },
    };
    const reader = createFilesystemArtifactReader(
      new Map([[artifactId, "/injected/path"]]),
      ops,
    );
    const exit = await Effect.runPromiseExit(
      reader.read({
        descriptor: descriptor(artifactId, 4),
        maxBytes: 4,
      }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause._tag).toBe("Fail");
      expect(isTaggedLimit(extractFail(exit))).toBe(true);
    }
    expect(readRan).toBe(true);
    expect(readReturned).toBeGreaterThan(4);
    expect(closed).toBe(true);
  });

  it("rejects stat-oversize with specific tagged oversize error", async () => {
    const artifactId = "sha256:" + "88".repeat(32);
    let closed = false;
    const ops: FilesystemOps = {
      openSync: () => 7,
      fstatSync: () => ({ size: 10_000 }),
      readSync: () => 0,
      closeSync: () => {
        closed = true;
      },
    };
    const reader = createFilesystemArtifactReader(
      new Map([[artifactId, "/injected/oversize"]]),
      ops,
    );
    const exit = await Effect.runPromiseExit(
      reader.read({
        descriptor: descriptor(artifactId, 10_000),
        maxBytes: 100,
      }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause._tag).toBe("Fail");
      expect(isTaggedLimit(extractFail(exit))).toBe(true);
    }
    expect(closed).toBe(true);
  });
});

describe("platform cross-layer key vectors", () => {
  it("preserves __proto__, constructor, and prototype in platform canonicalizer", () => {
    const schema = JSON.parse(
      '{"type":"object","required":["__proto__","constructor","prototype"],"properties":{"__proto__":{"type":"string"},"constructor":{"type":"string"},"prototype":{"type":"string"}}}',
    ) as Record<string, unknown>;
    const sorted = sortJsonKeys(schema) as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(Object.hasOwn(sorted.properties, "__proto__")).toBe(true);
    expect(Object.hasOwn(sorted.properties, "constructor")).toBe(true);
    expect(Object.hasOwn(sorted.properties, "prototype")).toBe(true);
    expect(sorted.required).toEqual(["__proto__", "constructor", "prototype"]);
    const text = stringifyCanonicalJson(schema);
    const reparsed = JSON.parse(text) as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(Object.hasOwn(reparsed.properties, "__proto__")).toBe(true);
    expect(Object.hasOwn(reparsed.properties, "constructor")).toBe(true);
    expect(Object.hasOwn(reparsed.properties, "prototype")).toBe(true);
  });

  it("production prompt materializer preserves special keys and exact required array", async () => {
    const schema = JSON.parse(
      '{"type":"object","required":["__proto__","constructor","prototype"],"properties":{"__proto__":{"type":"string"},"constructor":{"type":"string"},"prototype":{"type":"string"}},"additionalProperties":false}',
    ) as Record<string, unknown>;
    const materializer = NodePromptMaterializer;
    const input: PromptMaterializerInput = {
      format: "council-prompt-v1" as const,
      trustedAuthority: {
        profile: "council-ace-1" as const,
        aceText: "rule",
      },
      taskData: {
        candidateId: "cand_01ARZ3NDEKTSV4RRFFQ69G5FAV",
        bundle: decodeStrictSync(ReviewBundleIdentityV1, {
          schemaVersion: 1,
          baseSha: "a".repeat(40),
          headSha: "b".repeat(40),
          diffSha256: "c".repeat(64),
        }),
        limits: {
          maxPromptBytes: 200_000,
          maxArtifactBytes: 1_000_000,
          maxTurns: 1,
          maxWallTimeMs: 60_000,
          maxRetries: 1,
        },
      },
      untrustedEvidence: [],
      responseSchema: schema,
    };
    const exit = await Effect.runPromiseExit(materializer.materialize(input));
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      const text = Buffer.from(exit.value).toString("utf8");
      const parsed = JSON.parse(text) as {
        responseSchema: {
          properties: Record<string, unknown>;
          required: string[];
        };
      };
      expect(Object.hasOwn(parsed.responseSchema.properties, "__proto__")).toBe(
        true,
      );
      expect(
        Object.hasOwn(parsed.responseSchema.properties, "constructor"),
      ).toBe(true);
      expect(Object.hasOwn(parsed.responseSchema.properties, "prototype")).toBe(
        true,
      );
      expect(parsed.responseSchema.required).toEqual([
        "__proto__",
        "constructor",
        "prototype",
      ]);
    }
  });
});
