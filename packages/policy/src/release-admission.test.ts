import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import { canonicalize } from "@foreman/core";

import {
  evaluateReleaseAdmissionV1,
  evaluateReleaseEvidenceV1,
  type FailedReservationAuthorityV1,
  type RegisteredReleaseAuthorityV1,
  type ReleaseActionOutcomeV1,
  type ReleaseAdmissionFailureReason,
  type ReleaseAdmissionResultV1,
  type ReleaseAuditFindingV1,
  type ReleaseAuditSourceV1,
  type ReleaseAuthorityKeySha256V1,
  type ReleaseAuthorityReceiptV1,
  type ReleaseCandidateIdentityV1,
  type ReleaseChecksSourceV1,
  type ReleaseCouncilOutcomeV1,
  type ReleaseEvaluationReportSourceV1,
  type ReleaseEvidenceBundleV1,
  type ReleaseEvidenceCheckResultV1,
  type ReleaseEvidenceInputV1,
} from "./index.js";

const SOURCE_COMMIT = "e30ab508d897fe7dd7f1179569d2bfcaec47df49";
const KEYSET_MANIFEST_SHA256 =
  "5be24b3424fff831719e1d60cb0bc2e8a1eedad64b88328590cc69877b024a6c";

const RECIPE_IDS = [
  "D_STD",
  "D_EVAL",
  "E_AUTH",
  "CHECKS_PASS",
  "CHECKS_FAIL",
  "AUDIT_WARNING",
  "AUDIT_BLOCKED",
  "AUDIT_UNVERIFIED",
  "AUDIT_APPROVED",
  "COUNCIL_REQUEST",
  "B_IMPLEMENT_B0",
  "B_IMPLEMENT_B1",
  "B_VERIFY",
  "B_AUDIT",
  "B_CORRECT_CHECKS",
  "B_CORRECT_WARNING",
  "B_CORRECT_BLOCKED",
  "B_CORRECT_UNVERIFIED",
  "B_COUNCIL",
  "B_PROVIDER_RETRY",
  "B_RESUME",
  "B_INTEGRATE",
  "B_PUBLISH",
  "B_EVALUATE",
  "O_EXTERNAL_FAILURE",
  "O_COUNCIL",
  "M_WRONG_ROLE_DESIGN_BY_HOST",
  "M_OUTER_WRONG_ROLE_NESTED",
  "M_OUTER_FORGED_NESTED",
  "M_WRONG_PROGRAM",
  "M_UNRELATED_BASE",
  "M_WRONG_RECEIPT_KIND",
  "M_AUDIT_APPROVED_NONEMPTY",
  "M_INTEGRATE_NONEMPTY",
] as const;

type RecipeId = (typeof RECIPE_IDS)[number];

const placeholderSignature = (index: number): string => {
  const prefix = `FOREMAN_SLOT_${String(index + 1).padStart(2, "0")}_`;
  return `${prefix}${"A".repeat(86 - prefix.length)}`;
};

const SIGNATURES = Object.fromEntries(
  RECIPE_IDS.map((id, index) => [id, placeholderSignature(index)]),
) as Readonly<Record<RecipeId, string>>;

