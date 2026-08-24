import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
  type Stats,
} from "node:fs";
import { isAbsolute, relative, resolve, sep, win32 } from "node:path";
import { Effect, Layer } from "effect";
import { canonicalize, isSha256Hex } from "@foreman/core";
import {
  inspectReleaseCoverageRegisterV1,
  sanitizedGitEnv,
  validateReleaseCoverageV1,
  type ReleaseCoverageFailureReason,
  type ReleaseCoveragePhaseV1,
  type ReleaseCoverageResultV1,
  type ReleasePackageBriefV1,
  type RoadmapAssignmentV1,
} from "@foreman/policy";
import {
  livePathLookup,
  liveProcessExec,
  PathLookup,
  ProcessExec,
  type CapturedProcessResult,
} from "./queue-services.js";

const ONE_MIB = 1_048_576;
const EXIT_OK = 0;
const EXIT_EVALUATED = 1;
const EXIT_USAGE = 64;
const USAGE_DIAGNOSTIC = "release-coverage: invalid invocation\n";
const TRACK1_OWNER = "openspec-superpowers-convergence" as const;
const PROGRAM = "v040" as const;
const FAMILY_SCHEMA = "foreman.execution-family-source.v1" as const;
const CHILD_SCHEMA = "foreman.execution-child-brief.v1" as const;
const FAMILY_ID = "v040-release-20260822-f1" as const;
const BRIEF_SCHEMA = "foreman.release-package-brief.v1" as const;
const ROADMAP_HEADER = "| Coverage key | Scope | Release | Owner |";
const ROADMAP_SEPARATOR = "|---|---|---|---|";
const OPENSPEC_LIST_ARGV = ["list", "--json"] as const;
const SUPERPOWERS_SPECS = "docs/superpowers/specs";
const SUPERPOWERS_PLANS = "docs/superpowers/plans";
const GIT_TIMEOUT_MS = 30_000;
const OPENSPEC_TIMEOUT_MS = 30_000;
const TRANCHES = [2, 3, 4, 5, 6, 7, 8, 9] as const;

const encoder = new TextEncoder();

export type ReleaseCoverageCliIo = {
  readonly writeStdout: (text: string) => void;
  readonly writeStderr: (text: string) => void;
};

export type ReleaseCoverageFileReadService = {
  readonly resolveRepositoryRoot: () => Effect.Effect<string, unknown>;
  readonly readBounded: (input: {
    readonly path: string;
    readonly maxBytes: number;
    readonly containmentRoot?: string;
  }) => Effect.Effect<Uint8Array, unknown>;
};

export type ReleaseCoverageOpenSpecListService = {
  readonly listJson: (input: {
    readonly repository: string;
    readonly argv: readonly ["list", "--json"];
    readonly maxBytes: number;
  }) => Effect.Effect<Uint8Array, unknown>;
};

export type ReleaseCoverageGitChangedPathsService = {
  readonly discover: (input: {
    readonly repository: string;
    readonly baselineCommit: string;
  }) => Effect.Effect<readonly string[], unknown>;
};

export type ReleaseCoverageChildBriefV1 = {
  readonly schema: "foreman.execution-child-brief.v1";
  readonly childId: string;
  readonly tranche: 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  readonly packageId: string;
  readonly dependencyChildIds: readonly string[];
  readonly objective: string;
  readonly acceptance: readonly string[];
  readonly allowedPaths: readonly string[];
};

export type ReleaseCoverageFamilySourceV1 = {
  readonly schema: "foreman.execution-family-source.v1";
  readonly program: "v040";
  readonly familyId: "v040-release-20260822-f1";
  readonly children: readonly ReleaseCoverageChildBriefV1[];
};

export type ReleaseCoverageResolvedFamilyV1 = {
  readonly stateRoot: string;
  readonly contractId: string;
  readonly contractSha256: string;
  readonly familySha256: string;
  readonly source: ReleaseCoverageFamilySourceV1;
};

export type ReleaseCoverageFamilySourceService = {
  readonly resolve: (input: {
    readonly stateRoot: string;
    readonly contractId: string;
    readonly contractSha256: string;
    readonly familySha256: string;
  }) => Effect.Effect<ReleaseCoverageResolvedFamilyV1, unknown>;
};

export type ReleaseCoverageCliServices = {
  readonly fileRead: ReleaseCoverageFileReadService;
  readonly openspecList: ReleaseCoverageOpenSpecListService;
  readonly gitChangedPaths: ReleaseCoverageGitChangedPathsService;
  readonly familySource: ReleaseCoverageFamilySourceService;
};

type ParsedFlags = {
  readonly phase: "bootstrap" | "lane" | "release";
  readonly owner: string | undefined;
  readonly register: string;
  readonly repo: string | undefined;
  readonly stateRoot: string | undefined;
  readonly contractId: string | undefined;
  readonly contractSha: string | undefined;
  readonly familySha: string | undefined;
};

