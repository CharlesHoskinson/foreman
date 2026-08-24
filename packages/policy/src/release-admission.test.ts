import assert from "node:assert/strict";
import test from "node:test";

import { canonicalize, sha256Hex } from "@foreman/core";

import {
  buildApprovedOpenSpecManifestV1,
  evaluateReleaseAdmissionV1,
  evaluateReleaseEvidenceV1,
  type RegisteredReleaseAuthorityV1,
  type ReleaseCandidateIdentityV1,
  type ReleaseEvidenceBundleV1,
  type ReleaseEvidenceInputV1,
} from "./index.js";

const encoder = new TextEncoder();
const utf8 = (text: string): Uint8Array => encoder.encode(text);
const canonicalFile = (value: unknown): Uint8Array =>
  utf8(`${canonicalize(value)}\n`);

const COMMIT = "a".repeat(40);
const TREE = "b".repeat(40);
const ROOT_SHA = "c".repeat(64);
const FAMILY_SHA = "d".repeat(64);
const SHA_F = "f".repeat(64);
const TASK_BYTES = utf8("# Release task plan\n");
const OPEN_SPEC_BYTES = {
  "design.md": utf8("# Design\n"),
  "proposal.md": utf8("# Proposal\n"),
  "specs/release/spec.md": utf8("# Requirements\n"),
} as const;

const manifestResult = buildApprovedOpenSpecManifestV1({
  workflow: "foreman-architectural",
  files: Object.entries(OPEN_SPEC_BYTES).map(([path, bytes]) => ({ path, bytes })),
});
assert.equal(manifestResult._tag, "Valid");
if (manifestResult._tag !== "Valid") throw new Error("manifest fixture");

const CANDIDATE: ReleaseCandidateIdentityV1 = {
  commit: COMMIT,
  tree: TREE,
  candidateSha256: sha256Hex(COMMIT),
};

const DESIGN_RECEIPT = {
  schema: "foreman.design-approval.v1" as const,
  program: "v040" as const,
  packageId: "project-registry",
  designCommit: COMMIT,
  designTree: TREE,
  approvedOpenSpecSha256: manifestResult.sha256,
  taskPlanSha256: sha256Hex(TASK_BYTES),
  approvalStatementSha256: "e".repeat(64),
  issuedAt: "2026-08-24T12:00:00Z",
};

const BUNDLE: ReleaseEvidenceBundleV1 = {
  schema: "foreman.release-evidence-bundle.v1",
  program: "v040",
  rootContractId: "v040-release-root",
  rootContractSha256: ROOT_SHA,
  familySha256: FAMILY_SHA,
  childId: "v040-t2-project-registry",
  packageId: "project-registry",
  action: "implement",
  candidate: CANDIDATE,
  taskPlanSha256: sha256Hex(TASK_BYTES),
  receipts: [DESIGN_RECEIPT],
  issuedAt: "2026-08-24T12:01:00Z",
};

const EVIDENCE_BYTES = canonicalFile(BUNDLE);
const RECEIPT_BYTES = canonicalFile(DESIGN_RECEIPT);

const INPUT: ReleaseEvidenceInputV1 = {
  action: "implement",
  packageId: "project-registry",
  candidate: CANDIDATE,
  approvedOpenSpecBytes: OPEN_SPEC_BYTES,
  taskPlanBytes: TASK_BYTES,
  evidenceBytes: EVIDENCE_BYTES,
};

const REGISTERED: RegisteredReleaseAuthorityV1 = {
  rootContractId: BUNDLE.rootContractId,
  rootContractSha256: BUNDLE.rootContractSha256,
  familySha256: BUNDLE.familySha256,
  childId: BUNDLE.childId,
  action: BUNDLE.action,
  effectiveAction: BUNDLE.action,
  priorReservationId: null,
  originReservationId: null,
  candidate: CANDIDATE,
  taskPlanSha256: BUNDLE.taskPlanSha256,
  bundleSha256: sha256Hex(EVIDENCE_BYTES),
  receiptSchemas: [DESIGN_RECEIPT.schema],
  receiptSha256s: [sha256Hex(RECEIPT_BYTES)],
  evaluationManifestSha256: null,
  registeredAt: "2026-08-24T12:02:00Z",
};

test("standalone evidence validation needs no registration", () => {
  assert.deepEqual(evaluateReleaseEvidenceV1(INPUT), {
    schemaVersion: 1,
    _tag: "EvidenceValid",
  });
});

test("admits the exact registered canonical evidence digest", () => {
  assert.deepEqual(
    evaluateReleaseAdmissionV1({ ...INPUT, registered: REGISTERED }),
    { schemaVersion: 1, _tag: "Admitted" },
  );
});

test("valid evidence without registration is refused", () => {
  assert.deepEqual(
    evaluateReleaseAdmissionV1({ ...INPUT, registered: null }),
    { schemaVersion: 1, _tag: "Refused", reason: "missing_registration" },
  );
});

