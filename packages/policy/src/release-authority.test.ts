import assert from "node:assert/strict";
import { createHash, createPublicKey, verify as verifyEd25519 } from "node:crypto";
import { describe, it } from "node:test";

import { canonicalize } from "@foreman/core";

import {
  buildApprovedOpenSpecManifestV1,
  decodeReleaseAuthorityFileV1,
  decodeReleaseProducerSourceFileV1,
  parseReleaseAuthorityObjectV1,
  releaseAuthoritySignaturePreimageV1,
  verifyReleaseSourceReceiptBindingV1,
  type ApprovedOpenSpecManifestV1,
  type ExecutionChildTerminalApprovalV1,
  type ReleaseActionOutcomeV1,
  type ReleaseActionV1,
  type ReleaseAuditFindingV1,
  type ReleaseAuditSourceV1,
  type ReleaseAuthorityFileDecodeResultV1,
  type ReleaseAuthorityObjectParseResultV1,
  type ReleaseAuthorityReceiptV1,
  type ReleaseCandidateIdentityV1,
  type ReleaseChecksSourceV1,
  type ReleaseCouncilOutcomeV1,
  type ReleaseEvaluationReportSourceV1,
  type ReleaseEvaluationVerdictV1,
  type ReleaseEvidenceBundleV1,
  type ReleaseProducerSourceDecodeResultV1,
  type ReleaseSourceReceiptBindingResultV1,
} from "./index.js";

const commit = "1111111111111111111111111111111111111111";
const tree = "2222222222222222222222222222222222222222";
const candidateSha256 =
  "468d019ea81224aeca7ee270b11959d8a187f6f0b6a3febff1c34dc1d66c8d85";
const shaA =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const shaB =
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const shaC =
  "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
const issuedAt = "2026-08-24T00:00:00Z";
const userKeySha256 =
  "00f3a61e60f4e7c066a13b9d8b98617ce015a40a0fd922f0a4af975c03d3ca3b";
const hostKeySha256 =
  "6d6ad713d16b7803dddbe84a449f6df798455e4494b22a9da6bf96d043b42397";

const SIGNATURES = {
  "foreman.design-approval.v1":
    "d1eE0j16E7ZZC6-PY2lsOkqfGKJh0I4TMrkTJsL-dfBrfdA97r_x5JQnPGjyms3mMa5ohUtpDp3soqF37d9HCQ",
  "foreman.checks-evidence.v1":
    "BPgTcnSFhwR3eelZD2mMpdt-YhMtHraTnRYv2vxJoBnwfN4tnvBLXMJZIPDsJue_DxgmJw1VLRJHoxYu20TBDQ",
  "foreman.release-audit.v1":
    "xdypf480NP1-u3OeG8N9jwZ7nAiD6ZyyEI2AER-FxtVnSgjyWGPioUSR1SZ9IjJlUxwnAy09rtGzcH4gUVOpCw",
  "foreman.council-request.v1":
    "BPwkjmTGzGIwA2ihDnivudKVnd9VPkfMZI2zgmC5blIONpHqZO_HCeVRF82GVmBpGB6rTMGX-MKr2yBVi5QMAQ",
  "foreman.evaluation-authority.v1":
    "euVje7ngS8I1BkAosrhcrrSo42YBOIK6hkufyPpOIIWIVK4vwvCbJof86XaBSbFkyerzqzK50b-X5SwsUWqyDw",
  "foreman.release-action-outcome.v1":
    "5T3m8el5ChwGVMhRVkD4Oh5z_yQUlUbrv0Gv1znTArRXvy6sW93Ccr-IL6WuVFUDbYz8ip6tNiGTsvS1gqPsDg",
  "foreman.council-outcome.v1":
    "pmXENk5_MrEQZlzDIqW-bcPvQEzE_gil4pWbRt02KrE8L1gYLE2U5h0km59HUZt_7Ntt60tdN-0S4A5Lx6qDAw",
  "foreman.evaluation-verdict.v1":
    "_vIvHzbOWv_aPF2T48bB9ujge03MTgiQ2JEXL5KirwLb4IQU-dx524PA6-RIHeqoScH0dZJuvFBkqhl-ULu7Ag",
  "foreman.execution-child-cancel.v1":
    "QlX2MBbwNMdg3ItEm2_H3YPkjUvcXvcNxdwXLPab83omtSCvZAr0MlZbI6mE31UWO65WXiToAAwqm9Y4dhbaAQ",
  "foreman.execution-child-invalidate.v1":
    "KhidP3eQI1LeBM3l7_TV8Xbptal9hoKYJui9bYhX-XsXuxPEeqqtFkRKKSWc91mZrcqJD6Zeb5hoA1ZaX89xCg",
  "foreman.release-evidence-bundle.v1":
    "YBa5W4GIo5-ZLzfpgJGtCtzet7NkT9HO8XGZP1nzikPbA3Ek0ZyH4U_HJos8kiInvfmNrXS25Firi2MtwEpuCw",
} as const;

const WRONG_ROLE_SIGNATURES = {
  designApprovalByHost:
    "EIcdBrEJDXO-L3V0RCb_f_3sAx6zU06waOcaB9RYfxSnnUmwPO8A0zLNnfeZ9hbroFMvgKg_U4xuspkvLMdvDw",
  checksEvidenceByUser:
    "dsi_yV2GyHgKgekqycBisIijd9K1_5X3noEcH1NYG6M1QF0P3CEd4s0PW07lDpkGMI28mC5fCOIw4_pjZgI2Aw",
} as const;

const CHECKS_SOURCE_SHA256 =
  "0505a731853eddb0985b3b805eda34b753582ae623699939a1693df61c4c44e4";
