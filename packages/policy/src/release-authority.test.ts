import assert from "node:assert/strict";
import test from "node:test";

import { canonicalize, sha256Hex } from "@foreman/core";

import {
  buildApprovedOpenSpecManifestV1,
  decodeReleaseAuthorityFileV1,
  decodeReleaseProducerSourceFileV1,
  parseReleaseAuthorityObjectV1,
  validateApprovedOpenSpecManifestV1,
  verifyReleaseSourceReceiptBindingV1,
  type ReleaseAuthorityObjectV1,
  type ReleaseAuthorityReceiptV1,
  type ReleaseCandidateIdentityV1,
} from "./index.js";

const encoder = new TextEncoder();
const utf8 = (text: string): Uint8Array => encoder.encode(text);
const canonicalFile = (value: unknown): Uint8Array =>
  utf8(`${canonicalize(value)}\n`);

const COMMIT = "a".repeat(40);
const TREE = "b".repeat(40);
const SHA_C = "c".repeat(64);
const SHA_D = "d".repeat(64);
const SHA_E = "e".repeat(64);
const SHA_F = "f".repeat(64);

const CANDIDATE: ReleaseCandidateIdentityV1 = {
  commit: COMMIT,
  tree: TREE,
  candidateSha256: sha256Hex(COMMIT),
};

const DESIGN: ReleaseAuthorityReceiptV1 = {
  schema: "foreman.design-approval.v1",
  program: "v040",
  packageId: "project-registry",
  designCommit: COMMIT,
  designTree: TREE,
  approvedOpenSpecSha256: SHA_C,
  taskPlanSha256: SHA_D,
  approvalStatementSha256: SHA_E,
  issuedAt: "2026-08-24T12:00:00Z",
};

const CHECKS: ReleaseAuthorityReceiptV1 = {
  schema: "foreman.checks-evidence.v1",
  program: "v040",
  packageId: "project-registry",
  candidate: CANDIDATE,
  status: "PASS",
  checksSha256: SHA_C,
  issuedAt: "2026-08-24T12:01:00Z",
};

const AUDIT: ReleaseAuthorityReceiptV1 = {
  schema: "foreman.release-audit.v1",
  program: "v040",
  packageId: "project-registry",
  candidate: CANDIDATE,
  verdict: "APPROVED",
  findings: [],
  evidenceSha256: SHA_D,
  issuedAt: "2026-08-24T12:02:00Z",
};

const COUNCIL: ReleaseAuthorityReceiptV1 = {
  schema: "foreman.council-request.v1",
  program: "v040",
  packageId: "project-registry",
  candidateSha256: CANDIDATE.candidateSha256,
  questionSha256: SHA_C,
  constraintsSha256: SHA_D,
  optionsSha256: SHA_E,
  issuedAt: "2026-08-24T12:03:00Z",
};

const EVALUATION_AUTHORITY: ReleaseAuthorityReceiptV1 = {
  schema: "foreman.evaluation-authority.v1",
  program: "v040",
  packageId: "graph-eval-falsification",
  manifestSha256: SHA_F,
  issuedAt: "2026-08-24T12:04:00Z",
};

const ACTION_OUTCOME: ReleaseAuthorityObjectV1 = {
  schema: "foreman.release-action-outcome.v1",
  program: "v040",
  rootContractId: "v040-release-root",
  rootContractSha256: SHA_C,
  familySha256: SHA_D,
  childId: "v040-t2-project-registry",
  packageId: "project-registry",
  reservationAction: "verify",
  effectiveAction: "verify",
  reservationId: "reservation-1",
  originReservationId: "reservation-1",
  candidateSha256: CANDIDATE.candidateSha256,
  status: "PASS",
  evidenceSha256: SHA_E,
  issuedAt: "2026-08-24T12:05:00Z",
};

const COUNCIL_OUTCOME: ReleaseAuthorityObjectV1 = {
  schema: "foreman.council-outcome.v1",
  program: "v040",
  rootContractId: "v040-release-root",
  rootContractSha256: SHA_C,
  familySha256: SHA_D,
  childId: "v040-t2-project-registry",
  packageId: "project-registry",
  reservationAction: "council",
  reservationId: "reservation-2",
  originReservationId: "reservation-2",
  candidateSha256: CANDIDATE.candidateSha256,
  requestSha256: SHA_E,
  decisionSha256: SHA_F,
  status: "ADVICE",
  issuedAt: "2026-08-24T12:06:00Z",
};

const EVALUATION_VERDICT: ReleaseAuthorityObjectV1 = {
  schema: "foreman.evaluation-verdict.v1",
  program: "v040",
  rootContractId: "v040-release-root",
  rootContractSha256: SHA_C,
  familySha256: SHA_D,
  childId: "v040-t8-evaluation",
  packageId: "graph-eval-falsification",
  candidateSha256: CANDIDATE.candidateSha256,
  authorityManifestSha256: SHA_E,
  evaluationAuthorityReceiptSha256: SHA_F,
  result: "PROMOTE",
  plannedRuns: 2000,
  completedRuns: 2000,
  unavailableRuns: 0,
  notRunRuns: 0,
  runSetSha256: SHA_C,
  reportSha256: SHA_D,
  issuedAt: "2026-08-24T12:07:00Z",
};

const CANCEL: ReleaseAuthorityObjectV1 = {
  schema: "foreman.execution-child-cancel.v1",
  program: "v040",
  rootContractId: "v040-release-root",
  rootContractSha256: SHA_C,
  familySha256: SHA_D,
  childId: "v040-t2-project-registry",
  reasonSha256: SHA_E,
  issuedAt: "2026-08-24T12:08:00Z",
};

