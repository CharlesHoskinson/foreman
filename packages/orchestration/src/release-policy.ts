import {
  canonicalize,
  isCommitSha40,
  isCoreFailure,
  isSha256Hex,
  parseJsonRejectDuplicateKeys,
  sha256Hex,
} from "@foreman/core";
import { decodeRunId } from "@foreman/event-log";
import {
  decodeReleaseAuthorityFileV1,
  evaluateReleaseAdmissionV1,
  liveReleaseAdmissionCliServices,
  type RegisteredReleaseAuthorityV1,
  type ReleaseActionV1,
  type ReleaseAdmissionCliServices,
  type ReleaseAdmissionGitAuthorityV1,
  type ReleaseCandidateIdentityV1,
  type ReleaseCoveragePhaseV1,
  type ReleaseCoverageResultV1,
} from "@foreman/policy";
import { isAbsolute } from "node:path";
import { Effect } from "effect";
import {
  liveReleaseCoverageCliServices,
  runReleaseCoverageCli,
} from "./release-coverage-cli.js";
import { EndstopLedger, makeLiveEndstopLedgerLayer } from "./execution-ledger.js";

const ONE_MIB = 1_048_576;
const ACTIONS: readonly ReleaseActionV1[] = [
  "implement",
  "verify",
  "audit",
  "correct",
  "council",
  "provider_retry",
  "resume",
  "integrate",
  "publish",
  "evaluate",
];

export const RELEASE_POLICY_USAGE =
  "release-policy: invalid invocation\n";

export type ReleasePolicyBlockV1 = {
  readonly stateRoot: string;
  readonly contractId: string;
  readonly contractSha256: string;
  readonly familySha256: string;
  readonly childId: string;
  readonly action: ReleaseActionV1;
  readonly candidateSha256: string;
  readonly program: "v040";
  readonly phase: "bootstrap" | "lane" | "release";
  readonly owner: string;
  readonly repository: string;
  readonly candidateCommit: string;
  readonly register: string;
  readonly evidence: string;
};

export type ParsedReleasePolicyArgv =
  | { readonly _tag: "Check"; readonly block: ReleasePolicyBlockV1 }
  | { readonly _tag: "Invalid" };

export type ReleasePolicyFamilyViewV1 = {
  readonly packageId: string;
  readonly currentCandidate: ReleaseCandidateIdentityV1 | null;
  readonly registrations: readonly RegisteredReleaseAuthorityV1[];
};

export type ReleasePolicyServices = {
  readonly checkCoverage: (
    block: ReleasePolicyBlockV1,
  ) => Effect.Effect<ReleaseCoverageResultV1, unknown>;
  readonly readEvidence: ReleaseAdmissionCliServices["readEvidence"];
  readonly loadGitAuthority: ReleaseAdmissionCliServices["loadGitAuthority"];
  readonly resolveFamily: (input: {
    readonly stateRoot: string;
    readonly contractId: string;
    readonly contractSha256: string;
    readonly familySha256: string;
    readonly childId: string;
  }) => Effect.Effect<ReleasePolicyFamilyViewV1, unknown>;
};

export type ReleasePolicyCliIo = {
  readonly writeStdout: (text: string) => void;
  readonly writeStderr: (text: string) => void;
};

function stripProcessArgv(argv: readonly string[]): readonly string[] {
  if (argv[0] === "check") return argv;
  return argv.slice(2);
}

function validId(value: unknown): value is string {
  return typeof value === "string" && typeof decodeRunId(value) === "string";
}

export function parseReleasePolicyArgv(
  argv: readonly string[],
): ParsedReleasePolicyArgv {
  const args = stripProcessArgv(argv);
  if (
    args.length !== 29 ||
    args[0] !== "check" ||
    args[1] !== "--endstop-state-root" ||
    args[3] !== "--endstop-contract-id" ||
    args[5] !== "--endstop-contract-sha" ||
    args[7] !== "--endstop-family-sha" ||
    args[9] !== "--endstop-child-id" ||
    args[11] !== "--endstop-action" ||
    args[13] !== "--endstop-candidate-sha" ||
    args[15] !== "--release-program" ||
    args[17] !== "--release-phase" ||
    args[19] !== "--release-owner" ||
    args[21] !== "--release-repo" ||
    args[23] !== "--release-candidate-commit" ||
    args[25] !== "--release-register" ||
    args[27] !== "--release-evidence"
  ) {
    return { _tag: "Invalid" };
  }
  const [
    stateRoot,
    contractId,
    contractSha256,
    familySha256,
    childId,
    action,
    candidateSha256,
    program,
    phase,
    owner,
    repository,
    candidateCommit,
    register,
    evidence,
  ] = [
    args[2], args[4], args[6], args[8], args[10], args[12], args[14],
    args[16], args[18], args[20], args[22], args[24], args[26], args[28],
  ];
  if (
    typeof stateRoot !== "string" || !isAbsolute(stateRoot) ||
    !validId(contractId) ||
    typeof contractSha256 !== "string" || !isSha256Hex(contractSha256) ||
    typeof familySha256 !== "string" || !isSha256Hex(familySha256) ||
    !validId(childId) ||
    typeof action !== "string" || !ACTIONS.includes(action as ReleaseActionV1) ||
    typeof candidateSha256 !== "string" || !isSha256Hex(candidateSha256) ||
    program !== "v040" ||
    (phase !== "bootstrap" && phase !== "lane" && phase !== "release") ||
    !validId(owner) ||
    typeof repository !== "string" || !isAbsolute(repository) ||
    typeof candidateCommit !== "string" || !isCommitSha40(candidateCommit) ||
    typeof register !== "string" || !isAbsolute(register) ||
    typeof evidence !== "string" || !isAbsolute(evidence) ||
    candidateSha256 !== sha256Hex(candidateCommit)
  ) {
    return { _tag: "Invalid" };
  }
  return {
    _tag: "Check",
    block: {
      stateRoot,
      contractId,
      contractSha256,
      familySha256,
      childId,
      action: action as ReleaseActionV1,
      candidateSha256,
      program,
      phase,
      owner,
      repository,
      candidateCommit,
      register,
      evidence,
    },
  };
}