const AUDIT_SOURCE_SHA256 =
  "626842e9b21333e27b5790e8ba25e374de32f730f8be1cb4b57e70ae5e0ee465";
const EVAL_REPORT_SOURCE_SHA256 =
  "952d7ed591d3cb5d81f7ae479c89ce7ebf3b7a833b96155b8c3fa9c1dc93e343";
const COUNCIL_REQUEST_SHA256 =
  "8085315e38a71c9f518873d85176bc3e7f395d72e238e9af6366db4ba8980483";

const candidate: ReleaseCandidateIdentityV1 = {
  commit,
  tree,
  candidateSha256,
};

const finding: ReleaseAuditFindingV1 = {
  severity: "high",
  file: "packages/policy/src/release-authority.ts",
  line: 7,
  summary: "Authority mismatch.",
  evidence: "Exact mismatch evidence.",
};

const checksSource: ReleaseChecksSourceV1 = {
  schema: "foreman.checks-source.v1",
  program: "v040",
  packageId: "openspec-superpowers-convergence",
  candidate,
  status: "FAIL",
  commands: [
    {
      commandSha256: shaA,
      exitCode: 1,
      stdoutSha256: shaB,
      stderrSha256: shaC,
    },
  ],
};

const auditSource: ReleaseAuditSourceV1 = {
  schema: "foreman.audit-source.v1",
  program: "v040",
  packageId: "openspec-superpowers-convergence",
  candidate,
  verdict: "BLOCKED",
  findings: [finding],
  auditArtifactSha256: shaA,
};

const evaluationReportSource: ReleaseEvaluationReportSourceV1 = {
  schema: "foreman.evaluation-report-source.v1",
  program: "v040",
  packageId: "graph-eval-falsification",
  candidateSha256,
  authorityManifestSha256: shaA,
  evaluationAuthorityReceiptSha256: shaB,
  result: "GRAPH_OFF_UNCOMPUTABLE",
  plannedRuns: 2000,
  completedRuns: 1900,
  unavailableRuns: 50,
  notRunRuns: 50,
  runSetSha256: shaC,
  reportArtifactSha256: shaA,
};

const designReceipt: ReleaseAuthorityReceiptV1 = {
  schema: "foreman.design-approval.v1",
  program: "v040",
  packageId: "project-registry",
  designCommit: commit,
  designTree: tree,
  approvedOpenSpecSha256: shaA,
  taskPlanSha256: shaB,
  approvalStatementSha256: shaC,
  issuedAt,
  issuerKeySha256: userKeySha256,
  signature: SIGNATURES["foreman.design-approval.v1"],
};

const checksReceipt: ReleaseAuthorityReceiptV1 = {
  schema: "foreman.checks-evidence.v1",
  program: "v040",
  packageId: "openspec-superpowers-convergence",
  candidate,
  status: "FAIL",
  checksSha256: CHECKS_SOURCE_SHA256,
  issuedAt,
  issuerKeySha256: hostKeySha256,
  signature: SIGNATURES["foreman.checks-evidence.v1"],
};

const auditReceipt: ReleaseAuthorityReceiptV1 = {
  schema: "foreman.release-audit.v1",
  program: "v040",
  packageId: "openspec-superpowers-convergence",
  candidate,
  verdict: "BLOCKED",
  findings: [finding],
  evidenceSha256: AUDIT_SOURCE_SHA256,
  issuedAt,
  issuerKeySha256: hostKeySha256,
  signature: SIGNATURES["foreman.release-audit.v1"],
};

const councilRequest: ReleaseAuthorityReceiptV1 = {
  schema: "foreman.council-request.v1",
  program: "v040",
  packageId: "openspec-superpowers-convergence",
  candidateSha256,
  questionSha256: shaA,
  constraintsSha256: shaB,
  optionsSha256: shaC,
  issuedAt,
  issuerKeySha256: hostKeySha256,
  signature: SIGNATURES["foreman.council-request.v1"],
};

const evaluationAuthority: ReleaseAuthorityReceiptV1 = {
  schema: "foreman.evaluation-authority.v1",
  program: "v040",
  packageId: "graph-eval-falsification",
  manifestSha256: shaA,
  issuedAt,
  issuerKeySha256: userKeySha256,
  signature: SIGNATURES["foreman.evaluation-authority.v1"],
};

const actionOutcome: ReleaseActionOutcomeV1 = {
  schema: "foreman.release-action-outcome.v1",
  program: "v040",
  rootContractId: "v040-release-20260822-r4",
  rootContractSha256: shaA,
  familySha256: shaB,
  childId: "v040-t2-project-registry",
  packageId: "project-registry",
  reservationAction: "verify",
  effectiveAction: "verify",
  reservationId: "reservation-1",
  originReservationId: "reservation-1",
  candidateSha256,
  status: "PASS",
  evidenceSha256: shaC,
  issuedAt,
  issuerKeySha256: hostKeySha256,
  signature: SIGNATURES["foreman.release-action-outcome.v1"],
};

const councilOutcome: ReleaseCouncilOutcomeV1 = {
  schema: "foreman.council-outcome.v1",
  program: "v040",
  rootContractId: "v040-release-20260822-r4",
  rootContractSha256: shaA,
  familySha256: shaB,
  childId: "v040-t2-project-registry",
  packageId: "project-registry",
  reservationAction: "council",
  reservationId: "reservation-2",
  originReservationId: "reservation-2",
  candidateSha256,
  requestSha256: COUNCIL_REQUEST_SHA256,
  decisionSha256: shaC,
  status: "ADVICE",
  issuedAt,
  issuerKeySha256: hostKeySha256,
  signature: SIGNATURES["foreman.council-outcome.v1"],
};

