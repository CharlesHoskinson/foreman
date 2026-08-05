import type {
  ArtifactId,
  CandidateId,
  ContentHash,
  ContractHash,
  GitCommitSha,
  ReviewArtifactDescriptorV1,
  Sha256Digest,
} from "@council/schema";
import { decodeStrictSync } from "@council/schema";
import type {
  SpecCorrectnessAdmissionInputV1,
  SpecCorrectnessIdentityV1,
} from "@council/schema/spec-correctness-admission";
import { SpecCorrectnessAdmissionResultV1 } from "@council/schema/spec-correctness-admission";
import type { SpecCorrectnessItemResultV1 } from "@council/schema/spec-correctness";
import { Effect, Exit, Layer } from "effect";
import { describe, expect, it } from "vitest";
import {
  ArtifactLimitExceeded,
  ArtifactMissing,
  ArtifactReader,
  sortJsonKeys,
  encodeUtf8,
  type ArtifactReaderService,
} from "../src/index.js";
import * as ApplicationRoot from "../src/index.js";
import {
  evaluateSpecCorrectnessAdmission,
  SPEC_CORRECTNESS_MAX_ARTIFACT_BYTES,
  SPEC_CORRECTNESS_MAX_ARTIFACT_COUNT,
  SPEC_CORRECTNESS_MAX_TOTAL_BYTES,
} from "../src/spec-correctness-admission.js";
import {
  SpecCorrectnessPrimitives,
  type SpecCorrectnessPrimitivesService,
} from "../src/spec-correctness-primitives.js";
import { sha256Hex, encodeUtf8Text } from "./test-helpers.js";

const asDigest = (hex: string): Sha256Digest => hex as Sha256Digest;
const asCommit = (hex: string): GitCommitSha => hex as GitCommitSha;
const asArtifactId = (hex: string): ArtifactId => `sha256:${hex}` as ArtifactId;
const asContent = (hex: string): ContentHash => `sha256:${hex}` as ContentHash;
const asContract = (hex: string): ContractHash =>
  `sha256:${hex}` as ContractHash;

const BASELINE_IDS: readonly string[] = [
  ...Array.from(
    { length: 37 },
    (_, index) => `CW-${String(index + 1).padStart(3, "0")}`,
  ),
  ...Array.from(
    { length: 7 },
    (_, index) => `RT-${String(index + 1).padStart(3, "0")}`,
  ),
];

const buildMatrix = (ids: readonly string[] = BASELINE_IDS): string => {
  const header =
    "| ID | Class | Target sprint | Mapped requirement or boundary | Acceptance evidence | Baseline status |\n|---|---|---|---|---|---|\n";
  const rows = ids
    .map(
      (id) =>
        `| \`${id}\` | carried_work | 0 | requirement | evidence | open |`,
    )
    .join("\n");
  return `${header}${rows}\n`;
};

const makeMapped = (itemId: string): SpecCorrectnessItemResultV1 => ({
  schemaVersion: 1,
  itemId,
  disposition: "mapped",
  sprint: "0",
  requirement: `requirement for ${itemId}`,
  acceptanceEvidence: `evidence for ${itemId}`,
  status: "open",
});

const makeDefect = (
  itemId: string,
  disposition: "omitted" | "contradiction" | "unevidenced_defer",
): SpecCorrectnessItemResultV1 => ({
  schemaVersion: 1,
  itemId,
  disposition,
  assessment: `assessment for ${itemId}`,
});

/**
 * Pure UTF-8 decoder for application tests. No TextDecoder host global —
 * architecture forbids Node/runtime globals in the application test layer.
 */
const pureDecodeUtf8 = (bytes: Uint8Array): string | null => {
  let index = 0;
  let out = "";
  while (index < bytes.length) {
    const byte = bytes[index];
    if (byte === undefined) {
      return null;
    }
    if (byte <= 0x7f) {
      out += String.fromCharCode(byte);
      index += 1;
      continue;
    }
    if (byte >= 0xc2 && byte <= 0xdf) {
      const next = bytes[index + 1];
      if (next === undefined || (next & 0xc0) !== 0x80) {
        return null;
      }
      const code = ((byte & 0x1f) << 6) | (next & 0x3f);
      out += String.fromCharCode(code);
      index += 2;
      continue;
    }
    if (byte >= 0xe0 && byte <= 0xef) {
      const next1 = bytes[index + 1];
      const next2 = bytes[index + 2];
      if (
        next1 === undefined ||
        next2 === undefined ||
        (next1 & 0xc0) !== 0x80 ||
        (next2 & 0xc0) !== 0x80
      ) {
        return null;
      }
      const code =
        ((byte & 0x0f) << 12) | ((next1 & 0x3f) << 6) | (next2 & 0x3f);
      if (code >= 0xd800 && code <= 0xdfff) {
        return null;
      }
      out += String.fromCharCode(code);
      index += 3;
      continue;
    }
    if (byte >= 0xf0 && byte <= 0xf4) {
      const next1 = bytes[index + 1];
      const next2 = bytes[index + 2];
      const next3 = bytes[index + 3];
      if (
        next1 === undefined ||
        next2 === undefined ||
        next3 === undefined ||
        (next1 & 0xc0) !== 0x80 ||
        (next2 & 0xc0) !== 0x80 ||
        (next3 & 0xc0) !== 0x80
      ) {
        return null;
      }
      const code =
        ((byte & 0x07) << 18) |
        ((next1 & 0x3f) << 12) |
        ((next2 & 0x3f) << 6) |
        (next3 & 0x3f);
      if (code > 0x10ffff) {
        return null;
      }
      const adjusted = code - 0x10000;
      out += String.fromCharCode(
        0xd800 + (adjusted >> 10),
        0xdc00 + (adjusted & 0x3ff),
      );
      index += 4;
      continue;
    }
    return null;
  }
  return out;
};

const purePrimitives: SpecCorrectnessPrimitivesService = {
  sha256: (bytes) => asDigest(sha256Hex(bytes)),
  decodeUtf8: pureDecodeUtf8,
};

const computeSpecSetDigest = (
  specs: readonly {
    readonly alias: string;
    readonly artifactId: string;
    readonly sha256: string;
    readonly byteLength: number;
  }[],
): Sha256Digest => {
  const sorted = [...specs].sort((left, right) => {
    if (left.alias < right.alias) return -1;
    if (left.alias > right.alias) return 1;
    return 0;
  });
  const records = sorted.map((item) => sortJsonKeys(item));
  const payload = `${JSON.stringify(records)}\n`;
  return asDigest(sha256Hex(encodeUtf8(payload)));
};

const headSha = asCommit("1".repeat(40));
const baseSha = asCommit("a".repeat(40));
const treeSha = "2".repeat(40);
const readyTokenHash = asContent("f".repeat(64));
const contractHash = asContract("0".repeat(64));
const promptHash = asContent("1".repeat(64));
const providerReceiptHash = asContent("2".repeat(64));
const schemaVariantHash = asContent("3".repeat(64));
const candidateId = "cand_01ARZ3NDEKTSV4RRFFQ69G5FAV" as CandidateId;
const reviewerId = "reviewer-a";

const matrixText = buildMatrix();
const matrixBytes = encodeUtf8Text(matrixText);
const matrixDigest = asDigest(sha256Hex(matrixBytes));
const matrixId = asArtifactId(matrixDigest);

const ledgerText = "# ledger\nline one\n";
const ledgerBytes = encodeUtf8Text(ledgerText);
const ledgerDigest = asDigest(sha256Hex(ledgerBytes));
const ledgerId = asArtifactId(ledgerDigest);

const specText = "# spec-a\nrequirement text\n";
const specBytes = encodeUtf8Text(specText);
const specDigest = asDigest(sha256Hex(specBytes));
const specId = asArtifactId(specDigest);

const specSetSha256 = computeSpecSetDigest([
  {
    alias: "spec-a",
    artifactId: specId,
    sha256: specDigest,
    byteLength: specBytes.byteLength,
  },
]);