const INVALIDATE: ReleaseAuthorityObjectV1 = {
  schema: "foreman.execution-child-invalidate.v1",
  program: "v040",
  rootContractId: "v040-release-root",
  rootContractSha256: SHA_C,
  familySha256: SHA_D,
  childId: "v040-t2-project-registry",
  observedFamilySha256: SHA_F,
  reasonSha256: SHA_E,
  issuedAt: "2026-08-24T12:09:00Z",
};

const BUNDLE: ReleaseAuthorityObjectV1 = {
  schema: "foreman.release-evidence-bundle.v1",
  program: "v040",
  rootContractId: "v040-release-root",
  rootContractSha256: SHA_C,
  familySha256: SHA_D,
  childId: "v040-t2-project-registry",
  packageId: "project-registry",
  action: "implement",
  candidate: CANDIDATE,
  taskPlanSha256: SHA_D,
  receipts: [DESIGN],
  issuedAt: "2026-08-24T12:10:00Z",
};

const AUTHORITY_OBJECTS: readonly ReleaseAuthorityObjectV1[] = [
  DESIGN,
  CHECKS,
  AUDIT,
  COUNCIL,
  EVALUATION_AUTHORITY,
  ACTION_OUTCOME,
  COUNCIL_OUTCOME,
  EVALUATION_VERDICT,
  CANCEL,
  INVALIDATE,
  BUNDLE,
];

test("all digest authority schemas parse and decode canonically", () => {
  for (const value of AUTHORITY_OBJECTS) {
    assert.deepEqual(parseReleaseAuthorityObjectV1(value), {
      _tag: "Valid",
      value,
    });
    const bytes = canonicalFile(value);
    assert.deepEqual(decodeReleaseAuthorityFileV1(bytes), {
      _tag: "Valid",
      value,
      sha256: sha256Hex(bytes),
    });
  }
});

test("legacy signer and signature fields are closed", () => {
  for (const extra of [
    { issuerKeySha256: SHA_F },
    { signature: "legacy" },
  ]) {
    assert.deepEqual(parseReleaseAuthorityObjectV1({ ...DESIGN, ...extra }), {
      _tag: "Invalid",
    });
  }
});

test("authority files require canonical UTF-8 with one LF", () => {
  const body = canonicalize(DESIGN);
  for (const bytes of [
    utf8(body),
    utf8(`${body}\r\n`),
    utf8(`${body}\n\n`),
    Uint8Array.of(0xff),
    utf8(`{\"schema\":\"foreman.design-approval.v1\",\"schema\":\"foreman.design-approval.v1\"}\n`),
  ]) {
    assert.deepEqual(decodeReleaseAuthorityFileV1(bytes), { _tag: "Invalid" });
  }
});

test("authority files refuse more than one MiB", () => {
  const oversized = canonicalFile({
    ...AUDIT,
    findings: [
      {
        severity: "high",
        file: "a",
        line: 1,
        summary: "b",
        evidence: "x".repeat(1_048_576),
      },
    ],
  });
  assert.equal(oversized.byteLength > 1_048_576, true);
  assert.deepEqual(decodeReleaseAuthorityFileV1(oversized), { _tag: "Invalid" });
});

test("producer source binding uses complete canonical file digests", () => {
  const source = {
    schema: "foreman.checks-source.v1" as const,
    program: "v040" as const,
    packageId: "project-registry",
    candidate: CANDIDATE,
    status: "PASS" as const,
    commands: [
      {
        commandSha256: SHA_C,
        exitCode: 0,
        stdoutSha256: SHA_D,
        stderrSha256: SHA_E,
      },
    ],
  };
  const sourceBytes = canonicalFile(source);
  const receipt = { ...CHECKS, checksSha256: sha256Hex(sourceBytes) };
  assert.equal(decodeReleaseProducerSourceFileV1(sourceBytes)._tag, "Valid");
  assert.deepEqual(
    verifyReleaseSourceReceiptBindingV1(sourceBytes, canonicalFile(receipt)),
    { _tag: "Valid" },
  );
  assert.deepEqual(
    verifyReleaseSourceReceiptBindingV1(
      sourceBytes,
      canonicalFile({ ...receipt, status: "FAIL" }),
    ),
    { _tag: "Invalid" },
  );
});

test("approved OpenSpec manifests bind sorted raw bytes", () => {
  const files = [
    { path: "design.md", bytes: utf8("design\n") },
    { path: "proposal.md", bytes: utf8("proposal\n") },
    { path: "specs/release/spec.md", bytes: utf8("spec\n") },
  ];
  const built = buildApprovedOpenSpecManifestV1({
    workflow: "foreman-architectural",
    files,
  });
  assert.equal(built._tag, "Valid");
  if (built._tag !== "Valid") throw new Error("manifest fixture");
  assert.deepEqual(
    validateApprovedOpenSpecManifestV1({
      workflow: "foreman-architectural",
      manifest: built.manifest,
      files,
    }),
    { _tag: "Valid" },
  );
  assert.deepEqual(
    validateApprovedOpenSpecManifestV1({
      workflow: "foreman-architectural",
      manifest: built.manifest,
      files: files.map((file) =>
        file.path === "proposal.md" ? { ...file, bytes: utf8("changed\n") } : file,
      ),
    }),
    { _tag: "Invalid" },
  );
});
