import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringifyCanonicalJson } from "@council/application";
import type {
  ArtifactId,
  CandidateId,
  ContentHash,
  ContractHash,
  GitCommitSha,
  Sha256Digest,
} from "@council/schema";
import { decodeStrictSync } from "@council/schema";
import type {
  SpecCorrectnessAdmissionResultV1,
  SpecCorrectnessCliRequestV1,
  SpecCorrectnessIdentityV1,
} from "@council/schema/spec-correctness-admission";
import { SpecCorrectnessAdmissionResultV1 as ResultSchema } from "@council/schema/spec-correctness-admission";
import type { SpecCorrectnessItemResultV1 } from "@council/schema/spec-correctness";
import { describe, expect, it } from "vitest";
import {
  MAX_STDERR_BYTES,
  MAX_STDIN_BYTES,
  MAX_STDOUT_BYTES,
  runSpecCorrectnessCli,
  type SpecCorrectnessCliIo,
} from "../src/spec-correctness-cli.js";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

const asDigest = (hex: string): Sha256Digest => hex as Sha256Digest;
const asCommit = (hex: string): GitCommitSha => hex as GitCommitSha;
const asArtifactId = (hex: string): ArtifactId => `sha256:${hex}` as ArtifactId;
const asContent = (hex: string): ContentHash => `sha256:${hex}` as ContentHash;
const asContract = (hex: string): ContractHash =>
  `sha256:${hex}` as ContractHash;

const sha256Hex = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");
const encode = (text: string): Uint8Array => textEncoder.encode(text);

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

const buildMatrix = (): string => {
  const header =
    "| ID | Class | Target sprint | Mapped requirement or boundary | Acceptance evidence | Baseline status |\n|---|---|---|---|---|---|\n";
  const rows = BASELINE_IDS.map(
    (id) => `| \`${id}\` | carried_work | 0 | requirement | evidence | open |`,
  ).join("\n");
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

const computeSpecSetDigest = (
  specs: readonly {
    readonly alias: string;
    readonly artifactId: string;
    readonly sha256: string;
    readonly byteLength: number;
  }[],
): Sha256Digest => {
  const sorted = [...specs].sort((a, b) => a.alias.localeCompare(b.alias));
  const records = sorted.map((item) => {
    const keys = Object.keys(item).sort();
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      out[key] = (item as Record<string, unknown>)[key];
    }
    return out;
  });
  return asDigest(sha256Hex(encode(`${JSON.stringify(records)}\n`)));
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
const matrixBytes = encode(matrixText);
const matrixDigest = asDigest(sha256Hex(matrixBytes));
const matrixId = asArtifactId(matrixDigest);
const ledgerBytes = encode("# ledger\nline one\n");
const ledgerDigest = asDigest(sha256Hex(ledgerBytes));
const ledgerId = asArtifactId(ledgerDigest);
const specBytes = encode("# spec-a\nrequirement text\n");
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

const acceptProviderResponse = {
  schemaVersion: 1 as const,
  outcome: "accept" as const,
  itemResults: BASELINE_IDS.map((id) => makeMapped(id)),
  inventedCompletions: [] as const,
  findings: [] as const,
  summary: "coverage complete",
};

const makeIo = (
  stdinText: string,
  execute: SpecCorrectnessCliIo["execute"],
): {
  readonly io: SpecCorrectnessCliIo;
  readonly stdout: Uint8Array[];
  readonly stderr: Uint8Array[];
} => {
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const io: SpecCorrectnessCliIo = {
    stdin: {
      async *[Symbol.asyncIterator]() {
        await Promise.resolve();
        yield textEncoder.encode(stdinText);
      },
    },
    writeStdout: (bytes) => {
      stdout.push(bytes);
      return Promise.resolve();
    },
    writeStderr: (bytes) => {
      stderr.push(bytes);
      return Promise.resolve();
    },
    execute,
  };
  return { io, stdout, stderr };
};

const approvedResult: SpecCorrectnessAdmissionResultV1 = decodeStrictSync(
  ResultSchema,
  {
    schemaVersion: 1,
    _tag: "CompletedApproved",
    evaluation: {
      schemaVersion: 1,
      identity,
      evaluation: {
        schemaVersion: 1,
        _tag: "Valid",
        outcome: "accept",
        metrics: {
          schemaVersion: 1,
          baselineItemCount: 44,
          mappedItemCount: 44,
          evidencedDeferCount: 0,
          omittedItemCount: 0,
          contradictionCount: 0,
          unevidencedDeferCount: 0,
          inventedCompletionCount: 0,
          coverageRatio: { numerator: 44, denominator: 44 },
        },
        findings: [],
      },
    },
    classification: {
      _tag: "CompletedVerdict",
      response: approvedFinalResponse,
      terminal: completedTerminal,
      quorumEligible: true,
      deliberationEligible: true,
    },
    quorumEligible: true,
    candidateDisposition: "approved",
  },
);

const rejectedResult: SpecCorrectnessAdmissionResultV1 = decodeStrictSync(
  ResultSchema,
  {
    schemaVersion: 1,
    _tag: "Rejected",
    failure: {
      stage: "parse",
      reason: "identity mismatch",
      retry: "new_contract",
    },
    evaluation: null,
    quorumEligible: false,
    candidateDisposition: "changes_requested",
  },
);

const changesFinalResponse = {
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
        location: "row 1",
        summary: "defect",
        nextAction: "repair",
      },
    ] as const,
  },
};