const evaluationVerdict: ReleaseEvaluationVerdictV1 = {
  schema: "foreman.evaluation-verdict.v1",
  program: "v040",
  rootContractId: "v040-release-20260822-r4",
  rootContractSha256: shaA,
  familySha256: shaB,
  childId: "v040-t8-evaluation",
  packageId: "graph-eval-falsification",
  candidateSha256,
  authorityManifestSha256: shaA,
  evaluationAuthorityReceiptSha256: shaB,
  result: "GRAPH_OFF_UNCOMPUTABLE",
  plannedRuns: 2000,
  completedRuns: 1900,
  unavailableRuns: 50,
  notRunRuns: 50,
  runSetSha256: shaC,
  reportSha256: EVAL_REPORT_SOURCE_SHA256,
  issuedAt,
  issuerKeySha256: hostKeySha256,
  signature: SIGNATURES["foreman.evaluation-verdict.v1"],
};

const cancelApproval: ExecutionChildTerminalApprovalV1 = {
  schema: "foreman.execution-child-cancel.v1",
  program: "v040",
  rootContractId: "v040-release-20260822-r4",
  rootContractSha256: shaA,
  familySha256: shaB,
  childId: "v040-t2-project-registry",
  reasonSha256: shaC,
  issuedAt,
  issuerKeySha256: userKeySha256,
  signature: SIGNATURES["foreman.execution-child-cancel.v1"],
};

const invalidateApproval: ExecutionChildTerminalApprovalV1 = {
  schema: "foreman.execution-child-invalidate.v1",
  program: "v040",
  rootContractId: "v040-release-20260822-r4",
  rootContractSha256: shaA,
  familySha256: shaB,
  childId: "v040-t2-project-registry",
  observedFamilySha256: shaC,
  reasonSha256: shaA,
  issuedAt,
  issuerKeySha256: userKeySha256,
  signature: SIGNATURES["foreman.execution-child-invalidate.v1"],
};

const evidenceBundle: ReleaseEvidenceBundleV1 = {
  schema: "foreman.release-evidence-bundle.v1",
  program: "v040",
  rootContractId: "v040-release-20260822-r4",
  rootContractSha256: shaA,
  familySha256: shaB,
  childId: "v040-t2-project-registry",
  packageId: "project-registry",
  action: "verify",
  candidate,
  taskPlanSha256: shaB,
  receipts: [designReceipt],
  issuedAt,
  issuerKeySha256: hostKeySha256,
  signature: SIGNATURES["foreman.release-evidence-bundle.v1"],
};

const signedArtifacts = [
  designReceipt,
  checksReceipt,
  auditReceipt,
  councilRequest,
  evaluationAuthority,
  actionOutcome,
  councilOutcome,
  evaluationVerdict,
  cancelApproval,
  invalidateApproval,
  evidenceBundle,
] as const;

const producerSources = [
  checksSource,
  auditSource,
  evaluationReportSource,
] as const;

const compileTypeBindings: {
  readonly manifest: ApprovedOpenSpecManifestV1 | null;
  readonly action: ReleaseActionV1;
  readonly objectResult: ReleaseAuthorityObjectParseResultV1 | null;
  readonly fileResult: ReleaseAuthorityFileDecodeResultV1 | null;
  readonly sourceResult: ReleaseProducerSourceDecodeResultV1 | null;
  readonly bindingResult: ReleaseSourceReceiptBindingResultV1 | null;
} = {
  manifest: null,
  action: "verify",
  objectResult: null,
  fileResult: null,
  sourceResult: null,
  bindingResult: null,
};

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

const canonicalFile = (value: unknown): Uint8Array =>
  utf8(`${canonicalize(value)}\n`);

const sha256Hex = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

const validSignedArtifactCases = signedArtifacts.map((artifact) => ({
  schema: artifact.schema,
  artifact,
  bytes: canonicalFile(artifact),
}));

const validProducerSourceCases = [
  {
    schema: checksSource.schema,
    source: checksSource,
    bytes: canonicalFile(checksSource),
    sha256: CHECKS_SOURCE_SHA256,
  },
  {
    schema: auditSource.schema,
    source: auditSource,
    bytes: canonicalFile(auditSource),
    sha256: AUDIT_SOURCE_SHA256,
  },
  {
    schema: evaluationReportSource.schema,
    source: evaluationReportSource,
    bytes: canonicalFile(evaluationReportSource),
    sha256: EVAL_REPORT_SOURCE_SHA256,
  },
] as const;

describe("release authority positive signed schemas", () => {
  for (const item of validSignedArtifactCases) {
    it(item.schema, () => {
      const parsed = parseReleaseAuthorityObjectV1(item.artifact);
      assert.equal(parsed._tag, "Valid");
      if (parsed._tag === "Valid") {
        assert.deepEqual(parsed.value, item.artifact);
      }

      const decoded = decodeReleaseAuthorityFileV1(item.bytes);
      assert.equal(decoded._tag, "Valid");
      if (decoded._tag === "Valid") {
        assert.deepEqual(decoded.value, item.artifact);
        assert.equal(decoded.sha256, sha256Hex(item.bytes));
      }
    });
  }
});

