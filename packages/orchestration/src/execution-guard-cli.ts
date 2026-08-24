import {
  canonicalize,
  isCommitSha40,
  isCoreFailure,
  isSha256Hex,
  parseJsonRejectDuplicateKeys,
  sha256Hex,
} from "@foreman/core";
import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { decodeRunId, isUtcSecondTimestamp } from "@foreman/event-log";
import { Effect } from "effect";
import {
  decodeExecutionContractV1,
  decodeExecutionContractFamilyV2,
  deriveExecutionContractFamilyV2,
  executionContractFamilySha256,
  executionMilestones,
  isExecutionContractFailure,
  isExecutionFamilyFailure,
  type ExecutionContractFamilyV2,
} from "./execution-contract.js";
import {
  EndstopLedger,
  isEndstopLedgerFailure,
  makeLiveEndstopLedgerLayer,
} from "./execution-ledger.js";
import type { ExecutionState } from "./execution-terminal-policy.js";
import type {
  ExecutionChildStateV2,
  ExecutionFamilyStateV2,
} from "./execution-terminal-policy.js";
import { readFileBoundedSync } from "./queue-services.js";

export const ENDSTOP_EXIT_OK = 0;
export const ENDSTOP_EXIT_FAIL = 1;
export const ENDSTOP_EXIT_CONFIG = 2;

export type EndstopCliIo = {
  readonly writeStdout: (text: string) => void;
  readonly writeStderr: (text: string) => void;
};

export type EndstopCliServices = {
  readonly now: () => string;
};

const ONE_MIB = 1024 * 1024;
const textEncoder = new TextEncoder();

type CanonicalFile = {
  readonly value: unknown;
  readonly bytes: Uint8Array;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function readCanonicalFile(path: string): CanonicalFile | null {
  const read = readFileBoundedSync(path, ONE_MIB);
  if (read._tag !== "Ok") return null;
  const text = read.text;
  if (!text.endsWith("\n") || text.endsWith("\r\n")) return null;
  const body = text.slice(0, -1);
  const parsed = parseJsonRejectDuplicateKeys(body);
  if (isCoreFailure(parsed) || canonicalize(parsed) !== body) return null;
  return { value: JSON.parse(body) as unknown, bytes: textEncoder.encode(text) };
}

function validFamilyAuditReceipt(
  value: unknown,
  manifest: ExecutionContractFamilyV2,
  familySha256: string,
): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "schema",
      "program",
      "familyId",
      "manifestSha256",
      "track1Commit",
      "track1Tree",
      "verdict",
      "findings",
      "evidenceSha256",
      "issuedAt",
    ]) &&
    value.schema === "foreman.execution-family-audit.v1" &&
    value.program === "v040" &&
    value.familyId === manifest.familyId &&
    value.manifestSha256 === familySha256 &&
    value.track1Commit === manifest.track1Commit &&
    value.track1Tree === manifest.track1Tree &&
    value.verdict === "APPROVED" &&
    Array.isArray(value.findings) &&
    value.findings.length === 0 &&
    typeof value.evidenceSha256 === "string" &&
    isSha256Hex(value.evidenceSha256) &&
    typeof value.issuedAt === "string" &&
    isUtcSecondTimestamp(value.issuedAt)
  );
}

function validFamilyUserReceipt(
  value: unknown,
  manifest: ExecutionContractFamilyV2,
  familySha256: string,
): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "schema",
      "program",
      "familyId",
      "manifestSha256",
      "track1Commit",
      "track1Tree",
      "approvalStatementSha256",
      "issuedAt",
    ]) &&
    value.schema === "foreman.execution-family-user-approval.v1" &&
    value.program === "v040" &&
    value.familyId === manifest.familyId &&
    value.manifestSha256 === familySha256 &&
    value.track1Commit === manifest.track1Commit &&
    value.track1Tree === manifest.track1Tree &&
    typeof value.approvalStatementSha256 === "string" &&
    isSha256Hex(value.approvalStatementSha256) &&
    typeof value.issuedAt === "string" &&
    isUtcSecondTimestamp(value.issuedAt)
  );
}

