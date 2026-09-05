import {
  canonicalize,
  isCommitSha40,
  isSha256Hex,
  sha256Hex,
} from "@foreman/core";

import {
  isReleaseProgram,
  releaseProgramTable,
  RELEASE_PROGRAMS,
  type ReleaseProgram,
} from "./release-program.js";

export type ReleaseCoverageFailureReason =
  | "invalid_register"
  | "invalid_roadmap"
  | "duplicate_identity"
  | "unknown_owner"
  | "inventory_mismatch"
  | "roadmap_mismatch"
  | "workflow_mismatch"
  | "brief_mismatch"
  | "unreconciled"
  | "competing_plan"
  | "dependency_failure"
  | "wrong_program";

export type RoadmapAssignmentV1 = {
  readonly key: string;
  readonly scope: string;
  readonly release: "v0.4" | "v0.5" | "v0.6";
  readonly owner: string;
};

export type ReleaseCoverageResultV1 =
  | {
      readonly schemaVersion: 1;
      readonly _tag: "Valid";
      readonly activeInventorySha256: string;
      readonly roadmapSha256: string;
      readonly entryCount: number;
    }
  | {
      readonly schemaVersion: 1;
      readonly _tag: "Invalid";
      readonly reason: ReleaseCoverageFailureReason;
    };

export type ReleaseCoveragePhaseV1 =
  | {
      readonly _tag: "Bootstrap";
      readonly owner: string;
    }
  | { readonly _tag: "Lane"; readonly owner: string }
  | { readonly _tag: "Release" };

export type ReleasePackageBriefV1 = {
  readonly schema: "foreman.release-package-brief.v1";
  readonly familySha256: string;
  readonly childId: string;
  readonly packageId: string;
  readonly objective: string;
  readonly acceptance: readonly string[];
  readonly allowedPaths: readonly string[];
};

const SCHEMA_VERSION = 1 as const;
const ONE_MIB = 1024 * 1024;
const IMMUTABLE_BASELINE_COMMIT =
  "bb5c8c2345ac5524ebb9c6a7de0fe16b17242195" as const;
const ROADMAP_PATH = "ROADMAP.md";
const OPENSPEC_PREFIX = "openspec/changes/";
const CHANGE_PREFIX = "change:";
const ROADMAP_PREFIX = "roadmap:";
const ALLOWED_WORKFLOWS = new Set([
  "foreman-bounded",
  "foreman-architectural",
]);
const SOURCE_KINDS = new Set(["openspec_change", "roadmap"]);
const RECONCILES = new Set(["complete", "required", "not_required"]);
const SHARED_TARGET_RELEASES = ["v0.4", "v0.5", "released"] as const;
const BRIEF_SCHEMA = "foreman.release-package-brief.v1" as const;
const BRIEF_KEYS = [
  "acceptance",
  "allowedPaths",
  "childId",
  "familySha256",
  "objective",
  "packageId",
  "schema",
] as const;

const TOP_LEVEL_FIELDS = new Set([
  "schema_version",
  "baseline_commit",
  "active_inventory_sha256",
  "roadmap_sha256",
]);
const FUTURE_OWNER_FIELDS = new Set(["name", "target_release", "reason"]);
const ENTRY_FIELDS = new Set([
  "key",
  "source_kind",
  "source_path",
  "disposition",
  "owner",
  "target_release",
  "reconcile",
  "reason",
]);

const encoder = new TextEncoder();

function defaultReleaseProgram(): ReleaseProgram {
  return RELEASE_PROGRAMS[0]!;
}

function resolveCoverageProgram(value: unknown): ReleaseProgram | null {
  if (value === undefined) return defaultReleaseProgram();
  return isReleaseProgram(value) ? value : null;
}

function programCurrentRelease(program: ReleaseProgram): "v0.4" | "v0.5" {
  return program === RELEASE_PROGRAMS[0] ? "v0.4" : "v0.5";
}

function programFutureRelease(program: ReleaseProgram): "v0.5" | "v0.6" {
  return program === RELEASE_PROGRAMS[0] ? "v0.5" : "v0.6";
}

function dispositionsFor(program: ReleaseProgram): Set<string> {
  return new Set(releaseProgramTable(program).dispositions);
}

function targetReleasesFor(program: ReleaseProgram): Set<string> {
  const releases = new Set<string>(SHARED_TARGET_RELEASES);
  if (program !== RELEASE_PROGRAMS[0]) releases.add("v0.6");
  return releases;
}

