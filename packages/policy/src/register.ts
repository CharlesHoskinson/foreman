import {
  decodeUtf8Fatal,
  isCanonicalJsonText,
  isCoreFailure,
  parseJsonRejectDuplicateKeys,
  sha256Hex,
  type CoreFailure,
} from "@foreman/core";
import {
  decodeRegister,
  mapCoreFailure,
  type DenialReason,
  type Register,
} from "./schema.js";

export const BEGIN_SENTINEL = "<!-- FOREMAN-DESTRUCTION-REGISTER-V1:BEGIN -->";
export const END_SENTINEL = "<!-- FOREMAN-DESTRUCTION-REGISTER-V1:END -->";

export type ExtractSuccess = {
  readonly register: Register;
  readonly registerSha256: string;
  readonly canonicalJson: string;
};

export type ExtractFailure = {
  readonly _tag: "Denied" | "Failed";
  readonly reason: DenialReason;
};

export type ExtractResult = ExtractSuccess | ExtractFailure;

function isExtractFailure(v: ExtractResult): v is ExtractFailure {
  return "_tag" in v && (v._tag === "Denied" || v._tag === "Failed");
}

function coreFail(f: CoreFailure): ExtractFailure {
  return { _tag: "Failed", reason: mapCoreFailure(f) };
}

/**
 * Detect structured projections outside the canonical sentinel block:
 * fenced code, Markdown tables, JSON line starts, YAML-like register keys.
 */
function hasParallelProjection(
  lines: string[],
  beginIdx: number,
  endIdx: number,
): boolean {
  const DST_ROW = /^\|\s*`?DST-\d{4}`?\s*\|/;
  const TABLE_HDR = /^\|.*\|.*\|/;
  const TABLE_SEP = /^\|[\s:|-]+\|$/;
  const JSON_START = /^\s*[\[{]/;
  const YAML_KEY =
    /^(schemaVersion|registerId|currentEntries|historicalIncidents)\s*:/;
  let inFence = false;
  for (let i = 0; i < lines.length; i += 1) {
    if (i > beginIdx && i < endIdx) continue;
    const line = lines[i]!.replace(/\r$/, "");
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      // Any Markdown fence outside the sentinel is a parallel projection.
      return true;
    }
    if (inFence) {
      return true;
    }
    if (DST_ROW.test(line)) return true;
    if (TABLE_HDR.test(trimmed) || TABLE_SEP.test(trimmed)) return true;
    if (JSON_START.test(line)) return true;
    if (YAML_KEY.test(trimmed)) return true;
    if (
      line.includes('"currentEntries"') ||
      line.includes('"schemaVersion"') ||
      line.includes('"registerId"') ||
      line.includes('"historicalIncidents"')
    ) {
      return true;
    }
  }
  return false;
}

export function extractRegister(markdownBytes: Uint8Array): ExtractResult {
  const textOrFail = decodeUtf8Fatal(markdownBytes);
  if (isCoreFailure(textOrFail)) {
    return coreFail(textOrFail);
  }
  const text = textOrFail;
  const lines = text.split("\n");

  let beginIdx = -1;
  let endIdx = -1;
  let beginCount = 0;
  let endCount = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const trimmed = line.endsWith("\r") ? line.slice(0, -1) : line;
    if (trimmed === BEGIN_SENTINEL) {
      beginCount += 1;
      if (beginIdx < 0) beginIdx = i;
    }
    if (trimmed === END_SENTINEL) {
      endCount += 1;
      if (endIdx < 0) endIdx = i;
    }
  }

  if (beginCount === 0) {
    return { _tag: "Failed", reason: "missing_begin_sentinel" };
  }
  if (beginCount > 1) {
    return { _tag: "Failed", reason: "duplicate_begin_sentinel" };
  }
  if (endCount === 0) {
    return { _tag: "Failed", reason: "missing_end_sentinel" };
  }
  if (endCount > 1) {
    return { _tag: "Failed", reason: "duplicate_end_sentinel" };
  }
  if (endIdx <= beginIdx) {
    return { _tag: "Failed", reason: "empty_register" };
  }

  if (hasParallelProjection(lines, beginIdx, endIdx)) {
    return { _tag: "Failed", reason: "duplicate_register_projection" };
  }

  const between = lines.slice(beginIdx + 1, endIdx).join("\n");
  const jsonText = between.replace(/^\n+/, "").replace(/\n+$/, "");
  if (jsonText.length === 0) {
    return { _tag: "Failed", reason: "empty_register" };
  }

  const parsed = parseJsonRejectDuplicateKeys(jsonText);
  if (isCoreFailure(parsed)) {
    return coreFail(parsed);
  }

  if (!isCanonicalJsonText(jsonText)) {
    return { _tag: "Failed", reason: "non_canonical_json" };
  }

  const register = decodeRegister(parsed);
  if (isCoreFailure(register)) {
    if (register._tag === "SchemaMismatch" && register.reason === "duplicate_id") {
      return { _tag: "Failed", reason: "duplicate_id" };
    }
    if (register._tag === "SchemaMismatch" && register.reason === "register_id") {
      return { _tag: "Failed", reason: "register_id_mismatch" };
    }
    return coreFail(register);
  }

  if (!isCanonicalJsonText(jsonText)) {
    return { _tag: "Failed", reason: "non_canonical_json" };
  }
  const registerSha256 = sha256Hex(jsonText);

  return {
    register,
    registerSha256,
    canonicalJson: jsonText,
  };
}

export { isExtractFailure };
