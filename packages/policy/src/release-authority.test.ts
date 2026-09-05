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
  type ReleaseAuditSourceV1,
  type ReleaseCandidateIdentityV1,
  type ReleaseChecksSourceV1,
  type ReleaseEvaluationReportSourceV1,
  type ReleaseProducerSourceV1,
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

test("every authority schema is closed over required own keys and types", () => {
  for (const value of AUTHORITY_OBJECTS) {
    assert.deepEqual(
      parseReleaseAuthorityObjectV1({ ...value, unexpected: true }),
      { _tag: "Invalid" },
      `${value.schema} accepted an extra key`,
    );
    for (const key of Object.keys(value)) {
      const missing = Object.fromEntries(
        Object.entries(value).filter(([name]) => name !== key),
      );
      assert.deepEqual(
        parseReleaseAuthorityObjectV1(missing),
        { _tag: "Invalid" },
        `${value.schema} accepted missing ${key}`,
      );
      assert.deepEqual(
        parseReleaseAuthorityObjectV1({ ...value, [key]: null }),
        { _tag: "Invalid" },
        `${value.schema} accepted null ${key}`,
      );
    }
  }
});

test("authority identifiers, Git identities, digests, enums, and timestamps are strict", () => {
  const invalid: readonly unknown[] = [
    { ...DESIGN, packageId: "bad\\id" },
    { ...DESIGN, packageId: "bad\tid" },
    { ...DESIGN, designCommit: "A".repeat(40) },
    { ...DESIGN, designCommit: "a".repeat(39) },
    { ...DESIGN, designTree: "g".repeat(40) },
    { ...DESIGN, approvedOpenSpecSha256: "A".repeat(64) },
    { ...CHECKS, status: "UNKNOWN" },
    { ...AUDIT, verdict: "UNKNOWN" },
    { ...ACTION_OUTCOME, status: "UNKNOWN" },
    { ...ACTION_OUTCOME, reservationAction: "deploy" },
    { ...COUNCIL_OUTCOME, status: "UNKNOWN" },
    { ...EVALUATION_VERDICT, result: "UNKNOWN" },
    { ...CANCEL, childId: "bad/id" },
    { ...INVALIDATE, familySha256: "f".repeat(63) },
    {
      ...BUNDLE,
      candidate: { ...CANDIDATE, candidateSha256: SHA_F },
    },
  ];
  for (const value of invalid) {
    assert.deepEqual(parseReleaseAuthorityObjectV1(value), { _tag: "Invalid" });
  }
  for (const value of AUTHORITY_OBJECTS) {
    assert.deepEqual(
      parseReleaseAuthorityObjectV1({ ...value, issuedAt: "2026-08-24T12:00:00.1Z" }),
      { _tag: "Invalid" },
      `${value.schema} accepted a fractional timestamp`,
    );
  }
});

