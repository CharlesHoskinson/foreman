import assert from "node:assert/strict";
import test from "node:test";

import { canonicalize, sha256Hex } from "@foreman/core";

import {
  buildApprovedOpenSpecManifestV1,
  evaluateReleaseAdmissionV1,
  evaluateReleaseEvidenceV1,
  type RegisteredReleaseAuthorityV1,
  type ReleaseActionV1,
  type ReleaseAdmissionFailureReason,
  type ReleaseAuthorityReceiptV1,
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

const checksReceipt = (
  status: "PASS" | "FAIL",
  packageId = "project-registry",
  candidate: ReleaseCandidateIdentityV1 = CANDIDATE,
): ReleaseAuthorityReceiptV1 => ({
  schema: "foreman.checks-evidence.v1",
  program: "v040",
  packageId,
  candidate,
  status,
  checksSha256: SHA_F,
  issuedAt: "2026-08-24T12:00:10Z",
});

const auditReceipt = (
  verdict: "APPROVED" | "WARNING" | "BLOCKED" | "UNVERIFIED",
  findings: Extract<
    ReleaseAuthorityReceiptV1,
    { readonly schema: "foreman.release-audit.v1" }
  >["findings"] = [],
): ReleaseAuthorityReceiptV1 => ({
  schema: "foreman.release-audit.v1",
  program: "v040",
  packageId: "project-registry",
  candidate: CANDIDATE,
  verdict,
  findings,
  evidenceSha256: SHA_F,
  issuedAt: "2026-08-24T12:00:20Z",
});

const COUNCIL_RECEIPT: ReleaseAuthorityReceiptV1 = {
  schema: "foreman.council-request.v1",
  program: "v040",
  packageId: "project-registry",
  candidateSha256: CANDIDATE.candidateSha256,
  questionSha256: SHA_F,
  constraintsSha256: ROOT_SHA,
  optionsSha256: FAMILY_SHA,
  issuedAt: "2026-08-24T12:00:30Z",
};

const EVALUATION_RECEIPT: ReleaseAuthorityReceiptV1 = {
  schema: "foreman.evaluation-authority.v1",
  program: "v040",
  packageId: "graph-eval-falsification",
  manifestSha256: SHA_F,
  issuedAt: "2026-08-24T12:00:40Z",
};

const designReceiptFor = (packageId: string): ReleaseAuthorityReceiptV1 => ({
  ...DESIGN_RECEIPT,
  packageId,
});

type OrdinaryAuthorityCase = {
  readonly name: string;
  readonly action: Exclude<ReleaseActionV1, "provider_retry" | "resume">;
  readonly packageId: string;
  readonly childId: string;
  readonly receipts: readonly ReleaseAuthorityReceiptV1[];
};

const ORDINARY_CASES: readonly OrdinaryAuthorityCase[] = [
  {
    name: "implement",
    action: "implement",
    packageId: "project-registry",
    childId: "v040-t2-project-registry",
    receipts: [DESIGN_RECEIPT],
  },
  {
    name: "verify",
    action: "verify",
    packageId: "project-registry",
    childId: "v040-t2-project-registry",
    receipts: [DESIGN_RECEIPT],
  },
  {
    name: "audit",
    action: "audit",
    packageId: "project-registry",
    childId: "v040-t2-project-registry",
    receipts: [DESIGN_RECEIPT, checksReceipt("PASS")],
  },
  {
    name: "correct-checks",
    action: "correct",
    packageId: "project-registry",
    childId: "v040-t2-project-registry",
    receipts: [DESIGN_RECEIPT, checksReceipt("FAIL")],
  },
  ...(["WARNING", "BLOCKED", "UNVERIFIED"] as const).map((verdict) => ({
    name: `correct-${verdict.toLowerCase()}`,
    action: "correct" as const,
    packageId: "project-registry",
    childId: "v040-t2-project-registry",
    receipts: [DESIGN_RECEIPT, auditReceipt(verdict)],
  })),
  {
    name: "council",
    action: "council",
    packageId: "project-registry",
    childId: "v040-t2-project-registry",
    receipts: [DESIGN_RECEIPT, COUNCIL_RECEIPT],
  },
  {
    name: "integrate",
    action: "integrate",
    packageId: "project-registry",
    childId: "v040-t2-project-registry",
    receipts: [DESIGN_RECEIPT, auditReceipt("APPROVED")],
  },
  {
    name: "publish",
    action: "publish",
    packageId: "project-registry",
    childId: "v040-t2-project-registry",
    receipts: [DESIGN_RECEIPT, auditReceipt("APPROVED")],
  },
  {
    name: "evaluate",
    action: "evaluate",
    packageId: "graph-eval-falsification",
    childId: "v040-t8-evaluation",
    receipts: [
      designReceiptFor("graph-eval-falsification"),
      EVALUATION_RECEIPT,
    ],
  },
];

function bundleFor(
  item: OrdinaryAuthorityCase,
  action: ReleaseActionV1 = item.action,
): ReleaseEvidenceBundleV1 {
  const ordinary: ReleaseEvidenceBundleV1 = {
    ...BUNDLE,
    childId: item.childId,
    packageId: item.packageId,
    action,
    receipts: item.receipts,
  };
  if (action !== "provider_retry" && action !== "resume") return ordinary;
  return {
    ...ordinary,
    priorReservation: {
      reservationId: `prior-${item.name}`,
      originReservationId: `origin-${item.name}`,
      originalAction: item.action,
      candidate: CANDIDATE,
      failureEvidenceSha256: SHA_F,
    },
  };
}

function inputFor(bundle: ReleaseEvidenceBundleV1): ReleaseEvidenceInputV1 {
  return {
    action: bundle.action,
    packageId: bundle.packageId,
    candidate: bundle.candidate,
    approvedOpenSpecBytes: OPEN_SPEC_BYTES,
    taskPlanBytes: TASK_BYTES,
    evidenceBytes: canonicalFile(bundle),
  };
}

function registrationFor(
  bundle: ReleaseEvidenceBundleV1,
): RegisteredReleaseAuthorityV1 {
  const prior = bundle.priorReservation;
  const evaluation = bundle.receipts.find(
    (receipt) => receipt.schema === "foreman.evaluation-authority.v1",
  );
  const evidenceBytes = canonicalFile(bundle);
  return {
    rootContractId: bundle.rootContractId,
    rootContractSha256: bundle.rootContractSha256,
    familySha256: bundle.familySha256,
    childId: bundle.childId,
    action: bundle.action,
    effectiveAction: prior?.originalAction ?? bundle.action,
    priorReservationId: prior?.reservationId ?? null,
    originReservationId: prior?.originReservationId ?? null,
    candidate: bundle.candidate,
    taskPlanSha256: bundle.taskPlanSha256,
    bundleSha256: sha256Hex(evidenceBytes),
    receiptSchemas: bundle.receipts.map((receipt) => receipt.schema),
    receiptSha256s: bundle.receipts.map((receipt) =>
      sha256Hex(canonicalFile(receipt)),
    ),
    evaluationManifestSha256:
      evaluation?.schema === "foreman.evaluation-authority.v1"
        ? evaluation.manifestSha256
        : null,
    registeredAt: "2026-08-24T12:02:00Z",
  };
}

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

test("every ordinary action and registered digest is admitted", async (t) => {
  for (const item of ORDINARY_CASES) {
    await t.test(item.name, () => {
      const bundle = bundleFor(item);
      const input = inputFor(bundle);
      assert.deepEqual(evaluateReleaseEvidenceV1(input), {
        schemaVersion: 1,
        _tag: "EvidenceValid",
      });
      assert.deepEqual(
        evaluateReleaseAdmissionV1({
          ...input,
          registered: registrationFor(bundle),
        }),
        { schemaVersion: 1, _tag: "Admitted" },
      );
    });
  }
});

test("provider_retry and resume preserve every original authority", async (t) => {
  for (const wrapper of ["provider_retry", "resume"] as const) {
    for (const item of ORDINARY_CASES) {
      await t.test(`${wrapper}-${item.name}`, () => {
        const bundle = bundleFor(item, wrapper);
        const input = inputFor(bundle);
        assert.deepEqual(evaluateReleaseEvidenceV1(input), {
          schemaVersion: 1,
          _tag: "EvidenceValid",
        });
        assert.deepEqual(
          evaluateReleaseAdmissionV1({
            ...input,
            registered: registrationFor(bundle),
          }),
          { schemaVersion: 1, _tag: "Admitted" },
        );
      });
    }
  }
});

test("secondary receipts bind package and candidate to the bundle", () => {
  const audit = ORDINARY_CASES.find((item) => item.action === "audit")!;
  const wrongPackageBundle: ReleaseEvidenceBundleV1 = {
    ...bundleFor(audit),
    receipts: [DESIGN_RECEIPT, checksReceipt("PASS", "other-package")],
  };
  assert.deepEqual(evaluateReleaseEvidenceV1(inputFor(wrongPackageBundle)), {
    schemaVersion: 1,
    _tag: "EvidenceInvalid",
    reason: "wrong_package",
  });

  const otherCandidate: ReleaseCandidateIdentityV1 = {
    commit: "1".repeat(40),
    tree: "2".repeat(40),
    candidateSha256: sha256Hex("1".repeat(40)),
  };
  const wrongCandidateBundle: ReleaseEvidenceBundleV1 = {
    ...bundleFor(audit),
    receipts: [
      DESIGN_RECEIPT,
      checksReceipt("PASS", "project-registry", otherCandidate),
    ],
  };
  assert.deepEqual(evaluateReleaseEvidenceV1(inputFor(wrongCandidateBundle)), {
    schemaVersion: 1,
    _tag: "EvidenceInvalid",
    reason: "wrong_candidate",
  });

  const council = ORDINARY_CASES.find((item) => item.action === "council")!;
  const wrongCouncilCandidate: ReleaseEvidenceBundleV1 = {
    ...bundleFor(council),
    receipts: [
      DESIGN_RECEIPT,
      { ...COUNCIL_RECEIPT, candidateSha256: SHA_F },
    ],
  };
  assert.deepEqual(evaluateReleaseEvidenceV1(inputFor(wrongCouncilCandidate)), {
    schemaVersion: 1,
    _tag: "EvidenceInvalid",
    reason: "wrong_candidate",
  });
});

test("evaluation authority is fixed to the tranche-eight package and child", () => {
  const evaluation = ORDINARY_CASES.find((item) => item.action === "evaluate")!;
  const wrongPackageBundle: ReleaseEvidenceBundleV1 = {
    ...bundleFor(evaluation),
    packageId: "project-registry",
    receipts: [DESIGN_RECEIPT, EVALUATION_RECEIPT],
  };
  assert.deepEqual(evaluateReleaseEvidenceV1(inputFor(wrongPackageBundle)), {
    schemaVersion: 1,
    _tag: "EvidenceInvalid",
    reason: "wrong_package",
  });

  const wrongChildBundle: ReleaseEvidenceBundleV1 = {
    ...bundleFor(evaluation),
    childId: "v040-t2-project-registry",
  };
  assert.deepEqual(evaluateReleaseEvidenceV1(inputFor(wrongChildBundle)), {
    schemaVersion: 1,
    _tag: "EvidenceInvalid",
    reason: "wrong_package",
  });
});

test("invalid retry provenance refuses before registration", () => {
  const item = ORDINARY_CASES.find((candidate) => candidate.action === "audit")!;
  const bundle = bundleFor(item, "provider_retry");
  const prior = bundle.priorReservation!;
  const invalid: ReleaseEvidenceBundleV1 = {
    ...bundle,
    priorReservation: {
      ...prior,
      candidate: {
        commit: "1".repeat(40),
        tree: "2".repeat(40),
        candidateSha256: sha256Hex("1".repeat(40)),
      },
    },
  };
  assert.deepEqual(evaluateReleaseEvidenceV1(inputFor(invalid)), {
    schemaVersion: 1,
    _tag: "EvidenceInvalid",
    reason: "invalid_retry",
  });
});

test("action receipt order and blocking conditions are fail closed", () => {
  const finding = {
    severity: "high" as const,
    file: "src/release.ts",
    line: 1,
    summary: "blocking finding",
    evidence: "the release cannot proceed",
  };
  const invalidBundles: readonly ReleaseEvidenceBundleV1[] = [
    { ...BUNDLE, action: "audit", receipts: [DESIGN_RECEIPT, checksReceipt("FAIL")] },
    { ...BUNDLE, action: "correct", receipts: [DESIGN_RECEIPT, checksReceipt("PASS")] },
    { ...BUNDLE, action: "correct", receipts: [DESIGN_RECEIPT, auditReceipt("APPROVED")] },
    { ...BUNDLE, action: "council", receipts: [DESIGN_RECEIPT] },
    { ...BUNDLE, action: "integrate", receipts: [DESIGN_RECEIPT, auditReceipt("WARNING")] },
    {
      ...BUNDLE,
      action: "publish",
      receipts: [DESIGN_RECEIPT, auditReceipt("APPROVED", [finding])],
    },
    { ...BUNDLE, action: "evaluate", receipts: [DESIGN_RECEIPT, checksReceipt("PASS")] },
    { ...BUNDLE, action: "audit", receipts: [checksReceipt("PASS"), DESIGN_RECEIPT] },
    { ...BUNDLE, action: "verify", receipts: [DESIGN_RECEIPT, DESIGN_RECEIPT] },
  ];
  for (const bundle of invalidBundles) {
    assert.deepEqual(evaluateReleaseEvidenceV1(inputFor(bundle)), {
      schemaVersion: 1,
      _tag: "EvidenceInvalid",
      reason: "invalid_evidence",
    });
  }

  const bait = {
    ...bundleFor(ORDINARY_CASES.find((item) => item.action === "integrate")!),
    auditPolicy: { allowWarning: true },
  } as unknown as ReleaseEvidenceBundleV1;
  assert.deepEqual(evaluateReleaseEvidenceV1(inputFor(bait)), {
    schemaVersion: 1,
    _tag: "EvidenceInvalid",
    reason: "invalid_evidence",
  });
});

test("the refusal reason vocabulary remains closed", () => {
  const reasons = [
    "invalid_evidence",
    "wrong_program",
    "wrong_package",
    "wrong_action",
    "wrong_candidate",
    "wrong_design_base",
    "approved_openspec_mismatch",
    "task_plan_mismatch",
    "missing_registration",
    "registration_mismatch",
    "invalid_retry",
    "git_resolution_failure",
  ] as const satisfies readonly ReleaseAdmissionFailureReason[];
  assert.equal(new Set(reasons).size, 12);
});