export type ParsedEndstopArgv =
  | {
      readonly _tag: "Create";
      readonly stateRoot: string;
      readonly contractFile: string;
    }
  | {
      readonly _tag: "Status";
      readonly stateRoot: string;
      readonly contractId: string;
    }
  | {
      readonly _tag: "FamilyStatus";
      readonly stateRoot: string;
      readonly contractId: string;
      readonly contractSha256: string;
      readonly familySha256: string;
    }
  | {
      readonly _tag: "ChildStatus";
      readonly stateRoot: string;
      readonly contractId: string;
      readonly contractSha256: string;
      readonly familySha256: string;
      readonly childId: string;
    }
  | {
      readonly _tag: "RegisterFamilyAuthority";
      readonly stateRoot: string;
      readonly contractId: string;
      readonly contractSha256: string;
      readonly manifestFile: string;
      readonly sourceFile: string;
      readonly briefsDirectory: string;
      readonly auditReceiptFile: string;
      readonly userReceiptFile: string;
    }
  | {
      readonly _tag: "ActivateFamily";
      readonly stateRoot: string;
      readonly contractId: string;
      readonly contractSha256: string;
      readonly manifestFile: string;
    }
  | {
      readonly _tag: "ChildRecordProductChange";
      readonly stateRoot: string;
      readonly contractId: string;
      readonly contractSha256: string;
      readonly familySha256: string;
      readonly childId: string;
      readonly reservationId: string;
      readonly repository: string;
      readonly candidateCommit: string;
    }
  | {
      readonly _tag: "ChildRecordMilestone";
      readonly stateRoot: string;
      readonly contractId: string;
      readonly contractSha256: string;
      readonly familySha256: string;
      readonly childId: string;
      readonly milestone: (typeof executionMilestones)[number];
      readonly outcomeFile: string;
    }
  | {
      readonly _tag:
        | "ChildRecordBlocking"
        | "ChildRecordExternalFailure";
      readonly stateRoot: string;
      readonly contractId: string;
      readonly contractSha256: string;
      readonly familySha256: string;
      readonly childId: string;
      readonly outcomeFile: string;
    }
  | {
      readonly _tag: "ChildCancel" | "ChildInvalidate";
      readonly stateRoot: string;
      readonly contractId: string;
      readonly contractSha256: string;
      readonly familySha256: string;
      readonly childId: string;
      readonly approvalFile: string;
    }
  | { readonly _tag: "Invalid" };

function stripNodeArgv(argv: readonly string[]): readonly string[] {
  let args = [...argv];
  if (args[0]?.match(/(?:^|[\\/])node(?:\.exe)?$/u)) args = args.slice(1);
  if (args[0]?.includes("execution-guard")) args = args.slice(1);
  return args;
}