describe("release authority producer sources", () => {
  for (const item of validProducerSourceCases) {
    it(item.schema, () => {
      const decoded = decodeReleaseProducerSourceFileV1(item.bytes);
      assert.equal(decoded._tag, "Valid");
      if (decoded._tag === "Valid") {
        assert.deepEqual(decoded.value, item.source);
        assert.equal(decoded.sha256, item.sha256);
        assert.equal(decoded.sha256, sha256Hex(item.bytes));
      }
    });
  }

  const bindings = [
    [checksSource, checksReceipt],
    [auditSource, auditReceipt],
    [evaluationReportSource, evaluationVerdict],
  ] as const;

  for (const [source, receipt] of bindings) {
    it(`binds ${source.schema} to ${receipt.schema}`, () => {
      assert.deepEqual(
        verifyReleaseSourceReceiptBindingV1(
          canonicalFile(source),
          canonicalFile(receipt),
        ),
        { _tag: "Valid" },
      );
    });
  }
});

describe("release authority signature preimage", () => {
  const rawPublicKey = Buffer.from(
    "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
    "hex",
  );
  const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
  const publicKey = createPublicKey({
    key: Buffer.concat([spkiPrefix, rawPublicKey]),
    format: "der",
    type: "spki",
  });
  const signature = Buffer.from(
    "f254e1822d7096fb31e5a555014cca0f7a2a5b20893f6a7677329fc783f406c9814aeba23b2ecd9fcaea2f843f4898d7e23fb08ffbe9c4a0c4134adb3d198408",
    "hex",
  );

  it("uses one LF byte between the domain and canonical object", () => {
    const message = releaseAuthoritySignaturePreimageV1({});
    assert.equal(
      Buffer.from(message).toString("hex"),
      "666f72656d616e2e72656c656173652d617574686f726974792e76310a7b7d",
    );
    assert.equal(verifyEd25519(null, message, publicKey, signature), true);
  });

  for (const [name, message] of [
    ["literal-backslash-n", utf8("foreman.release-authority.v1\\n{}")],
    ["trailing-lf", utf8("foreman.release-authority.v1\n{}\n")],
    ["trailing-nul", utf8("foreman.release-authority.v1\n{}\u0000")],
  ] as const) {
    it(`rejects ${name}`, () => {
      assert.equal(verifyEd25519(null, message, publicKey, signature), false);
    });
  }
});

void buildApprovedOpenSpecManifestV1;
void compileTypeBindings;
void producerSources;
void WRONG_ROLE_SIGNATURES;

const cloneRecord = (value: unknown): Record<string, unknown> =>
  structuredClone(value) as Record<string, unknown>;

const expectParseInvalid = (value: unknown): void => {
  assert.deepEqual(parseReleaseAuthorityObjectV1(value), { _tag: "Invalid" });
};

const expectFileInvalid = (bytes: Uint8Array): void => {
  assert.deepEqual(decodeReleaseAuthorityFileV1(bytes), { _tag: "Invalid" });
};

describe("release authority objects use closed top-level schemas", () => {
  for (const artifact of signedArtifacts) {
    describe(artifact.schema, () => {
      for (const key of Object.keys(artifact)) {
        it(`rejects missing ${key}`, () => {
          const mutant = cloneRecord(artifact);
          delete mutant[key];
          expectParseInvalid(mutant);
        });

        it(`rejects wrong-type ${key}`, () => {
          const mutant = cloneRecord(artifact);
          mutant[key] = null;
          expectParseInvalid(mutant);
        });
      }

      it("rejects an extra key", () => {
        expectParseInvalid({ ...artifact, unexpected: true });
      });
    });
  }

  it("rejects an unknown schema", () => {
    expectParseInvalid({ ...designReceipt, schema: "foreman.unknown.v1" });
  });

  it("rejects inherited authority fields", () => {
    expectParseInvalid(Object.create(designReceipt) as unknown);
  });

  for (const [name, value] of [
    ["null", null],
    ["array", []],
    ["date", new Date(0)],
    ["map", new Map()],
  ] as const) {
    it(`rejects non-plain ${name}`, () => {
      expectParseInvalid(value);
    });
  }
});

void expectFileInvalid;

const candidateMutant = (field: string, value: unknown): unknown => {
  const mutant = cloneRecord(checksReceipt);
  const nested = cloneRecord(mutant["candidate"]);
  nested[field] = value;
  mutant["candidate"] = nested;
  return mutant;
};

const actionOutcomeMutant = (field: string, value: unknown): unknown => {
  const mutant = cloneRecord(actionOutcome);
  mutant[field] = value;
  return mutant;
};