export function releasePolicyBlockArgv(
  block: ReleasePolicyBlockV1,
): readonly string[] {
  return [
    "--endstop-state-root", block.stateRoot,
    "--endstop-contract-id", block.contractId,
    "--endstop-contract-sha", block.contractSha256,
    "--endstop-family-sha", block.familySha256,
    "--endstop-child-id", block.childId,
    "--endstop-action", block.action,
    "--endstop-candidate-sha", block.candidateSha256,
    "--release-program", block.program,
    "--release-phase", block.phase,
    "--release-owner", block.owner,
    "--release-repo", block.repository,
    "--release-candidate-commit", block.candidateCommit,
    "--release-register", block.register,
    "--release-evidence", block.evidence,
  ];
}

function phaseForCoverage(block: ReleasePolicyBlockV1): ReleaseCoveragePhaseV1 {
  if (block.phase === "release") return { _tag: "Release" };
  if (block.phase === "bootstrap") {
    return { _tag: "Bootstrap", owner: "openspec-superpowers-convergence" };
  }
  return { _tag: "Lane", owner: block.owner };
}

function sameCandidate(
  left: ReleaseCandidateIdentityV1 | null,
  right: ReleaseCandidateIdentityV1,
): boolean {
  return left !== null &&
    left.commit === right.commit &&
    left.tree === right.tree &&
    left.candidateSha256 === right.candidateSha256;
}

function safeWrite(write: (text: string) => void, text: string): void {
  try {
    write(text);
  } catch {
    // Public output failures do not expose dependency details.
  }
}

function emit(
  io: ReleasePolicyCliIo,
  result: { readonly schemaVersion: 1; readonly _tag: string; readonly reason?: string },
): number {
  safeWrite(io.writeStdout, `${canonicalize(result)}\n`);
  return result._tag === "Admitted" ? 0 : 1;
}

function refused(reason: string) {
  return { schemaVersion: 1 as const, _tag: "Refused" as const, reason };
}

export function runReleasePolicyCli(
  argv: readonly string[],
  io: ReleasePolicyCliIo,
  services: ReleasePolicyServices,
): Effect.Effect<number, never> {
  const program = Effect.gen(function* () {
    const parsed = parseReleasePolicyArgv(argv);
    if (parsed._tag === "Invalid") {
      safeWrite(io.writeStderr, RELEASE_POLICY_USAGE);
      return 64;
    }
    const block = parsed.block;
    void phaseForCoverage(block);
    const coverage = yield* services.checkCoverage(block);
    if (coverage._tag !== "Valid") return emit(io, refused(coverage.reason));

    const evidenceBytes = yield* services.readEvidence({
      path: block.evidence,
      maxBytes: ONE_MIB,
    });
    const decoded = decodeReleaseAuthorityFileV1(evidenceBytes);
    const firstReceipt = decoded._tag === "Valid" &&
        decoded.value.schema === "foreman.release-evidence-bundle.v1"
      ? decoded.value.receipts[0]
      : undefined;
    if (
      decoded._tag !== "Valid" ||
      decoded.value.schema !== "foreman.release-evidence-bundle.v1" ||
      firstReceipt?.schema !== "foreman.design-approval.v1"
    ) {
      return emit(io, refused("invalid_evidence"));
    }
    const bundle = decoded.value;
    const design = firstReceipt;
    if (
      bundle.rootContractId !== block.contractId ||
      bundle.rootContractSha256 !== block.contractSha256 ||
      bundle.familySha256 !== block.familySha256 ||
      bundle.childId !== block.childId
    ) {
      return emit(io, refused("registration_mismatch"));
    }
    const git: ReleaseAdmissionGitAuthorityV1 = yield* services.loadGitAuthority({
      repository: block.repository,
      candidateCommit: block.candidateCommit,
      designCommit: design.designCommit,
      packageId: block.owner,
      maxBlobBytes: ONE_MIB,
      maxSpecFiles: 256,
      maxRetainedBytes: 16 * ONE_MIB,
    });
    if (
      git.candidate.commit !== block.candidateCommit ||
      git.candidate.candidateSha256 !== block.candidateSha256 ||
      git.designTree !== design.designTree ||
      !git.designLineageValid
    ) {
      return emit(io, refused("git_resolution_failure"));
    }
    const family = yield* services.resolveFamily({
      stateRoot: block.stateRoot,
      contractId: block.contractId,
      contractSha256: block.contractSha256,
      familySha256: block.familySha256,
      childId: block.childId,
    });
    if (family.packageId !== block.owner) {
      return emit(io, refused("wrong_package"));
    }
    if (
      family.currentCandidate === null
        ? block.action !== "implement" ||
          git.candidate.commit !== design.designCommit ||
          git.candidate.tree !== design.designTree
        : !sameCandidate(family.currentCandidate, git.candidate)
    ) {
      return emit(io, refused("wrong_candidate"));
    }
    const registered = family.registrations.find((item) =>
      item.rootContractId === block.contractId &&
      item.rootContractSha256 === block.contractSha256 &&
      item.familySha256 === block.familySha256 &&
      item.childId === block.childId &&
      item.action === block.action &&
      item.candidate.candidateSha256 === block.candidateSha256 &&
      item.bundleSha256 === decoded.sha256
    ) ?? null;
    const result = evaluateReleaseAdmissionV1({
      action: block.action,
      packageId: block.owner,
      candidate: git.candidate,
      approvedOpenSpecBytes: git.approvedOpenSpecBytes,
      taskPlanBytes: git.taskPlanBytes,
      evidenceBytes,
      registered,
    });
    return emit(io, result);
  });
  return program.pipe(
    Effect.catchAllCause(() =>
      Effect.sync(() => emit(io, refused("dependency_failure"))),
    ),
  );
}