test("legacy authority fields are closed", () => {
  assert.deepEqual(
    parseReleaseAuthorityObjectV1({ ...DESIGN, keyMaterial: "legacy" }),
    { _tag: "Invalid" },
  );
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

test("all producer sources are closed and bind complete canonical file digests", () => {
  const checks: ReleaseChecksSourceV1 = {
    schema: "foreman.checks-source.v1",
    program: "v040",
    packageId: "project-registry",
    candidate: CANDIDATE,
    status: "PASS",
    commands: [
      {
        commandSha256: SHA_C,
        exitCode: 0,
        stdoutSha256: SHA_D,
        stderrSha256: SHA_E,
      },
    ],
  };
  const audit: ReleaseAuditSourceV1 = {
    schema: "foreman.audit-source.v1",
    program: "v040",
    packageId: "project-registry",
    candidate: CANDIDATE,
    verdict: "APPROVED",
    findings: [],
    auditArtifactSha256: SHA_F,
  };
  const evaluation: ReleaseEvaluationReportSourceV1 = {
    schema: "foreman.evaluation-report-source.v1",
    program: "v040",
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
    reportArtifactSha256: SHA_D,
  };
  const sources: readonly {
    readonly source: ReleaseProducerSourceV1;
    readonly receipt: ReleaseAuthorityObjectV1;
    readonly mismatch: ReleaseAuthorityObjectV1;
  }[] = [
    {
      source: checks,
      receipt: {
        ...CHECKS,
        checksSha256: sha256Hex(canonicalFile(checks)),
      },
      mismatch: {
        ...CHECKS,
        status: "FAIL",
        checksSha256: sha256Hex(canonicalFile(checks)),
      },
    },
    {
      source: audit,
      receipt: {
        ...AUDIT,
        evidenceSha256: sha256Hex(canonicalFile(audit)),
      },
      mismatch: {
        ...AUDIT,
        verdict: "WARNING",
        evidenceSha256: sha256Hex(canonicalFile(audit)),
      },
    },
    {
      source: evaluation,
      receipt: {
        ...EVALUATION_VERDICT,
        reportSha256: sha256Hex(canonicalFile(evaluation)),
      },
      mismatch: {
        ...EVALUATION_VERDICT,
        completedRuns: 1999,
        notRunRuns: 1,
        reportSha256: sha256Hex(canonicalFile(evaluation)),
      },
    },
  ];
  for (const item of sources) {
    const sourceBytes = canonicalFile(item.source);
    assert.deepEqual(decodeReleaseProducerSourceFileV1(sourceBytes), {
      _tag: "Valid",
      value: item.source,
      sha256: sha256Hex(sourceBytes),
    });
    assert.deepEqual(
      verifyReleaseSourceReceiptBindingV1(
        sourceBytes,
        canonicalFile(item.receipt),
      ),
      { _tag: "Valid" },
    );
    assert.deepEqual(
      verifyReleaseSourceReceiptBindingV1(
        sourceBytes,
        canonicalFile(item.mismatch),
      ),
      { _tag: "Invalid" },
    );
    assert.deepEqual(
      decodeReleaseProducerSourceFileV1(
        canonicalFile({ ...item.source, unexpected: true }),
      ),
      { _tag: "Invalid" },
    );
    for (const key of Object.keys(item.source)) {
      const missing = Object.fromEntries(
        Object.entries(item.source).filter(([name]) => name !== key),
      );
      assert.deepEqual(decodeReleaseProducerSourceFileV1(canonicalFile(missing)), {
        _tag: "Invalid",
      });
      assert.deepEqual(
        decodeReleaseProducerSourceFileV1(
          canonicalFile({ ...item.source, [key]: null }),
        ),
        { _tag: "Invalid" },
      );
    }
  }

  assert.deepEqual(
    decodeReleaseProducerSourceFileV1(
      canonicalFile({
        ...checks,
        commands: [{ ...checks.commands[0]!, unexpected: true }],
      }),
    ),
    { _tag: "Invalid" },
  );
  assert.deepEqual(
    decodeReleaseProducerSourceFileV1(
      canonicalFile({ ...audit, verdict: "UNKNOWN" }),
    ),
    { _tag: "Invalid" },
  );
  assert.deepEqual(
    decodeReleaseProducerSourceFileV1(
      canonicalFile({ ...evaluation, completedRuns: 1999 }),
    ),
    { _tag: "Invalid" },
  );
});

test("v050 authority objects parse and v041 is refused", () => {
  const v050 = { ...DESIGN, program: "v050" as const };
  assert.deepEqual(parseReleaseAuthorityObjectV1(v050), {
    _tag: "Valid",
    value: v050,
  });
  assert.deepEqual(
    parseReleaseAuthorityObjectV1({ ...DESIGN, program: "v041" }),
    { _tag: "Invalid", reason: "wrong_program" },
  );
});

test("bundle program v041 decodes as wrong_program", () => {
  const bundle = { ...BUNDLE, program: "v041" };
  assert.deepEqual(parseReleaseAuthorityObjectV1(bundle), {
    _tag: "Invalid",
    reason: "wrong_program",
  });
  assert.deepEqual(decodeReleaseAuthorityFileV1(canonicalFile(bundle)), {
    _tag: "Invalid",
    reason: "wrong_program",
  });
});

test("nested receipt program v041 decodes as wrong_program", () => {
  const bundle = {
    ...BUNDLE,
    receipts: [{ ...DESIGN, program: "v041" }],
  };
  assert.deepEqual(parseReleaseAuthorityObjectV1(bundle), {
    _tag: "Invalid",
    reason: "wrong_program",
  });
  assert.deepEqual(decodeReleaseAuthorityFileV1(canonicalFile(bundle)), {
    _tag: "Invalid",
    reason: "wrong_program",
  });
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

  const invalidFileSets = [
    [files[1]!, files[0]!, files[2]!],
    [files[0]!, files[2]!],
    [files[0]!, files[1]!, files[2]!, files[2]!],
    [{ path: "README.md", bytes: utf8("extra\n") }, ...files],
    [{ path: "/absolute.md", bytes: utf8("bad\n") }, ...files],
    [{ path: "../escape.md", bytes: utf8("bad\n") }, ...files],
    [...files, { path: "specs\\bad.md", bytes: utf8("bad\n") }],
    [
      files[0]!,
      files[1]!,
      { path: "specs/release/readme.txt", bytes: utf8("bad\n") },
      files[2]!,
    ],
    [...files, { path: "tasks.md", bytes: utf8("excluded\n") }],
  ] as const;
  for (const invalidFiles of invalidFileSets) {
    assert.deepEqual(
      buildApprovedOpenSpecManifestV1({
        workflow: "foreman-architectural",
        files: invalidFiles,
      }),
      { _tag: "Invalid" },
    );
  }
  assert.deepEqual(
    buildApprovedOpenSpecManifestV1({
      workflow: "foreman-bounded",
      files,
    }),
    { _tag: "Invalid" },
  );
  assert.deepEqual(
    validateApprovedOpenSpecManifestV1({
      workflow: "foreman-architectural",
      manifest: {
        ...built.manifest,
        files: [
          { ...built.manifest.files[0]!, unexpected: true },
          ...built.manifest.files.slice(1),
        ],
      } as typeof built.manifest,
      files,
    }),
    { _tag: "Invalid" },
  );
});