describe("release authority identity and enum bounds", () => {
  const cases: Array<readonly [string, unknown]> = [];
  const invalidGitIds = [
    "",
    "1".repeat(39),
    "1".repeat(41),
    "A".repeat(40),
    "g".repeat(40),
  ] as const;
  for (const field of ["commit", "tree"] as const) {
    for (const value of invalidGitIds) {
      cases.push(["candidate " + field + " " + JSON.stringify(value), candidateMutant(field, value)]);
    }
  }
  for (const value of [
    "a".repeat(63),
    "a".repeat(65),
    "A".repeat(64),
    "g".repeat(64),
    shaA,
  ]) {
    cases.push(["candidate sha " + value.slice(0, 8) + ":" + value.length, candidateMutant("candidateSha256", value)]);
  }

  const missingCandidateField = candidateMutant("commit", commit);
  const missingNested = cloneRecord(missingCandidateField);
  const missingNestedValue = cloneRecord(missingNested["candidate"]);
  delete missingNestedValue["commit"];
  missingNested["candidate"] = missingNestedValue;
  cases.push(["candidate missing commit", missingNested]);

  cases.push(["candidate extra key", candidateMutant("unexpected", true)]);
  const inheritedCandidate = cloneRecord(checksReceipt);
  inheritedCandidate["candidate"] = Object.create(candidate) as unknown;
  cases.push(["candidate inherited fields", inheritedCandidate]);

  const invalidIds = ["", "bad/id", "bad\u0000id", "x".repeat(129)] as const;
  for (const field of [
    "rootContractId",
    "childId",
    "packageId",
    "reservationId",
    "originReservationId",
  ] as const) {
    for (const value of invalidIds) {
      cases.push([field + " invalid " + value.length, actionOutcomeMutant(field, value)]);
    }
  }

  const invalidDigests = [
    "a".repeat(63),
    "a".repeat(65),
    "A".repeat(64),
    "g".repeat(64),
  ] as const;
  for (const field of [
    "rootContractSha256",
    "familySha256",
    "candidateSha256",
    "evidenceSha256",
  ] as const) {
    for (const value of invalidDigests) {
      cases.push([field + " invalid " + value.slice(0, 1) + ":" + value.length, actionOutcomeMutant(field, value)]);
    }
  }

  cases.push(["bundle unknown action", { ...evidenceBundle, action: "unknown" }]);
  cases.push(["outcome unknown reservation action", actionOutcomeMutant("reservationAction", "unknown")]);
  cases.push(["outcome unknown effective action", actionOutcomeMutant("effectiveAction", "unknown")]);
  cases.push(["outcome unknown status", actionOutcomeMutant("status", "unknown")]);
  cases.push(["council invalid reservation action", { ...councilOutcome, reservationAction: "integrate" }]);
  cases.push(["council invalid status", { ...councilOutcome, status: "PASS" }]);
  cases.push(["audit invalid verdict", { ...auditReceipt, verdict: "UNKNOWN" }]);
  cases.push([
    "audit invalid severity",
    { ...auditReceipt, findings: [{ ...finding, severity: "urgent" }] },
  ]);
  cases.push(["evaluation invalid result", { ...evaluationVerdict, result: "UNKNOWN" }]);
  cases.push(["evaluation wrong package", { ...evaluationVerdict, packageId: "project-registry" }]);
  cases.push(["evaluation wrong child", { ...evaluationVerdict, childId: "v040-t7-context" }]);
  cases.push(["wrong program", { ...designReceipt, program: "v050" }]);

  const invalidTimes: readonly unknown[] = [
    "2026-08-24T00:00:00",
    "2026-08-24T00:00:00.000Z",
    "2026-08-24T00:00:00+00:00",
    "2026-02-30T00:00:00Z",
    "bad\u0000time",
    1,
  ];
  for (const value of invalidTimes) {
    cases.push(["receipt invalid time " + String(value), { ...designReceipt, issuedAt: value }]);
    cases.push(["outcome invalid time " + String(value), actionOutcomeMutant("issuedAt", value)]);
  }

  for (const [name, mutant] of cases) {
    it(name, () => {
      expectParseInvalid(mutant);
    });
  }

  it("candidate digest is SHA-256 of the lowercase ASCII commit", () => {
    assert.equal(
      candidateSha256,
      createHash("sha256").update(commit, "ascii").digest("hex"),
    );
  });
});

describe("release authority finding bounds", () => {
  const findingCopies = (count: number): ReleaseAuditFindingV1[] =>
    Array.from({ length: count }, () => ({ ...finding }));

  it("accepts exactly 100 findings structurally", () => {
    assert.equal(
      parseReleaseAuthorityObjectV1({
        ...auditReceipt,
        findings: findingCopies(100),
      })._tag,
      "Valid",
    );
  });

  const invalidFindings: Array<readonly [string, unknown]> = [
    ["101 findings", findingCopies(101)],
    ["line zero", [{ ...finding, line: 0 }]],
    ["line over max", [{ ...finding, line: 2147483648 }]],
    ["line fractional", [{ ...finding, line: 1.5 }]],
    ["line string", [{ ...finding, line: "7" }]],
    ["file empty", [{ ...finding, file: "" }]],
    ["file over bound", [{ ...finding, file: "x".repeat(4097) }]],
    ["summary empty", [{ ...finding, summary: "" }]],
    ["summary over bound", [{ ...finding, summary: "x".repeat(4097) }]],
    ["evidence empty", [{ ...finding, evidence: "" }]],
    ["evidence over bound", [{ ...finding, evidence: "x".repeat(16385) }]],
    ["extra key", [{ ...finding, unexpected: true }]],
    ["inherited fields", [Object.create(finding) as unknown]],
  ];
  for (const [name, findings] of invalidFindings) {
    it("rejects " + name, () => {
      expectParseInvalid({ ...auditReceipt, findings });
    });
  }
});

describe("release evidence bundle receipt and retry grammar", () => {
  const priorReservation = {
    reservationId: "reservation-prior",
    originReservationId: "reservation-origin",
    originalAction: "verify",
    candidate,
    failureEvidenceSha256: shaC,
  } as const;
  const retryBundle = {
    ...evidenceBundle,
    action: "provider_retry",
    priorReservation,
  };

  it("accepts a structurally valid retry bundle", () => {
    assert.equal(parseReleaseAuthorityObjectV1(retryBundle)._tag, "Valid");
  });

  const invalidBundles: Array<readonly [string, unknown]> = [
    ["zero receipts", { ...evidenceBundle, receipts: [] }],
    ["three receipts", { ...evidenceBundle, receipts: [designReceipt, checksReceipt, auditReceipt] }],
    ["verify wrong receipt", { ...evidenceBundle, receipts: [checksReceipt] }],
    ["audit wrong order", { ...evidenceBundle, action: "audit", receipts: [checksReceipt, designReceipt] }],
    ["receipt extra key", { ...evidenceBundle, receipts: [{ ...designReceipt, unexpected: true }] }],
    ["receipt inherited fields", { ...evidenceBundle, receipts: [Object.create(designReceipt) as unknown] }],
    ["prior on ordinary verify", { ...evidenceBundle, priorReservation }],
    ["retry three receipts", { ...retryBundle, receipts: [designReceipt, checksReceipt, auditReceipt] }],
    ["retry extra prior key", { ...retryBundle, priorReservation: { ...priorReservation, unexpected: true } }],
    ["retry unknown original action", { ...retryBundle, priorReservation: { ...priorReservation, originalAction: "unknown" } }],
    ["retry bad prior candidate", { ...retryBundle, priorReservation: { ...priorReservation, candidate: { ...candidate, commit: "1".repeat(39) } } }],
    ["retry bad failure digest", { ...retryBundle, priorReservation: { ...priorReservation, failureEvidenceSha256: "a".repeat(63) } }],
  ];
  for (const key of Object.keys(priorReservation)) {
    const missing = cloneRecord(priorReservation);
    delete missing[key];
    invalidBundles.push(["retry missing prior " + key, { ...retryBundle, priorReservation: missing }]);
  }

  for (const [name, mutant] of invalidBundles) {
    it("rejects " + name, () => {
      expectParseInvalid(mutant);
    });
  }
});

