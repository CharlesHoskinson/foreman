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
  SpecCorrectnessCliRequestV1,
  SpecCorrectnessIdentityV1,
} from "@council/schema/spec-correctness-admission";
import { SpecCorrectnessAdmissionResultV1 } from "@council/schema/spec-correctness-admission";
import type { SpecCorrectnessItemResultV1 } from "@council/schema/spec-correctness";
import { describe, expect, it } from "vitest";
import { executeSpecCorrectnessRequest } from "../src/spec-correctness-program.js";

const asDigest = (hex: string): Sha256Digest => hex as Sha256Digest;
const asCommit = (hex: string): GitCommitSha => hex as GitCommitSha;
const asArtifactId = (hex: string): ArtifactId => `sha256:${hex}` as ArtifactId;
const asContent = (hex: string): ContentHash => `sha256:${hex}` as ContentHash;
const asContract = (hex: string): ContractHash =>
  `sha256:${hex}` as ContractHash;

const sha256Hex = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");
const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

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
  const payload = `${JSON.stringify(records)}\n`;
  return asDigest(sha256Hex(encode(payload)));
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
const ledgerText = "# ledger\nline one\n";
const ledgerBytes = encode(ledgerText);
const ledgerDigest = asDigest(sha256Hex(ledgerBytes));
const ledgerId = asArtifactId(ledgerDigest);
const specText = "# spec-a\nrequirement text\n";
const specBytes = encode(specText);
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

const matrixArtifact = {
  schemaVersion: 1 as const,
  alias: "coverage-matrix",
  mediaType: "text/markdown",
  byteLength: matrixBytes.byteLength,
  digest: matrixDigest,
  artifactId: matrixId,
};
const ledgerArtifact = {
  schemaVersion: 1 as const,
  alias: "ledger",
  mediaType: "text/markdown",
  byteLength: ledgerBytes.byteLength,
  digest: ledgerDigest,
  artifactId: ledgerId,
};
const specArtifact = {
  schemaVersion: 1 as const,
  alias: "spec-a",
  mediaType: "text/markdown",
  byteLength: specBytes.byteLength,
  digest: specDigest,
  artifactId: specId,
};

const buildRequest = async (): Promise<{
  readonly request: SpecCorrectnessCliRequestV1;
  readonly dir: string;
}> => {
  const dir = await mkdtemp(join(tmpdir(), "council-sc-"));
  const matrixPath = join(dir, "matrix.md");
  const ledgerPath = join(dir, "ledger.md");
  const specPath = join(dir, "spec.md");
  await writeFile(matrixPath, matrixBytes);
  await writeFile(ledgerPath, ledgerBytes);
  await writeFile(specPath, specBytes);

  const request = {
    input: {
      schemaVersion: 1 as const,
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
        specSetArtifactIds: [specId] as const,
      },
    },
    artifactPaths: [
      { artifactId: matrixId, path: matrixPath },
      { artifactId: ledgerId, path: ledgerPath },
      { artifactId: specId, path: specPath },
    ],
  } as SpecCorrectnessCliRequestV1;

  return { request, dir };
};

describe("executeSpecCorrectnessRequest", () => {
  it("is not exported from the runtime-node root barrel", async () => {
    const RuntimeRoot = await import("../src/index.js");
    expect(
      Object.prototype.hasOwnProperty.call(
        RuntimeRoot,
        "executeSpecCorrectnessRequest",
      ),
    ).toBe(false);
  });

  it("returns CompletedApproved for a filesystem-backed clean matrix", async () => {
    const { request, dir } = await buildRequest();
    try {
      const result = await executeSpecCorrectnessRequest(request);
      const decoded = decodeStrictSync(
        SpecCorrectnessAdmissionResultV1,
        result,
      );
      expect(decoded._tag).toBe("CompletedApproved");
      const text = stringifyCanonicalJson(decoded);
      expect(text).not.toContain(dir);
      expect(text).not.toContain("matrix.md");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns Rejected when an artifact path is missing on disk", async () => {
    const { request, dir } = await buildRequest();
    try {
      const ledgerPath = request.artifactPaths[1]?.path;
      const specPath = request.artifactPaths[2]?.path;
      if (ledgerPath === undefined || specPath === undefined) {
        throw new Error("fixture artifact paths missing");
      }
      const broken: SpecCorrectnessCliRequestV1 = {
        ...request,
        artifactPaths: [
          {
            artifactId: matrixId,
            path: join(dir, "missing-matrix.md"),
          },
          { artifactId: ledgerId, path: ledgerPath },
          { artifactId: specId, path: specPath },
        ],
      };
      const result = await executeSpecCorrectnessRequest(broken);
      expect(result._tag).toBe("Rejected");
      expect(JSON.stringify(result)).not.toContain(dir);
      expect(JSON.stringify(result)).not.toContain("missing-matrix");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