type ParsedCli =
  | {
      readonly _tag: "Ok";
      readonly phase: ReleaseCoveragePhaseV1;
      readonly register: string;
      readonly repo: string | undefined;
      readonly stateRoot: string | undefined;
      readonly contractId: string | undefined;
      readonly contractSha: string | undefined;
      readonly familySha: string | undefined;
    }
  | { readonly _tag: "Invalid" };

function invalidResult(
  reason: ReleaseCoverageFailureReason,
): ReleaseCoverageResultV1 {
  return { schemaVersion: 1, _tag: "Invalid", reason };
}

function dependencyFailure(): ReleaseCoverageResultV1 {
  return invalidResult("dependency_failure");
}

function emitEvaluated(
  io: ReleaseCoverageCliIo,
  result: ReleaseCoverageResultV1,
): number {
  io.writeStdout(`${canonicalize(result)}\n`);
  return result._tag === "Valid" ? EXIT_OK : EXIT_EVALUATED;
}

function utf8ByteLength(text: string): number {
  return encoder.encode(text).byteLength;
}

function isRunId(value: string): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  if (utf8ByteLength(value) > 128) return false;
  if (value.includes("/") || value.includes("\\") || value.includes("\0")) {
    return false;
  }
  return true;
}

function isNativeAbsolutePath(value: string): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  if (value.includes("\0")) return false;
  return isAbsolute(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isNotFoundError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    Object.prototype.hasOwnProperty.call(error, "_tag") &&
    (error as { readonly _tag?: unknown })._tag === "NotFound"
  );
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

function decodeUtf8Fatal(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch {
    return null;
  }
}

function hasAnyControl(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function hasControlExcludingLf(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 0x0a) continue;
    if (code < 0x20 || code === 0x7f) return true;
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

function compareUtf8Bytes(a: string, b: string): number {
  const ab = encoder.encode(a);
  const bb = encoder.encode(b);
  const n = Math.min(ab.length, bb.length);
  for (let i = 0; i < n; i++) {
    if (ab[i] !== bb[i]) return ab[i]! - bb[i]!;
  }
  return ab.length - bb.length;
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

function parseArgv(argv: ReadonlyArray<string>): ParsedCli {
  const args = argv.slice(2);
  if (args.length === 0 || args[0] !== "check") return { _tag: "Invalid" };

  const rest = args.slice(1);
  if (rest.length % 2 !== 0) return { _tag: "Invalid" };

  const seen = new Set<string>();
  const raw: Record<string, string> = {};
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i]!;
    const value = rest[i + 1];
    if (!flag.startsWith("--") || flag.length < 3) return { _tag: "Invalid" };
    if (value === undefined || value.startsWith("--")) return { _tag: "Invalid" };
    if (seen.has(flag)) return { _tag: "Invalid" };
    seen.add(flag);
    raw[flag] = value;
  }

  const program = raw["--program"];
  const phase = raw["--phase"];
  const register = raw["--register"];
  if (program !== PROGRAM) return { _tag: "Invalid" };
  if (phase !== "bootstrap" && phase !== "lane" && phase !== "release") {
    return { _tag: "Invalid" };
  }
  if (typeof register !== "string" || !isNativeAbsolutePath(register)) {
    return { _tag: "Invalid" };
  }

  const owner = raw["--owner"];
  const repo = raw["--repo"];
  const stateRoot = raw["--state-root"];
  const contractId = raw["--contract-id"];
  const contractSha = raw["--contract-sha"];
  const familySha = raw["--family-sha"];

  const flags: ParsedFlags = {
    phase,
    owner,
    register,
    repo,
    stateRoot,
    contractId,
    contractSha,
    familySha,
  };

  if (phase === "bootstrap") {
    const allowed = new Set([
      "--program",
      "--phase",
      "--owner",
      "--register",
    ]);
    for (const key of Object.keys(raw)) {
      if (!allowed.has(key)) return { _tag: "Invalid" };
    }
    if (owner !== TRACK1_OWNER) return { _tag: "Invalid" };
    if (
      repo !== undefined ||
      stateRoot !== undefined ||
      contractId !== undefined ||
      contractSha !== undefined ||
      familySha !== undefined
    ) {
      return { _tag: "Invalid" };
    }
    return {
      _tag: "Ok",
      phase: { _tag: "Bootstrap", owner: TRACK1_OWNER },
      register,
      repo: undefined,
      stateRoot: undefined,
      contractId: undefined,
      contractSha: undefined,
      familySha: undefined,
    };
  }

  if (phase === "lane") {
    const allowed = new Set([
      "--program",
      "--phase",
      "--owner",
      "--repo",
      "--state-root",
      "--contract-id",
      "--contract-sha",
      "--family-sha",
      "--register",
    ]);
    for (const key of Object.keys(raw)) {
      if (!allowed.has(key)) return { _tag: "Invalid" };
    }
    if (typeof owner !== "string" || !isRunId(owner)) return { _tag: "Invalid" };
    if (typeof repo !== "string" || !isNativeAbsolutePath(repo)) {
      return { _tag: "Invalid" };
    }
    if (typeof stateRoot !== "string" || !isNativeAbsolutePath(stateRoot)) {
      return { _tag: "Invalid" };
    }
    if (typeof contractId !== "string" || !isRunId(contractId)) {
      return { _tag: "Invalid" };
    }
    if (typeof contractSha !== "string" || !isSha256Hex(contractSha)) {
      return { _tag: "Invalid" };
    }
    if (typeof familySha !== "string" || !isSha256Hex(familySha)) {
      return { _tag: "Invalid" };
    }
    return {
      _tag: "Ok",
      phase: { _tag: "Lane", owner },
      register: flags.register,
      repo,
      stateRoot,
      contractId,
      contractSha,
      familySha,
    };
  }

  const allowed = new Set([
    "--program",
    "--phase",
    "--repo",
    "--state-root",
    "--contract-id",
    "--contract-sha",
    "--family-sha",
    "--register",
  ]);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) return { _tag: "Invalid" };
  }
  if (owner !== undefined) return { _tag: "Invalid" };
  if (typeof repo !== "string" || !isNativeAbsolutePath(repo)) {
    return { _tag: "Invalid" };
  }
  if (typeof stateRoot !== "string" || !isNativeAbsolutePath(stateRoot)) {
    return { _tag: "Invalid" };
  }
  if (typeof contractId !== "string" || !isRunId(contractId)) {
    return { _tag: "Invalid" };
  }
  if (typeof contractSha !== "string" || !isSha256Hex(contractSha)) {
    return { _tag: "Invalid" };
  }
  if (typeof familySha !== "string" || !isSha256Hex(familySha)) {
    return { _tag: "Invalid" };
  }
  return {
    _tag: "Ok",
    phase: { _tag: "Release" },
    register: flags.register,
    repo,
    stateRoot,
    contractId,
    contractSha,
    familySha,
  };
}