describe("release evaluation count grammar", () => {
  const cases: Array<readonly [string, unknown]> = [
    ["planned not 2000", { ...evaluationVerdict, plannedRuns: 1999 }],
    ["wrong run-set digest", { ...evaluationVerdict, runSetSha256: "a".repeat(63) }],
    ["wrong report digest", { ...evaluationVerdict, reportSha256: "a".repeat(63) }],
    ["sum 1999", { ...evaluationVerdict, completedRuns: 1899 }],
    ["sum 2001", { ...evaluationVerdict, completedRuns: 1901 }],
  ];
  for (const field of ["completedRuns", "unavailableRuns", "notRunRuns"] as const) {
    for (const value of [-1, 1.5, "1", 2001] as const) {
      cases.push([field + " invalid " + String(value), { ...evaluationVerdict, [field]: value }]);
    }
  }
  for (const [name, mutant] of cases) {
    it("rejects " + name, () => {
      expectParseInvalid(mutant);
    });
  }
});

describe("release outcome and terminal approval distinctions", () => {
  const cases: Array<readonly [string, unknown]> = [
    ["outcome empty origin", { ...actionOutcome, originReservationId: "" }],
    ["retry effective retry", { ...actionOutcome, reservationAction: "provider_retry", effectiveAction: "provider_retry" }],
    ["council malformed request digest", { ...councilOutcome, requestSha256: "a".repeat(63) }],
    ["cancel observed-family extra", { ...cancelApproval, observedFamilySha256: shaC }],
    ["invalidate observed-family missing", (() => {
      const mutant = cloneRecord(invalidateApproval);
      delete mutant["observedFamilySha256"];
      return mutant;
    })()],
  ];
  for (const [name, mutant] of cases) {
    it("rejects " + name, () => {
      expectParseInvalid(mutant);
    });
  }
});

describe("release authority canonical signed-file rejection", () => {
  const designCanonical = canonicalize(designReceipt);
  const designBytes = canonicalFile(designReceipt);
  const checksCanonical = canonicalize(checksReceipt);

  const wrongRoleDesign = {
    ...designReceipt,
    packageId: "openspec-superpowers-convergence",
    issuerKeySha256: hostKeySha256,
    signature:
      "EIcdBrEJDXO-L3V0RCb_f_3sAx6zU06waOcaB9RYfxSnnUmwPO8A0zLNnfeZ9hbroFMvgKg_U4xuspkvLMdvDw",
  };
  const wrongRoleChecks = {
    ...checksReceipt,
    issuerKeySha256: userKeySha256,
    signature:
      "dsi_yV2GyHgKgekqycBisIijd9K1_5X3noEcH1NYG6M1QF0P3CEd4s0PW07lDpkGMI28mC5fCOIw4_pjZgI2Aw",
  };

  const changedSignature =
    (designReceipt.signature.startsWith("A") ? "B" : "A") +
    designReceipt.signature.slice(1);
  const fileCases: Array<readonly [string, Uint8Array]> = [
    ["missing LF", designBytes.slice(0, -1)],
    ["CRLF", utf8(designCanonical + "\r\n")],
    ["two LFs", utf8(designCanonical + "\n\n")],
    ["noncanonical key order", utf8(JSON.stringify(designReceipt) + "\n")],
    ["noncanonical whitespace", utf8(designCanonical.replace(":", ": ") + "\n")],
    ["duplicate root key", utf8('{"schema":"foreman.design-approval.v1",' + designCanonical.slice(1) + "\n")],
    [
      "duplicate nested key",
      utf8(
        checksCanonical.replace(
          '"candidate":{',
          '"candidate":{"commit":"' + commit + '",',
        ) + "\n",
      ),
    ],
    ["invalid UTF-8", Uint8Array.of(0xff)],
    ["padded signature", canonicalFile({ ...designReceipt, signature: designReceipt.signature + "=" })],
    ["standard base64 characters", canonicalFile({ ...designReceipt, signature: "+" + designReceipt.signature.slice(1, -1) + "/" })],
    ["63-byte signature", canonicalFile({ ...designReceipt, signature: Buffer.alloc(63).toString("base64url") })],
    ["65-byte signature", canonicalFile({ ...designReceipt, signature: Buffer.alloc(65).toString("base64url") })],
    ["changed signature", canonicalFile({ ...designReceipt, signature: changedSignature })],
    ["unknown fingerprint", canonicalFile({ ...designReceipt, issuerKeySha256: shaA })],
    ["valid signature from wrong design role", canonicalFile(wrongRoleDesign)],
    ["valid signature from wrong checks role", canonicalFile(wrongRoleChecks)],
  ];

  assert.notEqual(JSON.stringify(designReceipt), designCanonical);
  for (const [name, bytes] of fileCases) {
    it("rejects " + name, () => {
      expectFileInvalid(bytes);
    });
  }

  it("rejects a valid signed file larger than 1 MiB", () => {
    const largeFinding = { ...finding, evidence: "x".repeat(16384) };
    const largeAuditReceipt = {
      ...auditReceipt,
      findings: Array.from({ length: 100 }, () => largeFinding),
      signature:
        "Nkq0xKhgFHe-z791vQ9DnOH8ZmzWWC1oGNnIBVGS3v4E2JrAawUUGAnqQXZc60bXjXSyBdfPAC7WYy9jd2jsCw",
    };
    const bytes = canonicalFile(largeAuditReceipt);
    assert.equal(bytes.byteLength > 1024 * 1024, true);
    assert.equal(parseReleaseAuthorityObjectV1(largeAuditReceipt)._tag, "Valid");
    expectFileInvalid(bytes);
  });
});