const identity: SpecCorrectnessIdentityV1 = {
  schemaVersion: 1,
  candidateCommitSha: headSha,
  candidateTreeSha: treeSha as SpecCorrectnessIdentityV1["candidateTreeSha"],
  baseCommitSha: baseSha,
  diffSha256: asDigest("b".repeat(64)),
  ledgerSha256: ledgerDigest,
  coverageMatrixSha256: matrixDigest,
  specSetSha256,
  reviewerId,
  providerFamily: "xai",
  providerReceiptHash,
  readyTokenHash,
  contractHash,
  promptHash,
  responseSchemaVariantHash: schemaVariantHash,
};

const completedTerminal = {
  schemaVersion: 1 as const,
  modelTurnStarted: true,
  terminalRecordObserved: true,
  terminalState: "completed" as const,
  exitCode: 0,
  stopReason: "end_turn",
  pendingToolCalls: 0,
  failedToolCalls: 0,
  parserComplete: true,
  structuredOutputPresent: true,
  structuredOutputError: null,
  stdoutDigest: asDigest("8".repeat(64)),
  stderrDigest: asDigest("7".repeat(64)),
  errorMessage: null,
};

const expectedBundle = {
  schemaVersion: 1 as const,
  baseSha,
  headSha,
  diffSha256: identity.diffSha256,
};

const descriptor = (
  alias: string,
  bytes: Uint8Array,
  id: ArtifactId,
  digest: Sha256Digest,
): ReviewArtifactDescriptorV1 => ({
  schemaVersion: 1,
  alias,
  mediaType: "text/markdown",
  byteLength: bytes.byteLength,
  digest,
  artifactId: id,
});

const matrixArtifact = descriptor(
  "coverage-matrix",
  matrixBytes,
  matrixId,
  matrixDigest,
);
const ledgerArtifact = descriptor(
  "ledger",
  ledgerBytes,
  ledgerId,
  ledgerDigest,
);
const specArtifact = descriptor("spec-a", specBytes, specId, specDigest);

const acceptProviderResponse = {
  schemaVersion: 1 as const,
  outcome: "accept" as const,
  itemResults: BASELINE_IDS.map((id) => makeMapped(id)),
  inventedCompletions: [] as const,
  findings: [] as const,
  summary: "coverage complete",
};

const approvedFinalResponse = {
  schemaVersion: 1 as const,
  readyTokenHash,
  contractHash,
  promptHash,
  bundle: expectedBundle,
  reviewerId,
  candidateId,
  inspectedArtifactIds: [matrixId, ledgerId, specId] as const,
  advice: { kind: "approved" as const },
};

const baseInput = (
  overrides: Partial<SpecCorrectnessAdmissionInputV1> = {},
): SpecCorrectnessAdmissionInputV1 => ({
  schemaVersion: 1,
  reviewAttempt: {
    preflightStageFailed: false,
    terminal: completedTerminal,
    readyTokenCurrent: true,
    expectedReadyTokenHash: readyTokenHash,
    expectedContractHash: contractHash,
    expectedPromptHash: promptHash,
    expectedBundle,
    expectedReviewerId: reviewerId,
    expectedCandidateId: candidateId,
    expectedArtifactIds: [matrixId, ledgerId, specId],
    verifiedArtifactIds: [matrixId, ledgerId, specId],
    bundleVerified: true,
    designatedStructuredValid: true,
    declaredEvidenceNamespace: ["acceptance-criteria"],
    response: approvedFinalResponse,
  },
  expectedIdentity: identity,
  observedIdentity: identity,
  submission: {
    identity,
    response: acceptProviderResponse,
  },
  artifacts: [matrixArtifact, ledgerArtifact, specArtifact],
  roles: {
    coverageMatrixArtifactId: matrixId,
    ledgerArtifactId: ledgerId,
    specSetArtifactIds: [specId],
  },
  ...overrides,
});

const memoryReader = (
  store: ReadonlyMap<string, Uint8Array>,
): ArtifactReaderService => ({
  read: (request) => {
    const bytes = store.get(request.descriptor.artifactId);
    if (bytes === undefined) {
      return Effect.fail(
        new ArtifactMissing({
          stage: "artifact_read",
          reason: "missing",
          artifactId: request.descriptor.artifactId,
        }),
      );
    }
    if (bytes.byteLength > request.maxBytes) {
      return Effect.fail(
        new ArtifactLimitExceeded({
          stage: "artifact_limit",
          reason: "limit",
          artifactId: request.descriptor.artifactId,
          maxArtifactBytes: request.maxBytes,
          observedBytes: bytes.byteLength,
        }),
      );
    }
    return Effect.succeed(Uint8Array.from(bytes));
  },
});

const defaultStore = (): Map<string, Uint8Array> =>
  new Map([
    [matrixId, matrixBytes],
    [ledgerId, ledgerBytes],
    [specId, specBytes],
  ]);

const runAdmission = (
  input: SpecCorrectnessAdmissionInputV1,
  options: {
    readonly store?: Map<string, Uint8Array>;
    readonly primitives?: SpecCorrectnessPrimitivesService;
  } = {},
) => {
  const readerLayer = Layer.succeed(
    ArtifactReader,
    memoryReader(options.store ?? defaultStore()),
  );
  const primitivesLayer = Layer.succeed(
    SpecCorrectnessPrimitives,
    options.primitives ?? purePrimitives,
  );
  return Effect.runPromiseExit(
    evaluateSpecCorrectnessAdmission(input).pipe(
      Effect.provide(Layer.merge(readerLayer, primitivesLayer)),
    ),
  );
};

const expectRejected = async (
  input: SpecCorrectnessAdmissionInputV1,
  options?: Parameters<typeof runAdmission>[1],
) => {
  const exit = await runAdmission(input, options);
  expect(Exit.isSuccess(exit)).toBe(true);
  if (!Exit.isSuccess(exit)) return;
  const result = decodeStrictSync(SpecCorrectnessAdmissionResultV1, exit.value);
  expect(result._tag).toBe("Rejected");
  if (result._tag !== "Rejected") return;
  expect(result.candidateDisposition).toBe("changes_requested");
  expect(result.quorumEligible).toBe(false);
  expect(result.failure.reason.length).toBeGreaterThan(0);
  expect(JSON.stringify(result)).not.toMatch(/\/tmp|\/home|sk-/);
  return result;
};

