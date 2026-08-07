/**
 * Bounded NUL-delimited Git name-status delta parser.
 * Supports added, modified, deleted, and renamed records without argv or
 * newline ambiguity. Rejects malformed or oversized deltas.
 */

import { MAX_INPUT_BYTES } from "@foreman/core";
import type { DeltaKind, PolicyReason } from "./architecture-schema.js";

export type DeltaRecord =
  | { readonly kind: "added"; readonly path: string; readonly status: string }
  | {
      readonly kind: "modified";
      readonly path: string;
      readonly status: string;
    }
  | {
      readonly kind: "deleted";
      readonly path: string;
      readonly status: string;
    }
  | {
      readonly kind: "renamed";
      readonly path: string;
      readonly oldPath: string;
      readonly status: string;
    };

export type ParseDeltaOk = {
  readonly ok: true;
  readonly records: readonly DeltaRecord[];
};

export type ParseDeltaFail = {
  readonly ok: false;
  readonly reason: PolicyReason;
};

export type ParseDeltaResult = ParseDeltaOk | ParseDeltaFail;

const STATUS_ADD = /^A\d*$/;
const STATUS_MOD = /^M\d*$/;
const STATUS_DEL = /^D\d*$/;
const STATUS_REN = /^R\d*$/;
const STATUS_COPY = /^C\d*$/;
const STATUS_TYPE = /^T\d*$/;

/**
 * Parse `git diff --name-status -z A B` output.
 * Records are status\0path\0 or for renames/copies status\0old\0new\0.
 */
export function parseNameStatusDelta(bytes: Uint8Array): ParseDeltaResult {
  if (bytes.byteLength > MAX_INPUT_BYTES) {
    return { ok: false, reason: "oversize_output" };
  }
  if (bytes.byteLength === 0) {
    return { ok: true, records: [] };
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, reason: "invalid_git_output" };
  }
  // Trailing NUL is normal; split and drop empty segments.
  const parts = text.split("\0");
  // Drop final empty after trailing NUL
  while (parts.length > 0 && parts[parts.length - 1] === "") {
    parts.pop();
  }
  const records: DeltaRecord[] = [];
  let i = 0;
  while (i < parts.length) {
    const status = parts[i];
    if (status === undefined || status.length === 0) {
      return { ok: false, reason: "malformed_delta" };
    }
    if (STATUS_REN.test(status) || STATUS_COPY.test(status)) {
      const oldPath = parts[i + 1];
      const newPath = parts[i + 2];
      if (
        oldPath === undefined ||
        newPath === undefined ||
        oldPath.length === 0 ||
        newPath.length === 0
      ) {
        return { ok: false, reason: "malformed_delta" };
      }
      // Treat copy as added at new path for policy; rename as renamed.
      if (STATUS_COPY.test(status)) {
        records.push({ kind: "added", path: newPath, status });
      } else {
        records.push({
          kind: "renamed",
          path: newPath,
          oldPath,
          status,
        });
      }
      i += 3;
      continue;
    }
    const path = parts[i + 1];
    if (path === undefined || path.length === 0) {
      return { ok: false, reason: "malformed_delta" };
    }
    let kind: DeltaKind;
    if (STATUS_ADD.test(status)) {
      kind = "added";
    } else if (STATUS_MOD.test(status) || STATUS_TYPE.test(status)) {
      kind = "modified";
    } else if (STATUS_DEL.test(status)) {
      kind = "deleted";
    } else {
      return { ok: false, reason: "malformed_delta" };
    }
    if (kind === "added") {
      records.push({ kind: "added", path, status });
    } else if (kind === "modified") {
      records.push({ kind: "modified", path, status });
    } else {
      records.push({ kind: "deleted", path, status });
    }
    i += 2;
  }
  return { ok: true, records };
}

/** Parse `git ls-tree -r -z --name-only <tree>` path list. */
export function parseNulPathList(bytes: Uint8Array): ParseDeltaResult | {
  ok: true;
  paths: readonly string[];
} {
  if (bytes.byteLength > MAX_INPUT_BYTES) {
    return { ok: false, reason: "oversize_output" };
  }
  if (bytes.byteLength === 0) {
    return { ok: true, paths: [] };
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, reason: "invalid_git_output" };
  }
  const parts = text.split("\0").filter((p) => p.length > 0);
  return { ok: true, paths: parts };
}