const expectSourceInvalid = (bytes: Uint8Array): void => {
  assert.deepEqual(decodeReleaseProducerSourceFileV1(bytes), { _tag: "Invalid" });
};

describe("release producer source canonical schemas and bounds", () => {
  for (const source of producerSources) {
    describe(source.schema, () => {
      for (const key of Object.keys(source)) {
        it("rejects missing " + key, () => {
          const mutant = cloneRecord(source);
          delete mutant[key];
          expectSourceInvalid(canonicalFile(mutant));
        });
        it("rejects wrong-type " + key, () => {
          expectSourceInvalid(canonicalFile({ ...source, [key]: null }));
        });
      }
      it("rejects an extra key", () => {
        expectSourceInvalid(canonicalFile({ ...source, unexpected: true }));
      });
    });
  }

  const checksCanonical = canonicalize(checksSource);
  for (const [name, bytes] of [
    ["missing LF", canonicalFile(checksSource).slice(0, -1)],
    ["CRLF", utf8(checksCanonical + "\r\n")],
    ["two LF", utf8(checksCanonical + "\n\n")],
    ["noncanonical order", utf8(JSON.stringify(checksSource) + "\n")],
    ["noncanonical whitespace", utf8(checksCanonical.replace(":", ": ") + "\n")],
    ["duplicate root", utf8('{"schema":"foreman.checks-source.v1",' + checksCanonical.slice(1) + "\n")],
    [
      "duplicate command field",
      utf8(
        checksCanonical.replace('"commands":[{', '"commands":[{"exitCode":1,') +
          "\n",
      ),
    ],
    ["invalid UTF-8", Uint8Array.of(0xff)],
  ] as const) {
    it("rejects " + name, () => {
      expectSourceInvalid(bytes);
    });
  }

  const command = checksSource.commands[0];
  const invalidChecks: Array<readonly [string, unknown]> = [
    ["zero commands", { ...checksSource, commands: [] }],
    ["257 commands", { ...checksSource, commands: Array.from({ length: 257 }, () => command) }],
    ["exit negative", { ...checksSource, commands: [{ ...command, exitCode: -1 }] }],
    ["exit over 255", { ...checksSource, commands: [{ ...command, exitCode: 256 }] }],
    ["exit fractional", { ...checksSource, commands: [{ ...command, exitCode: 1.5 }] }],
    ["command extra key", { ...checksSource, commands: [{ ...command, unexpected: true }] }],
    ["command inherited fields", { ...checksSource, commands: [Object.create(command) as unknown] }],
    ["command bad stdout digest", { ...checksSource, commands: [{ ...command, stdoutSha256: "a".repeat(63) }] }],
  ];
  for (const [name, mutant] of invalidChecks) {
    it("rejects " + name, () => {
      expectSourceInvalid(canonicalFile(mutant));
    });
  }

  it("rejects 101 audit findings", () => {
    expectSourceInvalid(
      canonicalFile({
        ...auditSource,
        findings: Array.from({ length: 101 }, () => finding),
      }),
    );
  });

  it("rejects a structurally valid producer file larger than 1 MiB", () => {
    const largeSource = {
      ...auditSource,
      findings: Array.from({ length: 100 }, () => ({
        ...finding,
        evidence: "x".repeat(16384),
      })),
    };
    const bytes = canonicalFile(largeSource);
    assert.equal(bytes.byteLength > 1024 * 1024, true);
    expectSourceInvalid(bytes);
  });

  const invalidEvaluationSources: Array<readonly [string, unknown]> = [
    ["wrong package", { ...evaluationReportSource, packageId: "project-registry" }],
    ["planned not 2000", { ...evaluationReportSource, plannedRuns: 1999 }],
    ["sum 1999", { ...evaluationReportSource, completedRuns: 1899 }],
    ["sum 2001", { ...evaluationReportSource, completedRuns: 1901 }],
  ];
  for (const field of ["completedRuns", "unavailableRuns", "notRunRuns"] as const) {
    for (const value of [-1, 1.5, "1", 2001] as const) {
      invalidEvaluationSources.push([
        field + " invalid " + String(value),
        { ...evaluationReportSource, [field]: value },
      ]);
    }
  }
  for (const [name, mutant] of invalidEvaluationSources) {
    it("rejects evaluation " + name, () => {
      expectSourceInvalid(canonicalFile(mutant));
    });
  }
});