const FAILURE_REASONS = [
  "invalid_evidence",
  "invalid_signature",
  "wrong_signer",
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

const B0: ReleaseCandidateIdentityV1 = {
  commit: "1".repeat(40),
  tree: "2".repeat(40),
  candidateSha256: createHash("sha256")
    .update("1".repeat(40), "ascii")
    .digest("hex"),
};

describe("Task 3.3 public fixture starter", () => {
  it("freezes the recipe and placeholder inventories", () => {
    assert.equal(RECIPE_IDS.length, 34);
    assert.equal(new Set(RECIPE_IDS).size, 34);
    const placeholders = Object.values(SIGNATURES);
    assert.equal(new Set(placeholders).size, 34);
    for (const signature of placeholders) {
      assert.match(signature, /^[A-Za-z0-9_-]{86}$/u);
    }
  });

  it("freezes every refusal reason", () => {
    assert.equal(FAILURE_REASONS.length, 14);
    assert.equal(new Set(FAILURE_REASONS).size, 14);
  });

  it("derives candidate identity from the lowercase ASCII commit", () => {
    assert.equal(
      B0.candidateSha256,
      createHash("sha256").update(B0.commit, "ascii").digest("hex"),
    );
  });
});

void SOURCE_COMMIT;
void KEYSET_MANIFEST_SHA256;
void evaluateReleaseAdmissionV1;
void evaluateReleaseEvidenceV1;
void (null as RegisteredReleaseAuthorityV1 | null);
void (null as ReleaseAdmissionResultV1 | null);
void (null as ReleaseAuthorityKeySha256V1 | null);
void (null as ReleaseEvidenceCheckResultV1 | null);
void (null as ReleaseEvidenceInputV1 | null);

const USER_APPROVAL_FINGERPRINT =
  "454e04effab1f4bd83757aa23b3885fff8ed3cc9bbc226acdd816496abee370c";
const HOST_AUDIT_FINGERPRINT =
  "205477e6a7d35c81501a19e6e626b14664b2ed09d20edd7dce0c7c122912511b";
const USER_APPROVAL_SPKI =
  "MCowBQYDK2VwAyEAhYttcX7HTnczgb7-4HJyKNK6mU__uZmRGAabOV0EJUI";
const HOST_AUDIT_SPKI =
  "MCowBQYDK2VwAyEAoczdxczpGA6Kk4gtzp80-6wpCRT1K6wzI6wbKDXLdpY";

type FixtureSignerRole = "userApproval" | "hostAudit";

const FIXTURE_SIGNER_FINGERPRINTS = {
  userApproval: USER_APPROVAL_FINGERPRINT,
  hostAudit: HOST_AUDIT_FINGERPRINT,
} as const satisfies Readonly<
  Record<FixtureSignerRole, ReleaseAuthorityKeySha256V1>
>;

const FIXTURE_SIGNER_SPKIS = {
  userApproval: USER_APPROVAL_SPKI,
  hostAudit: HOST_AUDIT_SPKI,
} as const satisfies Readonly<Record<FixtureSignerRole, string>>;

const utf8 = (value: string): Uint8Array => new TextEncoder().encode(value);

const sha256Bytes = (value: Uint8Array): string =>
  createHash("sha256").update(value).digest("hex");

const sha256Utf8 = (value: string): string => sha256Bytes(utf8(value));

const candidateIdentity = (
  commit: string,
  tree: string,
): ReleaseCandidateIdentityV1 => ({
  commit,
  tree,
  candidateSha256: createHash("sha256").update(commit, "ascii").digest("hex"),
});

const ROOT_CONTRACT_ID = "fixture-v040-root-rotation-r1";
const ROOT_CONTRACT_SHA256 = sha256Utf8(
  "fixture-v040-root-contract-rotation-r1",
);
const FAMILY_SHA256 = sha256Utf8("fixture-v040-family-rotation-r1");
const STANDARD_CHILD_ID = "fixture-v040-t2-standard";
const STANDARD_PACKAGE_ID = "fixture-standard-package";
const EVALUATION_CHILD_ID = "v040-t8-evaluation";
const EVALUATION_PACKAGE_ID = "graph-eval-falsification";
const ISSUED_AT = "2026-08-24T12:00:00Z";

const B1 = candidateIdentity("3".repeat(40), "4".repeat(40));
const E0 = candidateIdentity("5".repeat(40), "6".repeat(40));

type ApprovedFixtureFile = {
  readonly path: string;
  readonly bytes: Uint8Array;
};

const STANDARD_APPROVED_FILES = [
  {
    path: "proposal.md",
    bytes: utf8("# Fixture standard proposal\n"),
  },
  {
    path: "specs/fixture-standard/spec.md",
    bytes: utf8(
      "## ADDED Requirements\n\n### Requirement: Fixture standard authority\n",
    ),
  },
] as const satisfies readonly ApprovedFixtureFile[];

const EVALUATION_APPROVED_FILES = [
  {
    path: "proposal.md",
    bytes: utf8("# Fixture evaluation proposal\n"),
  },
  {
    path: "specs/fixture-evaluation/spec.md",
    bytes: utf8(
      "## ADDED Requirements\n\n### Requirement: Fixture evaluation authority\n",
    ),
  },
] as const satisfies readonly ApprovedFixtureFile[];

const approvedBytes = (
  files: readonly ApprovedFixtureFile[],
): Readonly<Record<string, Uint8Array>> =>
  Object.fromEntries(files.map((file) => [file.path, file.bytes])) as Readonly<
    Record<string, Uint8Array>
  >;

const approvedOpenSpecSha256 = (
  files: readonly ApprovedFixtureFile[],
): string =>
  sha256Utf8(
    canonicalize({
      schema: "foreman.approved-openspec.v1",
      files: files.map((file) => ({
        path: file.path,
        sha256: sha256Bytes(file.bytes),
      })),
    }),
  );

const STANDARD_APPROVED_OPENSPEC_BYTES = approvedBytes(
  STANDARD_APPROVED_FILES,
);
const STANDARD_APPROVED_OPENSPEC_SHA256 = approvedOpenSpecSha256(
  STANDARD_APPROVED_FILES,
);
const STANDARD_TASK_PLAN_BYTES = utf8(
  "# Fixture standard tasks\n\n- [ ] Complete the fixture task.\n",
);
const STANDARD_TASK_PLAN_SHA256 = sha256Bytes(STANDARD_TASK_PLAN_BYTES);

const EVALUATION_APPROVED_OPENSPEC_BYTES = approvedBytes(
  EVALUATION_APPROVED_FILES,
);
const EVALUATION_APPROVED_OPENSPEC_SHA256 = approvedOpenSpecSha256(
  EVALUATION_APPROVED_FILES,
);
const EVALUATION_TASK_PLAN_BYTES = utf8(
  "# Fixture evaluation tasks\n\n- [ ] Complete the evaluation fixture.\n",
);
const EVALUATION_TASK_PLAN_SHA256 = sha256Bytes(
  EVALUATION_TASK_PLAN_BYTES,
);

const FIXTURE_FINDING: ReleaseAuditFindingV1 = {
  severity: "high",
  file: "packages/fixture/src/authority.ts",
  line: 7,
  summary: "Fixture authority is blocked.",
  evidence: "Deterministic fixture evidence.",
};

const FAILURE_EVIDENCE_SHA256 = sha256Utf8(
  "fixture external failure evidence",
);

const PRIOR_RESERVATION: FailedReservationAuthorityV1 = {
  reservationId: "fixture-reservation-prior",
  originReservationId: "fixture-reservation-prior",
  originalAction: "verify",
  candidate: B1,
  failureEvidenceSha256: FAILURE_EVIDENCE_SHA256,
};

type SignedFixtureObject =
  | ReleaseAuthorityReceiptV1
  | ReleaseEvidenceBundleV1
  | ReleaseActionOutcomeV1
  | ReleaseCouncilOutcomeV1;

type UnsignedFixtureObject<T extends { readonly signature: string }> =
  T extends unknown ? Omit<T, "signature"> : never;

type UnsignedReceipt = UnsignedFixtureObject<ReleaseAuthorityReceiptV1>;
type UnsignedBundle = UnsignedFixtureObject<ReleaseEvidenceBundleV1>;
type UnsignedActionOutcome =
  UnsignedFixtureObject<ReleaseActionOutcomeV1>;
type UnsignedCouncilOutcome =
  UnsignedFixtureObject<ReleaseCouncilOutcomeV1>;

type FixtureRecipeKind =
  | "receipt"
  | "bundle"
  | "actionOutcome"
  | "councilOutcome";

type FixtureRecipeMetadata = {
  readonly id: RecipeId;
  readonly kind: FixtureRecipeKind;
  readonly role: FixtureSignerRole;
  readonly dependsOn: readonly RecipeId[];
};

type FixtureSigningRecipe = FixtureRecipeMetadata & {
  readonly unsigned:
    | UnsignedReceipt
    | UnsignedBundle
    | UnsignedActionOutcome
    | UnsignedCouncilOutcome;
};

void FIXTURE_SIGNER_FINGERPRINTS;
void FIXTURE_SIGNER_SPKIS;
void ROOT_CONTRACT_ID;
void ROOT_CONTRACT_SHA256;
void FAMILY_SHA256;
void STANDARD_CHILD_ID;
void STANDARD_PACKAGE_ID;
void EVALUATION_CHILD_ID;
void EVALUATION_PACKAGE_ID;
void ISSUED_AT;
void B1;
void E0;
void STANDARD_APPROVED_OPENSPEC_BYTES;
void STANDARD_APPROVED_OPENSPEC_SHA256;
void STANDARD_TASK_PLAN_BYTES;
void STANDARD_TASK_PLAN_SHA256;
void EVALUATION_APPROVED_OPENSPEC_BYTES;
void EVALUATION_APPROVED_OPENSPEC_SHA256;
void EVALUATION_TASK_PLAN_BYTES;
void EVALUATION_TASK_PLAN_SHA256;
void FIXTURE_FINDING;
void PRIOR_RESERVATION;
void (null as SignedFixtureObject | null);
void (null as FixtureSigningRecipe | null);
void (null as ReleaseChecksSourceV1 | null);
void (null as ReleaseAuditSourceV1 | null);
void (null as ReleaseEvaluationReportSourceV1 | null);

const canonicalFile = (value: unknown): Uint8Array =>
  utf8(`${canonicalize(value)}\n`);

const completeFileSha256 = (value: unknown): string =>
  sha256Bytes(canonicalFile(value));

const CHECKS_PASS_SOURCE = {
  schema: "foreman.checks-source.v1",
  program: "v040",
  packageId: STANDARD_PACKAGE_ID,
  candidate: B1,
  status: "PASS",
  commands: [
    {
      commandSha256: sha256Utf8("fixture checks command"),
      exitCode: 0,
      stdoutSha256: sha256Utf8("fixture checks stdout"),
      stderrSha256: sha256Utf8("fixture checks stderr"),
    },
  ],
} as const satisfies ReleaseChecksSourceV1;

const CHECKS_FAIL_SOURCE = {
  ...CHECKS_PASS_SOURCE,
  status: "FAIL",
  commands: [
    {
      ...CHECKS_PASS_SOURCE.commands[0],
      exitCode: 1,
    },
  ],
} as const satisfies ReleaseChecksSourceV1;

const auditSource = (
  verdict: ReleaseAuditSourceV1["verdict"],
  findings: readonly ReleaseAuditFindingV1[],
): ReleaseAuditSourceV1 => ({
  schema: "foreman.audit-source.v1",
  program: "v040",
  packageId: STANDARD_PACKAGE_ID,
  candidate: B1,
  verdict,
  findings,
  auditArtifactSha256: sha256Utf8(`fixture audit artifact ${verdict}`),
});

const AUDIT_WARNING_SOURCE = auditSource("WARNING", [FIXTURE_FINDING]);
const AUDIT_BLOCKED_SOURCE = auditSource("BLOCKED", [FIXTURE_FINDING]);
const AUDIT_UNVERIFIED_SOURCE = auditSource("UNVERIFIED", [FIXTURE_FINDING]);
const AUDIT_APPROVED_SOURCE = auditSource("APPROVED", []);

const D_STD_UNSIGNED = {
  schema: "foreman.design-approval.v1",
  program: "v040",
  packageId: STANDARD_PACKAGE_ID,
  designCommit: B0.commit,
  designTree: B0.tree,
  approvedOpenSpecSha256: STANDARD_APPROVED_OPENSPEC_SHA256,
  taskPlanSha256: STANDARD_TASK_PLAN_SHA256,
  approvalStatementSha256: sha256Utf8("fixture standard approval statement"),
  issuerKeySha256: USER_APPROVAL_FINGERPRINT,
  issuedAt: ISSUED_AT,
} as const satisfies UnsignedReceipt;

const D_EVAL_UNSIGNED = {
  schema: "foreman.design-approval.v1",
  program: "v040",
  packageId: EVALUATION_PACKAGE_ID,
  designCommit: E0.commit,
  designTree: E0.tree,
  approvedOpenSpecSha256: EVALUATION_APPROVED_OPENSPEC_SHA256,
  taskPlanSha256: EVALUATION_TASK_PLAN_SHA256,
  approvalStatementSha256: sha256Utf8("fixture evaluation approval statement"),
  issuerKeySha256: USER_APPROVAL_FINGERPRINT,
  issuedAt: ISSUED_AT,
} as const satisfies UnsignedReceipt;

const E_AUTH_MANIFEST_SHA256 = sha256Utf8(
  "fixture locked evaluation manifest",
);

const E_AUTH_UNSIGNED = {
  schema: "foreman.evaluation-authority.v1",
  program: "v040",
  packageId: EVALUATION_PACKAGE_ID,
  manifestSha256: E_AUTH_MANIFEST_SHA256,
  issuerKeySha256: USER_APPROVAL_FINGERPRINT,
  issuedAt: ISSUED_AT,
} as const satisfies UnsignedReceipt;

const CHECKS_PASS_UNSIGNED = {
  schema: "foreman.checks-evidence.v1",
  program: "v040",
  packageId: STANDARD_PACKAGE_ID,
  candidate: B1,
  status: "PASS",
  checksSha256: completeFileSha256(CHECKS_PASS_SOURCE),
  issuerKeySha256: HOST_AUDIT_FINGERPRINT,
  issuedAt: ISSUED_AT,
} as const satisfies UnsignedReceipt;

const CHECKS_FAIL_UNSIGNED = {
  ...CHECKS_PASS_UNSIGNED,
  status: "FAIL",
  checksSha256: completeFileSha256(CHECKS_FAIL_SOURCE),
} as const satisfies UnsignedReceipt;

const auditReceipt = (
  source: ReleaseAuditSourceV1,
): UnsignedReceipt => ({
  schema: "foreman.release-audit.v1",
  program: "v040",
  packageId: STANDARD_PACKAGE_ID,
  candidate: B1,
  verdict: source.verdict,
  findings: source.findings,
  evidenceSha256: completeFileSha256(source),
  issuerKeySha256: HOST_AUDIT_FINGERPRINT,
  issuedAt: ISSUED_AT,
});

const AUDIT_WARNING_UNSIGNED = auditReceipt(AUDIT_WARNING_SOURCE);
const AUDIT_BLOCKED_UNSIGNED = auditReceipt(AUDIT_BLOCKED_SOURCE);
const AUDIT_UNVERIFIED_UNSIGNED = auditReceipt(AUDIT_UNVERIFIED_SOURCE);
const AUDIT_APPROVED_UNSIGNED = auditReceipt(AUDIT_APPROVED_SOURCE);

const COUNCIL_REQUEST_UNSIGNED = {
  schema: "foreman.council-request.v1",
  program: "v040",
  packageId: STANDARD_PACKAGE_ID,
  candidateSha256: B1.candidateSha256,
  questionSha256: sha256Utf8("fixture council question"),
  constraintsSha256: sha256Utf8("fixture council constraints"),
  optionsSha256: sha256Utf8("fixture council options"),
  issuerKeySha256: HOST_AUDIT_FINGERPRINT,
  issuedAt: ISSUED_AT,
} as const satisfies UnsignedReceipt;

const signedReceipt = (
  id: RecipeId,
  unsigned: UnsignedReceipt,
): ReleaseAuthorityReceiptV1 =>
  ({ ...unsigned, signature: SIGNATURES[id] }) as ReleaseAuthorityReceiptV1;

const D_STD = signedReceipt("D_STD", D_STD_UNSIGNED);
const D_EVAL = signedReceipt("D_EVAL", D_EVAL_UNSIGNED);
const E_AUTH = signedReceipt("E_AUTH", E_AUTH_UNSIGNED);
const CHECKS_PASS = signedReceipt("CHECKS_PASS", CHECKS_PASS_UNSIGNED);
const CHECKS_FAIL = signedReceipt("CHECKS_FAIL", CHECKS_FAIL_UNSIGNED);
const AUDIT_WARNING = signedReceipt("AUDIT_WARNING", AUDIT_WARNING_UNSIGNED);
const AUDIT_BLOCKED = signedReceipt("AUDIT_BLOCKED", AUDIT_BLOCKED_UNSIGNED);
const AUDIT_UNVERIFIED = signedReceipt(
  "AUDIT_UNVERIFIED",
  AUDIT_UNVERIFIED_UNSIGNED,
);
const AUDIT_APPROVED = signedReceipt("AUDIT_APPROVED", AUDIT_APPROVED_UNSIGNED);
const COUNCIL_REQUEST = signedReceipt(
  "COUNCIL_REQUEST",
  COUNCIL_REQUEST_UNSIGNED,
);

const RECEIPT_RECIPES = [
  { id: "D_STD", kind: "receipt", role: "userApproval", dependsOn: [], unsigned: D_STD_UNSIGNED },
  { id: "D_EVAL", kind: "receipt", role: "userApproval", dependsOn: [], unsigned: D_EVAL_UNSIGNED },
  { id: "E_AUTH", kind: "receipt", role: "userApproval", dependsOn: [], unsigned: E_AUTH_UNSIGNED },
  { id: "CHECKS_PASS", kind: "receipt", role: "hostAudit", dependsOn: [], unsigned: CHECKS_PASS_UNSIGNED },
  { id: "CHECKS_FAIL", kind: "receipt", role: "hostAudit", dependsOn: [], unsigned: CHECKS_FAIL_UNSIGNED },
  { id: "AUDIT_WARNING", kind: "receipt", role: "hostAudit", dependsOn: [], unsigned: AUDIT_WARNING_UNSIGNED },
  { id: "AUDIT_BLOCKED", kind: "receipt", role: "hostAudit", dependsOn: [], unsigned: AUDIT_BLOCKED_UNSIGNED },
  { id: "AUDIT_UNVERIFIED", kind: "receipt", role: "hostAudit", dependsOn: [], unsigned: AUDIT_UNVERIFIED_UNSIGNED },
  { id: "AUDIT_APPROVED", kind: "receipt", role: "hostAudit", dependsOn: [], unsigned: AUDIT_APPROVED_UNSIGNED },
  { id: "COUNCIL_REQUEST", kind: "receipt", role: "hostAudit", dependsOn: [], unsigned: COUNCIL_REQUEST_UNSIGNED },
] as const satisfies readonly FixtureSigningRecipe[];

void RECEIPT_RECIPES;

type BundleFixtureInput = {
  readonly childId: string;
  readonly packageId: string;
  readonly action: ReleaseEvidenceBundleV1["action"];
  readonly candidate: ReleaseCandidateIdentityV1;
  readonly taskPlanSha256: string;
  readonly receipts: readonly ReleaseAuthorityReceiptV1[];
  readonly priorReservation?: FailedReservationAuthorityV1;
};

const unsignedBundle = (input: BundleFixtureInput): UnsignedBundle => {
  const base: UnsignedBundle = {
    schema: "foreman.release-evidence-bundle.v1",
    program: "v040",
    rootContractId: ROOT_CONTRACT_ID,
    rootContractSha256: ROOT_CONTRACT_SHA256,
    familySha256: FAMILY_SHA256,
    childId: input.childId,
    packageId: input.packageId,
    action: input.action,
    candidate: input.candidate,
    taskPlanSha256: input.taskPlanSha256,
    receipts: input.receipts,
    issuerKeySha256: HOST_AUDIT_FINGERPRINT,
    issuedAt: ISSUED_AT,
  };
  if (input.priorReservation === undefined) return base;
  return { ...base, priorReservation: input.priorReservation };
};

const standardBundle = (
  action: ReleaseEvidenceBundleV1["action"],
  candidate: ReleaseCandidateIdentityV1,
  receipts: readonly ReleaseAuthorityReceiptV1[],
  priorReservation?: FailedReservationAuthorityV1,
): UnsignedBundle =>
  unsignedBundle({
    childId: STANDARD_CHILD_ID,
    packageId: STANDARD_PACKAGE_ID,
    action,
    candidate,
    taskPlanSha256: STANDARD_TASK_PLAN_SHA256,
    receipts,
    ...(priorReservation === undefined ? {} : { priorReservation }),
  });

const B_IMPLEMENT_B0_UNSIGNED = standardBundle("implement", B0, [D_STD]);
const B_IMPLEMENT_B1_UNSIGNED = standardBundle("implement", B1, [D_STD]);
const B_VERIFY_UNSIGNED = standardBundle("verify", B1, [D_STD]);
const B_AUDIT_UNSIGNED = standardBundle("audit", B1, [D_STD, CHECKS_PASS]);
const B_CORRECT_CHECKS_UNSIGNED = standardBundle("correct", B1, [
  D_STD,
  CHECKS_FAIL,
]);
const B_CORRECT_WARNING_UNSIGNED = standardBundle("correct", B1, [
  D_STD,
  AUDIT_WARNING,
]);
const B_CORRECT_BLOCKED_UNSIGNED = standardBundle("correct", B1, [
  D_STD,
  AUDIT_BLOCKED,
]);
const B_CORRECT_UNVERIFIED_UNSIGNED = standardBundle("correct", B1, [
  D_STD,
  AUDIT_UNVERIFIED,
]);
const B_COUNCIL_UNSIGNED = standardBundle("council", B1, [
  D_STD,
  COUNCIL_REQUEST,
]);
const B_PROVIDER_RETRY_UNSIGNED = standardBundle(
  "provider_retry",
  B1,
  [D_STD],
  PRIOR_RESERVATION,
);
const B_RESUME_UNSIGNED = standardBundle(
  "resume",
  B1,
  [D_STD],
  PRIOR_RESERVATION,
);
const B_INTEGRATE_UNSIGNED = standardBundle("integrate", B1, [
  D_STD,
  AUDIT_APPROVED,
]);
const B_PUBLISH_UNSIGNED = standardBundle("publish", B1, [
  D_STD,
  AUDIT_APPROVED,
]);
const B_EVALUATE_UNSIGNED = unsignedBundle({
  childId: EVALUATION_CHILD_ID,
  packageId: EVALUATION_PACKAGE_ID,
  action: "evaluate",
  candidate: E0,
  taskPlanSha256: EVALUATION_TASK_PLAN_SHA256,
  receipts: [D_EVAL, E_AUTH],
});

const signedBundle = (
  id: RecipeId,
  unsigned: UnsignedBundle,
): ReleaseEvidenceBundleV1 =>
  ({ ...unsigned, signature: SIGNATURES[id] }) as ReleaseEvidenceBundleV1;

const B_IMPLEMENT_B0 = signedBundle("B_IMPLEMENT_B0", B_IMPLEMENT_B0_UNSIGNED);
const B_IMPLEMENT_B1 = signedBundle("B_IMPLEMENT_B1", B_IMPLEMENT_B1_UNSIGNED);
const B_VERIFY = signedBundle("B_VERIFY", B_VERIFY_UNSIGNED);
const B_AUDIT = signedBundle("B_AUDIT", B_AUDIT_UNSIGNED);
const B_CORRECT_CHECKS = signedBundle(
  "B_CORRECT_CHECKS",
  B_CORRECT_CHECKS_UNSIGNED,
);
const B_CORRECT_WARNING = signedBundle(
  "B_CORRECT_WARNING",
  B_CORRECT_WARNING_UNSIGNED,
);
const B_CORRECT_BLOCKED = signedBundle(
  "B_CORRECT_BLOCKED",
  B_CORRECT_BLOCKED_UNSIGNED,
);
const B_CORRECT_UNVERIFIED = signedBundle(
  "B_CORRECT_UNVERIFIED",
  B_CORRECT_UNVERIFIED_UNSIGNED,
);
const B_COUNCIL = signedBundle("B_COUNCIL", B_COUNCIL_UNSIGNED);
const B_PROVIDER_RETRY = signedBundle(
  "B_PROVIDER_RETRY",
  B_PROVIDER_RETRY_UNSIGNED,
);
const B_RESUME = signedBundle("B_RESUME", B_RESUME_UNSIGNED);
const B_INTEGRATE = signedBundle("B_INTEGRATE", B_INTEGRATE_UNSIGNED);
const B_PUBLISH = signedBundle("B_PUBLISH", B_PUBLISH_UNSIGNED);
const B_EVALUATE = signedBundle("B_EVALUATE", B_EVALUATE_UNSIGNED);

const O_EXTERNAL_FAILURE_UNSIGNED = {
  schema: "foreman.release-action-outcome.v1",
  program: "v040",
  rootContractId: ROOT_CONTRACT_ID,
  rootContractSha256: ROOT_CONTRACT_SHA256,
  familySha256: FAMILY_SHA256,
  childId: STANDARD_CHILD_ID,
  packageId: STANDARD_PACKAGE_ID,
  reservationAction: "verify",
  effectiveAction: "verify",
  reservationId: PRIOR_RESERVATION.reservationId,
  originReservationId: PRIOR_RESERVATION.originReservationId,
  candidateSha256: B1.candidateSha256,
  status: "EXTERNAL_FAILURE",
  evidenceSha256: FAILURE_EVIDENCE_SHA256,
  issuerKeySha256: HOST_AUDIT_FINGERPRINT,
  issuedAt: ISSUED_AT,
} as const satisfies UnsignedActionOutcome;

const O_COUNCIL_UNSIGNED = {
  schema: "foreman.council-outcome.v1",
  program: "v040",
  rootContractId: ROOT_CONTRACT_ID,
  rootContractSha256: ROOT_CONTRACT_SHA256,
  familySha256: FAMILY_SHA256,
  childId: STANDARD_CHILD_ID,
  packageId: STANDARD_PACKAGE_ID,
  reservationAction: "council",
  reservationId: "fixture-reservation-council",
  originReservationId: "fixture-reservation-council",
  candidateSha256: B1.candidateSha256,
  requestSha256: completeFileSha256(COUNCIL_REQUEST),
  decisionSha256: sha256Utf8("fixture council decision"),
  status: "ADVICE",
  issuerKeySha256: HOST_AUDIT_FINGERPRINT,
  issuedAt: ISSUED_AT,
} as const satisfies UnsignedCouncilOutcome;

const O_EXTERNAL_FAILURE = {
  ...O_EXTERNAL_FAILURE_UNSIGNED,
  signature: SIGNATURES.O_EXTERNAL_FAILURE,
} as const satisfies ReleaseActionOutcomeV1;

const O_COUNCIL = {
  ...O_COUNCIL_UNSIGNED,
  signature: SIGNATURES.O_COUNCIL,
} as const satisfies ReleaseCouncilOutcomeV1;

const BUNDLE_RECIPES = [
  { id: "B_IMPLEMENT_B0", kind: "bundle", role: "hostAudit", dependsOn: ["D_STD"], unsigned: B_IMPLEMENT_B0_UNSIGNED },
  { id: "B_IMPLEMENT_B1", kind: "bundle", role: "hostAudit", dependsOn: ["D_STD"], unsigned: B_IMPLEMENT_B1_UNSIGNED },
  { id: "B_VERIFY", kind: "bundle", role: "hostAudit", dependsOn: ["D_STD"], unsigned: B_VERIFY_UNSIGNED },
  { id: "B_AUDIT", kind: "bundle", role: "hostAudit", dependsOn: ["D_STD", "CHECKS_PASS"], unsigned: B_AUDIT_UNSIGNED },
  { id: "B_CORRECT_CHECKS", kind: "bundle", role: "hostAudit", dependsOn: ["D_STD", "CHECKS_FAIL"], unsigned: B_CORRECT_CHECKS_UNSIGNED },
  { id: "B_CORRECT_WARNING", kind: "bundle", role: "hostAudit", dependsOn: ["D_STD", "AUDIT_WARNING"], unsigned: B_CORRECT_WARNING_UNSIGNED },
  { id: "B_CORRECT_BLOCKED", kind: "bundle", role: "hostAudit", dependsOn: ["D_STD", "AUDIT_BLOCKED"], unsigned: B_CORRECT_BLOCKED_UNSIGNED },
  { id: "B_CORRECT_UNVERIFIED", kind: "bundle", role: "hostAudit", dependsOn: ["D_STD", "AUDIT_UNVERIFIED"], unsigned: B_CORRECT_UNVERIFIED_UNSIGNED },
  { id: "B_COUNCIL", kind: "bundle", role: "hostAudit", dependsOn: ["D_STD", "COUNCIL_REQUEST"], unsigned: B_COUNCIL_UNSIGNED },
  { id: "B_PROVIDER_RETRY", kind: "bundle", role: "hostAudit", dependsOn: ["D_STD"], unsigned: B_PROVIDER_RETRY_UNSIGNED },
  { id: "B_RESUME", kind: "bundle", role: "hostAudit", dependsOn: ["D_STD"], unsigned: B_RESUME_UNSIGNED },
  { id: "B_INTEGRATE", kind: "bundle", role: "hostAudit", dependsOn: ["D_STD", "AUDIT_APPROVED"], unsigned: B_INTEGRATE_UNSIGNED },
  { id: "B_PUBLISH", kind: "bundle", role: "hostAudit", dependsOn: ["D_STD", "AUDIT_APPROVED"], unsigned: B_PUBLISH_UNSIGNED },
  { id: "B_EVALUATE", kind: "bundle", role: "hostAudit", dependsOn: ["D_EVAL", "E_AUTH"], unsigned: B_EVALUATE_UNSIGNED },
] as const satisfies readonly FixtureSigningRecipe[];

const OUTCOME_RECIPES = [
  { id: "O_EXTERNAL_FAILURE", kind: "actionOutcome", role: "hostAudit", dependsOn: [], unsigned: O_EXTERNAL_FAILURE_UNSIGNED },
  { id: "O_COUNCIL", kind: "councilOutcome", role: "hostAudit", dependsOn: ["COUNCIL_REQUEST"], unsigned: O_COUNCIL_UNSIGNED },
] as const satisfies readonly FixtureSigningRecipe[];

void B_IMPLEMENT_B0;
void B_IMPLEMENT_B1;
void B_VERIFY;
void B_AUDIT;
void B_CORRECT_CHECKS;
void B_CORRECT_WARNING;
void B_CORRECT_BLOCKED;
void B_CORRECT_UNVERIFIED;
void B_COUNCIL;
void B_PROVIDER_RETRY;
void B_RESUME;
void B_INTEGRATE;
void B_PUBLISH;
void B_EVALUATE;
void O_EXTERNAL_FAILURE;
void O_COUNCIL;
void BUNDLE_RECIPES;
void OUTCOME_RECIPES;

// FOREMAN_TASK33_UNSIGNED_MUTANTS
