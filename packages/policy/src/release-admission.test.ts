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

// FOREMAN_TASK33_UNSIGNED_RECEIPTS