describe("release producer receipts copy every authoritative field", () => {
  const alternateCandidate = {
    commit: "3".repeat(40),
    tree: "4".repeat(40),
    candidateSha256:
      "e69e5e6f3541ea47026a711c50e1b0f79537e2898c0a72af9909c1702821ca6c",
  };
  const cases: Array<readonly [string, unknown, unknown]> = [
    ["checks package", checksSource, { ...checksReceipt, packageId: "project-registry", signature: "7cfb3F9-xZ28ogWLtjAjR6u_n3nWZNPtdYv4Xg2D4VtpRkPYEPLlIYVJCXRIagd5zGp9SYoRSeHIeD2B2kuqAw" }],
    ["checks candidate", checksSource, { ...checksReceipt, candidate: alternateCandidate, signature: "TWWEuHL2bCGEfSVSBeTab35MP0jSCR1FSqeQxsdmzSRVnzPdgQccgx-u9gvYEpxB9rZUm8tGLzoz8GilvwViCQ" }],
    ["checks status", checksSource, { ...checksReceipt, status: "PASS", signature: "iXQ5cpww7G3Mz1E16OcZBgEE7VI83h5o42_c-PhA2oKntifGHHonyW1AXQEJytv5Mhl4LlQRME0dUeuYhBz2CQ" }],
    ["checks digest", checksSource, { ...checksReceipt, checksSha256: shaA, signature: "DHHMSMnVCJ6gyzfI-veNIiRsL4mMsD_8-uTIiDRWi_drYE8esN8ZlZ3dcxqodTb4CgynKgs3WWNYl3YIwdbVAA" }],
    ["audit package", auditSource, { ...auditReceipt, packageId: "project-registry", signature: "53zetoZQmyZ0IuUTzqeatuaWWz60mbxIR8pecFk_LOKaD_uSEpYBch6DWHowaRQDUjPp7aMTuTnFBCrrggzqBA" }],
    ["audit candidate", auditSource, { ...auditReceipt, candidate: alternateCandidate, signature: "6EvAnyHV3naNPnMJ0u3mbbVeQMI4YAETdM7ODai8hZgeLKW0EQJMuRL7JJJrBz2Cg1NA-CdGEvZrYZuD5HItAQ" }],
    ["audit verdict", auditSource, { ...auditReceipt, verdict: "WARNING", signature: "3t-h6TdMr7bRgyeZvNd-Sqi2UmgMTVAGacmD1W8L0SCflYrhl1hq3xeGW1E6DGncv3VHAB-rn2TS-MdLQ4LpBA" }],
    ["audit findings", auditSource, { ...auditReceipt, findings: [], signature: "mZ_i-XXaOnrCukOTyK751uhV0REPlG7Chu8tyJvrNbunoRm_lBuFfsg1NuFjPQxGgvzasn15nHZATZqjvxbqBQ" }],
    ["audit digest", auditSource, { ...auditReceipt, evidenceSha256: shaA, signature: "64GQ0UhIk1hfMMrjRkYTg_gH-VuMu2t-VK_TE6bqR6BrJ1ADQT8jrxeaozcrQpTHXzW3aAjPlZ6OWK-0Hj4TAw" }],
    ["evaluation candidate", evaluationReportSource, { ...evaluationVerdict, candidateSha256: shaA, signature: "cy6c_SlHEihQIw5EHQdXbDAwit4T38vlsR9Mch7XwMsQCkK0iD265qFqIS-oPyXfHLnvFezeoLXxTDTWWQpzCw" }],
    ["evaluation manifest", evaluationReportSource, { ...evaluationVerdict, authorityManifestSha256: shaC, signature: "1sR1NlBRSjdN6l2EKmrTq0fcdE9MyHK9QuyeYAtTKb2DTHcNx01q-TvLO8lP0v4-HY6W7SEPpioIejRMozA-Dw" }],
    ["evaluation authority receipt", evaluationReportSource, { ...evaluationVerdict, evaluationAuthorityReceiptSha256: shaC, signature: "xe1mpfRHdUxSjgJ5cye2ljAylfPxKxKkflmR2gQiqun-o312tB5i_4NIW9G1qWa4LnMt7gpk5J9SXRWCg1CUCg" }],
    ["evaluation result", evaluationReportSource, { ...evaluationVerdict, result: "PROMOTE", signature: "eWx_sAEEDKgFgtbM24ofiIz6ABbmbgo-blzMzW3-RDq0Cm_lEWb1EOi5FIshTazH_BpeshlhKEzjV7xioYmGCg" }],
    ["evaluation counts", evaluationReportSource, { ...evaluationVerdict, completedRuns: 1899, notRunRuns: 51, signature: "IrtC36erMkt-l8PmBxmDEPLZOIq-IvT-0yef7mfZWU4tRQRYI4PqUMTzffTlE3DHROHHwZEx7KoKQKgS9PAxDw" }],
    ["evaluation run set", evaluationReportSource, { ...evaluationVerdict, runSetSha256: shaA, signature: "kU3YByXCm33f8ui33Uyloj-xm3LfK3FIxsE1kHbs6SI5c3Iqr5TmiCoVwmgoVZunMu3UvTPZxEJ91i-3aTYYCA" }],
    ["evaluation report digest", evaluationReportSource, { ...evaluationVerdict, reportSha256: shaA, signature: "9in_eCc53cER_HDntgbhS3C70K9mQkEgUpV7gMOFqh5DacoMCVJPdktfGSNgz_Ga3x1lsM0R8IlzkR-wW19dDA" }],
  ];
  for (const [name, source, receipt] of cases) {
    it("rejects mismatched " + name, () => {
      assert.deepEqual(
        verifyReleaseSourceReceiptBindingV1(
          canonicalFile(source),
          canonicalFile(receipt),
        ),
        { _tag: "Invalid" },
      );
    });
  }
});
