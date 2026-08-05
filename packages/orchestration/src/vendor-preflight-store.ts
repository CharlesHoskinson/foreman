/**
 * Persisted vendor-preflight record store (Sprint 3 R4C).
 *
 * Bounded reads and atomic owner-only writes. Decode every record through
 * `decodeVendorPreflightRecordV1`. No process or PATH I/O.
 */

import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { randomBytes } from "node:crypto";
import { Context, Effect, Layer } from "effect";
import { canonicalize } from "@foreman/core";
import { readFileBoundedSync } from "./queue-services.js";
import {
  decodeVendorPreflightRecordV1,
  isVendorPreflightContractFailure,
  type VendorPreflightRecordV1,
} from "./vendor-preflight-contract.js";

/** UTF-8 byte bound applied before JSON parsing of a stored record. */
export const MAX_PREFLIGHT_RECORD_BYTES = 1_048_576;

export type PreflightStoreFailureReason =
  | "path_invalid"
  | "absent"
  | "oversized"
  | "unreadable"
  | "malformed_json"
  | "decode_failed"
  | "write_failed";

export class PreflightStoreFailure {
  readonly _tag = "PreflightStoreFailure" as const;
  constructor(
    readonly reason: PreflightStoreFailureReason,
    readonly detail?: string,
  ) {}
}

export class PreflightRecordStore extends Context.Tag("PreflightRecordStore")<
  PreflightRecordStore,
  {
    readonly read: (
      absolutePath: string,
    ) => Effect.Effect<VendorPreflightRecordV1, PreflightStoreFailure>;
    readonly write: (
      absolutePath: string,
      record: VendorPreflightRecordV1,
    ) => Effect.Effect<void, PreflightStoreFailure>;
  }
>() {}

function pathInvalid(
  detail: string,
): PreflightStoreFailure {
  return new PreflightStoreFailure("path_invalid", detail);
}

function validateAbsolutePath(
  absolutePath: string,
): PreflightStoreFailure | null {
  if (typeof absolutePath !== "string" || absolutePath.length === 0) {
    return pathInvalid("path is empty");
  }
  if (absolutePath.includes("\0")) {
    return pathInvalid("path contains NUL");
  }
  if (!isAbsolute(absolutePath)) {
    return pathInvalid("path is not absolute");
  }
  return null;
}

/**
 * Read one persisted record. Bounds input before JSON parse. Decodes through
 * the public contract decoder.
 */
export function readPreflightRecord(
  absolutePath: string,
): Effect.Effect<VendorPreflightRecordV1, PreflightStoreFailure> {
  return Effect.try({
    try: () => {
      const pathErr = validateAbsolutePath(absolutePath);
      if (pathErr !== null) {
        throw pathErr;
      }

      const bounded = readFileBoundedSync(
        absolutePath,
        MAX_PREFLIGHT_RECORD_BYTES,
      );
      switch (bounded._tag) {
        case "Absent":
          throw new PreflightStoreFailure("absent");
        case "Oversized":
          throw new PreflightStoreFailure("oversized");
        case "Unreadable":
        case "IdentityChanged":
        case "MalformedUtf8":
          throw new PreflightStoreFailure(
            "unreadable",
            bounded._tag.toLowerCase(),
          );
        case "Ok":
          break;
        default: {
          const _exhaustive: never = bounded;
          throw new PreflightStoreFailure(
            "unreadable",
            `unexpected bound result: ${JSON.stringify(_exhaustive)}`,
          );
        }
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(bounded.text);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new PreflightStoreFailure("malformed_json", msg);
      }

      const decoded = decodeVendorPreflightRecordV1(parsed);
      if (isVendorPreflightContractFailure(decoded)) {
        throw new PreflightStoreFailure("decode_failed", decoded.reason);
      }
      return decoded;
    },
    catch: (e) =>
      e instanceof PreflightStoreFailure
        ? e
        : new PreflightStoreFailure(
            "unreadable",
            e instanceof Error ? e.message : String(e),
          ),
  });
}

/**
 * Write one validated record as canonical JSON + LF via same-directory temp,
 * fsync, rename. Parent directory mode 0700; record mode 0600. Remove the
 * temporary file after any failed write.
 */
export function writePreflightRecord(
  absolutePath: string,
  record: VendorPreflightRecordV1,
): Effect.Effect<void, PreflightStoreFailure> {
  return Effect.try({
    try: () => {
      const pathErr = validateAbsolutePath(absolutePath);
      if (pathErr !== null) {
        throw pathErr;
      }

      // Re-validate before persist so a corrupted in-memory record never lands.
      const rechecked = decodeVendorPreflightRecordV1(record);
      if (isVendorPreflightContractFailure(rechecked)) {
        throw new PreflightStoreFailure("decode_failed", rechecked.reason);
      }

      let body: string;
      try {
        body = canonicalize(rechecked as unknown) + "\n";
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new PreflightStoreFailure("write_failed", msg);
      }
      if (Buffer.byteLength(body, "utf8") > MAX_PREFLIGHT_RECORD_BYTES) {
        throw new PreflightStoreFailure(
          "oversized",
          `canonical record exceeds ${MAX_PREFLIGHT_RECORD_BYTES} bytes`,
        );
      }

      const dir = dirname(absolutePath);
      try {
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        chmodSync(dir, 0o700);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new PreflightStoreFailure(
          "write_failed",
          `cannot create parent directory: ${msg}`,
        );
      }

      const tmpName = `.preflight.${randomBytes(16).toString("hex")}.tmp`;
      const tmpPath = join(dir, tmpName);
      let fd: number | undefined;
      try {
        fd = openSync(
          tmpPath,
          fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
          0o600,
        );
        const buf = Buffer.from(body, "utf8");
        let offset = 0;
        while (offset < buf.byteLength) {
          const n = writeSync(fd, buf, offset, buf.byteLength - offset);
          offset += n;
        }
        fsyncSync(fd);
        closeSync(fd);
        fd = undefined;
        // Ensure owner-only mode survives umask quirks.
        chmodSync(tmpPath, 0o600);
        renameSync(tmpPath, absolutePath);
        try {
          chmodSync(absolutePath, 0o600);
        } catch {
          /* best-effort on platforms that ignore mode */
        }
        try {
          const dirFd = openSync(dir, fsConstants.O_RDONLY);
          try {
            fsyncSync(dirFd);
          } finally {
            closeSync(dirFd);
          }
        } catch {
          // Parent fsync is best-effort (not supported on all platforms).
        }
      } catch (e) {
        if (fd !== undefined) {
          try {
            closeSync(fd);
          } catch {
            /* ignore */
          }
        }
        try {
          unlinkSync(tmpPath);
        } catch {
          /* ignore */
        }
        if (e instanceof PreflightStoreFailure) {
          throw e;
        }
        const msg = e instanceof Error ? e.message : String(e);
        throw new PreflightStoreFailure("write_failed", msg);
      }
    },
    catch: (e) =>
      e instanceof PreflightStoreFailure
        ? e
        : new PreflightStoreFailure(
            "write_failed",
            e instanceof Error ? e.message : String(e),
          ),
  });
}

export const livePreflightRecordStore = Layer.succeed(PreflightRecordStore, {
  read: (absolutePath) => readPreflightRecord(absolutePath),
  write: (absolutePath, record) => writePreflightRecord(absolutePath, record),
});