test("a different registered bundle digest is refused", () => {
  assert.deepEqual(
    evaluateReleaseAdmissionV1({
      ...INPUT,
      registered: { ...REGISTERED, bundleSha256: "f".repeat(64) },
    }),
    { schemaVersion: 1, _tag: "Refused", reason: "registration_mismatch" },
  );
});

test("legacy authority fields are invalid evidence", () => {
  const legacy = canonicalFile({
    ...BUNDLE,
    keyMaterial: "legacy",
  });
  assert.deepEqual(evaluateReleaseEvidenceV1({ ...INPUT, evidenceBytes: legacy }), {
    schemaVersion: 1,
    _tag: "EvidenceInvalid",
    reason: "invalid_evidence",
  });
});

test("malformed evidence fails before registration", () => {
  assert.deepEqual(
    evaluateReleaseAdmissionV1({
      ...INPUT,
      evidenceBytes: utf8("not-json\n"),
      registered: null,
    }),
    { schemaVersion: 1, _tag: "Refused", reason: "invalid_evidence" },
  );
});

test("caller action, package, and candidate must match evidence", () => {
  assert.deepEqual(evaluateReleaseEvidenceV1({ ...INPUT, action: "verify" }), {
    schemaVersion: 1,
    _tag: "EvidenceInvalid",
    reason: "wrong_action",
  });
  assert.deepEqual(
    evaluateReleaseEvidenceV1({ ...INPUT, packageId: "other-package" }),
    { schemaVersion: 1, _tag: "EvidenceInvalid", reason: "wrong_package" },
  );
  const otherCandidate = {
    commit: "1".repeat(40),
    tree: "2".repeat(40),
    candidateSha256: sha256Hex("1".repeat(40)),
  };
  assert.deepEqual(
    evaluateReleaseEvidenceV1({ ...INPUT, candidate: otherCandidate }),
    { schemaVersion: 1, _tag: "EvidenceInvalid", reason: "wrong_candidate" },
  );
});

test("implementation candidate must equal the approved design base", () => {
  const otherCandidate = {
    commit: "1".repeat(40),
    tree: "2".repeat(40),
    candidateSha256: sha256Hex("1".repeat(40)),
  };
  const evidenceBytes = canonicalFile({ ...BUNDLE, candidate: otherCandidate });
  assert.deepEqual(
    evaluateReleaseEvidenceV1({
      ...INPUT,
      candidate: otherCandidate,
      evidenceBytes,
    }),
    { schemaVersion: 1, _tag: "EvidenceInvalid", reason: "wrong_design_base" },
  );
});

test("approved OpenSpec and task-plan bytes are immutable", () => {
  assert.deepEqual(
    evaluateReleaseEvidenceV1({
      ...INPUT,
      approvedOpenSpecBytes: {
        ...OPEN_SPEC_BYTES,
        "proposal.md": utf8("changed\n"),
      },
    }),
    {
      schemaVersion: 1,
      _tag: "EvidenceInvalid",
      reason: "approved_openspec_mismatch",
    },
  );
  assert.deepEqual(
    evaluateReleaseEvidenceV1({ ...INPUT, taskPlanBytes: utf8("changed\n") }),
    { schemaVersion: 1, _tag: "EvidenceInvalid", reason: "task_plan_mismatch" },
  );
});

test("every registered identity field is exact", () => {
  const mutations: readonly RegisteredReleaseAuthorityV1[] = [
    { ...REGISTERED, rootContractId: "other-root" },
    { ...REGISTERED, rootContractSha256: SHA_F },
    { ...REGISTERED, familySha256: SHA_F },
    { ...REGISTERED, childId: "other-child" },
    { ...REGISTERED, action: "verify" },
    { ...REGISTERED, effectiveAction: "verify" },
    { ...REGISTERED, priorReservationId: "prior" },
    { ...REGISTERED, originReservationId: "origin" },
    {
      ...REGISTERED,
      candidate: {
        commit: "1".repeat(40),
        tree: "2".repeat(40),
        candidateSha256: sha256Hex("1".repeat(40)),
      },
    },
    { ...REGISTERED, taskPlanSha256: SHA_F },
    { ...REGISTERED, bundleSha256: SHA_F },
    { ...REGISTERED, receiptSchemas: ["foreman.checks-evidence.v1"] },
    { ...REGISTERED, receiptSha256s: [SHA_F] },
    { ...REGISTERED, evaluationManifestSha256: SHA_F },
  ];
  for (const registered of mutations) {
    assert.deepEqual(evaluateReleaseAdmissionV1({ ...INPUT, registered }), {
      schemaVersion: 1,
      _tag: "Refused",
      reason: "registration_mismatch",
    });
  }
});
