import { canonicalize, isSha256Hex, sha256Hex } from "@foreman/core";
import { decodeRunId, isUtcSecondTimestamp } from "@foreman/event-log";
import {
  decodeReleaseAuthorityFileV1,
  type RegisteredReleaseAuthorityV1,
  type ReleaseActionV1,
  type ReleaseAuthorityReceiptV1,
  type ReleaseEvidenceBundleV1,
} from "@foreman/policy";
import { isAbsolute } from "node:path";
import { Effect } from "effect";
import {
  EndstopLedger,
  makeLiveEndstopLedgerLayer,
  type RegisteredEvaluationVerdictV1,
  type RegisteredReleaseOutcomeV1,
} from "./execution-ledger.js";
import { readFileBoundedSync } from "./queue-services.js";

export const RELEASE_AUTHORITY_EXIT_OK = 0;
export const RELEASE_AUTHORITY_EXIT_FAIL = 1;
export const RELEASE_AUTHORITY_EXIT_CONFIG = 2;

const ONE_MIB = 1024 * 1024;
const encoder = new TextEncoder();
const actions: readonly ReleaseActionV1[] = [
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

export type ReleaseAuthorityCliIo = {
  readonly writeStdout: (text: string) => void;
  readonly writeStderr: (text: string) => void;
};

export type ReleaseAuthorityCliServices = {
  readonly now: () => string;
  readonly registerChildAuthority: (
    stateRoot: string,
    registration: RegisteredReleaseAuthorityV1,
  ) => Effect.Effect<RegisteredReleaseAuthorityV1, unknown>;
  readonly registerChildOutcome: (
    stateRoot: string,
    registration: RegisteredReleaseOutcomeV1,
  ) => Effect.Effect<RegisteredReleaseOutcomeV1, unknown>;
  readonly registerEvaluationVerdict: (
    stateRoot: string,
    registration: RegisteredEvaluationVerdictV1,
  ) => Effect.Effect<RegisteredEvaluationVerdictV1, unknown>;
};

type CommonRegistrationArgs = {
  readonly stateRoot: string;
  readonly contractId: string;
  readonly contractSha256: string;
  readonly familySha256: string;
  readonly childId: string;
};

export type ParsedReleaseAuthorityArgv =
  | ({
      readonly _tag: "Register";
      readonly action: ReleaseActionV1;
      readonly evidenceFile: string;
    } & CommonRegistrationArgs)
  | ({
      readonly _tag: "RegisterOutcome";
      readonly outcomeFile: string;
    } & CommonRegistrationArgs)
  | ({
      readonly _tag: "RegisterEvaluationVerdict";
      readonly verdictFile: string;
    } & CommonRegistrationArgs)
  | { readonly _tag: "Invalid" };

function stripNodeArgv(argv: readonly string[]): readonly string[] {
  let args = [...argv];
  if (args[0]?.match(/(?:^|[\\/])node(?:\.exe)?$/u)) args = args.slice(1);
  if (args[0]?.includes("release-authority")) args = args.slice(1);
  return args;
}

function commonArgs(
  args: readonly string[],
  fileFlag: string,
): CommonRegistrationArgs & { readonly file: string } | null {
  if (
    args[1] !== "--state-root" ||
    args[3] !== "--contract-id" ||
    args[5] !== "--contract-sha" ||
    args[7] !== "--family-sha" ||
    args[9] !== "--child-id" ||
    args[11] !== fileFlag ||
    typeof args[2] !== "string" ||
    !isAbsolute(args[2]) ||
    typeof args[4] !== "string" ||
    typeof decodeRunId(args[4]) !== "string" ||
    typeof args[6] !== "string" ||
    !isSha256Hex(args[6]) ||
    typeof args[8] !== "string" ||
    !isSha256Hex(args[8]) ||
    typeof args[10] !== "string" ||
    typeof decodeRunId(args[10]) !== "string" ||
    typeof args[12] !== "string" ||
    !isAbsolute(args[12])
  ) {
    return null;
  }
  return {
    stateRoot: args[2],
    contractId: args[4],
    contractSha256: args[6],
    familySha256: args[8],
    childId: args[10],
    file: args[12],
  };
}

export function parseReleaseAuthorityArgv(
  argv: readonly string[],
): ParsedReleaseAuthorityArgv {
  const args = stripNodeArgv(argv);
  if (
    args.length === 15 &&
    args[0] === "register" &&
    args[11] === "--action" &&
    args[13] === "--evidence"
  ) {
    const common = commonArgs(
      [...args.slice(0, 11), "--evidence", args[14]!],
      "--evidence",
    );
    const action = args[12];
    if (
      common !== null &&
      typeof action === "string" &&
      actions.includes(action as ReleaseActionV1)
    ) {
      return {
        _tag: "Register",
        stateRoot: common.stateRoot,
        contractId: common.contractId,
        contractSha256: common.contractSha256,
        familySha256: common.familySha256,
        childId: common.childId,
        action: action as ReleaseActionV1,
        evidenceFile: common.file,
      };
    }
  }
  if (args.length === 13 && args[0] === "register-outcome") {
    const common = commonArgs(args, "--outcome");
    if (common !== null) {
      return {
        _tag: "RegisterOutcome",
        stateRoot: common.stateRoot,
        contractId: common.contractId,
        contractSha256: common.contractSha256,
        familySha256: common.familySha256,
        childId: common.childId,
        outcomeFile: common.file,
      };
    }
  }
  if (
    args.length === 13 &&
    args[0] === "register-evaluation-verdict"
  ) {
    const common = commonArgs(args, "--verdict");
    if (common !== null && common.childId === "v040-t8-evaluation") {
      return {
        _tag: "RegisterEvaluationVerdict",
        stateRoot: common.stateRoot,
        contractId: common.contractId,
        contractSha256: common.contractSha256,
        familySha256: common.familySha256,
        childId: "v040-t8-evaluation",
        verdictFile: common.file,
      };
    }
  }
  return { _tag: "Invalid" };
}

function decodeFile(path: string) {
  const read = readFileBoundedSync(path, ONE_MIB);
  if (read._tag !== "Ok") return null;
  return decodeReleaseAuthorityFileV1(encoder.encode(read.text));
}

function receiptSha256(receipt: ReleaseAuthorityReceiptV1): string {
  return sha256Hex(encoder.encode(`${canonicalize(receipt)}\n`));
}

function authorityRegistration(
  parsed: Extract<ParsedReleaseAuthorityArgv, { readonly _tag: "Register" }>,
  bundle: ReleaseEvidenceBundleV1,
  bundleSha256: string,
  registeredAt: string,
): RegisteredReleaseAuthorityV1 | null {
  if (
    bundle.rootContractId !== parsed.contractId ||
    bundle.rootContractSha256 !== parsed.contractSha256 ||
    bundle.familySha256 !== parsed.familySha256 ||
    bundle.childId !== parsed.childId ||
    bundle.action !== parsed.action
  ) {
    return null;
  }
  let effectiveAction = bundle.action;
  let priorReservationId: string | null = null;
  let originReservationId: string | null = null;
  if (bundle.action === "provider_retry" || bundle.action === "resume") {
    if (bundle.priorReservation === undefined) return null;
    effectiveAction = bundle.priorReservation.originalAction;
    priorReservationId = bundle.priorReservation.reservationId;
    originReservationId = bundle.priorReservation.originReservationId;
  }
  const evaluation = bundle.receipts.find(
    (receipt) => receipt.schema === "foreman.evaluation-authority.v1",
  );
  return {
    rootContractId: bundle.rootContractId,
    rootContractSha256: bundle.rootContractSha256,
    familySha256: bundle.familySha256,
    childId: bundle.childId,
    action: bundle.action,
    effectiveAction,
    priorReservationId,
    originReservationId,
    candidate: bundle.candidate,
    taskPlanSha256: bundle.taskPlanSha256,
    bundleSha256,
    receiptSchemas: bundle.receipts.map((receipt) => receipt.schema),
    receiptSha256s: bundle.receipts.map(receiptSha256),
    evaluationManifestSha256:
      evaluation?.schema === "foreman.evaluation-authority.v1"
        ? evaluation.manifestSha256
        : null,
    registeredAt,
  };
}

export function makeLiveReleaseAuthorityCliServices(): ReleaseAuthorityCliServices {
  return {
    now: () => new Date().toISOString().replace(/\.\d{3}Z$/u, "Z"),
    registerChildAuthority: (stateRoot, registration) =>
      Effect.gen(function* () {
        const ledger = yield* EndstopLedger;
        return yield* ledger.registerChildAuthority(registration);
      }).pipe(Effect.provide(makeLiveEndstopLedgerLayer(stateRoot))),
    registerChildOutcome: (stateRoot, registration) =>
      Effect.gen(function* () {
        const ledger = yield* EndstopLedger;
        return yield* ledger.registerChildOutcome(registration);
      }).pipe(Effect.provide(makeLiveEndstopLedgerLayer(stateRoot))),
    registerEvaluationVerdict: (stateRoot, registration) =>
      Effect.gen(function* () {
        const ledger = yield* EndstopLedger;
        yield* ledger.registerEvaluationVerdict(registration);
        return registration;
      }).pipe(Effect.provide(makeLiveEndstopLedgerLayer(stateRoot))),
  };
}

function fail(io: ReleaseAuthorityCliIo, reason: string): number {
  io.writeStderr(`Foreman Release Authority: ${reason}\n`);
  return RELEASE_AUTHORITY_EXIT_FAIL;
}

export function runReleaseAuthorityCli(
  argv: readonly string[],
  io: ReleaseAuthorityCliIo,
  services: ReleaseAuthorityCliServices = makeLiveReleaseAuthorityCliServices(),
): Effect.Effect<number, never> {
  const parsed = parseReleaseAuthorityArgv(argv);
  if (parsed._tag === "Invalid") {
    io.writeStderr("Foreman Release Authority: invalid arguments\n");
    return Effect.succeed(RELEASE_AUTHORITY_EXIT_CONFIG);
  }
  const registeredAt = services.now();
  if (!isUtcSecondTimestamp(registeredAt)) {
    return Effect.succeed(fail(io, "invalid clock"));
  }
  const decoded = decodeFile(
    parsed._tag === "Register"
      ? parsed.evidenceFile
      : parsed._tag === "RegisterOutcome"
        ? parsed.outcomeFile
        : parsed.verdictFile,
  );
  if (decoded === null || decoded._tag !== "Valid") {
    return Effect.succeed(fail(io, "invalid canonical authority"));
  }

  let program: Effect.Effect<unknown, unknown>;
  if (parsed._tag === "Register") {
    if (decoded.value.schema !== "foreman.release-evidence-bundle.v1") {
      return Effect.succeed(fail(io, "invalid evidence"));
    }
    const registration = authorityRegistration(
      parsed,
      decoded.value,
      decoded.sha256,
      registeredAt,
    );
    if (registration === null) {
      return Effect.succeed(fail(io, "authority mismatch"));
    }
    program = services.registerChildAuthority(parsed.stateRoot, registration);
  } else if (parsed._tag === "RegisterOutcome") {
    const outcome = decoded.value;
    if (
      outcome.schema !== "foreman.release-action-outcome.v1" &&
      outcome.schema !== "foreman.council-outcome.v1"
    ) {
      return Effect.succeed(fail(io, "invalid outcome"));
    }
    if (
      outcome.rootContractId !== parsed.contractId ||
      outcome.rootContractSha256 !== parsed.contractSha256 ||
      outcome.familySha256 !== parsed.familySha256 ||
      outcome.childId !== parsed.childId
    ) {
      return Effect.succeed(fail(io, "authority mismatch"));
    }
    const registration: RegisteredReleaseOutcomeV1 = {
      rootContractId: outcome.rootContractId,
      rootContractSha256: outcome.rootContractSha256,
      familySha256: outcome.familySha256,
      childId: outcome.childId,
      reservationId: outcome.reservationId,
      originReservationId: outcome.originReservationId,
      reservationAction: outcome.reservationAction,
      effectiveAction:
        outcome.schema === "foreman.council-outcome.v1"
          ? "council"
          : outcome.effectiveAction,
      candidateSha256: outcome.candidateSha256,
      outcomeSha256: decoded.sha256,
      outcomeSchema: outcome.schema,
      registeredAt,
    };
    program = services.registerChildOutcome(parsed.stateRoot, registration);
  } else {
    const verdict = decoded.value;
    if (
      verdict.schema !== "foreman.evaluation-verdict.v1" ||
      verdict.rootContractId !== parsed.contractId ||
      verdict.rootContractSha256 !== parsed.contractSha256 ||
      verdict.familySha256 !== parsed.familySha256 ||
      verdict.childId !== parsed.childId
    ) {
      return Effect.succeed(fail(io, "authority mismatch"));
    }
    const registration: RegisteredEvaluationVerdictV1 = {
      rootContractId: verdict.rootContractId,
      rootContractSha256: verdict.rootContractSha256,
      familySha256: verdict.familySha256,
      childId: verdict.childId,
      candidateSha256: verdict.candidateSha256,
      result: verdict.result,
      completedRuns: verdict.completedRuns,
      unavailableRuns: verdict.unavailableRuns,
      notRunRuns: verdict.notRunRuns,
      runSetSha256: verdict.runSetSha256,
      evaluationAuthorityReceiptSha256:
        verdict.evaluationAuthorityReceiptSha256,
      verdictSha256: decoded.sha256,
      registeredAt,
    };
    program = services.registerEvaluationVerdict(parsed.stateRoot, registration);
  }

  return program.pipe(
    Effect.match({
      onFailure: () => fail(io, "registration refused"),
      onSuccess: (value) => {
        io.writeStdout(`${canonicalize(value)}\n`);
        return RELEASE_AUTHORITY_EXIT_OK;
      },
    }),
  );
}