type PortRead =
  | { readonly _tag: "Ok"; readonly bytes: Uint8Array }
  | { readonly _tag: "NotFound" }
  | { readonly _tag: "Fail" };

function readBoundedPort(
  fileRead: ReleaseCoverageFileReadService,
  path: string,
  containmentRoot?: string,
): Effect.Effect<PortRead, never> {
  return Effect.suspend(() =>
    fileRead.readBounded({
      path,
      maxBytes: ONE_MIB,
      ...(containmentRoot !== undefined ? { containmentRoot } : {}),
    }),
  ).pipe(
    Effect.map((bytes): PortRead => ({ _tag: "Ok", bytes })),
    Effect.catchAll((error): Effect.Effect<PortRead, never> =>
      Effect.succeed(isNotFoundError(error) ? { _tag: "NotFound" } : { _tag: "Fail" }),
    ),
    Effect.catchAllDefect((): Effect.Effect<PortRead, never> =>
      Effect.succeed({ _tag: "Fail" }),
    ),
  );
}

function callPort<A>(
  create: () => Effect.Effect<A, unknown>,
): Effect.Effect<A, "dependency_failure"> {
  return Effect.suspend(() => create()).pipe(
    Effect.mapError((): "dependency_failure" => "dependency_failure"),
    Effect.catchAllDefect((): Effect.Effect<A, "dependency_failure"> =>
      Effect.fail("dependency_failure"),
    ),
  );
}

function parseOpenSpecNames(bytes: Uint8Array): readonly string[] | null {
  const text = decodeUtf8Fatal(bytes);
  if (text === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  if (!isPlainObject(parsed)) return null;
  const changes = parsed["changes"];
  if (!Array.isArray(changes)) return null;
  const names: string[] = [];
  for (const item of changes) {
    if (!isPlainObject(item)) return null;
    const name = item["name"];
    if (typeof name !== "string") return null;
    names.push(name);
  }
  return names;
}

function parseRoadmapRows(
  text: string,
): readonly RoadmapAssignmentV1[] | null {
  const lines = text.split(/\r?\n/);
  let headerIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === ROADMAP_HEADER) {
      if (headerIndex !== -1) return null;
      headerIndex = i;
    }
  }
  if (headerIndex < 0) return null;
  if (lines[headerIndex + 1] !== ROADMAP_SEPARATOR) return null;
  for (let i = 0; i < lines.length; i++) {
    if (i !== headerIndex + 1 && lines[i] === ROADMAP_SEPARATOR) return null;
  }

  const rows: RoadmapAssignmentV1[] = [];
  for (let i = headerIndex + 2; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.length === 0) break;
    const match =
      /^\| `([^`]+)` \| ([^|]+) \| `(v0\.[45])` \| `([^`]+)` \|$/.exec(line);
    if (match === null) return null;
    rows.push({
      key: match[1]!,
      scope: match[2]!,
      release: match[3] as "v0.4" | "v0.5",
      owner: match[4]!,
    });
  }
  return rows;
}

