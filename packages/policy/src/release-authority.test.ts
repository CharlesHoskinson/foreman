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
    "A7303WMn8GMRpA71qwe_JAsoi9J9-4s1_j3C8M_0Ss4qtjGXjWD_QcOtID_hbRdQTGw0zXUsFtpAFhMDexHLDA",
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
    "Y3Stm2fC1oap6tf5N4BEa7SGQKYUbX8VVCfrUsZLAgt0eUPCs7KMsZkwPe5qCfKDqW7bHx_m5a3PORdRtKJ2BA",
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