export function parseEndstopArgv(argv: readonly string[]): ParsedEndstopArgv {
  const args = stripNodeArgv(argv);
  const childPrefix =
    args[1] === "--state-root" &&
    typeof args[2] === "string" &&
    isAbsolute(args[2]) &&
    args[3] === "--contract-id" &&
    typeof args[4] === "string" &&
    typeof decodeRunId(args[4]) === "string" &&
    args[5] === "--contract-sha" &&
    typeof args[6] === "string" &&
    isSha256Hex(args[6]) &&
    args[7] === "--family-sha" &&
    typeof args[8] === "string" &&
    isSha256Hex(args[8]) &&
    args[9] === "--child-id" &&
    typeof args[10] === "string" &&
    typeof decodeRunId(args[10]) === "string";
  if (
    args.length === 17 &&
    args[0] === "child-record-product-change" &&
    childPrefix &&
    args[11] === "--reservation-id" &&
    typeof args[12] === "string" &&
    typeof decodeRunId(args[12]) === "string" &&
    args[13] === "--repo" &&
    typeof args[14] === "string" &&
    isAbsolute(args[14]) &&
    args[15] === "--candidate-commit" &&
    typeof args[16] === "string" &&
    isCommitSha40(args[16])
  ) {
    return {
      _tag: "ChildRecordProductChange",
      stateRoot: args[2]!,
      contractId: args[4]!,
      contractSha256: args[6]!,
      familySha256: args[8]!,
      childId: args[10]!,
      reservationId: args[12]!,
      repository: args[14]!,
      candidateCommit: args[16]!,
    };
  }
  if (
    args.length === 15 &&
    args[0] === "child-record-milestone" &&
    childPrefix &&
    args[11] === "--milestone" &&
    typeof args[12] === "string" &&
    executionMilestones.includes(
      args[12] as (typeof executionMilestones)[number],
    ) &&
    args[13] === "--outcome" &&
    typeof args[14] === "string" &&
    isAbsolute(args[14])
  ) {
    return {
      _tag: "ChildRecordMilestone",
      stateRoot: args[2]!,
      contractId: args[4]!,
      contractSha256: args[6]!,
      familySha256: args[8]!,
      childId: args[10]!,
      milestone: args[12] as (typeof executionMilestones)[number],
      outcomeFile: args[14]!,
    };
  }
  if (
    args.length === 13 &&
    (args[0] === "child-record-blocking" ||
      args[0] === "child-record-external-failure") &&
    childPrefix &&
    args[11] === "--outcome" &&
    typeof args[12] === "string" &&
    isAbsolute(args[12])
  ) {
    return {
      _tag: args[0] === "child-record-blocking"
        ? "ChildRecordBlocking"
        : "ChildRecordExternalFailure",
      stateRoot: args[2]!,
      contractId: args[4]!,
      contractSha256: args[6]!,
      familySha256: args[8]!,
      childId: args[10]!,
      outcomeFile: args[12]!,
    };
  }
  if (
    args.length === 13 &&
    (args[0] === "child-cancel" || args[0] === "child-invalidate") &&
    childPrefix &&
    args[11] === "--approval" &&
    typeof args[12] === "string" &&
    isAbsolute(args[12])
  ) {
    return {
      _tag: args[0] === "child-cancel" ? "ChildCancel" : "ChildInvalidate",
      stateRoot: args[2]!,
      contractId: args[4]!,
      contractSha256: args[6]!,
      familySha256: args[8]!,
      childId: args[10]!,
      approvalFile: args[12]!,
    };
  }
  if (
    args.length === 5 &&
    args[0] === "create" &&
    args[1] === "--state-root" &&
    args[3] === "--contract-file" &&
    typeof args[2] === "string" &&
    isAbsolute(args[2]) &&
    typeof args[4] === "string" &&
    isAbsolute(args[4])
  ) {
    return { _tag: "Create", stateRoot: args[2], contractFile: args[4] };
  }
  if (
    args.length === 5 &&
    args[0] === "status" &&
    args[1] === "--state-root" &&
    args[3] === "--contract-id" &&
    typeof args[2] === "string" &&
    isAbsolute(args[2]) &&
    typeof args[4] === "string" &&
    args[4].length > 0
  ) {
    return { _tag: "Status", stateRoot: args[2], contractId: args[4] };
  }
  if (
    args.length === 9 &&
    args[0] === "family-status" &&
    args[1] === "--state-root" &&
    args[3] === "--contract-id" &&
    args[5] === "--contract-sha" &&
    args[7] === "--family-sha" &&
    typeof args[2] === "string" &&
    isAbsolute(args[2]) &&
    typeof args[4] === "string" &&
    args[4].length > 0 &&
    typeof args[6] === "string" &&
    isSha256Hex(args[6]) &&
    typeof args[8] === "string" &&
    isSha256Hex(args[8])
  ) {
    return {
      _tag: "FamilyStatus",
      stateRoot: args[2],
      contractId: args[4],
      contractSha256: args[6],
      familySha256: args[8],
    };
  }
  if (
    args.length === 11 &&
    args[0] === "child-status" &&
    args[1] === "--state-root" &&
    args[3] === "--contract-id" &&
    args[5] === "--contract-sha" &&
    args[7] === "--family-sha" &&
    args[9] === "--child-id" &&
    typeof args[2] === "string" &&
    isAbsolute(args[2]) &&
    typeof args[4] === "string" &&
    args[4].length > 0 &&
    typeof args[6] === "string" &&
    isSha256Hex(args[6]) &&
    typeof args[8] === "string" &&
    isSha256Hex(args[8]) &&
    typeof args[10] === "string" &&
    args[10].length > 0
  ) {
    return {
      _tag: "ChildStatus",
      stateRoot: args[2],
      contractId: args[4],
      contractSha256: args[6],
      familySha256: args[8],
      childId: args[10],
    };
  }
  if (
    args.length === 17 &&
    args[0] === "register-family-authority" &&
    args[1] === "--state-root" &&
    args[3] === "--contract-id" &&
    args[5] === "--contract-sha" &&
    args[7] === "--manifest" &&
    args[9] === "--source" &&
    args[11] === "--briefs" &&
    args[13] === "--audit-receipt" &&
    args[15] === "--user-receipt" &&
    typeof args[2] === "string" &&
    isAbsolute(args[2]) &&
    typeof args[4] === "string" &&
    args[4].length > 0 &&
    typeof args[6] === "string" &&
    isSha256Hex(args[6]) &&
    [args[8], args[10], args[12], args[14], args[16]].every(
      (path) => typeof path === "string" && isAbsolute(path),
    )
  ) {
    return {
      _tag: "RegisterFamilyAuthority",
      stateRoot: args[2],
      contractId: args[4],
      contractSha256: args[6],
      manifestFile: args[8]!,
      sourceFile: args[10]!,
      briefsDirectory: args[12]!,
      auditReceiptFile: args[14]!,
      userReceiptFile: args[16]!,
    };
  }
  if (
    args.length === 9 &&
    args[0] === "activate-family" &&
    args[1] === "--state-root" &&
    args[3] === "--contract-id" &&
    args[5] === "--contract-sha" &&
    args[7] === "--manifest" &&
    typeof args[2] === "string" &&
    isAbsolute(args[2]) &&
    typeof args[4] === "string" &&
    args[4].length > 0 &&
    typeof args[6] === "string" &&
    isSha256Hex(args[6]) &&
    typeof args[8] === "string" &&
    isAbsolute(args[8])
  ) {
    return {
      _tag: "ActivateFamily",
      stateRoot: args[2],
      contractId: args[4],
      contractSha256: args[6],
      manifestFile: args[8],
    };
  }
  return { _tag: "Invalid" };
}