function extractWorkflowSchema(text: string): string | null {
  const lines = text.split(/\r?\n/);
  let found: string | null = null;
  for (const line of lines) {
    if (line.length === 0) continue;
    if (/^\s/.test(line)) continue;
    const match = /^schema:\s*(\S+)\s*$/.exec(line);
    if (match === null) continue;
    if (found !== null) return null;
    found = match[1]!;
  }
  return found;
}

function resolveContainedPath(
  repository: string,
  segments: readonly string[],
): string | null {
  for (const segment of segments) {
    if (segment.includes("\\") || segment.includes("\0")) return null;
    if (segment.includes("/")) return null;
    if (segment === "." || segment === "..") return null;
  }
  const absolute = resolve(repository, ...segments);
  const rel = relative(repository, absolute);
  if (rel.length === 0) return null;
  if (isAbsolute(rel)) return null;
  if (rel === "..") return null;
  if (rel.startsWith(`..${sep}`)) return null;
  return absolute;
}

function validateFamilySource(
  source: unknown,
): source is ReleaseCoverageFamilySourceV1 {
  if (!isPlainObject(source)) return false;
  if (
    !hasExactOwnKeys(source, ["schema", "program", "familyId", "children"])
  ) {
    return false;
  }
  if (source["schema"] !== FAMILY_SCHEMA) return false;
  if (source["program"] !== PROGRAM) return false;
  if (source["familyId"] !== FAMILY_ID) return false;
  const children = source["children"];
  if (!Array.isArray(children) || children.length !== 8) return false;

  const childIds = new Set<string>();
  const packageIds = new Set<string>();

  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (!isPlainObject(child)) return false;
    if (
      !hasExactOwnKeys(child, [
        "schema",
        "childId",
        "tranche",
        "packageId",
        "dependencyChildIds",
        "objective",
        "acceptance",
        "allowedPaths",
      ])
    ) {
      return false;
    }
    if (child["schema"] !== CHILD_SCHEMA) return false;
    const childId = child["childId"];
    const tranche = child["tranche"];
    const packageId = child["packageId"];
    const dependencyChildIds = child["dependencyChildIds"];
    const objective = child["objective"];
    const acceptance = child["acceptance"];
    const allowedPaths = child["allowedPaths"];
    if (typeof childId !== "string" || !isRunId(childId)) return false;
    if (tranche !== TRANCHES[i]) return false;
    if (typeof packageId !== "string" || !isRunId(packageId)) return false;
    if (childIds.has(childId) || packageIds.has(packageId)) return false;
    childIds.add(childId);
    packageIds.add(packageId);
    if (!Array.isArray(dependencyChildIds)) return false;
    for (const dep of dependencyChildIds) {
      if (typeof dep !== "string" || !isRunId(dep)) return false;
    }
    if (typeof objective !== "string" || !isValidObjective(objective)) {
      return false;
    }
    if (
      !Array.isArray(acceptance) ||
      acceptance.length < 1 ||
      acceptance.length > 256
    ) {
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
    const seenPaths = new Set<string>();
    let previous: string | null = null;
    for (const path of allowedPaths) {
      if (typeof path !== "string" || !isAllowedPathValue(path)) return false;
      if (seenPaths.has(path)) return false;
      seenPaths.add(path);
      if (previous !== null && compareUtf8Bytes(previous, path) > 0) return false;
      previous = path;
    }
  }
  return true;
}

function deriveBrief(
  child: ReleaseCoverageChildBriefV1,
  familySha256: string,
): ReleasePackageBriefV1 {
  return {
    schema: BRIEF_SCHEMA,
    familySha256,
    childId: child.childId,
    packageId: child.packageId,
    objective: child.objective,
    acceptance: child.acceptance,
    allowedPaths: child.allowedPaths,
  };
}

