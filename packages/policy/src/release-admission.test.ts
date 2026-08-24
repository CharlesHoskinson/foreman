import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import {
  evaluateReleaseAdmissionV1,
  evaluateReleaseEvidenceV1,
  type RegisteredReleaseAuthorityV1,
  type ReleaseAdmissionFailureReason,
  type ReleaseAdmissionResultV1,
  type ReleaseAuthorityKeySha256V1,
  type ReleaseCandidateIdentityV1,
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

// FOREMAN_TASK33_FIXTURES