type PreparedFamilyFiles = {
  readonly manifest: ExecutionContractFamilyV2;
  readonly familySha256: string;
  readonly sourceBytes: Uint8Array;
  readonly briefBytes: Readonly<Record<string, Uint8Array>>;
};

function prepareFamilyFiles(input: {
  readonly manifestFile: string;
  readonly sourceFile: string;
  readonly briefsDirectory: string;
  readonly contractId: string;
  readonly contractSha256: string;
}): PreparedFamilyFiles | null {
  try {
    const manifestFile = readCanonicalFile(input.manifestFile);
    const sourceFile = readCanonicalFile(input.sourceFile);
    if (manifestFile === null || sourceFile === null) return null;
    const manifest = decodeExecutionContractFamilyV2(manifestFile.value);
    if (
      isExecutionFamilyFailure(manifest) ||
      manifest.rootContractId !== input.contractId ||
      manifest.rootContractSha256 !== input.contractSha256
    ) {
      return null;
    }
    const derived = deriveExecutionContractFamilyV2({
      rootContractId: input.contractId,
      rootContractSha256: input.contractSha256,
      track1Commit: manifest.track1Commit,
      track1Tree: manifest.track1Tree,
      sourceBytes: sourceFile.bytes,
      createdAt: manifest.createdAt,
    });
    if (
      derived._tag !== "Valid" ||
      canonicalize(derived.manifest) !== canonicalize(manifest)
    ) {
      return null;
    }
    const names = Object.keys(derived.briefs)
      .map((packageId) => `${packageId}.json`)
      .sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
    const entries = readdirSync(input.briefsDirectory, { withFileTypes: true })
      .map((entry) => entry.name)
      .sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
    if (
      entries.length !== names.length ||
      entries.some((name, index) => name !== names[index])
    ) {
      return null;
    }
    const briefBytes: Record<string, Uint8Array> = {};
    for (const [packageId, brief] of Object.entries(derived.briefs)) {
      const path = join(input.briefsDirectory, `${packageId}.json`);
      if (!lstatSync(path).isFile()) return null;
      const file = readCanonicalFile(path);
      if (
        file === null ||
        canonicalize(file.value) !== canonicalize(brief)
      ) {
        return null;
      }
      briefBytes[packageId] = file.bytes;
    }
    return {
      manifest,
      familySha256: derived.familySha256,
      sourceBytes: sourceFile.bytes,
      briefBytes,
    };
  } catch {
    return null;
  }
}