function roadmapReleasesFor(program: ReleaseProgram): Set<string> {
  const releases = new Set<string>(["v0.4", "v0.5"]);
  if (program !== RELEASE_PROGRAMS[0]) releases.add("v0.6");
  return releases;
}

function futureReleasesFor(program: ReleaseProgram): Set<string> {
  return roadmapReleasesFor(program);
}

function ownerDisposition(program: ReleaseProgram): string {
  return releaseProgramTable(program).dispositions[0]!;
}

function dependencyDisposition(program: ReleaseProgram): string {
  return releaseProgramTable(program).dispositions[1]!;
}

function futureDisposition(program: ReleaseProgram): string {
  return releaseProgramTable(program).dispositions[4]!;
}

function bootstrapOwner(program: ReleaseProgram): string {
  return releaseProgramTable(program).bootstrapOwner;
}

function bootstrapKey(program: ReleaseProgram): string {
  return `${CHANGE_PREFIX}${bootstrapOwner(program)}`;
}

type FutureOwner = {
  readonly name: string;
  readonly targetRelease: string;
  readonly reason: string;
};

type RegisterEntry = {
  readonly key: string;
  readonly sourceKind: "openspec_change" | "roadmap";
  readonly sourcePath: string;
  readonly disposition: string;
  readonly owner: string;
  readonly targetRelease: "v0.4" | "v0.5" | "v0.6" | "released";
  readonly reconcile: "complete" | "required" | "not_required";
  readonly reason: string;
};

type ParsedRegister = {
  readonly baselineCommit: string;
  readonly activeInventorySha256: string;
  readonly roadmapSha256: string;
  readonly futureOwners: readonly FutureOwner[];
  readonly entries: readonly RegisterEntry[];
};

function invalid(reason: ReleaseCoverageFailureReason): ReleaseCoverageResultV1 {
  return { schemaVersion: SCHEMA_VERSION, _tag: "Invalid", reason };
}

function valid(
  activeInventorySha256: string,
  roadmapSha256: string,
  entryCount: number,
): ReleaseCoverageResultV1 {
  return {
    schemaVersion: SCHEMA_VERSION,
    _tag: "Valid",
    activeInventorySha256,
    roadmapSha256,
    entryCount,
  };
}

function utf8Bytes(text: string): Uint8Array {
  return encoder.encode(text);
}

function utf8ByteLength(text: string): number {
  return utf8Bytes(text).byteLength;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactOwnKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const own = Object.keys(value);
  if (own.length !== keys.length) return false;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) return false;
  }
  return true;
}

function stripAsciiSpaces(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && text.charCodeAt(start) === 0x20) start += 1;
  while (end > start && text.charCodeAt(end - 1) === 0x20) end -= 1;
  return text.slice(start, end);
}

function isReadonlyStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function hasControlExcludingLf(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 0x0a) continue;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function hasAnyControl(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function hasUnpairedSurrogate(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      i += 1;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}

function isPrintableAscii(text: string): boolean {
  if (text.length === 0) return false;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x20 || code > 0x7e) return false;
  }
  return true;
}

function isRunId(value: string): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  if (utf8ByteLength(value) > 128) return false;
  if (value.includes("/") || value.includes("\\") || value.includes("\0")) {
    return false;
  }
  return true;
}

function decodeUtf8Unbounded(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch {
    return null;
  }
}

function compareUtf8Bytes(a: string, b: string): number {
  const ab = utf8Bytes(a);
  const bb = utf8Bytes(b);
  const n = Math.min(ab.length, bb.length);
  for (let i = 0; i < n; i++) {
    if (ab[i] !== bb[i]) return ab[i]! - bb[i]!;
  }
  return ab.length - bb.length;
}