function evaluateReleaseCoverage(
  parsed: Extract<ParsedCli, { readonly _tag: "Ok" }>,
  services: ReleaseCoverageCliServices,
): Effect.Effect<ReleaseCoverageResultV1, never> {
  return Effect.gen(function* () {
    const registerRead = yield* readBoundedPort(
      services.fileRead,
      parsed.register,
    );
    if (registerRead._tag !== "Ok") return dependencyFailure();
    const registerText = decodeUtf8Fatal(registerRead.bytes);
    if (registerText === null) return dependencyFailure();

    const inspection = inspectReleaseCoverageRegisterV1({
      registerText,
      phase: parsed.phase,
    });
    if (inspection._tag === "Invalid") {
      return invalidResult("invalid_register");
    }

    let repository: string;
    if (parsed.phase._tag === "Bootstrap") {
      const root = yield* callPort(() =>
        services.fileRead.resolveRepositoryRoot(),
      ).pipe(Effect.either);
      if (root._tag === "Left") return dependencyFailure();
      repository = root.right;
      if (!isNativeAbsolutePath(repository)) return dependencyFailure();
    } else {
      repository = parsed.repo!;
    }

    const openspecBytes = yield* callPort(() =>
      services.openspecList.listJson({
        repository,
        argv: OPENSPEC_LIST_ARGV,
        maxBytes: ONE_MIB,
      }),
    ).pipe(Effect.either);
    if (openspecBytes._tag === "Left") return dependencyFailure();
    const activeChangeNames = parseOpenSpecNames(openspecBytes.right);
    if (activeChangeNames === null) return dependencyFailure();

    const roadmapPath = resolveContainedPath(repository, ["ROADMAP.md"]);
    if (roadmapPath === null) return dependencyFailure();
    const roadmapRead = yield* readBoundedPort(
      services.fileRead,
      roadmapPath,
      repository,
    );
    if (roadmapRead._tag !== "Ok") return dependencyFailure();
    const roadmapBytes = roadmapRead.bytes;
    const roadmapText = decodeUtf8Fatal(roadmapBytes);
    if (roadmapText === null) return invalidResult("invalid_roadmap");
    const roadmapRows = parseRoadmapRows(roadmapText);
    if (roadmapRows === null) return invalidResult("invalid_roadmap");

    const changed = yield* callPort(() =>
      services.gitChangedPaths.discover({
        repository,
        baselineCommit: inspection.baselineCommit,
      }),
    ).pipe(Effect.either);
    if (changed._tag === "Left") return dependencyFailure();

    const workflowByChange: Record<string, string | null> = {};
    for (const owner of inspection.selectedOwners) {
      const workflowPath = resolveContainedPath(repository, [
        "openspec",
        "changes",
        owner,
        ".openspec.yaml",
      ]);
      if (workflowPath === null) {
        workflowByChange[owner] = null;
        continue;
      }
      const workflowRead = yield* readBoundedPort(
        services.fileRead,
        workflowPath,
        repository,
      );
      if (workflowRead._tag === "Fail") return dependencyFailure();
      if (workflowRead._tag === "NotFound") {
        workflowByChange[owner] = null;
        continue;
      }
      const workflowText = decodeUtf8Fatal(workflowRead.bytes);
      if (workflowText === null) {
        workflowByChange[owner] = null;
        continue;
      }
      workflowByChange[owner] = extractWorkflowSchema(workflowText);
    }

    let expectedBriefByOwner: Record<string, ReleasePackageBriefV1> = {};
    let packageBriefBytesByOwner: Record<string, Uint8Array> = {};

    if (parsed.phase._tag !== "Bootstrap") {
      const family = yield* callPort(() =>
        services.familySource.resolve({
          stateRoot: parsed.stateRoot!,
          contractId: parsed.contractId!,
          contractSha256: parsed.contractSha!,
          familySha256: parsed.familySha!,
        }),
      ).pipe(Effect.either);
      if (family._tag === "Left") return dependencyFailure();
      const resolved = family.right;
      if (!isPlainObject(resolved as unknown as Record<string, unknown>)) {
        return dependencyFailure();
      }
      if (
        resolved.stateRoot !== parsed.stateRoot ||
        resolved.contractId !== parsed.contractId ||
        resolved.contractSha256 !== parsed.contractSha ||
        resolved.familySha256 !== parsed.familySha
      ) {
        return dependencyFailure();
      }
      if (!validateFamilySource(resolved.source)) {
        return dependencyFailure();
      }

      const children = resolved.source.children;
      expectedBriefByOwner = {};
      packageBriefBytesByOwner = {};

      for (const owner of inspection.selectedOwners) {
        const matches = children.filter((child) => child.packageId === owner);
        if (matches.length !== 1) {
          return invalidResult("brief_mismatch");
        }
        const child = matches[0]!;
        if (!isRunId(child.packageId)) {
          return dependencyFailure();
        }
        const briefPath = resolveContainedPath(repository, [
          "openspec",
          "changes",
          child.packageId,
          "release-brief.json",
        ]);
        if (briefPath === null) return dependencyFailure();
        const briefRead = yield* readBoundedPort(
          services.fileRead,
          briefPath,
          repository,
        );
        if (briefRead._tag === "NotFound") {
          return invalidResult("brief_mismatch");
        }
        if (briefRead._tag !== "Ok") return dependencyFailure();
        expectedBriefByOwner[owner] = deriveBrief(child, parsed.familySha!);
        packageBriefBytesByOwner[owner] = briefRead.bytes;
      }
    }

    return validateReleaseCoverageV1({
      phase: parsed.phase,
      registerText,
      roadmapBytes,
      activeChangeNames,
      roadmapRows,
      workflowByChange,
      changedSuperpowersPaths: changed.right,
      expectedBriefByOwner,
      packageBriefBytesByOwner,
    });
  }).pipe(
    Effect.catchAll((): Effect.Effect<ReleaseCoverageResultV1, never> =>
      Effect.succeed(dependencyFailure()),
    ),
    Effect.catchAllDefect((): Effect.Effect<ReleaseCoverageResultV1, never> =>
      Effect.succeed(dependencyFailure()),
    ),
  );
}