function familySetPath(stateRoot: string, familySha256: string): string {
  return join(stateRoot, "release-families", familySha256);
}

function expectedFamilySetFiles(
  prepared: PreparedFamilyFiles,
): Readonly<Record<string, Uint8Array>> {
  const files: Record<string, Uint8Array> = {
    "manifest.json": textEncoder.encode(`${canonicalize(prepared.manifest)}\n`),
    "source.json": prepared.sourceBytes,
  };
  for (const [packageId, bytes] of Object.entries(prepared.briefBytes)) {
    files[`briefs/${packageId}.json`] = bytes;
  }
  return files;
}

function familySetMatches(
  target: string,
  prepared: PreparedFamilyFiles,
): boolean {
  try {
    if (!lstatSync(target).isDirectory()) return false;
    const top = readdirSync(target, { withFileTypes: true })
      .map((entry) => `${entry.isDirectory() ? "d" : entry.isFile() ? "f" : "o"}:${entry.name}`)
      .sort();
    if (canonicalize(top) !== canonicalize(["d:briefs", "f:manifest.json", "f:source.json"])) {
      return false;
    }
    const expected = expectedFamilySetFiles(prepared);
    const briefNames = readdirSync(join(target, "briefs"), {
      withFileTypes: true,
    })
      .map((entry) => `${entry.isFile() ? "f" : "o"}:${entry.name}`)
      .sort();
    const expectedBriefNames = Object.keys(prepared.briefBytes)
      .map((packageId) => `f:${packageId}.json`)
      .sort();
    if (canonicalize(briefNames) !== canonicalize(expectedBriefNames)) {
      return false;
    }
    return Object.entries(expected).every(([relativePath, bytes]) =>
      readFileSync(join(target, relativePath)).equals(Buffer.from(bytes)),
    );
  } catch {
    return false;
  }
}