function computeActiveInventorySha256(names: readonly string[]): string {
  const sorted = [...names].sort(compareUtf8Bytes);
  return sha256Hex(sorted.map((name) => `${name}\n`).join(""));
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function parseBasicString(raw: string, start: number): { value: string; end: number } | null {
  if (raw[start] !== '"') return null;
  let i = start + 1;
  let out = "";
  while (i < raw.length) {
    const ch = raw[i]!;
    if (ch === '"') {
      if (hasAnyControl(out) || hasUnpairedSurrogate(out)) return null;
      return { value: out, end: i + 1 };
    }
    if (ch === "\\") {
      i += 1;
      if (i >= raw.length) return null;
      const esc = raw[i]!;
      switch (esc) {
        case "\\":
          out += "\\";
          break;
        case '"':
          out += '"';
          break;
        case "b":
          out += "\b";
          break;
        case "f":
          out += "\f";
          break;
        case "n":
          out += "\n";
          break;
        case "r":
          out += "\r";
          break;
        case "t":
          out += "\t";
          break;
        case "u": {
          const hex = raw.slice(i + 1, i + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) return null;
          const code = Number.parseInt(hex, 16);
          if (code >= 0xd800 && code <= 0xdfff) return null;
          out += String.fromCharCode(code);
          i += 4;
          break;
        }
        default:
          return null;
      }
      i += 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return null;
}

function parseInteger(raw: string, start: number): { value: number; end: number } | null {
  let i = start;
  if (i >= raw.length || raw[i]! < "0" || raw[i]! > "9") return null;
  if (raw[i] === "0" && i + 1 < raw.length && raw[i + 1]! >= "0" && raw[i + 1]! <= "9") {
    return null;
  }
  while (i < raw.length && raw[i]! >= "0" && raw[i]! <= "9") i += 1;
  const text = raw.slice(start, i);
  if (text.length > 10) return null;
  const value = Number.parseInt(text, 10);
  if (!Number.isSafeInteger(value)) return null;
  return { value, end: i };
}

function parseAssignmentLine(
  line: string,
): { key: string; kind: "string" | "integer"; value: string | number } | null {
  const eq = line.indexOf("=");
  if (eq <= 0) return null;
  const key = stripAsciiSpaces(line.slice(0, eq));
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null;
  const rest = stripAsciiSpaces(line.slice(eq + 1));
  if (rest.length === 0) return null;
  if (rest[0] === '"') {
    const parsed = parseBasicString(rest, 0);
    if (parsed === null) return null;
    if (stripAsciiSpaces(rest.slice(parsed.end)) !== "") return null;
    return { key, kind: "string", value: parsed.value };
  }
  const parsedInt = parseInteger(rest, 0);
  if (parsedInt === null) return null;
  if (stripAsciiSpaces(rest.slice(parsedInt.end)) !== "") return null;
  return { key, kind: "integer", value: parsedInt.value };
}

function isNonemptyReason(value: string): boolean {
  return value.length > 0 && !hasAnyControl(value) && utf8ByteLength(value) <= 16384;
}

function validateDispositionCrossField(
  entry: {
    sourceKind: string;
    disposition: string;
    owner: string;
    targetRelease: string;
    reconcile: string;
    key: string;
  },
  program: ReleaseProgram,
): boolean {
  const { disposition, targetRelease, reconcile, sourceKind, key, owner } = entry;
  if (
    disposition === ownerDisposition(program) ||
    disposition === dependencyDisposition(program)
  ) {
    if (targetRelease !== programCurrentRelease(program)) return false;
    if (reconcile !== "required" && reconcile !== "complete") return false;
    return true;
  }
  if (disposition === futureDisposition(program)) {
    return targetRelease === programFutureRelease(program) && reconcile === "not_required";
  }
  if (disposition === "released_reference") {
    return targetRelease === "released" && reconcile === "complete";
  }
  if (disposition === "superseded") {
    if (reconcile !== "complete") return false;
    if (sourceKind === "openspec_change") {
      if (!key.startsWith(CHANGE_PREFIX)) return false;
      const sourcePackage = key.slice(CHANGE_PREFIX.length);
      if (owner === sourcePackage) return false;
    }
    return true;
  }
  return false;
}

function parseRegister(
  text: string,
  program: ReleaseProgram = defaultReleaseProgram(),
): ParsedRegister | "invalid_register" {
  if (typeof text !== "string") return "invalid_register";
  if (utf8ByteLength(text) > ONE_MIB) return "invalid_register";
  if (hasControlExcludingLf(text)) return "invalid_register";

  const lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  const top: Record<string, string | number> = {};
  const futureOwners: FutureOwner[] = [];
  const entries: RegisterEntry[] = [];
  let mode: "top" | "future_owner" | "entry" = "top";
  let current: Record<string, string | number> | null = null;
  let sawTable = false;

  const flushCurrent = (): boolean => {
    if (mode === "top" || current === null) return true;
    if (mode === "future_owner") {
      for (const field of FUTURE_OWNER_FIELDS) {
        if (!(field in current)) return false;
      }
      for (const key of Object.keys(current)) {
        if (!FUTURE_OWNER_FIELDS.has(key)) return false;
      }
      const name = current["name"];
      const targetRelease = current["target_release"];
      const reason = current["reason"];
      if (typeof name !== "string" || typeof targetRelease !== "string" || typeof reason !== "string") {
        return false;
      }
      if (!isRunId(name) || !futureReleasesFor(program).has(targetRelease) || !isNonemptyReason(reason)) {
        return false;
      }
      futureOwners.push({ name, targetRelease, reason });
      current = null;
      return true;
    }
    for (const field of ENTRY_FIELDS) {
      if (!(field in current)) return false;
    }
    for (const key of Object.keys(current)) {
      if (!ENTRY_FIELDS.has(key)) return false;
    }
    const key = current["key"];
    const sourceKind = current["source_kind"];
    const sourcePath = current["source_path"];
    const disposition = current["disposition"];
    const owner = current["owner"];
    const targetRelease = current["target_release"];
    const reconcile = current["reconcile"];
    const reason = current["reason"];
    if (
      typeof key !== "string" ||
      typeof sourceKind !== "string" ||
      typeof sourcePath !== "string" ||
      typeof disposition !== "string" ||
      typeof owner !== "string" ||
      typeof targetRelease !== "string" ||
      typeof reconcile !== "string" ||
      typeof reason !== "string"
    ) {
      return false;
    }
    if (key.length === 0 || hasAnyControl(key) || utf8ByteLength(key) > 512) {
      return false;
    }
    if (!SOURCE_KINDS.has(sourceKind)) return false;
    if (sourcePath.length === 0 || hasAnyControl(sourcePath) || utf8ByteLength(sourcePath) > 4096) {
      return false;
    }
    if (!dispositionsFor(program).has(disposition)) return false;
    if (!isRunId(owner)) return false;
    if (!targetReleasesFor(program).has(targetRelease)) return false;
    if (!RECONCILES.has(reconcile)) return false;
    if (!isNonemptyReason(reason)) return false;
    if (
      !validateDispositionCrossField(
        {
          sourceKind,
          disposition,
          owner,
          targetRelease,
          reconcile,
          key,
        },
        program,
      )
    ) {
      return false;
    }
    entries.push({
      key,
      sourceKind: sourceKind as RegisterEntry["sourceKind"],
      sourcePath,
      disposition: disposition as RegisterEntry["disposition"],
      owner,
      targetRelease: targetRelease as RegisterEntry["targetRelease"],
      reconcile: reconcile as RegisterEntry["reconcile"],
      reason,
    });
    current = null;
    return true;
  };

  for (const line of lines) {
    if (line.length === 0) continue;
    if (line.startsWith("[[") && line.endsWith("]]")) {
      if (!flushCurrent()) return "invalid_register";
      const name = line.slice(2, -2);
      if (name === "future_owner") {
        mode = "future_owner";
        current = {};
        sawTable = true;
        continue;
      }
      if (name === "entry") {
        mode = "entry";
        current = {};
        sawTable = true;
        continue;
      }
      return "invalid_register";
    }
    if (line.startsWith("[") && line.endsWith("]")) {
      return "invalid_register";
    }
    const assignment = parseAssignmentLine(line);
    if (assignment === null) return "invalid_register";
    if (!sawTable && mode === "top") {
      if (!TOP_LEVEL_FIELDS.has(assignment.key)) return "invalid_register";
      if (assignment.key in top) return "invalid_register";
      if (assignment.key === "schema_version") {
        if (assignment.kind !== "integer" || assignment.value !== 1) {
          return "invalid_register";
        }
        top[assignment.key] = assignment.value;
        continue;
      }
      if (assignment.kind !== "string") return "invalid_register";
      const value = assignment.value as string;
      if (assignment.key === "baseline_commit") {
        if (!isCommitSha40(value) || value !== IMMUTABLE_BASELINE_COMMIT) {
          return "invalid_register";
        }
      } else if (
        assignment.key === "active_inventory_sha256" ||
        assignment.key === "roadmap_sha256"
      ) {
        if (!isSha256Hex(value)) return "invalid_register";
      }
      top[assignment.key] = value;
      continue;
    }
    if (mode === "top") return "invalid_register";
    if (current === null) return "invalid_register";
    if (assignment.key in current) return "invalid_register";
    if (assignment.kind !== "string") return "invalid_register";
    current[assignment.key] = assignment.value as string;
  }

  if (!flushCurrent()) return "invalid_register";
  for (const field of TOP_LEVEL_FIELDS) {
    if (!(field in top)) return "invalid_register";
  }
  if (entries.length < 1) return "invalid_register";

  return {
    baselineCommit: top["baseline_commit"] as string,
    activeInventorySha256: top["active_inventory_sha256"] as string,
    roadmapSha256: top["roadmap_sha256"] as string,
    futureOwners,
    entries,
  };
}

function validateKeyPathCoherence(entry: RegisterEntry): boolean {
  if (entry.sourceKind === "openspec_change") {
    if (!entry.key.startsWith(CHANGE_PREFIX)) return false;
    const name = entry.key.slice(CHANGE_PREFIX.length);
    if (name.length === 0) return false;
    if (entry.sourcePath !== `${OPENSPEC_PREFIX}${name}`) return false;
    return true;
  }
  if (entry.sourceKind === "roadmap") {
    if (!entry.key.startsWith(ROADMAP_PREFIX)) return false;
    if (entry.sourcePath !== ROADMAP_PATH) return false;
    return true;
  }
  return false;
}

function validateRoadmapRows(
  rows: readonly RoadmapAssignmentV1[],
  program: ReleaseProgram,
): boolean {
  const seen = new Set<string>();
  for (const row of rows) {
    if (!isPlainObject(row)) return false;
    if (!hasExactOwnKeys(row, ["key", "scope", "release", "owner"])) {
      return false;
    }
    const { key, scope, release, owner } = row;
    if (
      typeof key !== "string" ||
      typeof scope !== "string" ||
      typeof release !== "string" ||
      typeof owner !== "string"
    ) {
      return false;
    }
    const keyBytes = utf8ByteLength(key);
    if (keyBytes < 1 || keyBytes > 256) return false;
    if (!key.startsWith(ROADMAP_PREFIX)) return false;
    if (!isPrintableAscii(key)) return false;
    const scopeBytes = utf8ByteLength(scope);
    if (scopeBytes < 1 || scopeBytes > 4096) return false;
    if (hasAnyControl(scope)) return false;
    if (!roadmapReleasesFor(program).has(release)) return false;
    if (!isRunId(owner)) return false;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

function pathIsCompetingPlan(path: string): boolean {
  return (
    path === "docs/superpowers/specs" ||
    path === "docs/superpowers/plans" ||
    path.startsWith("docs/superpowers/specs/") ||
    path.startsWith("docs/superpowers/plans/")
  );
}

function isAllowedPathValue(path: string): boolean {
  if (!isPrintableAscii(path)) return false;
  if (path.includes("\\")) return false;
  if (path.startsWith("/")) return false;
  if (/^[A-Za-z]:\//.test(path)) return false;
  let body = path;
  let directoryPrefix = false;
  if (body.endsWith("/**")) {
    directoryPrefix = true;
    body = body.slice(0, -3);
    if (body.length === 0) return false;
  }
  if (body.includes("*") || body.includes("?") || body.includes("[")) {
    return false;
  }
  const segments = body.split("/");
  if (segments.length === 0) return false;
  for (const segment of segments) {
    if (segment.length === 0) return false;
    if (segment === "." || segment === "..") return false;
  }
  if (directoryPrefix && path !== `${body}/**`) return false;
  return true;
}

function isValidObjective(value: string): boolean {
  const bytes = utf8ByteLength(value);
  if (bytes < 1 || bytes > 16384) return false;
  return !hasControlExcludingLf(value);
}

function isValidAcceptanceItem(value: string): boolean {
  const bytes = utf8ByteLength(value);
  if (bytes < 1 || bytes > 4096) return false;
  return !hasAnyControl(value);
}

function validateBriefShape(brief: unknown): brief is ReleasePackageBriefV1 {
  if (!isPlainObject(brief)) return false;
  const keys = Object.keys(brief).sort();
  if (keys.length !== BRIEF_KEYS.length) return false;
  for (let i = 0; i < BRIEF_KEYS.length; i++) {
    if (keys[i] !== BRIEF_KEYS[i]) return false;
  }
  if (brief["schema"] !== BRIEF_SCHEMA) return false;
  const familySha256 = brief["familySha256"];
  const childId = brief["childId"];
  const packageId = brief["packageId"];
  const objective = brief["objective"];
  const acceptance = brief["acceptance"];
  const allowedPaths = brief["allowedPaths"];
  if (typeof familySha256 !== "string" || !isSha256Hex(familySha256)) return false;
  if (typeof childId !== "string" || !isRunId(childId)) return false;
  if (typeof packageId !== "string" || !isRunId(packageId)) return false;
  if (typeof objective !== "string" || !isValidObjective(objective)) return false;
  if (!Array.isArray(acceptance) || acceptance.length < 1 || acceptance.length > 256) {
    return false;
  }
  for (const item of acceptance) {
    if (typeof item !== "string" || !isValidAcceptanceItem(item)) return false;
  }
  if (
    !Array.isArray(allowedPaths) ||
    allowedPaths.length < 1 ||
    allowedPaths.length > 256
  ) {
    return false;
  }
  const seen = new Set<string>();
  let previous: string | null = null;
  for (const path of allowedPaths) {
    if (typeof path !== "string" || !isAllowedPathValue(path)) return false;
    if (seen.has(path)) return false;
    seen.add(path);
    if (previous !== null && compareUtf8Bytes(previous, path) > 0) return false;
    previous = path;
  }
  return true;
}

function canonicalBriefFileBytes(brief: ReleasePackageBriefV1): Uint8Array | null {
  try {
    const body = canonicalize({
      acceptance: brief.acceptance,
      allowedPaths: brief.allowedPaths,
      childId: brief.childId,
      familySha256: brief.familySha256,
      objective: brief.objective,
      packageId: brief.packageId,
      schema: brief.schema,
    });
    return utf8Bytes(`${body}\n`);
  } catch {
    return null;
  }
}

function validateCollectionShapes(
  input: {
    readonly phase: ReleaseCoveragePhaseV1;
    readonly registerText: string;
    readonly roadmapBytes: Uint8Array;
    readonly activeChangeNames: readonly string[];
    readonly roadmapRows: readonly RoadmapAssignmentV1[];
    readonly workflowByChange: Readonly<Record<string, string | null>>;
    readonly changedSuperpowersPaths: readonly string[];
    readonly expectedBriefByOwner: Readonly<Record<string, ReleasePackageBriefV1>>;
    readonly packageBriefBytesByOwner: Readonly<Record<string, Uint8Array>>;
  },
  program: ReleaseProgram,
): boolean {
  if (typeof input.registerText !== "string") return false;
  if (!(input.roadmapBytes instanceof Uint8Array)) return false;
  if (!isReadonlyStringArray(input.activeChangeNames)) return false;
  if (!Array.isArray(input.roadmapRows)) return false;
  if (!isPlainObject(input.workflowByChange)) return false;
  for (const value of Object.values(input.workflowByChange)) {
    if (value !== null && typeof value !== "string") return false;
  }
  if (!isReadonlyStringArray(input.changedSuperpowersPaths)) return false;
  if (!isPlainObject(input.expectedBriefByOwner)) return false;
  if (!isPlainObject(input.packageBriefBytesByOwner)) return false;
  for (const value of Object.values(input.packageBriefBytesByOwner)) {
    if (!(value instanceof Uint8Array)) return false;
  }
  if (!isPlainObject(input.phase as unknown as Record<string, unknown>)) return false;
  const phase = input.phase as unknown as Record<string, unknown>;
  const tag = phase["_tag"];
  if (tag === "Bootstrap") {
    if (!hasExactOwnKeys(phase, ["_tag", "owner"])) return false;
    if (phase["owner"] !== bootstrapOwner(program)) return false;
  } else if (tag === "Lane") {
    if (!hasExactOwnKeys(phase, ["_tag", "owner"])) return false;
    if (typeof phase["owner"] !== "string") return false;
  } else if (tag === "Release") {
    if (!hasExactOwnKeys(phase, ["_tag"])) return false;
  } else {
    return false;
  }
  return true;
}

function uniqueOwnersFromEntries(entries: readonly RegisterEntry[]): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.owner)) continue;
    seen.add(entry.owner);
    names.push(entry.owner);
  }
  return names;
}

/**
 * Shared phase selection for register inspection and validation.
 * Owners are every owner whose workflow or brief the validator will require.
 */
function selectPhaseCoverage(
  phase: ReleaseCoveragePhaseV1,
  entries: readonly RegisterEntry[],
  futureOwners: readonly FutureOwner[],
  program: ReleaseProgram,
): {
  readonly entries: readonly RegisterEntry[];
  readonly owners: readonly string[];
} {
  const currentRelease = programCurrentRelease(program);
  if (phase._tag === "Bootstrap") {
    const key = bootstrapKey(program);
    for (const entry of entries) {
      if (entry.key === key) {
        return { entries: [entry], owners: uniqueOwnersFromEntries([entry]) };
      }
    }
    return { entries: [], owners: [] };
  }
  if (phase._tag === "Lane") {
    const selected = entries.filter(
      (entry) =>
        entry.targetRelease === currentRelease && entry.owner === phase.owner,
    );
    return { entries: selected, owners: uniqueOwnersFromEntries(selected) };
  }
  const selected = entries.filter((entry) => entry.targetRelease === currentRelease);
  const owners: string[] = [];
  const seen = new Set<string>();
  for (const entry of selected) {
    if (seen.has(entry.owner)) continue;
    seen.add(entry.owner);
    owners.push(entry.owner);
  }
  for (const future of futureOwners) {
    if (future.targetRelease !== currentRelease) continue;
    if (seen.has(future.name)) continue;
    seen.add(future.name);
    owners.push(future.name);
  }
  return { entries: selected, owners };
}

export type ReleaseCoverageRegisterInspectionV1 =
  | {
      readonly _tag: "Valid";
      readonly baselineCommit: string;
      readonly selectedOwners: readonly string[];
    }
  | {
      readonly _tag: "Invalid";
      readonly reason: "invalid_register";
    };

export function inspectReleaseCoverageRegisterV1(input: {
  readonly registerText: string;
  readonly phase: ReleaseCoveragePhaseV1;
  readonly program?: ReleaseProgram;
}): ReleaseCoverageRegisterInspectionV1 {
  const program = resolveCoverageProgram(input.program);
  if (program === null) {
    return { _tag: "Invalid", reason: "invalid_register" };
  }
  const parsed = parseRegister(input.registerText, program);
  if (parsed === "invalid_register") {
    return { _tag: "Invalid", reason: "invalid_register" };
  }
  const selection = selectPhaseCoverage(
    input.phase,
    parsed.entries,
    parsed.futureOwners,
    program,
  );
  return {
    _tag: "Valid",
    baselineCommit: parsed.baselineCommit,
    selectedOwners: [...selection.owners].sort(compareUtf8Bytes),
  };
}

export function validateReleaseCoverageV1(input: {
  readonly phase: ReleaseCoveragePhaseV1;
  readonly registerText: string;
  readonly roadmapBytes: Uint8Array;
  readonly activeChangeNames: readonly string[];
  readonly roadmapRows: readonly RoadmapAssignmentV1[];
  readonly workflowByChange: Readonly<Record<string, string | null>>;
  readonly changedSuperpowersPaths: readonly string[];
  readonly expectedBriefByOwner: Readonly<Record<string, ReleasePackageBriefV1>>;
  readonly packageBriefBytesByOwner: Readonly<Record<string, Uint8Array>>;
  readonly program?: ReleaseProgram;
}): ReleaseCoverageResultV1 {
  try {
    const program = resolveCoverageProgram(input.program);
    if (program === null) {
      return invalid("wrong_program");
    }
    if (!validateCollectionShapes(input, program)) {
      return invalid("dependency_failure");
    }

    if (input.roadmapBytes.byteLength > ONE_MIB) {
      return invalid("invalid_roadmap");
    }

    if (decodeUtf8Unbounded(input.roadmapBytes) === null) {
      return invalid("invalid_roadmap");
    }

    const parsed = parseRegister(input.registerText, program);
    if (parsed === "invalid_register") {
      return invalid("invalid_register");
    }

    const keySet = new Set<string>();
    for (const entry of parsed.entries) {
      if (keySet.has(entry.key)) return invalid("duplicate_identity");
      keySet.add(entry.key);
    }

    const futureNames = new Set<string>();
    for (const owner of parsed.futureOwners) {
      if (futureNames.has(owner.name)) return invalid("duplicate_identity");
      futureNames.add(owner.name);
    }

    const openspecPaths = new Set<string>();
    for (const entry of parsed.entries) {
      if (entry.sourceKind !== "openspec_change") continue;
      if (openspecPaths.has(entry.sourcePath)) {
        return invalid("duplicate_identity");
      }
      openspecPaths.add(entry.sourcePath);
    }

    for (const entry of parsed.entries) {
      if (!validateKeyPathCoherence(entry)) {
        return invalid("invalid_register");
      }
    }

    if (!validateRoadmapRows(input.roadmapRows, program)) {
      return invalid("invalid_roadmap");
    }

    const activeNames = input.activeChangeNames;
    const uniqueActive = new Set<string>();
    for (const name of activeNames) {
      if (uniqueActive.has(name)) return invalid("inventory_mismatch");
      uniqueActive.add(name);
    }

    const openspecNames = new Set<string>();
    for (const entry of parsed.entries) {
      if (entry.sourceKind !== "openspec_change") continue;
      const name = entry.key.slice(CHANGE_PREFIX.length);
      openspecNames.add(name);
    }
    if (openspecNames.size !== uniqueActive.size) {
      return invalid("inventory_mismatch");
    }
    for (const name of uniqueActive) {
      if (!openspecNames.has(name)) return invalid("inventory_mismatch");
    }

    const activeInventorySha256 = computeActiveInventorySha256(activeNames);
    if (activeInventorySha256 !== parsed.activeInventorySha256) {
      return invalid("inventory_mismatch");
    }

    const roadmapSha256 = sha256Hex(input.roadmapBytes);
    if (roadmapSha256 !== parsed.roadmapSha256) {
      return invalid("roadmap_mismatch");
    }

    const roadmapEntries = parsed.entries.filter(
      (entry) => entry.sourceKind === "roadmap",
    );
    const rowByKey = new Map<string, RoadmapAssignmentV1>();
    for (const row of input.roadmapRows) {
      rowByKey.set(row.key, row);
    }
    if (roadmapEntries.length !== rowByKey.size) {
      return invalid("roadmap_mismatch");
    }
    for (const entry of roadmapEntries) {
      const row = rowByKey.get(entry.key);
      if (row === undefined) return invalid("roadmap_mismatch");
      if (row.owner !== entry.owner) return invalid("roadmap_mismatch");
      if (row.release !== entry.targetRelease) return invalid("roadmap_mismatch");
    }

    for (const entry of parsed.entries) {
      if (!uniqueActive.has(entry.owner) && !futureNames.has(entry.owner)) {
        return invalid("unknown_owner");
      }
    }

    for (const path of input.changedSuperpowersPaths) {
      if (pathIsCompetingPlan(path)) return invalid("competing_plan");
    }

    const selection = selectPhaseCoverage(
      input.phase,
      parsed.entries,
      parsed.futureOwners,
      program,
    );
    const selected = selection.entries;

    if (input.phase._tag === "Lane") {
      if (
        !uniqueActive.has(input.phase.owner) &&
        !futureNames.has(input.phase.owner)
      ) {
        return invalid("unknown_owner");
      }
      if (selected.length === 0) {
        return invalid("unknown_owner");
      }
    }

    if (input.phase._tag === "Bootstrap") {
      const expectedOwner = bootstrapOwner(program);
      const track1 = parsed.entries.find(
        (entry) => entry.key === bootstrapKey(program),
      );
      const track1ReleaseStateIsValid =
        track1 !== undefined &&
        ((track1.targetRelease === programCurrentRelease(program) &&
          track1.disposition === ownerDisposition(program)) ||
          (track1.targetRelease === "released" &&
            track1.disposition === "released_reference"));
      if (
        track1 === undefined ||
        track1.owner !== expectedOwner ||
        track1.reconcile !== "complete" ||
        track1.sourceKind !== "openspec_change" ||
        !track1ReleaseStateIsValid
      ) {
        return invalid("unreconciled");
      }
    }

    for (const entry of selected) {
      if (entry.reconcile === "required") return invalid("unreconciled");
    }

    const owners = selection.owners;
    for (const owner of owners) {
      const workflow = input.workflowByChange[owner];
      if (typeof workflow !== "string" || !ALLOWED_WORKFLOWS.has(workflow)) {
        return invalid("workflow_mismatch");
      }
    }

    const expectedKeys = Object.keys(input.expectedBriefByOwner);
    const bytesKeys = Object.keys(input.packageBriefBytesByOwner);

    if (input.phase._tag === "Bootstrap") {
      if (expectedKeys.length !== 0 || bytesKeys.length !== 0) {
        return invalid("brief_mismatch");
      }
    } else {
      const ownerSet = new Set(owners);
      if (expectedKeys.length !== ownerSet.size || bytesKeys.length !== ownerSet.size) {
        return invalid("brief_mismatch");
      }
      for (const key of expectedKeys) {
        if (!ownerSet.has(key)) return invalid("brief_mismatch");
      }
      for (const key of bytesKeys) {
        if (!ownerSet.has(key)) return invalid("brief_mismatch");
      }
      for (const owner of owners) {
        const brief = input.expectedBriefByOwner[owner];
        const bytes = input.packageBriefBytesByOwner[owner];
        if (brief === undefined || bytes === undefined) {
          return invalid("brief_mismatch");
        }
        if (bytes.byteLength > ONE_MIB) return invalid("brief_mismatch");
        if (decodeUtf8Unbounded(bytes) === null) return invalid("brief_mismatch");
        if (!validateBriefShape(brief)) return invalid("brief_mismatch");
        if (brief.packageId !== owner) return invalid("brief_mismatch");
        const expectedBytes = canonicalBriefFileBytes(brief);
        if (expectedBytes === null || !bytesEqual(expectedBytes, bytes)) {
          return invalid("brief_mismatch");
        }
      }
    }

    return valid(activeInventorySha256, roadmapSha256, parsed.entries.length);
  } catch {
    return invalid("dependency_failure");
  }
}