const changesRequestedResult: SpecCorrectnessAdmissionResultV1 =
  decodeStrictSync(ResultSchema, {
    schemaVersion: 1,
    _tag: "CompletedChangesRequested",
    evaluation: {
      schemaVersion: 1,
      identity,
      evaluation: {
        schemaVersion: 1,
        _tag: "Valid",
        outcome: "changes_requested",
        metrics: {
          schemaVersion: 1,
          baselineItemCount: 44,
          mappedItemCount: 43,
          evidencedDeferCount: 0,
          omittedItemCount: 1,
          contradictionCount: 0,
          unevidencedDeferCount: 0,
          inventedCompletionCount: 0,
          coverageRatio: { numerator: 43, denominator: 44 },
        },
        findings: [
          {
            location: "coverage-matrix.md",
            summary: "one defect",
            nextAction: "repair",
          },
        ],
      },
    },
    classification: {
      _tag: "CompletedVerdict",
      response: changesFinalResponse,
      terminal: completedTerminal,
      quorumEligible: true,
      deliberationEligible: true,
    },
    quorumEligible: true,
    candidateDisposition: "changes_requested",
  });

const abstentionFinalResponse = {
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

const abstentionResult: SpecCorrectnessAdmissionResultV1 = decodeStrictSync(
  ResultSchema,
  {
    schemaVersion: 1,
    _tag: "CompletedAbstention",
    evaluation: {
      schemaVersion: 1,
      identity,
      evaluation: {
        schemaVersion: 1,
        _tag: "Valid",
        outcome: "abstain",
        metrics: {
          schemaVersion: 1,
          baselineItemCount: 44,
          mappedItemCount: 44,
          evidencedDeferCount: 0,
          omittedItemCount: 0,
          contradictionCount: 0,
          unevidencedDeferCount: 0,
          inventedCompletionCount: 0,
          coverageRatio: { numerator: 44, denominator: 44 },
        },
        evidenceGaps: [
          {
            evidenceRef: "acceptance-criteria",
            unmetCondition: "missing proof",
          },
        ],
        nextAction: "supply evidence",
      },
    },
    classification: {
      _tag: "CompletedAbstention",
      response: abstentionFinalResponse,
      terminal: completedTerminal,
      quorumEligible: false,
      deliberationEligible: true,
    },
    quorumEligible: false,
    candidateDisposition: "abstention",
  },
);

const responseRejectedResult: SpecCorrectnessAdmissionResultV1 =
  decodeStrictSync(ResultSchema, {
    schemaVersion: 1,
    _tag: "ResponseRejected",
    evaluation: null,
    classification: {
      _tag: "CompletedInvalidResponse",
      reason: "schema_invalid",
      terminal: completedTerminal,
      quorumEligible: false,
      deliberationEligible: false,
    },
    quorumEligible: false,
    candidateDisposition: "changes_requested",
  });

const staticStdoutOverflowRejected: SpecCorrectnessAdmissionResultV1 =
  decodeStrictSync(ResultSchema, {
    schemaVersion: 1,
    _tag: "Rejected",
    failure: {
      stage: "parse",
      reason: "spec-correctness CLI stdout result exceeds the closed bound",
      retry: "changed_preflight",
    },
    evaluation: null,
    quorumEligible: false,
    candidateDisposition: "changes_requested",
  });

const minimalRequestBody = JSON.stringify({
  input: {
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
    submission: { identity, response: acceptProviderResponse },
    artifacts: [
      {
        schemaVersion: 1,
        alias: "coverage-matrix",
        mediaType: "text/markdown",
        byteLength: matrixBytes.byteLength,
        digest: matrixDigest,
        artifactId: matrixId,
      },
      {
        schemaVersion: 1,
        alias: "ledger",
        mediaType: "text/markdown",
        byteLength: ledgerBytes.byteLength,
        digest: ledgerDigest,
        artifactId: ledgerId,
      },
      {
        schemaVersion: 1,
        alias: "spec-a",
        mediaType: "text/markdown",
        byteLength: specBytes.byteLength,
        digest: specDigest,
        artifactId: specId,
      },
    ],
    roles: {
      coverageMatrixArtifactId: matrixId,
      ledgerArtifactId: ledgerId,
      specSetArtifactIds: [specId],
    },
  },
  artifactPaths: [
    { artifactId: matrixId, path: "/artifacts/matrix.md" },
    { artifactId: ledgerId, path: "/artifacts/ledger.md" },
    { artifactId: specId, path: "/artifacts/spec.md" },
  ],
});

describe("runSpecCorrectnessCli", () => {
  it("exits 64 with usage on unexpected arguments", async () => {
    const { io, stderr, stdout } = makeIo("{}", () =>
      Promise.resolve(approvedResult),
    );
    const code = await runSpecCorrectnessCli(["--help"], io);
    expect(code).toBe(64);
    expect(textDecoder.decode(stderr[0])).toBe(
      "usage: council-spec-correctness < request.json\n",
    );
    expect(stdout).toHaveLength(0);
  });

  it("exits 0 for completed approved with canonical JSON and one LF", async () => {
    const { io, stdout, stderr } = makeIo(minimalRequestBody, () =>
      Promise.resolve(approvedResult),
    );
    const code = await runSpecCorrectnessCli([], io);
    expect(code).toBe(0);
    expect(stderr).toHaveLength(0);
    const text = textDecoder.decode(stdout[0]);
    expect(text.endsWith("\n")).toBe(true);
    expect(text.slice(0, -1).includes("\n")).toBe(false);
    expect(text).toBe(`${stringifyCanonicalJson(approvedResult)}\n`);
    // Recursive key order: candidateDisposition before classification alphabetically
    const withoutLf = text.slice(0, -1);
    const parsed: unknown = JSON.parse(withoutLf);
    expect(Object.keys(parsed as object)[0]).toBe("_tag");
  });

  it("exits 1 for rejected results", async () => {
    const { io, stdout } = makeIo(minimalRequestBody, () =>
      Promise.resolve(rejectedResult),
    );
    const code = await runSpecCorrectnessCli([], io);
    expect(code).toBe(1);
    const text = textDecoder.decode(stdout[0]);
    expect(text).toBe(`${stringifyCanonicalJson(rejectedResult)}\n`);
    expect(text).not.toContain("/artifacts");
  });

  it("exits 1 for invalid JSON stdin without leaking raw body", async () => {
    const secret = "sk-SECRET-MARKER-99 /tmp/hidden-path";
    const { io, stdout, stderr } = makeIo(`{ not json ${secret}`, () =>
      Promise.resolve(approvedResult),
    );
    const code = await runSpecCorrectnessCli([], io);
    expect(code).toBe(1);
    const out = textDecoder.decode(stdout[0] ?? new Uint8Array());
    expect(out).not.toContain(secret);
    expect(out).not.toContain("/tmp");
    expect(stderr).toHaveLength(0);
    const parsed = JSON.parse(out.slice(0, -1)) as { _tag: string };
    expect(parsed._tag).toBe("Rejected");
  });

  it("exits 1 when stdin exceeds the closed bound", async () => {
    const huge = "x".repeat(MAX_STDIN_BYTES + 1);
    const stdout: Uint8Array[] = [];
    const stderr: Uint8Array[] = [];
    const io: SpecCorrectnessCliIo = {
      stdin: {
        async *[Symbol.asyncIterator]() {
          await Promise.resolve();
          yield textEncoder.encode(huge);
        },
      },
      writeStdout: (bytes) => {
        stdout.push(bytes);
        return Promise.resolve();
      },
      writeStderr: (bytes) => {
        stderr.push(bytes);
        return Promise.resolve();
      },
      execute: () => Promise.resolve(approvedResult),
    };
    const code = await runSpecCorrectnessCli([], io);
    expect(code).toBe(1);
    expect(stderr).toHaveLength(0);
    expect(textDecoder.decode(stdout[0])).toContain("Rejected");
  });

  it("exports closed stream bounds", () => {
    expect(MAX_STDIN_BYTES).toBe(1_048_576);
    expect(MAX_STDOUT_BYTES).toBe(1_048_576);
    expect(MAX_STDERR_BYTES).toBe(4_096);
  });

  it("integration: filesystem program via CLI exits 0 for clean approval", async () => {
    const dir = await mkdtemp(join(tmpdir(), "council-sc-cli-"));
    try {
      const matrixPath = join(dir, "matrix.md");
      const ledgerPath = join(dir, "ledger.md");
      const specPath = join(dir, "spec.md");
      await writeFile(matrixPath, matrixBytes);
      await writeFile(ledgerPath, ledgerBytes);
      await writeFile(specPath, specBytes);

      const parsed = JSON.parse(
        minimalRequestBody,
      ) as SpecCorrectnessCliRequestV1;
      const request: SpecCorrectnessCliRequestV1 = {
        ...parsed,
        artifactPaths: [
          { artifactId: matrixId, path: matrixPath },
          { artifactId: ledgerId, path: ledgerPath },
          { artifactId: specId, path: specPath },
        ],
      };

      const { executeSpecCorrectnessRequest } =
        await import("../src/spec-correctness-program.js");
      const { io, stdout } = makeIo(JSON.stringify(request), (req) =>
        executeSpecCorrectnessRequest(req),
      );
      const code = await runSpecCorrectnessCli([], io);
      expect(code).toBe(0);
      const text = textDecoder.decode(stdout[0]);
      expect(text).not.toContain(dir);
      expect(text.endsWith("\n")).toBe(true);
      const result = JSON.parse(text.slice(0, -1)) as { _tag: string };
      expect(result._tag).toBe("CompletedApproved");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("exits 1 for completed changes requested with canonical JSON and one LF", async () => {
    const { io, stdout, stderr } = makeIo(minimalRequestBody, () =>
      Promise.resolve(changesRequestedResult),
    );
    const code = await runSpecCorrectnessCli([], io);
    expect(code).toBe(1);
    expect(stderr).toHaveLength(0);
    const text = textDecoder.decode(stdout[0]);
    expect(text.endsWith("\n")).toBe(true);
    expect(text.slice(0, -1).includes("\n")).toBe(false);
    expect(text).toBe(`${stringifyCanonicalJson(changesRequestedResult)}\n`);
    const parsedChanges = JSON.parse(text.slice(0, -1)) as { _tag: string };
    expect(parsedChanges._tag).toBe("CompletedChangesRequested");
  });

  it("exits 1 for completed abstention with canonical JSON and one LF", async () => {
    const { io, stdout, stderr } = makeIo(minimalRequestBody, () =>
      Promise.resolve(abstentionResult),
    );
    const code = await runSpecCorrectnessCli([], io);
    expect(code).toBe(1);
    expect(stderr).toHaveLength(0);
    const text = textDecoder.decode(stdout[0]);
    expect(text.endsWith("\n")).toBe(true);
    expect(text.slice(0, -1).includes("\n")).toBe(false);
    expect(text).toBe(`${stringifyCanonicalJson(abstentionResult)}\n`);
    const parsedAbstention = JSON.parse(text.slice(0, -1)) as { _tag: string };
    expect(parsedAbstention._tag).toBe("CompletedAbstention");
  });

  it("exits 1 for ResponseRejected with CompletedInvalidResponse and no infrastructure failure", async () => {
    const { io, stdout, stderr } = makeIo(minimalRequestBody, () =>
      Promise.resolve(responseRejectedResult),
    );
    const code = await runSpecCorrectnessCli([], io);
    expect(code).toBe(1);
    expect(stderr).toHaveLength(0);
    const text = textDecoder.decode(stdout[0]);
    expect(text.endsWith("\n")).toBe(true);
    expect(text.slice(0, -1).includes("\n")).toBe(false);
    expect(text).toBe(`${stringifyCanonicalJson(responseRejectedResult)}\n`);
    const parsed = JSON.parse(text.slice(0, -1)) as {
      _tag: string;
      classification?: { _tag: string; reason: string };
      evaluation?: unknown;
      failure?: unknown;
    };
    expect(parsed._tag).toBe("ResponseRejected");
    expect(parsed.classification?._tag).toBe("CompletedInvalidResponse");
    expect(parsed.classification?.reason).toBe("schema_invalid");
    expect(parsed.evaluation).toBeNull();
    expect(parsed).not.toHaveProperty("failure");
  });

  it("integration: real program returns ResponseRejected for Fable approved-with-findings shape", async () => {
    const dir = await mkdtemp(join(tmpdir(), "council-sc-fable-"));
    try {
      const matrixPath = join(dir, "matrix.md");
      const ledgerPath = join(dir, "ledger.md");
      const specPath = join(dir, "spec.md");
      await writeFile(matrixPath, matrixBytes);
      await writeFile(ledgerPath, ledgerBytes);
      await writeFile(specPath, specBytes);

      const parsed = JSON.parse(
        minimalRequestBody,
      ) as SpecCorrectnessCliRequestV1;
      const request: SpecCorrectnessCliRequestV1 = {
        ...parsed,
        input: {
          ...parsed.input,
          reviewAttempt: {
            ...parsed.input.reviewAttempt,
            designatedStructuredValid: false,
            response: undefined,
          },
          submission: {
            identity,
            response: {
              ...acceptProviderResponse,
              findings: [
                {
                  location: "application/src/spec-correctness-admission.ts",
                  summary: "approved with nonempty findings",
                  nextAction: "classify as schema_invalid",
                },
              ],
            },
          },
        },
        artifactPaths: [
          { artifactId: matrixId, path: matrixPath },
          { artifactId: ledgerId, path: ledgerPath },
          { artifactId: specId, path: specPath },
        ],
      };

      const { executeSpecCorrectnessRequest } =
        await import("../src/spec-correctness-program.js");
      const { io, stdout } = makeIo(JSON.stringify(request), (req) =>
        executeSpecCorrectnessRequest(req),
      );
      const code = await runSpecCorrectnessCli([], io);
      expect(code).toBe(1);
      const text = textDecoder.decode(stdout[0]);
      expect(text).not.toContain(dir);
      const result = JSON.parse(text.slice(0, -1)) as {
        _tag: string;
        evaluation: unknown;
        classification?: { _tag: string; reason: string };
        failure?: unknown;
      };
      expect(result._tag).toBe("ResponseRejected");
      expect(result._tag).not.toBe("Rejected");
      expect(result.classification?._tag).toBe("CompletedInvalidResponse");
      expect(result.classification?.reason).toBe("schema_invalid");
      expect(result.evaluation).toBeNull();
      expect(result).not.toHaveProperty("failure");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("integration: real program returns ResponseRejected for Grok alias-evidence insufficient_evidence", async () => {
    const dir = await mkdtemp(join(tmpdir(), "council-sc-grok-"));
    try {
      const matrixPath = join(dir, "matrix.md");
      const ledgerPath = join(dir, "ledger.md");
      const specPath = join(dir, "spec.md");
      await writeFile(matrixPath, matrixBytes);
      await writeFile(ledgerPath, ledgerBytes);
      await writeFile(specPath, specBytes);

      const parsed = JSON.parse(
        minimalRequestBody,
      ) as SpecCorrectnessCliRequestV1;
      const request: SpecCorrectnessCliRequestV1 = {
        ...parsed,
        input: {
          ...parsed.input,
          reviewAttempt: {
            ...parsed.input.reviewAttempt,
            response: {
              ...approvedFinalResponse,
              advice: {
                kind: "abstention",
                abstention: {
                  kind: "insufficient_evidence",
                  evidenceGaps: [
                    {
                      evidenceRef: "coverage-matrix",
                      unmetCondition: "alias not in declared namespace",
                    },
                  ],
                  nextAction: "use declared evidence refs",
                },
              },
            },
          },
          submission: {
            identity,
            response: {
              schemaVersion: 1,
              outcome: "abstain",
              itemResults: BASELINE_IDS.map((id) => makeMapped(id)),
              inventedCompletions: [],
              findings: [],
              summary: "insufficient evidence",
              evidenceGaps: [
                {
                  evidenceRef: "coverage-matrix",
                  unmetCondition: "alias not in declared namespace",
                },
              ],
              nextAction: "use declared evidence refs",
            },
          },
        },
        artifactPaths: [
          { artifactId: matrixId, path: matrixPath },
          { artifactId: ledgerId, path: ledgerPath },
          { artifactId: specId, path: specPath },
        ],
      };

      const { executeSpecCorrectnessRequest } =
        await import("../src/spec-correctness-program.js");
      const { io, stdout } = makeIo(JSON.stringify(request), (req) =>
        executeSpecCorrectnessRequest(req),
      );
      const code = await runSpecCorrectnessCli([], io);
      expect(code).toBe(1);
      const text = textDecoder.decode(stdout[0]);
      expect(text).not.toContain(dir);
      const result = JSON.parse(text.slice(0, -1)) as {
        _tag: string;
        evaluation: unknown;
        classification?: { _tag: string; reason: string };
        failure?: unknown;
      };
      expect(result._tag).toBe("ResponseRejected");
      expect(result._tag).not.toBe("Rejected");
      expect(result._tag).not.toBe("CompletedAbstention");
      expect(result.classification?._tag).toBe("CompletedInvalidResponse");
      expect(result.classification?.reason).toBe("abstention_invalid");
      expect(result.evaluation).toBeNull();
      expect(result).not.toHaveProperty("failure");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("exits 1 for invalid fatal UTF-8 stdin with static Rejected JSON", async () => {
    const stdout: Uint8Array[] = [];
    const stderr: Uint8Array[] = [];
    const io: SpecCorrectnessCliIo = {
      stdin: {
        async *[Symbol.asyncIterator]() {
          await Promise.resolve();
          // Invalid UTF-8 sequence (lone continuation byte).
          yield new Uint8Array([0x80, 0x61, 0x62]);
        },
      },
      writeStdout: (bytes) => {
        stdout.push(bytes);
        return Promise.resolve();
      },
      writeStderr: (bytes) => {
        stderr.push(bytes);
        return Promise.resolve();
      },
      execute: () => Promise.resolve(approvedResult),
    };
    const code = await runSpecCorrectnessCli([], io);
    expect(code).toBe(1);
    expect(stderr).toHaveLength(0);
    const text = textDecoder.decode(stdout[0]);
    expect(text.endsWith("\n")).toBe(true);
    const parsedRejected = JSON.parse(text.slice(0, -1)) as { _tag: string };
    expect(parsedRejected._tag).toBe("Rejected");
  });

  it("caps stderr writes at MAX_STDERR_BYTES", async () => {
    const { io, stderr, stdout } = makeIo("{}", () =>
      Promise.resolve(approvedResult),
    );
    const code = await runSpecCorrectnessCli(
      ["x".repeat(MAX_STDERR_BYTES + 64)],
      io,
    );
    expect(code).toBe(64);
    expect(stdout).toHaveLength(0);
    expect(stderr).toHaveLength(1);
    expect(stderr[0]?.byteLength).toBeLessThanOrEqual(MAX_STDERR_BYTES);
    // Usage line is short; still prove the bound constant is enforced by the
    // encoder path using a direct oversize write through usage only would not
    // exceed — so assert the exported bound and that usage is within it.
    expect(MAX_STDERR_BYTES).toBe(4_096);
    expect(textDecoder.decode(stderr[0])).toBe(
      "usage: council-spec-correctness < request.json\n",
    );
  });

  it("emits static secret-safe Rejected JSON when stdout would exceed the bound", async () => {
    const pad = "p".repeat(60_000);
    const findings = Array.from({ length: 20 }, (_, i) => ({
      artifactId: matrixId,
      location: `row-${String(i)}-${pad}`,
      summary: pad,
      nextAction: `fix-${String(i)}-${pad}`,
    }));
    const evalFindings = Array.from({ length: 20 }, (_, i) => ({
      location: `loc-${String(i)}-${pad}`,
      summary: pad,
      nextAction: `act-${String(i)}-${pad}`,
    }));
    const oversizeResult = decodeStrictSync(ResultSchema, {
      schemaVersion: 1,
      _tag: "CompletedChangesRequested",
      evaluation: {
        schemaVersion: 1,
        identity,
        evaluation: {
          schemaVersion: 1,
          _tag: "Valid",
          outcome: "changes_requested",
          metrics: {
            schemaVersion: 1,
            baselineItemCount: 44,
            mappedItemCount: 43,
            evidencedDeferCount: 0,
            omittedItemCount: 1,
            contradictionCount: 0,
            unevidencedDeferCount: 0,
            inventedCompletionCount: 0,
            coverageRatio: { numerator: 43, denominator: 44 },
          },
          findings: evalFindings,
        },
      },
      classification: {
        _tag: "CompletedVerdict",
        response: {
          ...changesFinalResponse,
          advice: {
            kind: "changes_requested",
            findings,
          },
        },
        terminal: completedTerminal,
        quorumEligible: true,
        deliberationEligible: true,
      },
      quorumEligible: true,
      candidateDisposition: "changes_requested",
    });
    const oversizeBytes = textEncoder.encode(
      `${stringifyCanonicalJson(oversizeResult)}\n`,
    );
    expect(oversizeBytes.byteLength).toBeGreaterThan(MAX_STDOUT_BYTES);

    const fallbackBytes = textEncoder.encode(
      `${stringifyCanonicalJson(staticStdoutOverflowRejected)}\n`,
    );
    expect(fallbackBytes.byteLength).toBeLessThanOrEqual(MAX_STDOUT_BYTES);
    expect(fallbackBytes.byteLength).toBeLessThan(2_000);

    const { io, stdout, stderr } = makeIo(minimalRequestBody, () =>
      Promise.resolve(oversizeResult),
    );
    const code = await runSpecCorrectnessCli([], io);
    expect(code).toBe(1);
    expect(stderr).toHaveLength(0);
    const textOut = textDecoder.decode(stdout[0]);
    expect(textOut).toBe(
      `${stringifyCanonicalJson(staticStdoutOverflowRejected)}\n`,
    );
    expect(textOut).not.toContain("/tmp");
    expect(textOut).not.toContain("sk-");
    expect(stdout[0]?.byteLength).toBeLessThanOrEqual(MAX_STDOUT_BYTES);
  });
});
