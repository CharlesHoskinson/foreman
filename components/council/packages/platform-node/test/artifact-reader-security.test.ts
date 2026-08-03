import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import type { ReviewArtifactDescriptorV1 } from "@council/schema";
import { createFilesystemArtifactReader } from "../src/artifact-reader.js";
import {
  stringifyCanonicalJson,
  canonicalJsonBytes,
} from "../src/canonical-json.js";

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

describe("filesystem artifact reader security", () => {
  it("does not leak filesystem paths or secret path segments in public errors", async () => {
    const secretSegment = "sk-supersecrettokenvalue99";
    const root = await mkdtemp(join(tmpdir(), "council-art-"));
    const secretDir = join(root, secretSegment);
    const filePath = join(secretDir, "missing-file.bin");
    const artifactId = "sha256:" + "cd".repeat(32);
    try {
      const reader = createFilesystemArtifactReader(
        new Map([[artifactId, filePath]]),
      );
      const exit = await Effect.runPromiseExit(
        reader.read({
          descriptor: descriptor(artifactId, 4),
          maxBytes: 4,
        }),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const cause = exit.cause;
        const error =
          cause._tag === "Fail" ? cause.error : { reason: String(cause) };
        const serialized = JSON.stringify(error);
        expect(serialized).not.toContain(filePath);
        expect(serialized).not.toContain(secretSegment);
        expect(serialized).not.toContain(root);
        expect(serialized).toContain(artifactId);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("bounded read refuses unbounded content beyond maxArtifactBytes", async () => {
    const root = await mkdtemp(join(tmpdir(), "council-bound-"));
    const filePath = join(root, "big.bin");
    const payload = Buffer.alloc(64, 0x41);
    await writeFile(filePath, payload);
    const artifactId = "sha256:" + "ef".repeat(32);
    try {
      const reader = createFilesystemArtifactReader(
        new Map([[artifactId, filePath]]),
      );
      // Reader must accept a max bound. When bound is 8, reading 64-byte file fails
      // without returning the full contents.
      const exit = await Effect.runPromiseExit(
        reader.read({
          descriptor: descriptor(artifactId, 64),
          maxBytes: 8,
        }),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        expect(exit.value.byteLength).toBeLessThanOrEqual(9);
        expect.fail("bounded reader must not succeed for oversized file");
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("platform canonical JSON safety", () => {
  it("preserves own __proto__ keys in platform canonicalizer", () => {
    const schema = JSON.parse(
      '{"type":"object","properties":{"__proto__":{"type":"string"},"ok":{"type":"number"}}}',
    ) as Record<string, unknown>;
    expect(Object.hasOwn(schema.properties as object, "__proto__")).toBe(true);
    const text = stringifyCanonicalJson(schema);
    expect(text).toContain('"__proto__"');
    const reparsed = JSON.parse(text) as {
      properties: Record<string, unknown>;
    };
    expect(Object.hasOwn(reparsed.properties, "__proto__")).toBe(true);
    const bytes = canonicalJsonBytes(schema);
    expect(Buffer.from(bytes).toString("utf8")).toContain('"__proto__"');
  });
});
