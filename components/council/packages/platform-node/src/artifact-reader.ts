import { closeSync, openSync, readSync, fstatSync } from "node:fs";
import type { ArtifactReaderService } from "@council/application";
import {
  ArtifactLimitExceeded,
  ArtifactMissing,
  ArtifactReadError,
  ArtifactReader,
} from "@council/application";
import { Effect, Layer } from "effect";

/**
 * Filesystem artifact reader keyed by a path map.
 * The application package never sees paths; this adapter is Node-only.
 * Public errors never include filesystem paths or raw OS messages.
 */
export type ArtifactPathMap = ReadonlyMap<string, string>;

export type FilesystemArtifactReaderOps = {
  readonly open: (path: string) => number;
  readonly stat: (fileDescriptor: number) => { readonly size: number };
  readonly read: (
    fileDescriptor: number,
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ) => number;
  readonly close: (fileDescriptor: number) => void;
};

const defaultOps: FilesystemArtifactReaderOps = {
  open: (path) => openSync(path, "r"),
  stat: (fileDescriptor) => fstatSync(fileDescriptor),
  read: (fileDescriptor, buffer, offset, length, position) =>
    readSync(fileDescriptor, buffer, offset, length, position),
  close: (fileDescriptor) => {
    closeSync(fileDescriptor);
  },
};

type CompatibleFilesystemOps = {
  readonly openSync: (path: string, flags: string) => number;
  readonly fstatSync: (fileDescriptor: number) => { readonly size: number };
  readonly readSync: (
    fileDescriptor: number,
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ) => number;
  readonly closeSync: (fileDescriptor: number) => void;
};

const normalizeOps = (
  supplied: CompatibleFilesystemOps | undefined,
): FilesystemArtifactReaderOps =>
  supplied === undefined
    ? defaultOps
    : {
        open: (path) => supplied.openSync(path, "r"),
        stat: (fileDescriptor) => supplied.fstatSync(fileDescriptor),
        read: (fileDescriptor, buffer, offset, length, position) =>
          supplied.readSync(fileDescriptor, buffer, offset, length, position),
        close: (fileDescriptor) => {
          supplied.closeSync(fileDescriptor);
        },
      };

const classifyOsCode = (
  code: string | undefined,
): "not_found" | "permission" | "io" | "unknown" => {
  if (code === "ENOENT") return "not_found";
  if (code === "EACCES" || code === "EPERM") return "permission";
  if (code === "EIO" || code === "EISDIR" || code === "ENOTDIR") return "io";
  return "unknown";
};

/**
 * Bounded read: open/stat/read at most maxBytes+1, always close the fd.
 * Never uses unbounded readFile.
 */
export const createFilesystemArtifactReader = (
  pathsByArtifactId: ArtifactPathMap,
  suppliedOps?: CompatibleFilesystemOps,
): ArtifactReaderService => ({
  read: (request) =>
    Effect.suspend(() => {
      const { descriptor, maxBytes } = request;
      if (
        !Number.isSafeInteger(maxBytes) ||
        maxBytes <= 0 ||
        !Number.isFinite(maxBytes)
      ) {
        return Effect.fail(
          new ArtifactReadError({
            stage: "artifact_read",
            reason: "maxBytes must be a positive safe-integer bound",
            artifactId: descriptor.artifactId,
            category: "limit",
          }),
        );
      }
      const path = pathsByArtifactId.get(descriptor.artifactId);
      if (path === undefined) {
        return Effect.fail(
          new ArtifactMissing({
            stage: "artifact_read",
            reason: `no path registered for artifact ${descriptor.artifactId}`,
            artifactId: descriptor.artifactId,
          }),
        );
      }

      let fd: number | undefined;
      const ops = normalizeOps(suppliedOps);
      try {
        fd = ops.open(path);
        const stats = ops.stat(fd);
        if (
          typeof stats.size !== "number" ||
          !Number.isSafeInteger(stats.size) ||
          stats.size < 0
        ) {
          return Effect.fail(
            new ArtifactReadError({
              stage: "artifact_read",
              reason: `artifact stat is invalid for ${descriptor.artifactId}`,
              artifactId: descriptor.artifactId,
              category: "io",
            }),
          );
        }
        if (stats.size > maxBytes) {
          return Effect.fail(
            new ArtifactLimitExceeded({
              stage: "artifact_limit",
              reason: `artifact exceeds configured maximum for ${descriptor.artifactId}`,
              artifactId: descriptor.artifactId,
              maxArtifactBytes: maxBytes,
              observedBytes: stats.size,
            }),
          );
        }
        const chunkSize = 64 * 1024;
        const chunks: Uint8Array[] = [];
        let total = 0;
        for (;;) {
          const remaining = maxBytes - total;
          const requestLength =
            remaining >= chunkSize ? chunkSize : remaining + 1;
          const buffer = new Uint8Array(requestLength);
          const n = ops.read(fd, buffer, 0, requestLength, total);
          if (!Number.isSafeInteger(n) || n < 0 || n > requestLength) {
            return Effect.fail(
              new ArtifactReadError({
                stage: "artifact_read",
                reason: `artifact reader returned an invalid byte count for ${descriptor.artifactId}`,
                artifactId: descriptor.artifactId,
                category: "io",
              }),
            );
          }
          if (n === 0) break;
          if (total + n > maxBytes) {
            return Effect.fail(
              new ArtifactLimitExceeded({
                stage: "artifact_limit",
                reason: `artifact exceeds configured maximum for ${descriptor.artifactId}`,
                artifactId: descriptor.artifactId,
                maxArtifactBytes: maxBytes,
                observedBytes: total + n,
              }),
            );
          }
          const chunk = new Uint8Array(n);
          chunk.set(buffer.subarray(0, n));
          chunks.push(chunk);
          total += n;
        }
        const out = new Uint8Array(total);
        let outputOffset = 0;
        for (const chunk of chunks) {
          out.set(chunk, outputOffset);
          outputOffset += chunk.byteLength;
        }
        return Effect.succeed(out);
      } catch (error) {
        if (
          error instanceof ArtifactMissing ||
          error instanceof ArtifactReadError ||
          error instanceof ArtifactLimitExceeded
        ) {
          return Effect.fail(error);
        }
        let code: string | undefined;
        try {
          if (error !== null && typeof error === "object") {
            const descriptor = Reflect.getOwnPropertyDescriptor(error, "code");
            if (
              descriptor !== undefined &&
              Object.hasOwn(descriptor, "value") &&
              typeof descriptor.value === "string"
            ) {
              code = descriptor.value;
            }
          }
        } catch {
          code = undefined;
        }
        const category = classifyOsCode(code);
        if (category === "not_found") {
          return Effect.fail(
            new ArtifactMissing({
              stage: "artifact_read",
              reason: `artifact file missing for ${descriptor.artifactId}`,
              artifactId: descriptor.artifactId,
            }),
          );
        }
        return Effect.fail(
          new ArtifactReadError({
            stage: "artifact_read",
            reason: `artifact read failed for ${descriptor.artifactId}`,
            artifactId: descriptor.artifactId,
            category,
          }),
        );
      } finally {
        if (fd !== undefined) {
          try {
            ops.close(fd);
          } catch {
            // ignore close races
          }
        }
      }
    }),
});

export const filesystemArtifactReaderLayer = (
  pathsByArtifactId: ArtifactPathMap,
) =>
  Layer.succeed(
    ArtifactReader,
    createFilesystemArtifactReader(pathsByArtifactId),
  );