function coverageArgv(block: ReleasePolicyBlockV1): readonly string[] {
  if (block.phase === "bootstrap") {
    return [
      "check", "--program", "v040", "--phase", "bootstrap",
      "--owner", block.owner, "--register", block.register,
    ];
  }
  if (block.phase === "lane") {
    return [
      "check", "--program", "v040", "--phase", "lane",
      "--owner", block.owner, "--repo", block.repository,
      "--state-root", block.stateRoot, "--contract-id", block.contractId,
      "--contract-sha", block.contractSha256, "--family-sha", block.familySha256,
      "--register", block.register,
    ];
  }
  return [
    "check", "--program", "v040", "--phase", "release",
    "--repo", block.repository, "--state-root", block.stateRoot,
    "--contract-id", block.contractId, "--contract-sha", block.contractSha256,
    "--family-sha", block.familySha256, "--register", block.register,
  ];
}

function decodeCoverageOutput(text: string): ReleaseCoverageResultV1 | null {
  if (!text.endsWith("\n") || text.endsWith("\r\n")) return null;
  const body = text.slice(0, -1);
  const parsed = parseJsonRejectDuplicateKeys(body);
  if (
    isCoreFailure(parsed) ||
    canonicalize(parsed) !== body ||
    typeof parsed !== "object" ||
    parsed === null
  ) {
    return null;
  }
  const value = parsed as Record<string, unknown>;
  if (
    value.schemaVersion !== 1 ||
    (value._tag !== "Valid" && value._tag !== "Invalid")
  ) {
    return null;
  }
  return JSON.parse(body) as ReleaseCoverageResultV1;
}

export const liveReleasePolicyServices: ReleasePolicyServices = {
  checkCoverage: (block) =>
    Effect.gen(function* () {
      let stdout = "";
      let stderr = "";
      const code = yield* runReleaseCoverageCli(
        coverageArgv(block),
        {
          writeStdout: (text) => { stdout += text; },
          writeStderr: (text) => { stderr += text; },
        },
        liveReleaseCoverageCliServices,
      );
      const result = decodeCoverageOutput(stdout);
      if (
        result === null ||
        stderr !== "" ||
        (result._tag === "Valid" ? code !== 0 : code !== 1)
      ) {
        return yield* Effect.fail(new Error("coverage_failure"));
      }
      return result;
    }),
  readEvidence: (input) => liveReleaseAdmissionCliServices.readEvidence(input),
  loadGitAuthority: (input) =>
    liveReleaseAdmissionCliServices.loadGitAuthority(input),
  resolveFamily: (input) =>
    Effect.gen(function* () {
      const ledger = yield* EndstopLedger;
      const status = yield* ledger.familyStatus({
        rootContractId: input.contractId,
        rootContractSha256: input.contractSha256,
        familySha256: input.familySha256,
      });
      const child = status.family.children[input.childId];
      if (child === undefined) {
        return yield* Effect.fail(new Error("unknown_child"));
      }
      return {
        packageId: child.contract.packageId,
        currentCandidate: child.currentCandidate,
        registrations: status.childAuthorities.filter(
          (item) => item.childId === input.childId,
        ),
      };
    }).pipe(Effect.provide(makeLiveEndstopLedgerLayer(input.stateRoot))),
};
