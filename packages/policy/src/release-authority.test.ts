import assert from "node:assert/strict";
import { createHash, verify as verifyEd25519 } from "node:crypto";
import { describe, it } from "node:test";

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
  type ReleaseAuthorityReceiptV1,
  type ReleaseCandidateIdentityV1,
  type ReleaseChecksSourceV1,
  type ReleaseCouncilOutcomeV1,
  type ReleaseEvaluationReportSourceV1,
  type ReleaseEvaluationVerdictV1,
  type ReleaseEvidenceBundleV1,
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
} = {
  manifest: null,
  action: "verify",
};

void buildApprovedOpenSpecManifestV1;
void decodeReleaseAuthorityFileV1;
void decodeReleaseProducerSourceFileV1;
void parseReleaseAuthorityObjectV1;
void releaseAuthoritySignaturePreimageV1;
void verifyReleaseSourceReceiptBindingV1;
void signedArtifacts;
void producerSources;
void compileTypeBindings;
void WRONG_ROLE_SIGNATURES;
void assert;
void createHash;
void verifyEd25519;
void describe;
void it;