export function runReleaseCoverageCli(
  argv: ReadonlyArray<string>,
  io: ReleaseCoverageCliIo,
  services: ReleaseCoverageCliServices,
): Effect.Effect<number, never> {
  return Effect.gen(function* () {
    const parsed = parseArgv(argv);
    if (parsed._tag === "Invalid") {
      io.writeStderr(USAGE_DIAGNOSTIC);
      return EXIT_USAGE;
    }
    const result = yield* evaluateReleaseCoverage(parsed, services);
    return emitEvaluated(io, result);
  }).pipe(
    Effect.catchAllDefect(() =>
      Effect.sync(() => emitEvaluated(io, dependencyFailure())),
    ),
  );
}

function boundedReadOpenFlagsLive(): number {
  let flags = fsConstants.O_RDONLY;
  const c = fsConstants as Record<string, number | undefined>;
  if (typeof c.O_NONBLOCK === "number") flags |= c.O_NONBLOCK;
  if (typeof c.O_NOFOLLOW === "number") flags |= c.O_NOFOLLOW;
  return flags;
}

function isEnoentLive(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}

function isInsideRootLive(root: string, path: string): boolean {
  const rel = relative(root, path);
  if (rel.length === 0) return true;
  if (isAbsolute(rel)) return false;
  if (rel === "..") return false;
  return !rel.startsWith(`..${sep}`);
}

function readFailureLive(
  tag:
    | "Containment"
    | "IdentityChanged"
    | "NotFile"
    | "NotFound"
    | "Oversize"
    | "Symlink"
    | "Unreadable",
  message: string,
): never {
  throw Object.assign(new Error(message), { _tag: tag });
}

