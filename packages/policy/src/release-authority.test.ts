import assert from "node:assert/strict";
import { createHash, createPublicKey, verify as verifyEd25519 } from "node:crypto";
import { describe, it } from "node:test";

import { canonicalize } from "@foreman/core";

import {
  buildApprovedOpenSpecManifestV1,
  decodeReleaseAuthorityFileV1,
  validateApprovedOpenSpecManifestV1,
  decodeReleaseProducerSourceFileV1,
  parseReleaseAuthorityObjectV1,
  releaseAuthoritySignaturePreimageV1,
  verifyReleaseSourceReceiptBindingV1,
  type ApprovedOpenSpecManifestBuildResultV1,
  type ApprovedOpenSpecManifestValidationResultV1,
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
  "454e04effab1f4bd83757aa23b3885fff8ed3cc9bbc226acdd816496abee370c";
const hostKeySha256 =
  "205477e6a7d35c81501a19e6e626b14664b2ed09d20edd7dce0c7c122912511b";

const SIGNATURES = {
  "foreman.design-approval.v1":
    "CYcZ9wBPsidcaD-v3I0K3iqXFNGVY-jp7vqN1OR440ZsPFFHZRAf4J_f4bi1zrd4tUctlCzaIFdziDwNhjMvBQ",
  "foreman.checks-evidence.v1":
    "CNlX0j4NSe-cTOqg3lzHg0gBEeUtQezpuDj_rWAgAa4sAX5Dwq8p5VoVIj3K_Va5iK5ew0ur_ratuWg1coQaBw",
  "foreman.release-audit.v1":
    "hHmQ70NXfzzidM1H4GC6clkOYJy6vtTJe-_pzOPfu66ugiKPKUi29tuIbCZqM_Y23zBoKn1ecfjHHb3rWhmMBg",
  "foreman.council-request.v1":
    "V0s-BYwNJNLGNCW3pj8EVvFTQlPs710Jx8JwvropohzMiLs17G0PaCXRbXosCRGgp0atVeOexAPt7Pmt6UKoCA",
  "foreman.evaluation-authority.v1":
    "s7KiG8JWqlILA_5tvWlXY0LhQ2u86ufnkS9V-gDrCaAjQZ8LBqRIFXkz9EbbEq_G0NFYNU92QNQk0C4_ud-vBA",
  "foreman.release-action-outcome.v1":
    "-aFTsII3rbo9CpBWVtVu_GzkxoUkH1HXCszZxBkrfOkg5BUNU__h4sofycrDDr5uP55bbPufmRQE1g5ebZz9BQ",
  "foreman.council-outcome.v1":
    "cT4Dwdyhh_t6usjsCzSzASkm6Xt4_8x8O7KmfY8O6LTFZrl7ek0nVw5FZ1EfHOylxODt6uEyfS9AVlChMygVBw",
  "foreman.evaluation-verdict.v1":
    "u1hR4aZCqnHh48Gu0FSTzf-DMgjy_sazaTvDOU5jK-LiIOAxyjfqfMxZpXe59EFi93PjbdsO2zGGCimyZDRDBQ",
  "foreman.execution-child-cancel.v1":
    "EzfWEzUO5-EVUlWW02R5iul9FOe3X-tATEZW9axieJA5nMfMuRLjj6hSqHPFhbiR_8d4MzLOlE7JkLApxfEjCA",
  "foreman.execution-child-invalidate.v1":
    "d_Q57fcsQWADkCxGCEAVIQFctw2yJmUSLZoPUdKvxFVU2LgxaI8Mg2Inlbl8Ob7pjKxTOPyEriAWGJDT-qoMBg",
  "foreman.release-evidence-bundle.v1":
    "bn0jpjhOHlK9cAFwtS16Wsol0fFDoENfx86MFv0sFKl-0ZfnqJMEgZFzt-B39mT594PhCxBrE90CJT8qiifcBw",
} as const;

const WRONG_ROLE_SIGNATURES = {
  designApprovalByHost:
    "F4wp6FzhYGV629exKQBYMP2kMtRpXwRmJqSKyA2q6LxZs-6cSgbs8N1bKz4cUqFe9QWYpPplPB6NRcbuhKeECw",
  checksEvidenceByUser:
    "NjDTMQjBxci-3u-WeQKU7ra66wvs0A3j4sLIxPeV20ZR8ADrm05AJNh3nxbjufiTuvBl1tA0h0T7UjcsUhckCA",
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
  readonly manifestBuild: ApprovedOpenSpecManifestBuildResultV1 | null;
  readonly manifestValidation: ApprovedOpenSpecManifestValidationResultV1 | null;
  readonly action: ReleaseActionV1;
  readonly objectResult: ReleaseAuthorityObjectParseResultV1 | null;
  readonly fileResult: ReleaseAuthorityFileDecodeResultV1 | null;
  readonly sourceResult: ReleaseProducerSourceDecodeResultV1 | null;
  readonly bindingResult: ReleaseSourceReceiptBindingResultV1 | null;
} = {
  manifest: null,
  manifestBuild: null,
  manifestValidation: null,
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

  it("enforces outcome cross-field grammar", () => {
    const coherent = (
      action: ReleaseActionV1,
      status: ReleaseActionOutcomeV1["status"],
    ): ReleaseActionOutcomeV1 => ({
      ...actionOutcome,
      reservationAction: action,
      effectiveAction: action,
      originReservationId: actionOutcome.reservationId,
      status,
    });

    const invalid: Array<readonly [string, unknown]> = [
      [
        "ordinary verify with effectiveAction audit",
        { ...actionOutcome, effectiveAction: "audit" },
      ],
      [
        "ordinary verify with distinct origin",
        { ...actionOutcome, originReservationId: "reservation-other" },
      ],
      [
        "ordinary council with distinct origin",
        { ...councilOutcome, originReservationId: "reservation-other" },
      ],
    ];
    for (const action of ["implement", "correct", "council"] as const) {
      invalid.push(["PASS coherent " + action, coherent(action, "PASS")]);
    }
    for (const action of [
      "implement",
      "correct",
      "council",
      "integrate",
      "publish",
    ] as const) {
      invalid.push([
        "BLOCKING coherent " + action,
        coherent(action, "BLOCKING"),
      ]);
    }
    for (const [, mutant] of invalid) {
      expectParseInvalid(mutant);
    }

    const valid: Array<readonly [string, unknown]> = [];
    for (const action of [
      "verify",
      "audit",
      "integrate",
      "publish",
      "evaluate",
    ] as const) {
      valid.push(["PASS coherent " + action, coherent(action, "PASS")]);
    }
    for (const action of ["verify", "audit", "evaluate"] as const) {
      valid.push([
        "BLOCKING coherent " + action,
        coherent(action, "BLOCKING"),
      ]);
    }
    for (const action of [
      "implement",
      "verify",
      "audit",
      "correct",
      "council",
      "integrate",
      "publish",
      "evaluate",
    ] as const) {
      valid.push([
        "EXTERNAL_FAILURE coherent " + action,
        coherent(action, "EXTERNAL_FAILURE"),
      ]);
    }
    valid.push([
      "provider_retry EXTERNAL_FAILURE verify distinct origin",
      {
        ...actionOutcome,
        reservationAction: "provider_retry",
        effectiveAction: "verify",
        originReservationId: "reservation-origin",
        status: "EXTERNAL_FAILURE",
      },
    ]);
    valid.push([
      "ordinary council equal origin",
      { ...councilOutcome },
    ]);
    valid.push([
      "resume council distinct origin",
      {
        ...councilOutcome,
        reservationAction: "resume",
        originReservationId: "reservation-origin",
      },
    ]);
    for (const [name, value] of valid) {
      assert.equal(
        parseReleaseAuthorityObjectV1(value)._tag,
        "Valid",
        name,
      );
    }
  });
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
      "F4wp6FzhYGV629exKQBYMP2kMtRpXwRmJqSKyA2q6LxZs-6cSgbs8N1bKz4cUqFe9QWYpPplPB6NRcbuhKeECw",
  };
  const wrongRoleChecks = {
    ...checksReceipt,
    issuerKeySha256: userKeySha256,
    signature:
      "NjDTMQjBxci-3u-WeQKU7ra66wvs0A3j4sLIxPeV20ZR8ADrm05AJNh3nxbjufiTuvBl1tA0h0T7UjcsUhckCA",
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
    [
      "revoked user fingerprint",
      canonicalFile({
        ...designReceipt,
        issuerKeySha256:
          "00f3a61e60f4e7c066a13b9d8b98617ce015a40a0fd922f0a4af975c03d3ca3b",
      }),
    ],
    [
      "revoked host fingerprint",
      canonicalFile({
        ...checksReceipt,
        issuerKeySha256:
          "6d6ad713d16b7803dddbe84a449f6df798455e4494b22a9da6bf96d043b42397",
      }),
    ],
  ];

  assert.notEqual(JSON.stringify(designReceipt), designCanonical);
  for (const [name, bytes] of fileCases) {
    it("rejects " + name, () => {
      expectFileInvalid(bytes);
    });
  }

  it("rejects an outer-valid bundle with a forged nested receipt signature", () => {
    const forgedSignature =
      (designReceipt.signature.startsWith("A") ? "B" : "A") +
      designReceipt.signature.slice(1);
    const forgedNestedDesign: ReleaseAuthorityReceiptV1 = {
      ...designReceipt,
      signature: forgedSignature,
    };
    const outerValidForgedNested: ReleaseEvidenceBundleV1 = {
      ...evidenceBundle,
      receipts: [forgedNestedDesign],
      signature:
        "5VhWLDYyhNiZ5vG5agkNPamz0e3UOWyJdNzwmP8eTn2L3K5GIO7fPX3J7Hmexr6x2tw3276OjxoVUvtZkjmMBw",
    };

    const outerWithoutSignature = cloneRecord(outerValidForgedNested);
    delete outerWithoutSignature["signature"];
    const hostPublicKey = createPublicKey({
      key: Buffer.from(
        "MCowBQYDK2VwAyEAoczdxczpGA6Kk4gtzp80-6wpCRT1K6wzI6wbKDXLdpY",
        "base64url",
      ),
      format: "der",
      type: "spki",
    });
    assert.equal(
      verifyEd25519(
        null,
        releaseAuthoritySignaturePreimageV1(outerWithoutSignature),
        hostPublicKey,
        Buffer.from(outerValidForgedNested.signature, "base64url"),
      ),
      true,
    );
    assert.equal(
      parseReleaseAuthorityObjectV1(outerValidForgedNested)._tag,
      "Valid",
    );
    assert.deepEqual(
      decodeReleaseAuthorityFileV1(canonicalFile(outerValidForgedNested)),
      { _tag: "Invalid" },
    );
  });

  it("rejects a valid signed file larger than 1 MiB", () => {
    const largeFinding = { ...finding, evidence: "x".repeat(16384) };
    const largeAuditReceipt = {
      ...auditReceipt,
      findings: Array.from({ length: 100 }, () => largeFinding),
      signature:
        "aLmuu03Xmji6pT9Y0u2qn30P3uPdcost4z7xFY8o-ZU21B5FZUfST-n_e-WklHJal7_k8fToHEqF09-ft-DwBQ",
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

  const command = checksSource.commands[0]!;
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
    ["checks package", checksSource, { ...checksReceipt, packageId: "project-registry", signature: "D4EVwQHelBjWcYjxlhNSYvXqYsCpjIB4Kl5E4jeOfXGqvOTRewmzDiO79pXxTH9gs99f6jhgShFr5NNw368ZCg" }],
    ["checks candidate", checksSource, { ...checksReceipt, candidate: alternateCandidate, signature: "BZ8Mz4RhsSeILqZ9Ifmd9Yjvd6WcevFLdknEL01PTxZSSAB_maTGCson3I2HcPaaZy7o7hxOu2xTjlyTSpxlDw" }],
    ["checks status", checksSource, { ...checksReceipt, status: "PASS", signature: "VTnbQyrJRbOEADyRsxSkT34cIfhZa8IupKBeTk-FGSPhssDSbKI01Mx6TMko_6iO1qWMFoaPC9MHt0l1hBy9Cw" }],
    ["checks digest", checksSource, { ...checksReceipt, checksSha256: shaA, signature: "NV8FaCdxfLi49DDUv-I3IJyy9xaPj5rQW31kbTK8Cxo0f1Y9Nn1otdJCXPDFWoXJb5v_0S442Wde5qylq_AbBA" }],
    ["audit package", auditSource, { ...auditReceipt, packageId: "project-registry", signature: "i2LR747ElLI__9qA_9SSUaqzMRRAXRVKsAzX51RpUa4LlIdRJZuEWnEtSOtgAgXoN3ufa1cw5iU4mb-AIBQ3Dw" }],
    ["audit candidate", auditSource, { ...auditReceipt, candidate: alternateCandidate, signature: "GD5ue7LYvh10d3Y2BnXSuuzuTnerF83u9b704tCh0YHLYxG_HyE_2a2VbpTce5X9tfjFkKZCuhSNByofYaQLCA" }],
    ["audit verdict", auditSource, { ...auditReceipt, verdict: "WARNING", signature: "uHaJSq4CpmCt4WMhe2Zu4NqYmxc_6wTn_VNYTy7nL26_qyk5ur0al3_AaUWq37Gk9ouygNIeN71a9FXq2JmXDw" }],
    ["audit findings", auditSource, { ...auditReceipt, findings: [], signature: "MqCiQ6GoAih0lgwX5It8cJ-JA44lRJ753u-WkfnJKkHolvxFMWHsRU-QsJ9w5_lQVMe2XDEHT15js2Sai64cBA" }],
    ["audit digest", auditSource, { ...auditReceipt, evidenceSha256: shaA, signature: "Av1RfbJpGH40lDBUo8avuk2U6EMIOEfMcGNYXlDzzBNVz2bXR8HXDSJxOL3alX-1F1kTMf1Jef8ADjtL3oS_Bw" }],
    ["evaluation candidate", evaluationReportSource, { ...evaluationVerdict, candidateSha256: shaA, signature: "kSfs1A78nQpdnRNkaFFWV6CyV2QSdETGaTsa28QO8-QPwK0bfx4X_Qr-tDUAGIJ6zdhDMUBW8XyI2HLIN2KNBw" }],
    ["evaluation manifest", evaluationReportSource, { ...evaluationVerdict, authorityManifestSha256: shaC, signature: "ifplNg18l7a_1bcKKuXJ3EBFo0WW6vjJjZTzib1STbawHCCkSWf_urBZSYzKYh_Y6kAi4S7nAGNjcrGjqGltAA" }],
    ["evaluation authority receipt", evaluationReportSource, { ...evaluationVerdict, evaluationAuthorityReceiptSha256: shaC, signature: "TPoLZEZ9-Hgv1Z3yI0DBMTVbTlSM0VAl7kvopvfU22WVIbi92MFnRk83Bm7NjnokH6dTqc5ZRnIiAjHXh0TrAA" }],
    ["evaluation result", evaluationReportSource, { ...evaluationVerdict, result: "PROMOTE", signature: "e5TyQDV-0XSyLj60RMfjsdgIOvdqieFB9Zjv7t6fEwWVCEbZnbnLgx5Hs0HfA0at9tVxngiWq_YVAGUkiO7kCA" }],
    ["evaluation counts", evaluationReportSource, { ...evaluationVerdict, completedRuns: 1899, notRunRuns: 51, signature: "-C7YHlO3JXzISJ7ptAGso0qAJF2eVMSNjvd_pNe0b-hCCG_dTwIht8ZFJ8pUfAPNtk5QQOeBDTlCXLvYs_LvBw" }],
    ["evaluation run set", evaluationReportSource, { ...evaluationVerdict, runSetSha256: shaA, signature: "KyKwFfB_4caa9rWAA4FTvmzWUnw5SatgxunCfastxvCJ_DVaPzb1w3CuZSN5b9w05_JLSxoB0sXs-thqPS63Bg" }],
    ["evaluation report digest", evaluationReportSource, { ...evaluationVerdict, reportSha256: shaA, signature: "mN7Lsu8zP0Ju9yq_4qa8OMVppBMbKa0sNQQUgomfD7aCnjpQziT_gw6N5a7sTOr9_qSqP03bXauGz7DCyl6ECA" }],
  ];
  for (const [name, source, receipt] of cases) {
    it("rejects mismatched " + name, () => {
      assert.equal(
        decodeReleaseAuthorityFileV1(canonicalFile(receipt))._tag,
        "Valid",
      );
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

describe("approved OpenSpec manifest", () => {
  const architecturalFiles = [
    { path: "design.md", bytes: utf8("design\r\n") },
    { path: "proposal.md", bytes: utf8("proposal\n") },
    { path: "specs/a/spec.md", bytes: utf8("alpha\n") },
    { path: "specs/nested/z.md", bytes: utf8("zeta\n") },
  ] as const;
  const architecturalWithoutDesign = architecturalFiles.slice(1);
  const boundedFiles = [
    { path: "proposal.md", bytes: utf8("proposal\n") },
    { path: "specs/a/spec.md", bytes: utf8("alpha\n") },
  ] as const;

  it("builds the exact architectural manifest and digest", () => {
    const result = buildApprovedOpenSpecManifestV1({
      workflow: "foreman-architectural",
      files: architecturalFiles,
    });
    assert.equal(result._tag, "Valid");
    if (result._tag === "Valid") {
      assert.deepEqual(
        result.manifest.files.map((row) => row.path),
        architecturalFiles.map((row) => row.path),
      );
      for (let index = 0; index < architecturalFiles.length; index += 1) {
        assert.equal(
          result.manifest.files[index]?.sha256,
          sha256Hex(architecturalFiles[index]!.bytes),
        );
      }
      assert.equal(
        result.sha256,
        sha256Hex(utf8(canonicalize(result.manifest))),
      );
      assert.equal(
        validateApprovedOpenSpecManifestV1({
          workflow: "foreman-architectural",
          manifest: result.manifest,
          files: architecturalFiles,
        })._tag,
        "Valid",
      );
      assert.equal(
        result.manifest.files.some((row) => row.path === "tasks.md"),
        false,
      );
    }
  });

  for (const [name, workflow, files] of [
    ["architectural without design", "foreman-architectural", architecturalWithoutDesign],
    ["bounded without design", "foreman-bounded", boundedFiles],
  ] as const) {
    it("accepts " + name, () => {
      assert.equal(
        buildApprovedOpenSpecManifestV1({ workflow, files })._tag,
        "Valid",
      );
    });
  }

  it("binds raw CRLF and LF bytes differently", () => {
    const lfFiles = [
      { path: "proposal.md", bytes: utf8("proposal\n") },
      { path: "specs/a.md", bytes: utf8("line\n") },
    ] as const;
    const crlfFiles = [
      { path: "proposal.md", bytes: utf8("proposal\n") },
      { path: "specs/a.md", bytes: utf8("line\r\n") },
    ] as const;
    const lf = buildApprovedOpenSpecManifestV1({
      workflow: "foreman-bounded",
      files: lfFiles,
    });
    const crlf = buildApprovedOpenSpecManifestV1({
      workflow: "foreman-bounded",
      files: crlfFiles,
    });
    assert.equal(lf._tag, "Valid");
    assert.equal(crlf._tag, "Valid");
    if (lf._tag === "Valid" && crlf._tag === "Valid") {
      assert.notEqual(lf.manifest.files[1]?.sha256, crlf.manifest.files[1]?.sha256);
      assert.notEqual(lf.sha256, crlf.sha256);
    }
  });

  it("uses UTF-8 byte path order, not UTF-16 order", () => {
    const files = [
      { path: "proposal.md", bytes: utf8("proposal\n") },
      { path: "specs/\uE000.md", bytes: utf8("private\n") },
      { path: "specs/\u{10000}.md", bytes: utf8("non-bmp\n") },
    ] as const;
    assert.equal(
      Buffer.from(files[1].path).compare(Buffer.from(files[2].path)) < 0,
      true,
    );
    assert.equal(
      buildApprovedOpenSpecManifestV1({
        workflow: "foreman-bounded",
        files,
      })._tag,
      "Valid",
    );
    assert.equal(
      buildApprovedOpenSpecManifestV1({
        workflow: "foreman-bounded",
        files: [files[0], files[2], files[1]],
      })._tag,
      "Invalid",
    );
  });

  const invalidBuilds: Array<readonly [string, {
    readonly workflow: "foreman-architectural" | "foreman-bounded";
    readonly files: readonly { readonly path: string; readonly bytes: Uint8Array }[];
  }]> = [
    ["unsorted", { workflow: "foreman-bounded", files: [boundedFiles[1], boundedFiles[0]] }],
    ["duplicate", { workflow: "foreman-bounded", files: [boundedFiles[0], boundedFiles[1], boundedFiles[1]] }],
    ["absolute", { workflow: "foreman-bounded", files: [{ path: "/proposal.md", bytes: utf8("x") }, boundedFiles[1]] }],
    ["drive absolute", { workflow: "foreman-bounded", files: [{ path: "C:/proposal.md", bytes: utf8("x") }, boundedFiles[1]] }],
    ["backslash", { workflow: "foreman-bounded", files: [{ path: "proposal.md", bytes: utf8("x") }, { path: "specs\\a.md", bytes: utf8("x") }] }],
    ["dot segment", { workflow: "foreman-bounded", files: [{ path: "proposal.md", bytes: utf8("x") }, { path: "specs/./a.md", bytes: utf8("x") }] }],
    ["escaping", { workflow: "foreman-bounded", files: [{ path: "../proposal.md", bytes: utf8("x") }, boundedFiles[1]] }],
    ["missing proposal", { workflow: "foreman-bounded", files: [boundedFiles[1]] }],
    ["missing specs", { workflow: "foreman-bounded", files: [boundedFiles[0]] }],
    ["tasks included", { workflow: "foreman-bounded", files: [boundedFiles[0], boundedFiles[1], { path: "tasks.md", bytes: utf8("tasks") }] }],
    ["bounded design", { workflow: "foreman-bounded", files: [{ path: "design.md", bytes: utf8("design") }, boundedFiles[0], boundedFiles[1]] }],
    ["non-markdown spec", { workflow: "foreman-bounded", files: [boundedFiles[0], { path: "specs/a.txt", bytes: utf8("x") }] }],
    ["extra package path", { workflow: "foreman-bounded", files: [{ path: "README.md", bytes: utf8("x") }, boundedFiles[0], boundedFiles[1]] }],
  ];
  for (const [name, input] of invalidBuilds) {
    it("rejects build " + name, () => {
      assert.deepEqual(buildApprovedOpenSpecManifestV1(input), { _tag: "Invalid" });
    });
  }

  it("rejects malformed or mismatched manifest rows", () => {
    const built = buildApprovedOpenSpecManifestV1({
      workflow: "foreman-bounded",
      files: boundedFiles,
    });
    assert.equal(built._tag, "Valid");
    if (built._tag !== "Valid") return;
    const rows = built.manifest.files;
    const invalidManifests: readonly ApprovedOpenSpecManifestV1[] = [
      { ...built.manifest, files: [...rows].reverse() },
      { ...built.manifest, files: [rows[0]!, rows[1]!, rows[1]!] },
      { ...built.manifest, files: [rows[0]!] },
      { ...built.manifest, files: [...rows, { path: "specs/z.md", sha256: shaA }] },
      { ...built.manifest, files: [{ ...rows[0]!, sha256: shaA }, rows[1]!] },
      { ...built.manifest, schema: "foreman.other.v1" as ApprovedOpenSpecManifestV1["schema"] },
    ];
    for (const manifest of invalidManifests) {
      assert.deepEqual(
        validateApprovedOpenSpecManifestV1({
          workflow: "foreman-bounded",
          manifest,
          files: boundedFiles,
        }),
        { _tag: "Invalid" },
      );
    }
  });
});

describe("Task 3.1 cold-review closure", () => {
  it("closes every signed-schema timestamp branch", () => {
    for (const artifact of signedArtifacts) {
      expectParseInvalid({
        ...artifact,
        issuedAt: "2026-08-24T00:00:00.000Z",
      });
    }
  });

  it("closes design base Git IDs and design digests", () => {
    const invalidGitIds = [
      "1".repeat(39),
      "1".repeat(41),
      "A".repeat(40),
      "g".repeat(40),
    ] as const;
    for (const field of ["designCommit", "designTree"] as const) {
      for (const value of invalidGitIds) {
        expectParseInvalid({ ...designReceipt, [field]: value });
      }
    }
    for (const field of [
      "approvedOpenSpecSha256",
      "taskPlanSha256",
      "approvalStatementSha256",
    ] as const) {
      for (const value of [
        "a".repeat(63),
        "a".repeat(65),
        "A".repeat(64),
        "g".repeat(64),
      ]) {
        expectParseInvalid({ ...designReceipt, [field]: value });
      }
    }
  });

  it("uses UTF-8 byte limits for identifiers and findings", () => {
    const maximumFinding = {
      ...finding,
      line: 2147483647,
      file: "é".repeat(2048),
      summary: "é".repeat(2048),
      evidence: "é".repeat(8192),
    };
    assert.equal(
      parseReleaseAuthorityObjectV1({
        ...auditReceipt,
        findings: [maximumFinding],
      })._tag,
      "Valid",
    );
    assert.equal(
      parseReleaseAuthorityObjectV1({
        ...actionOutcome,
        packageId: "é".repeat(64),
      })._tag,
      "Valid",
    );
    expectParseInvalid({
      ...actionOutcome,
      packageId: "é".repeat(64) + "x",
    });
    for (const [field, value] of [
      ["file", "é".repeat(2048) + "x"],
      ["summary", "é".repeat(2048) + "x"],
      ["evidence", "é".repeat(8192) + "x"],
    ] as const) {
      expectParseInvalid({
        ...auditReceipt,
        findings: [{ ...finding, [field]: value }],
      });
      expectSourceInvalid(
        canonicalFile({
          ...auditSource,
          findings: [{ ...finding, [field]: value }],
        }),
      );
    }
    for (const field of ["file", "summary", "evidence"] as const) {
      for (const control of ["\u0000", "\n", "\r"] as const) {
        expectParseInvalid({
          ...auditReceipt,
          findings: [{ ...finding, [field]: "left" + control + "right" }],
        });
        expectSourceInvalid(
          canonicalFile({
            ...auditSource,
            findings: [{ ...finding, [field]: "left" + control + "right" }],
          }),
        );
      }
    }
  });

  it("closes checks command fields, enums, and positive boundaries", () => {
    const command = checksSource.commands[0]!;
    for (const key of Object.keys(command)) {
      const missing = cloneRecord(command);
      delete missing[key];
      expectSourceInvalid(
        canonicalFile({ ...checksSource, commands: [missing] }),
      );
      expectSourceInvalid(
        canonicalFile({ ...checksSource, commands: [{ ...command, [key]: null }] }),
      );
    }
    for (const field of [
      "commandSha256",
      "stdoutSha256",
      "stderrSha256",
    ] as const) {
      expectSourceInvalid(
        canonicalFile({
          ...checksSource,
          commands: [{ ...command, [field]: "a".repeat(63) }],
        }),
      );
    }
    expectSourceInvalid(
      canonicalFile({ ...checksSource, status: "UNKNOWN" }),
    );
    for (const exitCode of [0, 255] as const) {
      assert.equal(
        decodeReleaseProducerSourceFileV1(
          canonicalFile({
            ...checksSource,
            commands: [{ ...command, exitCode }],
          }),
        )._tag,
        "Valid",
      );
    }
    assert.equal(
      decodeReleaseProducerSourceFileV1(
        canonicalFile({
          ...checksSource,
          commands: Array.from({ length: 256 }, () => command),
        }),
      )._tag,
      "Valid",
    );
  });

  it("closes audit source finding fields, enums, and positive boundaries", () => {
    for (const key of Object.keys(finding)) {
      const missing = cloneRecord(finding);
      delete missing[key];
      expectSourceInvalid(
        canonicalFile({ ...auditSource, findings: [missing] }),
      );
      expectSourceInvalid(
        canonicalFile({ ...auditSource, findings: [{ ...finding, [key]: null }] }),
      );
    }
    expectSourceInvalid(
      canonicalFile({ ...auditSource, verdict: "UNKNOWN" }),
    );
    expectSourceInvalid(
      canonicalFile({
        ...auditSource,
        findings: [{ ...finding, severity: "urgent" }],
      }),
    );
    assert.equal(
      decodeReleaseProducerSourceFileV1(
        canonicalFile({
          ...auditSource,
          findings: Array.from({ length: 100 }, () => finding),
        }),
      )._tag,
      "Valid",
    );
    assert.equal(
      decodeReleaseProducerSourceFileV1(
        canonicalFile({
          ...auditSource,
          findings: [{
            ...finding,
            line: 2147483647,
            file: "é".repeat(2048),
            summary: "é".repeat(2048),
            evidence: "é".repeat(8192),
          }],
        }),
      )._tag,
      "Valid",
    );
    expectSourceInvalid(
      canonicalFile({ ...evaluationReportSource, result: "UNKNOWN" }),
    );
  });

  it("freezes every evidence-bundle receipt array", () => {
    const checksPass = {
      ...checksReceipt,
      packageId: "project-registry",
      status: "PASS",
    } as const;
    const checksFail = {
      ...checksReceipt,
      packageId: "project-registry",
      status: "FAIL",
    } as const;
    const auditBlocked = {
      ...auditReceipt,
      packageId: "project-registry",
      verdict: "BLOCKED",
    } as const;
    const auditApproved = {
      ...auditReceipt,
      packageId: "project-registry",
      verdict: "APPROVED",
      findings: [],
    } as const;
    const request = {
      ...councilRequest,
      packageId: "project-registry",
    } as const;
    const priorVerify = {
      reservationId: "reservation-prior",
      originReservationId: "reservation-origin",
      originalAction: "verify",
      candidate,
      failureEvidenceSha256: shaC,
    } as const;
    const priorAudit = { ...priorVerify, originalAction: "audit" } as const;
    const evaluationDesign = {
      ...designReceipt,
      packageId: "graph-eval-falsification",
    } as const;
    const evaluationBundle = {
      ...evidenceBundle,
      childId: "v040-t8-evaluation",
      packageId: "graph-eval-falsification",
      action: "evaluate",
      receipts: [evaluationDesign, evaluationAuthority],
    } as const;
    const validBundles = [
      { ...evidenceBundle, action: "implement" },
      evidenceBundle,
      { ...evidenceBundle, action: "audit", receipts: [designReceipt, checksPass] },
      { ...evidenceBundle, action: "correct", receipts: [designReceipt, checksFail] },
      { ...evidenceBundle, action: "correct", receipts: [designReceipt, auditBlocked] },
      { ...evidenceBundle, action: "council", receipts: [designReceipt, request] },
      { ...evidenceBundle, action: "integrate", receipts: [designReceipt, auditApproved] },
      { ...evidenceBundle, action: "publish", receipts: [designReceipt, auditApproved] },
      evaluationBundle,
      { ...evidenceBundle, action: "provider_retry", priorReservation: priorVerify },
      { ...evidenceBundle, action: "resume", receipts: [designReceipt, checksPass], priorReservation: priorAudit },
    ] as const;
    for (const bundle of validBundles) {
      assert.equal(parseReleaseAuthorityObjectV1(bundle)._tag, "Valid");
    }
    const invalidBundles = [
      { ...evidenceBundle, action: "implement", receipts: [designReceipt, checksPass] },
      { ...evidenceBundle, action: "audit", receipts: [designReceipt, checksFail] },
      { ...evidenceBundle, action: "correct", receipts: [designReceipt, checksPass] },
      { ...evidenceBundle, action: "correct", receipts: [designReceipt, auditApproved] },
      { ...evidenceBundle, action: "council", receipts: [designReceipt] },
      { ...evidenceBundle, action: "integrate", receipts: [designReceipt, auditBlocked] },
      { ...evidenceBundle, action: "publish", receipts: [designReceipt, auditBlocked] },
      { ...evaluationBundle, receipts: [evaluationDesign] },
      { ...evidenceBundle, action: "provider_retry", receipts: [designReceipt, checksPass], priorReservation: priorVerify },
      { ...evidenceBundle, action: "resume", receipts: [designReceipt], priorReservation: priorAudit },
      { ...evidenceBundle, action: "resume" },
    ] as const;
    for (const bundle of invalidBundles) {
      expectParseInvalid(bundle);
    }
  });

  it("binds each evaluation count independently", () => {
    const cases = [
      {
        ...evaluationVerdict,
        completedRuns: 1899,
        unavailableRuns: 51,
        signature: "XpYDs8d3M0y6gH5J4ecKzv4EHpCJvYVtZqOwsS5nB3tijVNKq536zDKZp29OKbKbJskwRKO-kVq7jOAZdzrBBg",
      },
      {
        ...evaluationVerdict,
        unavailableRuns: 49,
        notRunRuns: 51,
        signature: "OmKTUJyOtRkZKViBD-1FVRXRZrWnP3e9lDCtwk8B6tqfdblhUsJlTeP5Olp6Jzo7DwLlIZLubfaqmBz6vgU9AA",
      },
      {
        ...evaluationVerdict,
        completedRuns: 1899,
        notRunRuns: 51,
        signature: "-C7YHlO3JXzISJ7ptAGso0qAJF2eVMSNjvd_pNe0b-hCCG_dTwIht8ZFJ8pUfAPNtk5QQOeBDTlCXLvYs_LvBw",
      },
    ] as const;
    for (const receipt of cases) {
      assert.equal(
        decodeReleaseAuthorityFileV1(canonicalFile(receipt))._tag,
        "Valid",
      );
      assert.deepEqual(
        verifyReleaseSourceReceiptBindingV1(
          canonicalFile(evaluationReportSource),
          canonicalFile(receipt),
        ),
        { _tag: "Invalid" },
      );
    }
  });

  it("isolates every hostile manifest path and row shape", () => {
    const proposal = { path: "proposal.md", bytes: utf8("proposal\n") } as const;
    const spec = { path: "specs/a.md", bytes: utf8("spec\n") } as const;
    const invalidInputs = [
      [{ path: "/outside.md", bytes: utf8("x") }, proposal, spec],
      [{ path: "C:/outside.md", bytes: utf8("x") }, proposal, spec],
      [proposal, spec, { path: "specs\\bad.md", bytes: utf8("x") }],
      [proposal, { path: "specs/./bad.md", bytes: utf8("x") }, spec],
      [{ path: "../escape.md", bytes: utf8("x") }, proposal, spec],
      [proposal, spec, { path: "specs/a.txt", bytes: utf8("x") }],
      [{ path: "README.md", bytes: utf8("x") }, proposal, spec],
    ] as const;
    for (const files of invalidInputs) {
      assert.deepEqual(
        buildApprovedOpenSpecManifestV1({
          workflow: "foreman-bounded",
          files,
        }),
        { _tag: "Invalid" },
      );
    }
    const built = buildApprovedOpenSpecManifestV1({
      workflow: "foreman-bounded",
      files: [proposal, spec],
    });
    assert.equal(built._tag, "Valid");
    if (built._tag !== "Valid") return;
    const malformed = {
      ...built.manifest,
      files: [
        { ...built.manifest.files[0]!, unexpected: true },
        built.manifest.files[1]!,
      ],
    } as unknown as ApprovedOpenSpecManifestV1;
    assert.deepEqual(
      validateApprovedOpenSpecManifestV1({
        workflow: "foreman-bounded",
        manifest: malformed,
        files: [proposal, spec],
      }),
      { _tag: "Invalid" },
    );
  });
});

describe("Task 3.1 final producer and bundle closure", () => {
  it("closes producer candidate identity objects", () => {
    for (const source of [checksSource, auditSource] as const) {
      for (const key of Object.keys(source.candidate)) {
        const missing = cloneRecord(source.candidate);
        delete missing[key];
        expectSourceInvalid(
          canonicalFile({ ...source, candidate: missing }),
        );
        expectSourceInvalid(
          canonicalFile({
            ...source,
            candidate: { ...source.candidate, [key]: null },
          }),
        );
      }
      expectSourceInvalid(
        canonicalFile({
          ...source,
          candidate: { ...source.candidate, unexpected: true },
        }),
      );
      expectSourceInvalid(
        canonicalFile({
          ...source,
          candidate: Object.create(source.candidate) as unknown,
        }),
      );
      for (const field of ["commit", "tree"] as const) {
        for (const value of [
          "1".repeat(39),
          "1".repeat(41),
          "A".repeat(40),
          "g".repeat(40),
        ]) {
          expectSourceInvalid(
            canonicalFile({
              ...source,
              candidate: { ...source.candidate, [field]: value },
            }),
          );
        }
      }
      expectSourceInvalid(
        canonicalFile({
          ...source,
          candidate: {
            ...source.candidate,
            candidateSha256: "a".repeat(63),
          },
        }),
      );
      expectSourceInvalid(
        canonicalFile({
          ...source,
          candidate: { ...source.candidate, candidateSha256: shaA },
        }),
      );
    }
  });

  it("closes producer audit finding and digest fields", () => {
    expectSourceInvalid(
      canonicalFile({
        ...auditSource,
        auditArtifactSha256: "a".repeat(63),
      }),
    );
    expectSourceInvalid(
      canonicalFile({
        ...auditSource,
        findings: [{ ...finding, unexpected: true }],
      }),
    );
    expectSourceInvalid(
      canonicalFile({
        ...auditSource,
        findings: [Object.create(finding) as unknown],
      }),
    );
    for (const line of [0, 2147483648, 1.5] as const) {
      expectSourceInvalid(
        canonicalFile({
          ...auditSource,
          findings: [{ ...finding, line }],
        }),
      );
    }
  });

  it("closes every evaluation-report digest field", () => {
    for (const field of [
      "candidateSha256",
      "authorityManifestSha256",
      "evaluationAuthorityReceiptSha256",
      "runSetSha256",
      "reportArtifactSha256",
    ] as const) {
      expectSourceInvalid(
        canonicalFile({
          ...evaluationReportSource,
          [field]: "a".repeat(63),
        }),
      );
    }
  });

  it("rejects every forbidden identifier and text control", () => {
    for (const value of [
      "bad\\id",
      "bad\tid",
      "bad\u001fid",
      "bad\u007fid",
    ] as const) {
      expectParseInvalid({ ...actionOutcome, packageId: value });
    }
    for (const value of [
      "left\tright",
      "left\u001fright",
      "left\u007fright",
    ] as const) {
      expectParseInvalid({
        ...auditReceipt,
        findings: [{ ...finding, summary: value }],
      });
      expectSourceInvalid(
        canonicalFile({
          ...auditSource,
          findings: [{ ...finding, summary: value }],
        }),
      );
    }
  });

  it("freezes all correction verdicts and retry or resume origins", () => {
    const design = designReceipt;
    const checksPass = {
      ...checksReceipt,
      packageId: "project-registry",
      status: "PASS",
    } as const;
    const checksFail = {
      ...checksReceipt,
      packageId: "project-registry",
      status: "FAIL",
    } as const;
    const request = {
      ...councilRequest,
      packageId: "project-registry",
    } as const;
    const auditFor = (
      verdict: "APPROVED" | "WARNING" | "BLOCKED" | "UNVERIFIED",
      findings: readonly ReleaseAuditFindingV1[],
    ) => ({
      ...auditReceipt,
      packageId: "project-registry",
      verdict,
      findings,
    });
    const auditApproved = auditFor("APPROVED", []);
    const evaluationDesign = {
      ...designReceipt,
      packageId: "graph-eval-falsification",
    } as const;
    const ordinary = [
      { name: "implement", originalAction: "implement", base: { ...evidenceBundle, action: "implement", receipts: [design] } },
      { name: "verify", originalAction: "verify", base: { ...evidenceBundle, action: "verify", receipts: [design] } },
      { name: "audit", originalAction: "audit", base: { ...evidenceBundle, action: "audit", receipts: [design, checksPass] } },
      { name: "correct checks", originalAction: "correct", base: { ...evidenceBundle, action: "correct", receipts: [design, checksFail] } },
      { name: "correct warning", originalAction: "correct", base: { ...evidenceBundle, action: "correct", receipts: [design, auditFor("WARNING", [finding])] } },
      { name: "correct blocked", originalAction: "correct", base: { ...evidenceBundle, action: "correct", receipts: [design, auditFor("BLOCKED", [finding])] } },
      { name: "correct unverified", originalAction: "correct", base: { ...evidenceBundle, action: "correct", receipts: [design, auditFor("UNVERIFIED", [finding])] } },
      { name: "council", originalAction: "council", base: { ...evidenceBundle, action: "council", receipts: [design, request] } },
      { name: "integrate", originalAction: "integrate", base: { ...evidenceBundle, action: "integrate", receipts: [design, auditApproved] } },
      { name: "publish", originalAction: "publish", base: { ...evidenceBundle, action: "publish", receipts: [design, auditApproved] } },
      { name: "evaluate", originalAction: "evaluate", base: { ...evidenceBundle, childId: "v040-t8-evaluation", packageId: "graph-eval-falsification", action: "evaluate", receipts: [evaluationDesign, evaluationAuthority] } },
    ] as const;
    for (const item of ordinary) {
      assert.equal(parseReleaseAuthorityObjectV1(item.base)._tag, "Valid", item.name);
      const priorReservation = {
        reservationId: "reservation-prior",
        originReservationId: "reservation-origin",
        originalAction: item.originalAction,
        candidate,
        failureEvidenceSha256: shaC,
      } as const;
      for (const action of ["provider_retry", "resume"] as const) {
        assert.equal(
          parseReleaseAuthorityObjectV1({
            ...item.base,
            action,
            priorReservation,
          })._tag,
          "Valid",
          action + " " + item.name,
        );
      }
    }
    for (const item of ordinary) {
      if (item.base.receipts.length === 2) {
        expectParseInvalid({
          ...item.base,
          receipts: [...item.base.receipts].reverse(),
        });
      }
    }
    for (const action of ["integrate", "publish"] as const) {
      expectParseInvalid({
        ...evidenceBundle,
        action,
        receipts: [design, auditFor("APPROVED", [finding])],
      });
      expectParseInvalid({
        ...evidenceBundle,
        action,
        receipts: [design, auditFor("BLOCKED", [])],
      });
    }
    expectParseInvalid({
      ...evidenceBundle,
      action: "council",
      receipts: [design, checksPass],
    });
    expectParseInvalid({
      ...evidenceBundle,
      childId: "v040-t8-evaluation",
      packageId: "graph-eval-falsification",
      action: "evaluate",
      receipts: [evaluationDesign, request],
    });
  });

  it("accepts zero and maximum producer boundaries", () => {
    assert.equal(
      decodeReleaseProducerSourceFileV1(
        canonicalFile({ ...auditSource, findings: [] }),
      )._tag,
      "Valid",
    );
    for (const counts of [
      { completedRuns: 2000, unavailableRuns: 0, notRunRuns: 0 },
      { completedRuns: 0, unavailableRuns: 2000, notRunRuns: 0 },
      { completedRuns: 0, unavailableRuns: 0, notRunRuns: 2000 },
    ] as const) {
      assert.equal(
        decodeReleaseProducerSourceFileV1(
          canonicalFile({ ...evaluationReportSource, ...counts }),
        )._tag,
        "Valid",
      );
    }
  });
});

describe("Task 3.1 schema-isolation closure", () => {
  it("closes producer discriminants and package identifiers", () => {
    for (const source of producerSources) {
      expectSourceInvalid(
        canonicalFile({ ...source, schema: "foreman.unknown-source.v1" }),
      );
      expectSourceInvalid(
        canonicalFile({ ...source, program: "v050" }),
      );
    }
    for (const source of [checksSource, auditSource] as const) {
      for (const packageId of [
        "",
        "bad/id",
        "bad\\id",
        "bad\u0000id",
        "bad\u001fid",
        "é".repeat(64) + "x",
      ] as const) {
        expectSourceInvalid(canonicalFile({ ...source, packageId }));
      }
    }
  });

  it("rejects package-matched wrong receipt schemas", () => {
    const design = designReceipt;
    const checksPass = {
      ...checksReceipt,
      packageId: "project-registry",
      status: "PASS",
    } as const;
    const auditApproved = {
      ...auditReceipt,
      packageId: "project-registry",
      verdict: "APPROVED",
      findings: [],
    } as const;
    const request = {
      ...councilRequest,
      packageId: "project-registry",
    } as const;
    const evaluationDesign = {
      ...designReceipt,
      packageId: "graph-eval-falsification",
    } as const;
    const evaluationRequest = {
      ...councilRequest,
      packageId: "graph-eval-falsification",
    } as const;
    const invalidBundles = [
      { ...evidenceBundle, action: "verify", receipts: [checksPass] },
      { ...evidenceBundle, action: "audit", receipts: [design, auditApproved] },
      { ...evidenceBundle, action: "correct", receipts: [design, request] },
      { ...evidenceBundle, action: "council", receipts: [design, checksPass] },
      { ...evidenceBundle, action: "integrate", receipts: [design, checksPass] },
      { ...evidenceBundle, action: "publish", receipts: [design, checksPass] },
      {
        ...evidenceBundle,
        childId: "v040-t8-evaluation",
        packageId: "graph-eval-falsification",
        action: "evaluate",
        receipts: [evaluationDesign, evaluationRequest],
      },
    ] as const;
    for (const bundle of invalidBundles) {
      expectParseInvalid(bundle);
    }
  });
});