describe("evaluateSpecCorrectnessAdmission", () => {
  it("returns CompletedApproved for clean exact 44-item approval", async () => {
    const exit = await runAdmission(baseInput());
    expect(Exit.isSuccess(exit)).toBe(true);
    if (!Exit.isSuccess(exit)) return;
    const result = decodeStrictSync(
      SpecCorrectnessAdmissionResultV1,
      exit.value,
    );
    expect(result._tag).toBe("CompletedApproved");
    if (result._tag !== "CompletedApproved") return;
    expect(result.quorumEligible).toBe(true);
    expect(result.candidateDisposition).toBe("approved");
    expect(result.evaluation.evaluation).toMatchObject({
      _tag: "Valid",
      outcome: "accept",
    });
    expect(result.classification.response.advice.kind).toBe("approved");
    expect(result.evaluation.identity).toEqual(identity);
  });

  it.each(["omitted", "contradiction", "unevidenced_defer"] as const)(
    "returns CompletedChangesRequested for disposition %s",
    async (disposition) => {
      const items = BASELINE_IDS.map((id, index) =>
        index === 0 ? makeDefect(id, disposition) : makeMapped(id),
      );
      const providerResponse = {
        schemaVersion: 1 as const,
        outcome: "changes_requested" as const,
        itemResults: items,
        inventedCompletions: [] as const,
        findings: [
          {
            location: "coverage-matrix.md",
            summary: "defect",
            nextAction: "repair",
          },
        ],
        summary: "incomplete",
      };
      const finalResponse = {
        schemaVersion: 1 as const,
        readyTokenHash,
        contractHash,
        promptHash,
        bundle: expectedBundle,
        reviewerId,
        candidateId,
        inspectedArtifactIds: [matrixId, ledgerId, specId] as const,
        advice: {
          kind: "changes_requested" as const,
          findings: [
            {
              artifactId: matrixId,
              location: "row",
              summary: "defect",
              nextAction: "repair",
            },
          ] as const,
        },
      };
      const exit = await runAdmission(
        baseInput({
          reviewAttempt: {
            ...baseInput().reviewAttempt,
            response: finalResponse,
          },
          submission: { identity, response: providerResponse },
        }),
      );
      expect(Exit.isSuccess(exit)).toBe(true);
      if (!Exit.isSuccess(exit)) return;
      const result = decodeStrictSync(
        SpecCorrectnessAdmissionResultV1,
        exit.value,
      );
      expect(result._tag).toBe("CompletedChangesRequested");
      if (result._tag !== "CompletedChangesRequested") return;
      expect(result.quorumEligible).toBe(true);
      expect(result.candidateDisposition).toBe("changes_requested");
    },
  );

  it("returns CompletedAbstention for named abstention and never quorum", async () => {
    const providerResponse = {
      schemaVersion: 1 as const,
      outcome: "abstain" as const,
      itemResults: BASELINE_IDS.map((id) => makeMapped(id)),
      inventedCompletions: [] as const,
      findings: [] as const,
      summary: "cannot decide",
      evidenceGaps: [
        {
          evidenceRef: "acceptance-criteria",
          unmetCondition: "missing proof",
        },
      ],
      nextAction: "supply evidence",
    };
    const finalResponse = {
      schemaVersion: 1 as const,
      readyTokenHash,
      contractHash,
      promptHash,
      bundle: expectedBundle,
      reviewerId,
      candidateId,
      inspectedArtifactIds: [matrixId, ledgerId, specId] as const,
      advice: {
        kind: "abstention" as const,
        abstention: {
          kind: "insufficient_evidence" as const,
          evidenceGaps: [
            {
              evidenceRef: "acceptance-criteria",
              unmetCondition: "missing proof",
            },
          ] as const,
          nextAction: "supply evidence",
        },
      },
    };
    const exit = await runAdmission(
      baseInput({
        reviewAttempt: {
          ...baseInput().reviewAttempt,
          response: finalResponse,
        },
        submission: { identity, response: providerResponse },
      }),
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    if (!Exit.isSuccess(exit)) return;
    const result = decodeStrictSync(
      SpecCorrectnessAdmissionResultV1,
      exit.value,
    );
    expect(result._tag).toBe("CompletedAbstention");
    if (result._tag !== "CompletedAbstention") return;
    expect(result.quorumEligible).toBe(false);
    expect(result.candidateDisposition).toBe("abstention");
  });

  it("rejects invalid provider response as infrastructure failure", async () => {
    const result = await expectRejected(
      baseInput({
        submission: { identity, response: { not: "valid" } },
      }),
    );
    expect(result?.evaluation).not.toBeNull();
  });

  it("returns public ResponseRejected (never infrastructure Rejected) for Fable approved-with-findings completed shape", async () => {
    // Exact completed Fable class: designated structured output is invalid
    // because an approved/accept response contains nonempty findings
    // (evaluator: declared_accept_with_findings). Classification must run
    // before any evaluator-Invalid short-circuit can return Rejected.
    const fableFindings = [
      {
        location:
          "components/council/packages/application/src/spec-correctness-admission.ts",
        summary:
          "approved response carries findings that invalidate the designated shape",
        nextAction: "reject as schema_invalid completed response",
      },
    ] as const;
    const exit = await runAdmission(
      baseInput({
        reviewAttempt: {
          ...baseInput().reviewAttempt,
          designatedStructuredValid: false,
          response: undefined,
        },
        submission: {
          identity,
          response: {
            ...acceptProviderResponse,
            findings: fableFindings,
          },
        },
      }),
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    if (!Exit.isSuccess(exit)) return;
    const result = decodeStrictSync(
      SpecCorrectnessAdmissionResultV1,
      exit.value,
    );
    expect(result._tag).toBe("ResponseRejected");
    expect(result._tag).not.toBe("Rejected");
    if (result._tag !== "ResponseRejected") return;
    expect(result.classification._tag).toBe("CompletedInvalidResponse");
    expect(result.classification.reason).toBe("schema_invalid");
    expect(result.evaluation).toBeNull();
    expect(result.quorumEligible).toBe(false);
    expect(result.candidateDisposition).toBe("changes_requested");
    expect(result).not.toHaveProperty("failure");
    expect(JSON.stringify(result)).not.toMatch(/\/tmp|\/home|sk-/);
  });

  it("returns ResponseRejected for completed schema-invalid designated output", async () => {
    const exit = await runAdmission(
      baseInput({
        reviewAttempt: {
          ...baseInput().reviewAttempt,
          designatedStructuredValid: false,
          response: undefined,
        },
      }),
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    if (!Exit.isSuccess(exit)) return;
    const result = decodeStrictSync(
      SpecCorrectnessAdmissionResultV1,
      exit.value,
    );
    expect(result._tag).toBe("ResponseRejected");
    if (result._tag !== "ResponseRejected") return;
    expect(result.classification._tag).toBe("CompletedInvalidResponse");
    expect(result.classification.reason).toBe("schema_invalid");
    expect(result.evaluation).toBeNull();
    expect(result.quorumEligible).toBe(false);
    expect(result.candidateDisposition).toBe("changes_requested");
    expect(result).not.toHaveProperty("failure");
    expect(JSON.stringify(result)).not.toMatch(/\/tmp|\/home|sk-/);
  });

  it("returns ResponseRejected for Grok insufficient_evidence with artifact-alias evidence refs", async () => {
    // Live Grok class: insufficient_evidence whose evidence references use
    // artifact aliases instead of bound namespace IDs → completed inadmissible
    // response (abstention_invalid), never abstention, verdict, or infrastructure.
    const exit = await runAdmission(
      baseInput({
        reviewAttempt: {
          ...baseInput().reviewAttempt,
          response: {
            ...approvedFinalResponse,
            advice: {
              kind: "abstention" as const,
              abstention: {
                kind: "insufficient_evidence" as const,
                evidenceGaps: [
                  {
                    evidenceRef: "coverage-matrix",
                    unmetCondition: "alias used instead of bound evidence id",
                  },
                  {
                    evidenceRef: "ledger",
                    unmetCondition: "alias used instead of bound evidence id",
                  },
                ] as const,
                nextAction: "rebind evidence gaps to declared namespace ids",
              },
            },
          },
        },
        submission: {
          identity,
          response: {
            schemaVersion: 1 as const,
            outcome: "abstain" as const,
            itemResults: BASELINE_IDS.map((id) => makeMapped(id)),
            inventedCompletions: [] as const,
            findings: [] as const,
            summary: "insufficient evidence",
            evidenceGaps: [
              {
                evidenceRef: "coverage-matrix",
                unmetCondition: "alias used instead of bound evidence id",
              },
            ],
            nextAction: "rebind evidence gaps to declared namespace ids",
          },
        },
      }),
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    if (!Exit.isSuccess(exit)) return;
    const result = decodeStrictSync(
      SpecCorrectnessAdmissionResultV1,
      exit.value,
    );
    expect(result._tag).toBe("ResponseRejected");
    expect(result._tag).not.toBe("Rejected");
    expect(result._tag).not.toBe("CompletedAbstention");
    if (result._tag !== "ResponseRejected") return;
    expect(result.classification._tag).toBe("CompletedInvalidResponse");
    expect(result.classification.reason).toBe("abstention_invalid");
    expect(result.evaluation).toBeNull();
    expect(result.quorumEligible).toBe(false);
    expect(result).not.toHaveProperty("failure");
  });

  it("returns ResponseRejected for findings that cite non-expected artifacts", async () => {
    const unrelated =
      `sha256:${"9".repeat(64)}` as SpecCorrectnessAdmissionInputV1["reviewAttempt"]["expectedArtifactIds"][number];
    const items = BASELINE_IDS.map((id, index) =>
      index === 0 ? makeDefect(id, "omitted") : makeMapped(id),
    );
    const exit = await runAdmission(
      baseInput({
        reviewAttempt: {
          ...baseInput().reviewAttempt,
          response: {
            ...approvedFinalResponse,
            advice: {
              kind: "changes_requested",
              findings: [
                {
                  artifactId: unrelated,
                  location: "file.ts:1",
                  summary: "defect",
                  nextAction: "fix it",
                },
              ],
            },
          },
        },
        submission: {
          identity,
          response: {
            schemaVersion: 1 as const,
            outcome: "changes_requested" as const,
            itemResults: items,
            inventedCompletions: [] as const,
            findings: [
              {
                location: "coverage",
                summary: "omission",
                nextAction: "map it",
              },
            ],
            summary: "needs work",
          },
        },
      }),
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    if (!Exit.isSuccess(exit)) return;
    const result = decodeStrictSync(
      SpecCorrectnessAdmissionResultV1,
      exit.value,
    );
    expect(result._tag).toBe("ResponseRejected");
    if (result._tag !== "ResponseRejected") return;
    expect(result.classification.reason).toBe("findings_invalid");
    expect(result.evaluation).toBeNull();
    expect(result.quorumEligible).toBe(false);
    expect(result).not.toHaveProperty("failure");
  });

  it("returns ResponseRejected for identity-mismatched completed response", async () => {
    // Drive identity_mismatch through final-review response binding only.
    // Admission identity cross-checks still pass (expected identity equals
    // review-attempt expected fields).
    const exit = await runAdmission(
      baseInput({
        reviewAttempt: {
          ...baseInput().reviewAttempt,
          response: {
            ...approvedFinalResponse,
            readyTokenHash: `sha256:${"1".repeat(64)}` as typeof readyTokenHash,
          },
        },
      }),
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    if (!Exit.isSuccess(exit)) return;
    const result = decodeStrictSync(
      SpecCorrectnessAdmissionResultV1,
      exit.value,
    );
    expect(result._tag).toBe("ResponseRejected");
    if (result._tag !== "ResponseRejected") return;
    expect(result.classification.reason).toBe("identity_mismatch");
    expect(result.evaluation).toBeNull();
    expect(result.candidateDisposition).toBe("changes_requested");
  });

  it("returns CompletedChangesRequested for invented completion", async () => {
    const lineText = "invented completion line\n";
    const lineBytes = encodeUtf8Text(lineText);
    // Place invention on the ledger first line range.
    const startByte = 0;
    const endByte = lineBytes.byteLength;
    // Use a ledger that contains that exact line as whole content.
    const inventionLedgerText = lineText;
    const inventionLedgerBytes = encodeUtf8Text(inventionLedgerText);
    const inventionLedgerDigest = asDigest(sha256Hex(inventionLedgerBytes));
    const inventionLedgerId = asArtifactId(inventionLedgerDigest);
    const inventionLedgerArtifact = descriptor(
      "ledger",
      inventionLedgerBytes,
      inventionLedgerId,
      inventionLedgerDigest,
    );
    const slice = inventionLedgerBytes.slice(startByte, endByte);
    const claimSha256 = asDigest(sha256Hex(slice));
    const prefix = encodeUtf8Text(
      `${inventionLedgerDigest}\u0000${String(startByte)}\u0000${String(endByte)}\u0000`,
    );
    const recordPayload = new Uint8Array(prefix.length + slice.length);
    recordPayload.set(prefix, 0);
    recordPayload.set(slice, prefix.length);
    const recordSha256 = asDigest(sha256Hex(recordPayload));
    const inventionSpecSet = computeSpecSetDigest([
      {
        alias: "spec-a",
        artifactId: specId,
        sha256: specDigest,
        byteLength: specBytes.byteLength,
      },
    ]);
    const inventionIdentity: SpecCorrectnessIdentityV1 = {
      ...identity,
      ledgerSha256: inventionLedgerDigest,
      specSetSha256: inventionSpecSet,
    };
    const providerResponse = {
      schemaVersion: 1 as const,
      outcome: "changes_requested" as const,
      itemResults: BASELINE_IDS.map((id) => makeMapped(id)),
      inventedCompletions: [
        {
          schemaVersion: 1 as const,
          artifactAlias: "ledger",
          artifactSha256: inventionLedgerDigest,
          startByte,
          endByte,
          claimSha256,
          recordSha256,
          summary: "invented line",
          correctiveAction: "delete it",
        },
      ],
      findings: [
        {
          location: "ledger",
          summary: "invented completion",
          nextAction: "remove",
        },
      ],
      summary: "invention found",
    };
    const finalResponse = {
      schemaVersion: 1 as const,
      readyTokenHash,
      contractHash,
      promptHash,
      bundle: expectedBundle,
      reviewerId,
      candidateId,
      inspectedArtifactIds: [matrixId, inventionLedgerId, specId] as const,
      advice: {
        kind: "changes_requested" as const,
        findings: [
          {
            artifactId: inventionLedgerId,
            location: "line 1",
            summary: "invented",
            nextAction: "delete",
          },
        ] as const,
      },
    };
    const exit = await runAdmission(
      baseInput({
        expectedIdentity: inventionIdentity,
        observedIdentity: inventionIdentity,
        submission: {
          identity: inventionIdentity,
          response: providerResponse,
        },
        artifacts: [matrixArtifact, inventionLedgerArtifact, specArtifact],
        roles: {
          coverageMatrixArtifactId: matrixId,
          ledgerArtifactId: inventionLedgerId,
          specSetArtifactIds: [specId],
        },
        reviewAttempt: {
          ...baseInput().reviewAttempt,
          expectedArtifactIds: [matrixId, inventionLedgerId, specId],
          verifiedArtifactIds: [matrixId, inventionLedgerId, specId],
          response: finalResponse,
        },
      }),
      {
        store: new Map([
          [matrixId, matrixBytes],
          [inventionLedgerId, inventionLedgerBytes],
          [specId, specBytes],
        ]),
      },
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    if (!Exit.isSuccess(exit)) return;
    const result = decodeStrictSync(
      SpecCorrectnessAdmissionResultV1,
      exit.value,
    );
    expect(result._tag).toBe("CompletedChangesRequested");
  });

  it("rejects modified spec-set digest against identity", async () => {
    await expectRejected(
      baseInput({
        expectedIdentity: {
          ...identity,
          specSetSha256: asDigest("9".repeat(64)),
        },
        observedIdentity: {
          ...identity,
          specSetSha256: asDigest("9".repeat(64)),
        },
        submission: {
          identity: {
            ...identity,
            specSetSha256: asDigest("9".repeat(64)),
          },
          response: acceptProviderResponse,
        },
      }),
    );
  });

  it("rejects approved final advice when evaluation is changes", async () => {
    const items = BASELINE_IDS.map((id, index) =>
      index === 0 ? makeDefect(id, "omitted") : makeMapped(id),
    );
    await expectRejected(
      baseInput({
        submission: {
          identity,
          response: {
            schemaVersion: 1,
            outcome: "changes_requested",
            itemResults: items,
            inventedCompletions: [],
            findings: [
              {
                location: "x",
                summary: "y",
                nextAction: "z",
              },
            ],
            summary: "incomplete",
          },
        },
      }),
    );
  });

  it("rejects changes final advice when evaluation is accept", async () => {
    await expectRejected(
      baseInput({
        reviewAttempt: {
          ...baseInput().reviewAttempt,
          response: {
            ...approvedFinalResponse,
            advice: {
              kind: "changes_requested",
              findings: [
                {
                  artifactId: matrixId,
                  location: "x",
                  summary: "y",
                  nextAction: "z",
                },
              ],
            },
          },
        },
      }),
    );
  });

  it("rejects abstain final advice when evaluation is accept", async () => {
    await expectRejected(
      baseInput({
        reviewAttempt: {
          ...baseInput().reviewAttempt,
          response: {
            ...approvedFinalResponse,
            advice: {
              kind: "abstention",
              abstention: {
                kind: "insufficient_evidence",
                evidenceGaps: [
                  {
                    evidenceRef: "acceptance-criteria",
                    unmetCondition: "x",
                  },
                ],
                nextAction: "act",
              },
            },
          },
        },
      }),
    );
  });

  it("rejects every identity field mismatch across expected/observed/submission", async () => {
    const fields: (keyof SpecCorrectnessIdentityV1)[] = [
      "candidateCommitSha",
      "candidateTreeSha",
      "baseCommitSha",
      "diffSha256",
      "ledgerSha256",
      "coverageMatrixSha256",
      "specSetSha256",
      "reviewerId",
      "providerFamily",
      "providerReceiptHash",
      "readyTokenHash",
      "contractHash",
      "promptHash",
      "responseSchemaVariantHash",
    ];
    for (const field of fields) {
      const mutated = {
        ...identity,
        [field]:
          field === "providerFamily"
            ? "openai"
            : field === "reviewerId"
              ? "other-reviewer"
              : field === "candidateCommitSha" ||
                  field === "baseCommitSha" ||
                  field === "candidateTreeSha"
                ? "9".repeat(40)
                : field.endsWith("Hash") || field.includes("Hash")
                  ? asContent("9".repeat(64))
                  : asDigest("9".repeat(64)),
      } as SpecCorrectnessIdentityV1;
      // Mismatch observed against expected for every field.
      await expectRejected(
        baseInput({
          observedIdentity: mutated,
          submission: { identity, response: acceptProviderResponse },
        }),
      );
      // Mismatch submission against expected for every field.
      await expectRejected(
        baseInput({
          observedIdentity: identity,
          submission: { identity: mutated, response: acceptProviderResponse },
        }),
      );
    }
  });

  it("rejects candidate/bundle cross-binding mismatch", async () => {
    await expectRejected(
      baseInput({
        reviewAttempt: {
          ...baseInput().reviewAttempt,
          expectedBundle: {
            ...expectedBundle,
            headSha: asCommit("9".repeat(40)),
          },
        },
      }),
    );
    await expectRejected(
      baseInput({
        reviewAttempt: {
          ...baseInput().reviewAttempt,
          expectedReviewerId: "other",
        },
      }),
    );
  });

  it("rejects modified matrix, ledger, and descriptor digest or length", async () => {
    const store = defaultStore();
    store.set(matrixId, encodeUtf8Text(`${matrixText}\nextra\n`));
    await expectRejected(baseInput(), { store });

    const wrongLedger = encodeUtf8Text("# wrong ledger\n");
    store.set(matrixId, matrixBytes);
    store.set(ledgerId, wrongLedger);
    await expectRejected(baseInput(), { store });

    await expectRejected(
      baseInput({
        artifacts: [
          { ...matrixArtifact, digest: asDigest("9".repeat(64)) },
          ledgerArtifact,
          specArtifact,
        ],
      }),
    );

    await expectRejected(
      baseInput({
        artifacts: [
          { ...matrixArtifact, byteLength: matrixBytes.byteLength + 1 },
          ledgerArtifact,
          specArtifact,
        ],
      }),
    );
  });

  it("rejects missing artifact, invalid UTF-8, primitive throw, and primitive mutation", async () => {
    const store = defaultStore();
    store.delete(specId);
    await expectRejected(baseInput(), { store });

    await expectRejected(baseInput(), {
      primitives: {
        sha256: purePrimitives.sha256,
        decodeUtf8: () => null,
      },
    });

    await expectRejected(baseInput(), {
      primitives: {
        sha256: () => {
          throw new Error("digest boom /tmp/secret");
        },
        decodeUtf8: purePrimitives.decodeUtf8,
      },
    });

    // Hostile mutation of the input buffer must not crash admission open.
    await expectRejected(baseInput(), {
      primitives: {
        sha256: (bytes) => {
          if (bytes.byteLength > 0) {
            bytes[0] = (bytes[0] ?? 0) ^ 0xff;
          }
          return purePrimitives.sha256(bytes);
        },
        decodeUtf8: purePrimitives.decodeUtf8,
      },
    });
  });

  it("rejects unrelated review-attempt artifact IDs (cold-audit oracle)", async () => {
    // Replace all three review-attempt artifact lists with unrelated valid
    // artifact IDs. Keep admission descriptors and roles unchanged.
    const unrelatedA = asArtifactId("7".repeat(64));
    const unrelatedB = asArtifactId("8".repeat(64));
    const unrelatedC = asArtifactId("9".repeat(64));
    const result = await expectRejected(
      baseInput({
        reviewAttempt: {
          ...baseInput().reviewAttempt,
          expectedArtifactIds: [unrelatedA, unrelatedB, unrelatedC],
          verifiedArtifactIds: [unrelatedA, unrelatedB, unrelatedC],
          response: {
            ...approvedFinalResponse,
            inspectedArtifactIds: [unrelatedA, unrelatedB, unrelatedC],
          },
        },
      }),
    );
    expect(result?._tag).toBe("Rejected");
    expect(JSON.stringify(result)).not.toMatch(/CompletedApproved/);
  });

  it("rejects invalid UTF-8 ledger and specification artifacts before evaluation", async () => {
    // Ledger is only byte 0x80 — digest and descriptor stay consistent.
    const badLedgerBytes = new Uint8Array([0x80]);
    const badLedgerDigest = asDigest(sha256Hex(badLedgerBytes));
    const badLedgerId = asArtifactId(badLedgerDigest);
    const badLedgerArtifact = descriptor(
      "ledger",
      badLedgerBytes,
      badLedgerId,
      badLedgerDigest,
    );
    const badLedgerIdentity: SpecCorrectnessIdentityV1 = {
      ...identity,
      ledgerSha256: badLedgerDigest,
      specSetSha256,
    };
    await expectRejected(
      baseInput({
        expectedIdentity: badLedgerIdentity,
        observedIdentity: badLedgerIdentity,
        submission: {
          identity: badLedgerIdentity,
          response: acceptProviderResponse,
        },
        artifacts: [matrixArtifact, badLedgerArtifact, specArtifact],
        roles: {
          coverageMatrixArtifactId: matrixId,
          ledgerArtifactId: badLedgerId,
          specSetArtifactIds: [specId],
        },
        reviewAttempt: {
          ...baseInput().reviewAttempt,
          expectedArtifactIds: [matrixId, badLedgerId, specId],
          verifiedArtifactIds: [matrixId, badLedgerId, specId],
          response: {
            ...approvedFinalResponse,
            inspectedArtifactIds: [matrixId, badLedgerId, specId],
          },
        },
      }),
      {
        store: new Map([
          [matrixId, matrixBytes],
          [badLedgerId, badLedgerBytes],
          [specId, specBytes],
        ]),
      },
    );

    // Spec is only byte 0x80 — cold-audit CompletedApproved oracle.
    const badSpecBytes = new Uint8Array([0x80]);
    const badSpecDigest = asDigest(sha256Hex(badSpecBytes));
    const badSpecId = asArtifactId(badSpecDigest);
    const badSpecArtifact = descriptor(
      "spec-a",
      badSpecBytes,
      badSpecId,
      badSpecDigest,
    );
    const badSpecSet = computeSpecSetDigest([
      {
        alias: "spec-a",
        artifactId: badSpecId,
        sha256: badSpecDigest,
        byteLength: badSpecBytes.byteLength,
      },
    ]);
    const badSpecIdentity: SpecCorrectnessIdentityV1 = {
      ...identity,
      specSetSha256: badSpecSet,
    };
    const result = await expectRejected(
      baseInput({
        expectedIdentity: badSpecIdentity,
        observedIdentity: badSpecIdentity,
        submission: {
          identity: badSpecIdentity,
          response: acceptProviderResponse,
        },
        artifacts: [matrixArtifact, ledgerArtifact, badSpecArtifact],
        roles: {
          coverageMatrixArtifactId: matrixId,
          ledgerArtifactId: ledgerId,
          specSetArtifactIds: [badSpecId],
        },
        reviewAttempt: {
          ...baseInput().reviewAttempt,
          expectedArtifactIds: [matrixId, ledgerId, badSpecId],
          verifiedArtifactIds: [matrixId, ledgerId, badSpecId],
          response: {
            ...approvedFinalResponse,
            inspectedArtifactIds: [matrixId, ledgerId, badSpecId],
          },
        },
      }),
      {
        store: new Map([
          [matrixId, matrixBytes],
          [ledgerId, ledgerBytes],
          [badSpecId, badSpecBytes],
        ]),
      },
    );
    expect(result?._tag).toBe("Rejected");
    expect(JSON.stringify(result)).not.toContain("CompletedApproved");
  });

  it("rejects when the UTF-8 decoder mutates the accepted snapshot buffer", async () => {
    const originalSpecFirst = specBytes[0];
    await expectRejected(baseInput(), {
      primitives: {
        sha256: purePrimitives.sha256,
        decodeUtf8: (bytes) => {
          if (bytes.byteLength > 0) {
            bytes[0] = (bytes[0] ?? 0) ^ 0xff;
          }
          return purePrimitives.decodeUtf8(bytes);
        },
      },
    });
    // Host store snapshot is unchanged by a hostile decoder.
    expect(specBytes[0]).toBe(originalSpecFirst);
  });

  it("rejects when a hostile UTF-8 decoder substitutes valid text for invalid bytes", async () => {
    // Spec is only invalid byte 0x80. Hostile decoder returns substituted text
    // without mutating the input buffer — must still Reject via round-trip gate.
    const badSpecBytes = new Uint8Array([0x80]);
    const originalBytes = Uint8Array.from(badSpecBytes);
    const badSpecDigest = asDigest(sha256Hex(badSpecBytes));
    const badSpecId = asArtifactId(badSpecDigest);
    const badSpecArtifact = descriptor(
      "spec-a",
      badSpecBytes,
      badSpecId,
      badSpecDigest,
    );
    const badSpecSet = computeSpecSetDigest([
      {
        alias: "spec-a",
        artifactId: badSpecId,
        sha256: badSpecDigest,
        byteLength: badSpecBytes.byteLength,
      },
    ]);
    const badSpecIdentity: SpecCorrectnessIdentityV1 = {
      ...identity,
      specSetSha256: badSpecSet,
    };
    const result = await expectRejected(
      baseInput({
        expectedIdentity: badSpecIdentity,
        observedIdentity: badSpecIdentity,
        submission: {
          identity: badSpecIdentity,
          response: acceptProviderResponse,
        },
        artifacts: [matrixArtifact, ledgerArtifact, badSpecArtifact],
        roles: {
          coverageMatrixArtifactId: matrixId,
          ledgerArtifactId: ledgerId,
          specSetArtifactIds: [badSpecId],
        },
        reviewAttempt: {
          ...baseInput().reviewAttempt,
          expectedArtifactIds: [matrixId, ledgerId, badSpecId],
          verifiedArtifactIds: [matrixId, ledgerId, badSpecId],
          response: {
            ...approvedFinalResponse,
            inspectedArtifactIds: [matrixId, ledgerId, badSpecId],
          },
        },
      }),
      {
        store: new Map([
          [matrixId, matrixBytes],
          [ledgerId, ledgerBytes],
          [badSpecId, badSpecBytes],
        ]),
        primitives: {
          sha256: purePrimitives.sha256,
          decodeUtf8: (bytes) => {
            const honest = pureDecodeUtf8(bytes);
            if (honest !== null) {
              return honest;
            }
            // Catch fatal decode and substitute valid text without mutating.
            return "substituted-valid-text";
          },
        },
      },
    );
    expect(result?._tag).toBe("Rejected");
    expect(JSON.stringify(result)).not.toContain("CompletedApproved");
    // Source bytes must remain exactly the original invalid snapshot.
    expect(badSpecBytes.byteLength).toBe(originalBytes.byteLength);
    expect(
      badSpecBytes.every((byte, index) => byte === originalBytes[index]),
    ).toBe(true);
    expect(badSpecBytes[0]).toBe(0x80);
  });

  it("accepts a BOM-prefixed valid multibyte Unicode specification artifact through the UTF-8 round-trip gate", async () => {
    // A UTF-8 BOM plus multibyte BMP and astral content must re-encode exactly.
    const unicodeSpecText = "# spec-a\nrequirement 日本語 café 🚀 evidence\n";
    const unicodeSpecBytes = Uint8Array.of(
      0xef,
      0xbb,
      0xbf,
      ...encodeUtf8Text(unicodeSpecText),
    );
    // Sanity: fixture contains multi-byte sequences (not pure ASCII).
    expect(unicodeSpecBytes.byteLength).toBeGreaterThan(unicodeSpecText.length);
    const unicodeSpecDigest = asDigest(sha256Hex(unicodeSpecBytes));
    const unicodeSpecId = asArtifactId(unicodeSpecDigest);
    const unicodeSpecArtifact = descriptor(
      "spec-a",
      unicodeSpecBytes,
      unicodeSpecId,
      unicodeSpecDigest,
    );
    const unicodeSpecSet = computeSpecSetDigest([
      {
        alias: "spec-a",
        artifactId: unicodeSpecId,
        sha256: unicodeSpecDigest,
        byteLength: unicodeSpecBytes.byteLength,
      },
    ]);
    const unicodeIdentity: SpecCorrectnessIdentityV1 = {
      ...identity,
      specSetSha256: unicodeSpecSet,
    };
    const exit = await runAdmission(
      baseInput({
        expectedIdentity: unicodeIdentity,
        observedIdentity: unicodeIdentity,
        submission: {
          identity: unicodeIdentity,
          response: acceptProviderResponse,
        },
        artifacts: [matrixArtifact, ledgerArtifact, unicodeSpecArtifact],
        roles: {
          coverageMatrixArtifactId: matrixId,
          ledgerArtifactId: ledgerId,
          specSetArtifactIds: [unicodeSpecId],
        },
        reviewAttempt: {
          ...baseInput().reviewAttempt,
          expectedArtifactIds: [matrixId, ledgerId, unicodeSpecId],
          verifiedArtifactIds: [matrixId, ledgerId, unicodeSpecId],
          response: {
            ...approvedFinalResponse,
            inspectedArtifactIds: [matrixId, ledgerId, unicodeSpecId],
          },
        },
      }),
      {
        store: new Map([
          [matrixId, matrixBytes],
          [ledgerId, ledgerBytes],
          [unicodeSpecId, unicodeSpecBytes],
        ]),
      },
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    if (!Exit.isSuccess(exit)) return;
    const result = decodeStrictSync(
      SpecCorrectnessAdmissionResultV1,
      exit.value,
    );
    expect(result._tag).toBe("CompletedApproved");
    if (result._tag !== "CompletedApproved") return;
    expect(result.quorumEligible).toBe(true);
    expect(result.candidateDisposition).toBe("approved");
  });

  it("converts GitHub PAT-shaped final-review free text into static Rejected", async () => {
    const githubClassicPat = `ghp_${"A".repeat(36)}`;
    const finalResponse = {
      schemaVersion: 1 as const,
      readyTokenHash,
      contractHash,
      promptHash,
      bundle: expectedBundle,
      reviewerId,
      candidateId,
      inspectedArtifactIds: [matrixId, ledgerId, specId] as const,
      advice: {
        kind: "changes_requested" as const,
        findings: [
          {
            artifactId: matrixId,
            location: "row",
            summary: `defect token ${githubClassicPat}`,
            nextAction: "rotate",
          },
        ] as const,
      },
    };
    const items = BASELINE_IDS.map((id, index) =>
      index === 0 ? makeDefect(id, "omitted") : makeMapped(id),
    );
    const exit = await runAdmission(
      baseInput({
        reviewAttempt: {
          ...baseInput().reviewAttempt,
          response: finalResponse,
        },
        submission: {
          identity,
          response: {
            schemaVersion: 1,
            outcome: "changes_requested",
            itemResults: items,
            inventedCompletions: [],
            findings: [
              {
                location: "coverage-matrix.md",
                summary: "defect",
                nextAction: "repair",
              },
            ],
            summary: "incomplete",
          },
        },
      }),
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    if (!Exit.isSuccess(exit)) return;
    const result = decodeStrictSync(
      SpecCorrectnessAdmissionResultV1,
      exit.value,
    );
    expect(result._tag).toBe("Rejected");
    const text = JSON.stringify(result);
    expect(text).not.toContain("ghp_");
    expect(text).not.toContain(githubClassicPat);
    expect(result.candidateDisposition).toBe("changes_requested");
  });

  it("rejects artifact count above the closed bound", async () => {
    const extras: ReviewArtifactDescriptorV1[] = [];
    const store = defaultStore();
    const extraIds: ArtifactId[] = [];
    for (
      let index = 0;
      index < SPEC_CORRECTNESS_MAX_ARTIFACT_COUNT;
      index += 1
    ) {
      const uniqueBytes = encodeUtf8Text(`extra-${String(index)}-unique\n`);
      const uniqueDigest = asDigest(sha256Hex(uniqueBytes));
      const uniqueId = asArtifactId(uniqueDigest);
      extras.push(
        descriptor(
          `extra-${String(index).padStart(3, "0")}`,
          uniqueBytes,
          uniqueId,
          uniqueDigest,
        ),
      );
      store.set(uniqueId, uniqueBytes);
      extraIds.push(uniqueId);
    }
    // total descriptors = 3 core + many extras > 128
    const artifacts = [matrixArtifact, ledgerArtifact, specArtifact, ...extras];
    expect(artifacts.length).toBeGreaterThan(
      SPEC_CORRECTNESS_MAX_ARTIFACT_COUNT,
    );
    // Schema rejects unequal role/descriptor sets, so exercise the coordinator
    // bound by providing a matching synthetic input via type assertion only after
    // constructing a valid oversized set with roles covering all descriptors.
    const roles = {
      coverageMatrixArtifactId: matrixId,
      ledgerArtifactId: ledgerId,
      specSetArtifactIds: [specId, ...extraIds] as unknown as readonly [
        ArtifactId,
        ...ArtifactId[],
      ],
    };
    const oversized = {
      ...baseInput(),
      artifacts:
        artifacts as unknown as SpecCorrectnessAdmissionInputV1["artifacts"],
      roles,
    } as SpecCorrectnessAdmissionInputV1;
    await expectRejected(oversized, { store });
  });

  it("exports closed byte bounds", () => {
    expect(SPEC_CORRECTNESS_MAX_ARTIFACT_BYTES).toBe(1_048_576);
    expect(SPEC_CORRECTNESS_MAX_TOTAL_BYTES).toBe(16_777_216);
    expect(SPEC_CORRECTNESS_MAX_ARTIFACT_COUNT).toBe(128);
  });

  it("rejects declared per-artifact overflow before any reader call", async () => {
    let readCount = 0;
    const trackingReader: ArtifactReaderService = {
      read: (request) => {
        readCount += 1;
        return memoryReader(defaultStore()).read(request);
      },
    };
    const oversizedDeclared = {
      ...matrixArtifact,
      byteLength: SPEC_CORRECTNESS_MAX_ARTIFACT_BYTES + 1,
    };
    const input = baseInput({
      artifacts: [oversizedDeclared, ledgerArtifact, specArtifact],
    });
    const exit = await Effect.runPromiseExit(
      evaluateSpecCorrectnessAdmission(input).pipe(
        Effect.provide(
          Layer.merge(
            Layer.succeed(ArtifactReader, trackingReader),
            Layer.succeed(SpecCorrectnessPrimitives, purePrimitives),
          ),
        ),
      ),
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    if (!Exit.isSuccess(exit)) return;
    expect(exit.value._tag).toBe("Rejected");
    expect(readCount).toBe(0);
  });

  it("rejects declared total-budget overflow before the overflowing read", async () => {
    // Fill total budget to remaining=100 with compact arrays, then declare 101.
    const remainingTarget = 100;
    const fillTarget = SPEC_CORRECTNESS_MAX_TOTAL_BYTES - remainingTarget;
    const chunks: {
      readonly bytes: Uint8Array;
      readonly descriptor: ReviewArtifactDescriptorV1;
    }[] = [];
    let planned = 0;
    let index = 0;
    while (planned < fillTarget) {
      const size = Math.min(
        SPEC_CORRECTNESS_MAX_ARTIFACT_BYTES,
        fillTarget - planned,
      );
      const bytes = new Uint8Array(size);
      bytes[0] = index & 0xff;
      const digest = asDigest(sha256Hex(bytes));
      const id = asArtifactId(digest);
      chunks.push({
        bytes,
        descriptor: descriptor(
          `chunk-${String(index).padStart(3, "0")}`,
          bytes,
          id,
          digest,
        ),
      });
      planned += size;
      index += 1;
    }
    expect(SPEC_CORRECTNESS_MAX_TOTAL_BYTES - planned).toBe(remainingTarget);

    const overflowDescriptor: ReviewArtifactDescriptorV1 = {
      schemaVersion: 1,
      alias: "overflow",
      mediaType: "text/markdown",
      byteLength: remainingTarget + 1,
      digest: asDigest("e".repeat(64)),
      artifactId: asArtifactId("e".repeat(64)),
    };

    const matrixChunk = chunks[0];
    const ledgerChunk = chunks[1];
    if (matrixChunk === undefined || ledgerChunk === undefined) {
      throw new Error("expected at least two budget chunks");
    }
    const matrixDesc = {
      ...matrixChunk.descriptor,
      alias: "coverage-matrix",
    };
    const ledgerDesc = {
      ...ledgerChunk.descriptor,
      alias: "ledger",
    };
    const midSpecs = chunks.slice(2).map((chunk) => chunk.descriptor);
    const artifacts = [matrixDesc, ledgerDesc, ...midSpecs, overflowDescriptor];
    const roles = {
      coverageMatrixArtifactId: matrixDesc.artifactId,
      ledgerArtifactId: ledgerDesc.artifactId,
      specSetArtifactIds: [
        ...midSpecs.map((item) => item.artifactId),
        overflowDescriptor.artifactId,
      ] as unknown as readonly [ArtifactId, ...ArtifactId[]],
    };
    const store = new Map<string, Uint8Array>();
    for (const chunk of chunks) {
      store.set(chunk.descriptor.artifactId, chunk.bytes);
    }

    let readCount = 0;
    const trackingReader: ArtifactReaderService = {
      read: (request) => {
        readCount += 1;
        return memoryReader(store).read(request);
      },
    };

    const localIdentity: SpecCorrectnessIdentityV1 = {
      ...identity,
      coverageMatrixSha256: matrixDesc.digest,
      ledgerSha256: ledgerDesc.digest,
      specSetSha256: computeSpecSetDigest([
        ...midSpecs.map((item) => ({
          alias: item.alias,
          artifactId: item.artifactId,
          sha256: item.digest,
          byteLength: item.byteLength,
        })),
        {
          alias: overflowDescriptor.alias,
          artifactId: overflowDescriptor.artifactId,
          sha256: overflowDescriptor.digest,
          byteLength: overflowDescriptor.byteLength,
        },
      ]),
    };
    const allIds = artifacts.map(
      (item) => item.artifactId,
    ) as unknown as readonly [ArtifactId, ...ArtifactId[]];
    const input = {
      ...baseInput({
        expectedIdentity: localIdentity,
        observedIdentity: localIdentity,
        submission: {
          identity: localIdentity,
          response: acceptProviderResponse,
        },
        artifacts:
          artifacts as unknown as SpecCorrectnessAdmissionInputV1["artifacts"],
        roles,
        reviewAttempt: {
          ...baseInput().reviewAttempt,
          expectedArtifactIds: allIds,
          verifiedArtifactIds: allIds,
          response: {
            ...approvedFinalResponse,
            inspectedArtifactIds: allIds,
          },
        },
      }),
    } as SpecCorrectnessAdmissionInputV1;

    const exit = await Effect.runPromiseExit(
      evaluateSpecCorrectnessAdmission(input).pipe(
        Effect.provide(
          Layer.merge(
            Layer.succeed(ArtifactReader, trackingReader),
            Layer.succeed(SpecCorrectnessPrimitives, purePrimitives),
          ),
        ),
      ),
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    if (!Exit.isSuccess(exit)) return;
    expect(exit.value._tag).toBe("Rejected");
    expect(readCount).toBe(chunks.length);
  });

  it("rejects actual per-artifact overflow from a nonconforming reader", async () => {
    let readCount = 0;
    const oversizedActual = new Uint8Array(
      SPEC_CORRECTNESS_MAX_ARTIFACT_BYTES + 1,
    );
    const nonconforming: ArtifactReaderService = {
      read: (request) => {
        readCount += 1;
        if (request.descriptor.artifactId === matrixId) {
          return Effect.succeed(Uint8Array.from(oversizedActual));
        }
        return memoryReader(defaultStore()).read(request);
      },
    };
    const input = baseInput({
      artifacts: [
        {
          ...matrixArtifact,
          byteLength: 100,
        },
        ledgerArtifact,
        specArtifact,
      ],
    });
    const exit = await Effect.runPromiseExit(
      evaluateSpecCorrectnessAdmission(input).pipe(
        Effect.provide(
          Layer.merge(
            Layer.succeed(ArtifactReader, nonconforming),
            Layer.succeed(SpecCorrectnessPrimitives, purePrimitives),
          ),
        ),
      ),
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    if (!Exit.isSuccess(exit)) return;
    expect(exit.value._tag).toBe("Rejected");
    expect(readCount).toBe(1);
  });

  it("rejects actual total-budget overflow from a nonconforming reader", async () => {
    // Fill until remaining=200, declare tail=150 (pre-read ok), return 201.
    const remainingTarget = 200;
    const fillTarget = SPEC_CORRECTNESS_MAX_TOTAL_BYTES - remainingTarget;
    const chunks: {
      readonly bytes: Uint8Array;
      readonly descriptor: ReviewArtifactDescriptorV1;
    }[] = [];
    let planned = 0;
    let index = 0;
    while (planned < fillTarget) {
      const size = Math.min(
        SPEC_CORRECTNESS_MAX_ARTIFACT_BYTES,
        fillTarget - planned,
      );
      const bytes = new Uint8Array(size);
      bytes[0] = (index + 11) & 0xff;
      const digest = asDigest(sha256Hex(bytes));
      const id = asArtifactId(digest);
      chunks.push({
        bytes,
        descriptor: descriptor(
          `tb-${String(index).padStart(3, "0")}`,
          bytes,
          id,
          digest,
        ),
      });
      planned += size;
      index += 1;
    }

    const tailDeclared = 150;
    const tailActual = remainingTarget + 1;
    const tailDigest = asDigest(sha256Hex(new Uint8Array(tailDeclared)));
    const tailId = asArtifactId(tailDigest);
    const tailDescriptor: ReviewArtifactDescriptorV1 = {
      schemaVersion: 1,
      alias: "tail",
      mediaType: "text/markdown",
      byteLength: tailDeclared,
      digest: tailDigest,
      artifactId: tailId,
    };

    const matrixChunk = chunks[0];
    const ledgerChunk = chunks[1];
    if (matrixChunk === undefined || ledgerChunk === undefined) {
      throw new Error("expected budget chunks");
    }
    const matrixDesc = {
      ...matrixChunk.descriptor,
      alias: "coverage-matrix",
    };
    const ledgerDesc = {
      ...ledgerChunk.descriptor,
      alias: "ledger",
    };
    const mid = chunks.slice(2).map((c) => c.descriptor);
    const artifacts = [matrixDesc, ledgerDesc, ...mid, tailDescriptor];
    const roles = {
      coverageMatrixArtifactId: matrixDesc.artifactId,
      ledgerArtifactId: ledgerDesc.artifactId,
      specSetArtifactIds: [
        ...mid.map((item) => item.artifactId),
        tailId,
      ] as unknown as readonly [ArtifactId, ...ArtifactId[]],
    };
    const store = new Map<string, Uint8Array>();
    for (const chunk of chunks) {
      store.set(chunk.descriptor.artifactId, chunk.bytes);
    }

    let readCount = 0;
    const nonconforming: ArtifactReaderService = {
      read: (request) => {
        readCount += 1;
        if (request.descriptor.artifactId === tailId) {
          return Effect.succeed(new Uint8Array(tailActual));
        }
        return memoryReader(store).read(request);
      },
    };

    const localIdentity: SpecCorrectnessIdentityV1 = {
      ...identity,
      coverageMatrixSha256: matrixDesc.digest,
      ledgerSha256: ledgerDesc.digest,
      specSetSha256: computeSpecSetDigest([
        ...mid.map((item) => ({
          alias: item.alias,
          artifactId: item.artifactId,
          sha256: item.digest,
          byteLength: item.byteLength,
        })),
        {
          alias: tailDescriptor.alias,
          artifactId: tailId,
          sha256: tailDigest,
          byteLength: tailDeclared,
        },
      ]),
    };
    const allIds = artifacts.map(
      (item) => item.artifactId,
    ) as unknown as readonly [ArtifactId, ...ArtifactId[]];
    const input = {
      ...baseInput({
        expectedIdentity: localIdentity,
        observedIdentity: localIdentity,
        submission: {
          identity: localIdentity,
          response: acceptProviderResponse,
        },
        artifacts:
          artifacts as unknown as SpecCorrectnessAdmissionInputV1["artifacts"],
        roles,
        reviewAttempt: {
          ...baseInput().reviewAttempt,
          expectedArtifactIds: allIds,
          verifiedArtifactIds: allIds,
          response: {
            ...approvedFinalResponse,
            inspectedArtifactIds: allIds,
          },
        },
      }),
    } as SpecCorrectnessAdmissionInputV1;

    const exit = await Effect.runPromiseExit(
      evaluateSpecCorrectnessAdmission(input).pipe(
        Effect.provide(
          Layer.merge(
            Layer.succeed(ArtifactReader, nonconforming),
            Layer.succeed(SpecCorrectnessPrimitives, purePrimitives),
          ),
        ),
      ),
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    if (!Exit.isSuccess(exit)) return;
    expect(exit.value._tag).toBe("Rejected");
    expect(readCount).toBe(chunks.length + 1);
  });

  it("converts provider-controlled unsafe completed free text into static Rejected", async () => {
    const finalResponse = {
      schemaVersion: 1 as const,
      readyTokenHash,
      contractHash,
      promptHash,
      bundle: expectedBundle,
      reviewerId,
      candidateId,
      inspectedArtifactIds: [matrixId, ledgerId, specId] as const,
      advice: {
        kind: "changes_requested" as const,
        findings: [
          {
            artifactId: matrixId,
            location: "/tmp/secret-path",
            summary: "defect sk-SECRET-KEY-99xxxx",
            nextAction: "repair HOME=/home/evil",
          },
        ] as const,
      },
    };
    const items = BASELINE_IDS.map((id, index) =>
      index === 0 ? makeDefect(id, "omitted") : makeMapped(id),
    );
    const exit = await runAdmission(
      baseInput({
        reviewAttempt: {
          ...baseInput().reviewAttempt,
          response: finalResponse,
        },
        submission: {
          identity,
          response: {
            schemaVersion: 1,
            outcome: "changes_requested",
            itemResults: items,
            inventedCompletions: [],
            findings: [
              {
                location: "coverage-matrix.md",
                summary: "defect",
                nextAction: "repair",
              },
            ],
            summary: "incomplete",
          },
        },
      }),
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    if (!Exit.isSuccess(exit)) return;
    const result = decodeStrictSync(
      SpecCorrectnessAdmissionResultV1,
      exit.value,
    );
    expect(result._tag).toBe("Rejected");
    const text = JSON.stringify(result);
    expect(text).not.toContain("/tmp/secret-path");
    expect(text).not.toContain("sk-SECRET-KEY-99xxxx");
    expect(text).not.toContain("HOME=");
    expect(text).not.toContain("/home/evil");
  });

  it("never returns paths or raw secret markers in rejected results", async () => {
    const result = await expectRejected(
      baseInput({
        expectedIdentity: {
          ...identity,
          reviewerId: "other",
        },
      }),
    );
    const text = JSON.stringify(result);
    expect(text).not.toContain("/tmp");
    expect(text).not.toContain("sk-");
  });

  it("exposes SpecCorrectnessPrimitives only on the primitives subpath, not the root barrel", () => {
    expect(SpecCorrectnessPrimitives).toBeDefined();
    expect(
      Object.prototype.hasOwnProperty.call(
        ApplicationRoot,
        "SpecCorrectnessPrimitives",
      ),
    ).toBe(false);
    expect(
      Object.prototype.hasOwnProperty.call(
        ApplicationRoot,
        "SpecCorrectnessPrimitivesService",
      ),
    ).toBe(false);
  });
});