function writeSynced(path: string, bytes: Uint8Array): void {
  const fd = openSync(path, "wx", 0o600);
  try {
    writeFileSync(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function syncDirectory(path: string): void {
  const fd = openSync(path, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function publishFamilySet(
  stateRoot: string,
  prepared: PreparedFamilyFiles,
): void {
  const parent = join(stateRoot, "release-families");
  const target = familySetPath(stateRoot, prepared.familySha256);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  if (existsSync(target)) {
    if (!familySetMatches(target, prepared)) {
      throw new Error("family_set_conflict");
    }
    return;
  }
  const temporary = join(parent, `.family-${randomUUID()}.tmp`);
  try {
    mkdirSync(join(temporary, "briefs"), { recursive: true, mode: 0o700 });
    const expected = expectedFamilySetFiles(prepared);
    for (const [relativePath, bytes] of Object.entries(expected)) {
      writeSynced(join(temporary, relativePath), bytes);
    }
    syncDirectory(join(temporary, "briefs"));
    syncDirectory(temporary);
    try {
      renameSync(temporary, target);
    } catch (error) {
      if (!familySetMatches(target, prepared)) throw error;
    }
    syncDirectory(parent);
  } finally {
    if (existsSync(temporary)) {
      rmSync(temporary, { recursive: true, force: true });
    }
  }
}

function loadPublishedFamilySet(
  stateRoot: string,
  manifestFile: string,
  contractId: string,
  contractSha256: string,
): PreparedFamilyFiles | null {
  const canonicalManifest = readCanonicalFile(manifestFile);
  if (canonicalManifest === null) return null;
  const manifest = decodeExecutionContractFamilyV2(canonicalManifest.value);
  if (
    isExecutionFamilyFailure(manifest) ||
    manifest.rootContractId !== contractId ||
    manifest.rootContractSha256 !== contractSha256
  ) {
    return null;
  }
  const familySha256 = executionContractFamilySha256(manifest);
  const target = familySetPath(stateRoot, familySha256);
  const prepared = prepareFamilyFiles({
    manifestFile: join(target, "manifest.json"),
    sourceFile: join(target, "source.json"),
    briefsDirectory: join(target, "briefs"),
    contractId,
    contractSha256,
  });
  return prepared !== null &&
      prepared.familySha256 === familySha256 &&
      familySetMatches(target, prepared)
    ? prepared
    : null;
}

function publicSnapshot(state: ExecutionState): Record<string, unknown> {
  return {
    contractId: state.contract.contractId,
    contractSha256: state.contractSha256,
    counts: state.counts,
    state: state._tag,
    ...(state._tag === "Running"
      ? {}
      : { terminalAt: state.terminalAt, terminalReason: state.terminalReason }),
  };
}

function familySnapshot(state: ExecutionFamilyStateV2): Record<string, unknown> {
  return {
    familySha256: state.familySha256,
    state: state._tag,
    totalActions: state.totalActions,
    children: state.manifest.children.map((contract) => ({
      childId: contract.childId,
      packageId: contract.packageId,
      state: state.children[contract.childId]!._tag,
    })),
  };
}

function childSnapshot(state: ExecutionChildStateV2): Record<string, unknown> {
  return {
    childId: state.contract.childId,
    packageId: state.contract.packageId,
    state: state._tag,
    counts: state.counts,
    currentCandidate: state.currentCandidate,
    milestones: state.milestones,
    evaluationVerdict: state.evaluationVerdict,
  };
}

function familyAuthoritySnapshot(
  authority: {
    readonly rootContractId: string;
    readonly rootContractSha256: string;
    readonly familySha256: string;
    readonly sourceSha256: string;
    readonly auditReceiptSha256: string;
    readonly userReceiptSha256: string;
    readonly registeredAt: string;
  },
): Record<string, unknown> {
  return { ...authority };
}

function emitFailure(io: EndstopCliIo, reason: string): number {
  io.writeStderr(`Foreman Endstop: ${reason}\n`);
  return ENDSTOP_EXIT_FAIL;
}

export function runEndstopCli(
  argv: readonly string[],
  io: EndstopCliIo,
  services: EndstopCliServices = {
    now: () => new Date().toISOString().replace(/\.\d{3}Z$/u, "Z"),
  },
): Effect.Effect<number> {
  const parsed = parseEndstopArgv(argv);
  if (parsed._tag === "Invalid") {
    io.writeStderr("Foreman Endstop: invalid arguments\n");
    return Effect.succeed(ENDSTOP_EXIT_CONFIG);
  }

  const layer = makeLiveEndstopLedgerLayer(parsed.stateRoot);
  const program = Effect.gen(function* () {
    const ledger = yield* EndstopLedger;
    if (parsed._tag === "Status") {
      return { _tag: "Root" as const, state: yield* ledger.status(parsed.contractId) };
    }
    if (parsed._tag === "FamilyStatus" || parsed._tag === "ChildStatus") {
      const status = yield* ledger.familyStatus({
        rootContractId: parsed.contractId,
        rootContractSha256: parsed.contractSha256,
        familySha256: parsed.familySha256,
      });
      if (parsed._tag === "ChildStatus") {
        const child = status.family.children[parsed.childId];
        if (child === undefined) {
          return yield* Effect.fail(new Error("unknown_child"));
        }
        return { _tag: "Child" as const, state: child };
      }
      return { _tag: "Family" as const, state: status.family };
    }
    if (parsed._tag === "RegisterFamilyAuthority") {
      const prepared = yield* Effect.try({
        try: () => {
          const family = prepareFamilyFiles({
            manifestFile: parsed.manifestFile,
            sourceFile: parsed.sourceFile,
            briefsDirectory: parsed.briefsDirectory,
            contractId: parsed.contractId,
            contractSha256: parsed.contractSha256,
          });
          const audit = readCanonicalFile(parsed.auditReceiptFile);
          const user = readCanonicalFile(parsed.userReceiptFile);
          if (
            family === null ||
            audit === null ||
            user === null ||
            !validFamilyAuditReceipt(
              audit.value,
              family.manifest,
              family.familySha256,
            ) ||
            !validFamilyUserReceipt(
              user.value,
              family.manifest,
              family.familySha256,
            )
          ) {
            throw new Error("invalid_family_authority");
          }
          publishFamilySet(parsed.stateRoot, family);
          return {
            family,
            auditReceiptSha256: sha256Hex(audit.bytes),
            userReceiptSha256: sha256Hex(user.bytes),
          };
        },
        catch: () => new Error("invalid_family_authority"),
      });
      const registeredAt = services.now();
      if (!isUtcSecondTimestamp(registeredAt)) {
        return yield* Effect.fail(new Error("invalid_clock"));
      }
      const authority = yield* ledger.registerFamilyAuthority({
        rootContractId: parsed.contractId,
        rootContractSha256: parsed.contractSha256,
        manifest: prepared.family.manifest,
        familySha256: prepared.family.familySha256,
        sourceSha256: sha256Hex(prepared.family.sourceBytes),
        auditReceiptSha256: prepared.auditReceiptSha256,
        userReceiptSha256: prepared.userReceiptSha256,
        registeredAt,
      });
      return { _tag: "FamilyAuthority" as const, state: authority };
    }
    if (parsed._tag === "ActivateFamily") {
      const prepared = yield* Effect.try({
        try: () => {
          const value = loadPublishedFamilySet(
            parsed.stateRoot,
            parsed.manifestFile,
            parsed.contractId,
            parsed.contractSha256,
          );
          if (value === null) throw new Error("invalid_family_authority");
          return value;
        },
        catch: () => new Error("invalid_family_authority"),
      });
      const authority = yield* ledger.familyAuthorityStatus({
        rootContractId: parsed.contractId,
        rootContractSha256: parsed.contractSha256,
        familySha256: prepared.familySha256,
      });
      if (authority.sourceSha256 !== sha256Hex(prepared.sourceBytes)) {
        return yield* Effect.fail(new Error("invalid_family_authority"));
      }
      const activatedAt = services.now();
      if (!isUtcSecondTimestamp(activatedAt)) {
        return yield* Effect.fail(new Error("invalid_clock"));
      }
      const status = yield* ledger.activateFamily({
        rootContractId: parsed.contractId,
        rootContractSha256: parsed.contractSha256,
        familySha256: prepared.familySha256,
        sourceSha256: authority.sourceSha256,
        auditReceiptSha256: authority.auditReceiptSha256,
        userReceiptSha256: authority.userReceiptSha256,
        activatedAt,
      });
      return { _tag: "Family" as const, state: status.family };
    }

    if (parsed._tag !== "Create") {
      return yield* Effect.fail(new Error("invalid_child_operation"));
    }

    const text = yield* Effect.try({
      try: () => readFileSync(parsed.contractFile, "utf8"),
      catch: () => new Error("contract_read_failed"),
    });
    const raw = parseJsonRejectDuplicateKeys(text);
    if (isCoreFailure(raw)) {
      return yield* Effect.fail(new Error("invalid_contract"));
    }
    const contract = decodeExecutionContractV1(raw);
    if (isExecutionContractFailure(contract)) {
      return yield* Effect.fail(new Error("invalid_contract"));
    }
    return { _tag: "Root" as const, state: yield* ledger.create(contract) };
  }).pipe(Effect.provide(layer));

  return program.pipe(
    Effect.match({
      onFailure: (error) => {
        if (isEndstopLedgerFailure(error)) return emitFailure(io, error.reason);
        const reason = error instanceof Error && [
          "invalid_contract",
          "invalid_family_authority",
          "invalid_clock",
          "unknown_child",
          "invalid_child_operation",
        ].includes(error.message)
          ? error.message
          : "contract_read_failed";
        return emitFailure(io, reason);
      },
      onSuccess: (result) => {
        const snapshot = result._tag === "Root"
          ? publicSnapshot(result.state)
          : result._tag === "Family"
            ? familySnapshot(result.state)
            : result._tag === "Child"
              ? childSnapshot(result.state)
              : familyAuthoritySnapshot(result.state);
        io.writeStdout(canonicalize(snapshot) + "\n");
        return ENDSTOP_EXIT_OK;
      },
    }),
  );
}