function sameRegularFileIdentityLive(left: Stats, right: Stats): boolean {
  return (
    left.isFile() &&
    right.isFile() &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

function validateContainmentLive(path: string, containmentRoot: string): void {
  const absoluteRoot = resolve(containmentRoot);
  const absolutePath = resolve(path);
  if (!isInsideRootLive(absoluteRoot, absolutePath)) {
    readFailureLive("Containment", "path escapes containment root");
  }
  const rel = relative(absoluteRoot, absolutePath);
  if (rel.length !== 0) {
    const segments = rel.split(sep);
    let current = absoluteRoot;
    for (let index = 0; index < segments.length; index++) {
      current = resolve(current, segments[index]!);
      let component: Stats;
      try {
        component = lstatSync(current);
      } catch (error) {
        if (isEnoentLive(error)) {
          readFailureLive("NotFound", "file not found");
        }
        throw error;
      }
      if (component.isSymbolicLink()) {
        readFailureLive("Symlink", "symlink below containment root");
      }
      if (index < segments.length - 1 && !component.isDirectory()) {
        readFailureLive("Unreadable", "intermediate component is not a directory");
      }
    }
  }
  let physicalRoot: string;
  try {
    physicalRoot = realpathSync(absoluteRoot);
  } catch {
    readFailureLive("Unreadable", "containment root is unreadable");
  }
  let physicalRootStats: Stats;
  try {
    physicalRootStats = lstatSync(physicalRoot);
  } catch {
    readFailureLive("Unreadable", "physical containment root is unreadable");
  }
  if (!physicalRootStats.isDirectory()) {
    readFailureLive("Containment", "containment root is not a directory");
  }
  let physicalPath: string;
  try {
    physicalPath = realpathSync(absolutePath);
  } catch (error) {
    if (isEnoentLive(error)) readFailureLive("NotFound", "file not found");
    throw error;
  }
  if (!isInsideRootLive(physicalRoot, physicalPath)) {
    readFailureLive("Containment", "physical path escapes containment root");
  }
}

function readBoundedBytesLive(
  path: string,
  maxBytes: number,
  containmentRoot?: string,
): Uint8Array {
  let fd: number | undefined;
  try {
    if (containmentRoot !== undefined) {
      validateContainmentLive(path, containmentRoot);
    }
    let before: Stats;
    try {
      before = lstatSync(path);
    } catch (error) {
      if (isEnoentLive(error)) readFailureLive("NotFound", "file not found");
      throw error;
    }
    if (before.isSymbolicLink()) readFailureLive("Symlink", "leaf is a symlink");
    if (!before.isFile()) readFailureLive("NotFile", "leaf is not a regular file");
    try {
      fd = openSync(path, boundedReadOpenFlagsLive());
    } catch (error) {
      if (isEnoentLive(error)) {
        readFailureLive("IdentityChanged", "leaf changed before open");
      }
      throw error;
    }
    const opened = fstatSync(fd);
    if (!sameRegularFileIdentityLive(before, opened)) {
      readFailureLive("IdentityChanged", "leaf identity changed during open");
    }
    const cap = maxBytes + 1;
    const buffer = Buffer.allocUnsafe(cap);
    let offset = 0;
    while (offset < cap) {
      const count = readSync(fd, buffer, offset, cap - offset, offset);
      if (count === 0) break;
      offset += count;
    }
    if (offset > maxBytes) readFailureLive("Oversize", "file exceeds the read bound");
    let afterOpen: Stats;
    try {
      afterOpen = fstatSync(fd);
    } catch {
      readFailureLive("IdentityChanged", "opened descriptor became unreadable");
    }
    let afterPath: Stats;
    try {
      afterPath = lstatSync(path);
    } catch {
      readFailureLive("IdentityChanged", "leaf changed after read");
    }
    if (
      afterPath.isSymbolicLink() ||
      !sameRegularFileIdentityLive(opened, afterOpen) ||
      !sameRegularFileIdentityLive(opened, afterPath)
    ) {
      readFailureLive("IdentityChanged", "leaf identity changed during read");
    }
    return Uint8Array.from(buffer.subarray(0, offset));
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

function isWindowsSafeAbsolutePath(value: string): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  if (
    value.includes("\0") ||
    value.includes("\r") ||
    value.includes("\n") ||
    value.includes('"')
  ) {
    return false;
  }
  return win32.isAbsolute(value);
}

/**
 * Pure OpenSpec argv planner. Live services resolve `openspec` on PATH, then
 * execute only a plan this helper returns.
 */
export function planOpenSpecInvocationV1(input: {
  readonly platform: NodeJS.Platform;
  readonly comSpec: string | undefined;
  readonly resolvedOpenSpec: string;
}):
  | { readonly _tag: "Ok"; readonly command: string; readonly args: readonly string[] }
  | { readonly _tag: "Invalid" } {
  const resolved = input.resolvedOpenSpec;
  if (typeof resolved !== "string" || resolved.length === 0) {
    return { _tag: "Invalid" };
  }
  if (resolved.includes("\0")) return { _tag: "Invalid" };

  if (input.platform === "win32") {
    const comSpec = input.comSpec;
    if (typeof comSpec !== "string" || comSpec.length === 0) {
      return { _tag: "Invalid" };
    }
    if (!isWindowsSafeAbsolutePath(comSpec)) return { _tag: "Invalid" };
    if (!isWindowsSafeAbsolutePath(resolved)) return { _tag: "Invalid" };
    if (!/\.cmd$/i.test(resolved)) return { _tag: "Invalid" };
    return {
      _tag: "Ok",
      command: comSpec,
      args: ["/d", "/s", "/c", `"${resolved}" list --json`],
    };
  }

  if (!isAbsolute(resolved)) return { _tag: "Invalid" };
  return {
    _tag: "Ok",
    command: resolved,
    args: ["list", "--json"],
  };
}

function isPhysicallyInsideRepository(
  repository: string,
  absolutePath: string,
): boolean {
  const rel = relative(repository, absolutePath);
  if (rel.length === 0) return true;
  if (isAbsolute(rel)) return false;
  if (rel === "..") return false;
  if (rel.startsWith(`..${sep}`)) return false;
  return true;
}

function isSafeRelativeGitPath(path: string): boolean {
  if (path.length === 0) return false;
  if (path.includes("\0")) return false;
  if (isAbsolute(path)) return false;
  if (path.startsWith("/")) return false;
  if (/^[A-Za-z]:[\\/]/.test(path)) return false;
  if (path.includes("\\")) return false;
  const segments = path.split("/");
  for (const segment of segments) {
    if (segment.length === 0) return false;
    if (segment === "." || segment === "..") return false;
  }
  return true;
}

/**
 * Parse git `-z` stdout: empty → [], otherwise require a terminal NUL, fatal
 * UTF-8, no empty path fields, and only safe relative paths.
 */
function parseNulDelimitedGitPaths(
  bytes: Uint8Array,
): readonly string[] | null {
  if (bytes.byteLength === 0) return [];
  if (bytes[bytes.byteLength - 1] !== 0) return null;
  const text = decodeUtf8Fatal(bytes);
  if (text === null) return null;
  const parts = text.split("\0");
  if (parts.length < 2) return null;
  if (parts[parts.length - 1] !== "") return null;
  const paths = parts.slice(0, -1);
  for (const path of paths) {
    if (!isSafeRelativeGitPath(path)) return null;
  }
  return paths;
}

function dedupeUtf8ByteOrder(paths: readonly string[]): readonly string[] {
  const sorted = [...paths].sort(compareUtf8Bytes);
  const out: string[] = [];
  let previous: string | undefined;
  for (const path of sorted) {
    if (previous !== undefined && previous === path) continue;
    out.push(path);
    previous = path;
  }
  return out;
}

function parseGitTopLevel(bytes: Uint8Array): string | null {
  const text = decodeUtf8Fatal(bytes);
  if (text === null) return null;
  let line: string;
  if (text.endsWith("\r\n")) {
    line = text.slice(0, -2);
  } else if (text.endsWith("\n")) {
    line = text.slice(0, -1);
  } else {
    line = text;
  }
  if (line.length === 0) return null;
  if (line.includes("\n") || line.includes("\r")) return null;
  if (hasAnyControl(line)) return null;
  if (!isNativeAbsolutePath(line)) return null;
  return line;
}

function gitArgv(args: readonly string[]): string[] {
  return ["--no-replace-objects", ...args];
}

function requireCapturedStdoutBytes(
  result: CapturedProcessResult,
): Effect.Effect<Uint8Array, unknown> {
  if (result.exitCode !== 0) {
    return Effect.fail({ _tag: "NonZeroExit" as const });
  }
  if (result.stdoutBytes === undefined) {
    return Effect.fail({ _tag: "MissingStdoutBytes" as const });
  }
  return Effect.succeed(result.stdoutBytes);
}

const liveProcessAndPathLayer = Layer.mergeAll(liveProcessExec, livePathLookup);

export const liveReleaseCoverageCliServices: ReleaseCoverageCliServices = {
  fileRead: {
    resolveRepositoryRoot: () =>
      Effect.gen(function* () {
        const exec = yield* ProcessExec;
        const cwd = process.cwd();
        const captured = yield* exec.runCaptured({
          command: "git",
          args: gitArgv(["-C", cwd, "rev-parse", "--show-toplevel"]),
          env: sanitizedGitEnv(),
          maxOutputBytes: ONE_MIB,
          timeoutMs: GIT_TIMEOUT_MS,
        });
        const bytes = yield* requireCapturedStdoutBytes(captured);
        const top = parseGitTopLevel(bytes);
        if (top === null) {
          return yield* Effect.fail({ _tag: "GitTopLevelInvalid" as const });
        }
        return top;
      }).pipe(Effect.provide(liveProcessExec)),
    readBounded: (input) =>
      Effect.try({
        try: () =>
          readBoundedBytesLive(
            input.path,
            input.maxBytes,
            input.containmentRoot,
          ),
        catch: (error) => error,
      }),
  },
  openspecList: {
    listJson: (input) =>
      Effect.gen(function* () {
        const exec = yield* ProcessExec;
        const lookup = yield* PathLookup;
        const resolved = yield* lookup.which("openspec");
        if (resolved === null) {
          return yield* Effect.fail({ _tag: "OpenSpecUnavailable" as const });
        }
        if (isPhysicallyInsideRepository(input.repository, resolved)) {
          return yield* Effect.fail({ _tag: "OpenSpecInsideRepository" as const });
        }
        const plan = planOpenSpecInvocationV1({
          platform: process.platform,
          comSpec: process.env.ComSpec ?? process.env.COMSPEC,
          resolvedOpenSpec: resolved,
        });
        if (plan._tag === "Invalid") {
          return yield* Effect.fail({ _tag: "OpenSpecUnavailable" as const });
        }
        const captured = yield* exec.runCaptured({
          command: plan.command,
          args: [...plan.args],
          cwd: input.repository,
          maxOutputBytes: input.maxBytes,
          timeoutMs: OPENSPEC_TIMEOUT_MS,
        });
        return yield* requireCapturedStdoutBytes(captured);
      }).pipe(Effect.provide(liveProcessAndPathLayer)),
  },
  gitChangedPaths: {
    discover: (input) =>
      Effect.gen(function* () {
        const exec = yield* ProcessExec;
        const env = sanitizedGitEnv();
        const tracked = yield* exec.runCaptured({
          command: "git",
          args: gitArgv([
            "-C",
            input.repository,
            "diff",
            "--name-only",
            "-z",
            "--no-ext-diff",
            "--no-textconv",
            input.baselineCommit,
            "--",
            SUPERPOWERS_SPECS,
            SUPERPOWERS_PLANS,
          ]),
          env,
          maxOutputBytes: ONE_MIB,
          timeoutMs: GIT_TIMEOUT_MS,
        });
        const trackedBytes = yield* requireCapturedStdoutBytes(tracked);
        const trackedPaths = parseNulDelimitedGitPaths(trackedBytes);
        if (trackedPaths === null) {
          return yield* Effect.fail({ _tag: "GitPathsInvalid" as const });
        }
        const untracked = yield* exec.runCaptured({
          command: "git",
          args: gitArgv([
            "-C",
            input.repository,
            "ls-files",
            "--others",
            "--exclude-standard",
            "-z",
            "--",
            SUPERPOWERS_SPECS,
            SUPERPOWERS_PLANS,
          ]),
          env,
          maxOutputBytes: ONE_MIB,
          timeoutMs: GIT_TIMEOUT_MS,
        });
        const untrackedBytes = yield* requireCapturedStdoutBytes(untracked);
        const untrackedPaths = parseNulDelimitedGitPaths(untrackedBytes);
        if (untrackedPaths === null) {
          return yield* Effect.fail({ _tag: "GitPathsInvalid" as const });
        }
        return dedupeUtf8ByteOrder([...trackedPaths, ...untrackedPaths]);
      }).pipe(Effect.provide(liveProcessExec)),
  },
  familySource: {
    resolve: () =>
      Effect.fail({
        _tag: "FamilySourceUnavailable" as const,
      }),
  },
};
