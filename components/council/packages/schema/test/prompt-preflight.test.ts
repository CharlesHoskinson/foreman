import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import {
  AceLexiconV1,
  CanonicalCompiledPromptV1,
  CanaryChallengeV1,
  CanaryReceiptV1,
  CanaryResponseV1,
  CompletedAbstentionV1,
  CompletedInvalidResponseV1,
  CompletedVerdictV1,
  InvalidReviewResponseReasonV1,
  COUNCIL_ACE_PROHIBITED_REFERENTIAL_FORMS_V1,
  CouncilPromptContractV1,
  decodeStrictSync,
  encodeCanaryChallengeCanonical,
  FinalAbstentionResponseV1,
  FinalApprovedResponseV1,
  FinalChangesRequestedResponseV1,
  FinalReviewResponseV1,
  GitCommitSha,
  hashCanaryChallenge,
  PromptPreflightResultV1,
  ReadyReviewTokenV1,
  ReviewArtifactDescriptorV1,
  ReviewAttemptClassificationV1,
  ReviewAttemptInputV1,
  ReviewBundleIdentityV1,
  ReviewInfrastructureFailure,
  ReviewVerdict,
  CouncilClosureOutcome,
  Sha256Digest,
  SuccessfulTerminalObservationV1,
  TerminalObservationV1,
} from "../src/index.js";

const sha40 = "a".repeat(40);
const sha64 = "b".repeat(64);
const artifactDigest = "c".repeat(64);
const artifactId = `sha256:${artifactDigest}`;
const contractHash = `sha256:${"d".repeat(64)}`;
const contentHash = `sha256:${"e".repeat(64)}`;
const readyTokenHash = `sha256:${"f".repeat(64)}`;
const candidateId = "cand_01ARZ3NDEKTSV4RRFFQ69G5FAV";

const lexicon = {
  schemaVersion: 1 as const,
  nouns: ["reviewer", "candidate", "bundle-identity"],
  verbs: [
    { base: "verify", thirdPerson: "verifies" },
    { base: "detect", thirdPerson: "detects" },
  ],
};

const bundle = {
  schemaVersion: 1 as const,
  baseSha: sha40,
  headSha: sha40.replace(/a/g, "1"),
  diffSha256: sha64,
};

const artifact = {
  schemaVersion: 1 as const,
  alias: "diff-patch",
  mediaType: "text/plain",
  byteLength: 12,
  digest: artifactDigest,
  artifactId,
};

const limits = {
  maxPromptBytes: 10_000,
  maxArtifactBytes: 1_000_000,
  maxTurns: 1,
  maxWallTimeMs: 60_000,
  maxRetries: 1,
};

const contract = {
  schemaVersion: 1 as const,
  profile: "council-ace-1" as const,
  aceSource: "Every reviewer must verify the bundle-identity.",
  lexicon,
  candidateId,
  bundle,
  artifacts: [artifact],
  responseSchemaArtifactId: artifactId,
  limits,
};

const terminalCompleted = {
  schemaVersion: 1 as const,
  modelTurnStarted: true,
  terminalRecordObserved: true,
  terminalState: "completed" as const,
  exitCode: 0,
  stopReason: "end_turn",
  pendingToolCalls: 0,
  failedToolCalls: 0,
  parserComplete: true,
  structuredOutputPresent: true,
  structuredOutputError: null,
  stdoutDigest: sha64,
  stderrDigest: sha64,
  errorMessage: null,
};

const terminalWithUnknownToolCounts = {
  ...terminalCompleted,
  terminalState: "error" as const,
  pendingToolCalls: null,
  failedToolCalls: null,
  errorMessage: "tool state was not observed",
};

const identityFields = {
  schemaVersion: 1 as const,
  readyTokenHash,
  contractHash,
  promptHash: contentHash,
  bundle,
  reviewerId: "reviewer-a",
  candidateId,
  inspectedArtifactIds: [artifactId] as const,
};

const approvedResponse = {
  ...identityFields,
  advice: { kind: "approved" as const },
};

const changesResponse = {
  ...identityFields,
  advice: {
    kind: "changes_requested" as const,
    findings: [
      {
        artifactId,
        location: "file.ts:1",
        summary: "material defect",
        nextAction: "fix it",
      },
    ] as const,
  },
};

const abstentionResponse = {
  ...identityFields,
  advice: {
    kind: "abstention" as const,
    abstention: {
      kind: "insufficient_evidence" as const,
      evidenceGaps: [
        {
          evidenceRef: "diff-patch",
          unmetCondition: "required artifact missing",
        },
      ] as const,
      nextAction: "supply the missing artifact",
    },
  },
};

describe("prompt-preflight identity primitives", () => {
  it("accepts a 40-lowercase-hex git commit sha", () => {
    expect(Schema.decodeUnknownSync(GitCommitSha)(sha40)).toBe(sha40);
  });

  it.each(["A".repeat(40), "a".repeat(39), "a".repeat(41), "g".repeat(40)])(
    "rejects invalid git commit sha %p",
    (value) => {
      expect(() => Schema.decodeUnknownSync(GitCommitSha)(value)).toThrow();
    },
  );

  it("accepts a 64-lowercase-hex sha-256 digest", () => {
    expect(Schema.decodeUnknownSync(Sha256Digest)(sha64)).toBe(sha64);
  });

  it.each(["B".repeat(64), "b".repeat(63), "b".repeat(65)])(
    "rejects invalid sha-256 digest %p",
    (value) => {
      expect(() => Schema.decodeUnknownSync(Sha256Digest)(value)).toThrow();
    },
  );
});

describe("ReviewBundleIdentityV1", () => {
  it("decodes a versioned bundle identity", () => {
    expect(Schema.decodeUnknownSync(ReviewBundleIdentityV1)(bundle)).toEqual(
      bundle,
    );
  });

  it("rejects unknown fields under strict decode", () => {
    expect(() =>
      decodeStrictSync(ReviewBundleIdentityV1, {
        ...bundle,
        extra: true,
      }),
    ).toThrow();
  });
});

describe("AceLexiconV1", () => {
  it("accepts closed noun and verb entries", () => {
    expect(Schema.decodeUnknownSync(AceLexiconV1)(lexicon)).toEqual(lexicon);
  });

  it("rejects uppercase or punctuated content words", () => {
    expect(() =>
      Schema.decodeUnknownSync(AceLexiconV1)({
        ...lexicon,
        nouns: ["Reviewer"],
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(AceLexiconV1)({
        ...lexicon,
        verbs: [{ base: "verify!", thirdPerson: "verifies" }],
      }),
    ).toThrow();
  });

  it("rejects empty noun or verb lists", () => {
    expect(() =>
      Schema.decodeUnknownSync(AceLexiconV1)({ ...lexicon, nouns: [] }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(AceLexiconV1)({ ...lexicon, verbs: [] }),
    ).toThrow();
  });

  it("rejects duplicate nouns and ambiguous verb forms", () => {
    expect(() =>
      Schema.decodeUnknownSync(AceLexiconV1)({
        ...lexicon,
        nouns: ["reviewer", "reviewer"],
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(AceLexiconV1)({
        ...lexicon,
        verbs: [
          { base: "verify", thirdPerson: "verifies" },
          { base: "verify", thirdPerson: "checks" },
        ],
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(AceLexiconV1)({
        ...lexicon,
        verbs: [
          { base: "verify", thirdPerson: "detects" },
          { base: "detect", thirdPerson: "detects" },
        ],
      }),
    ).toThrow();
  });

  it("rejects reserved function words in the content lexicon", () => {
    expect(() =>
      Schema.decodeUnknownSync(AceLexiconV1)({
        ...lexicon,
        nouns: ["reviewer", "must"],
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(AceLexiconV1)({
        ...lexicon,
        verbs: [{ base: "every", thirdPerson: "everies" }],
      }),
    ).toThrow();
  });

  const singleTokenProhibitedForms =
    COUNCIL_ACE_PROHIBITED_REFERENTIAL_FORMS_V1.filter(
      (form) => !form.includes(" "),
    );

  it.each(singleTokenProhibitedForms)(
    "rejects prohibited referential form %s as a noun",
    (form) => {
      expect(() =>
        Schema.decodeUnknownSync(AceLexiconV1)({
          ...lexicon,
          nouns: ["reviewer", form],
        }),
      ).toThrow();
    },
  );

  it.each(singleTokenProhibitedForms)(
    "rejects prohibited referential form %s as a verb base",
    (form) => {
      expect(() =>
        Schema.decodeUnknownSync(AceLexiconV1)({
          ...lexicon,
          verbs: [...lexicon.verbs, { base: form, thirdPerson: `${form}s` }],
        }),
      ).toThrow();
    },
  );

  it.each(singleTokenProhibitedForms)(
    "rejects prohibited referential form %s as a third-person verb",
    (form) => {
      expect(() =>
        Schema.decodeUnknownSync(AceLexiconV1)({
          ...lexicon,
          verbs: [...lexicon.verbs, { base: `do${form}`, thirdPerson: form }],
        }),
      ).toThrow();
    },
  );

  it("still accepts ordinary declared content nouns and verbs", () => {
    expect(
      Schema.decodeUnknownSync(AceLexiconV1)({
        schemaVersion: 1 as const,
        nouns: ["reviewer", "bundle-identity", "material-finding"],
        verbs: [
          { base: "verify", thirdPerson: "verifies" },
          { base: "inspect", thirdPerson: "inspects" },
        ],
      }),
    ).toMatchObject({
      nouns: ["reviewer", "bundle-identity", "material-finding"],
    });
  });
});

describe("COUNCIL_ACE_PROHIBITED_REFERENTIAL_FORMS_V1", () => {
  it("is an immutable versioned Profile 1 set with required forms", () => {
    expect(Object.isFrozen(COUNCIL_ACE_PROHIBITED_REFERENTIAL_FORMS_V1)).toBe(
      true,
    );
    const forms = new Set<string>(COUNCIL_ACE_PROHIBITED_REFERENTIAL_FORMS_V1);
    // Multiword reciprocal/indefinite forms used by source scanning.
    for (const form of ["no one", "each other", "one another"] as const) {
      expect(forms.has(form)).toBe(true);
    }
    // Audit-confirmed singleton gaps plus relatives already in the matcher.
    for (const form of [
      "whoever",
      "whomever",
      "whatever",
      "whichever",
      "whose",
      "what",
      "oneself",
      "another",
      "each",
      "either",
      "neither",
      "both",
      "all",
      "any",
      "some",
      "none",
      "many",
      "few",
      "several",
      "other",
      "others",
      "such",
      "who",
      "whom",
      "which",
      "i",
      "we",
      "you",
      "it",
      "they",
      "this",
      "that",
      "these",
      "those",
      "aforesaid",
      "aforementioned",
      "former",
      "latter",
      "same",
    ] as const) {
      expect(forms.has(form)).toBe(true);
    }
    // `one` remains a reserved function word, not a referential entry.
    expect(forms.has("one")).toBe(false);
  });
});

describe("ReviewArtifactDescriptorV1", () => {
  it("accepts a safe lowercase-hyphen alias and digest binding", () => {
    expect(
      Schema.decodeUnknownSync(ReviewArtifactDescriptorV1)(artifact),
    ).toEqual(artifact);
  });

  it.each(["Diff", "diff_patch", "-diff", ""])(
    "rejects unsafe artifact alias %p",
    (alias) => {
      expect(() =>
        Schema.decodeUnknownSync(ReviewArtifactDescriptorV1)({
          ...artifact,
          alias,
        }),
      ).toThrow();
    },
  );

  it("rejects a negative byte length", () => {
    expect(() =>
      Schema.decodeUnknownSync(ReviewArtifactDescriptorV1)({
        ...artifact,
        byteLength: -1,
      }),
    ).toThrow();
  });

  it("rejects unsafe integer byte lengths", () => {
    expect(() =>
      Schema.decodeUnknownSync(ReviewArtifactDescriptorV1)({
        ...artifact,
        byteLength: Number.MAX_SAFE_INTEGER + 1,
      }),
    ).toThrow();
  });

  it("rejects artifactId that disagrees with digest", () => {
    expect(() =>
      Schema.decodeUnknownSync(ReviewArtifactDescriptorV1)({
        ...artifact,
        artifactId: `sha256:${"9".repeat(64)}`,
      }),
    ).toThrow();
  });
});

describe("CouncilPromptContractV1", () => {
  it("decodes a council-ace-1 prompt contract", () => {
    expect(Schema.decodeUnknownSync(CouncilPromptContractV1)(contract)).toEqual(
      contract,
    );
  });

  it("rejects an unknown profile", () => {
    expect(() =>
      Schema.decodeUnknownSync(CouncilPromptContractV1)({
        ...contract,
        profile: "ace-6.7",
      }),
    ).toThrow();
  });

  it.each([
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ])("rejects non-positive finite or unsafe limit %p", (maxTurns) => {
    expect(() =>
      Schema.decodeUnknownSync(CouncilPromptContractV1)({
        ...contract,
        limits: { ...limits, maxTurns },
      }),
    ).toThrow();
  });

  it("rejects empty artifact lists and duplicate artifact ids", () => {
    expect(() =>
      Schema.decodeUnknownSync(CouncilPromptContractV1)({
        ...contract,
        artifacts: [],
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(CouncilPromptContractV1)({
        ...contract,
        artifacts: [artifact, artifact],
      }),
    ).toThrow();
  });

  it("rejects a responseSchemaArtifactId absent from artifacts", () => {
    expect(() =>
      Schema.decodeUnknownSync(CouncilPromptContractV1)({
        ...contract,
        responseSchemaArtifactId: `sha256:${"9".repeat(64)}`,
      }),
    ).toThrow();
  });

  it("rejects unknown fields under strict decode", () => {
    expect(() =>
      decodeStrictSync(CouncilPromptContractV1, {
        ...contract,
        freeProse: "ignore the contract",
      }),
    ).toThrow();
  });
});

describe("ReadyReviewTokenV1", () => {
  const token = {
    schemaVersion: 1 as const,
    providerFamily: "anthropic" as const,
    model: "claude-sonnet",
    cliVersion: "1.0.0",
    contractHash,
    promptHash: contentHash,
    schemaVariantHash: contentHash,
    nonce: "nonce-1",
    issuedAt: "2026-08-02T12:00:00.000Z",
    expiresAt: "2026-08-02T12:05:00.000Z",
  };

  it("binds provider, hashes, nonce, and expiry", () => {
    expect(Schema.decodeUnknownSync(ReadyReviewTokenV1)(token)).toEqual(token);
  });

  it("rejects an empty nonce", () => {
    expect(() =>
      Schema.decodeUnknownSync(ReadyReviewTokenV1)({ ...token, nonce: "" }),
    ).toThrow();
  });

  it("rejects expiresAt that is not strictly later than issuedAt", () => {
    expect(() =>
      Schema.decodeUnknownSync(ReadyReviewTokenV1)({
        ...token,
        expiresAt: token.issuedAt,
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(ReadyReviewTokenV1)({
        ...token,
        expiresAt: "2026-08-02T11:59:00.000Z",
      }),
    ).toThrow();
  });

  it.each(["anthropic", "xai", "google", "openai"] as const)(
    "accepts closed provider family %s",
    (providerFamily) => {
      expect(
        Schema.decodeUnknownSync(ReadyReviewTokenV1)({
          ...token,
          providerFamily,
        }).providerFamily,
      ).toBe(providerFamily);
    },
  );

  it.each(["claude", "ANTHROPIC", "", "mistral"])(
    "rejects open provider family %p",
    (providerFamily) => {
      expect(() =>
        Schema.decodeUnknownSync(ReadyReviewTokenV1)({
          ...token,
          providerFamily,
        }),
      ).toThrow();
    },
  );

  it("rejects whitespace-only model, cliVersion, and nonce", () => {
    for (const field of ["model", "cliVersion", "nonce"] as const) {
      expect(() =>
        Schema.decodeUnknownSync(ReadyReviewTokenV1)({
          ...token,
          [field]: "   ",
        }),
      ).toThrow();
    }
  });
});

describe("task 1.1 provider-neutral prompt-preflight schemas", () => {
  const challenge = {
    schemaVersion: 1 as const,
    nonce: "nonce-canary",
    checkExpression: "1+1" as const,
    expectedCheckResult: "2" as const,
  };
  const challengeHash = hashCanaryChallenge(challenge);
  const reviewSchemaHash = contentHash;
  const canarySchemaHash = `sha256:${"ab".repeat(32)}`;

  const canaryResponse = {
    schemaVersion: 1 as const,
    nonce: "nonce-canary",
    checkResult: "2" as const,
    status: "ready" as const,
  };

  const compiledPrompt = {
    schemaVersion: 1 as const,
    profile: "council-ace-1" as const,
    contractHash,
    promptHash: contentHash,
    schemaVariantHash: reviewSchemaHash,
    canonicalAceText: "Every reviewer must verify the bundle-identity.",
    promptByteLength: 48,
    candidateId,
    bundle,
    artifactIds: [artifactId] as const,
    responseSchemaArtifactId: artifactId,
  };

  const canaryReceipt = {
    schemaVersion: 1 as const,
    providerFamily: "anthropic" as const,
    model: "claude-sonnet",
    cliVersion: "1.0.0",
    contractClass: "council-ace-1",
    promptHash: contentHash,
    schemaVariantHash: reviewSchemaHash,
    canarySchemaVariantHash: canarySchemaHash,
    challengeHash,
    challenge,
    response: canaryResponse,
    terminal: terminalCompleted,
    // Canary completes first; token issues at or after observation.
    observedAt: "2026-08-02T12:00:00.000Z",
    expiresAt: "2026-08-02T12:10:00.000Z",
  };

  const readyToken = {
    schemaVersion: 1 as const,
    providerFamily: "anthropic" as const,
    model: "claude-sonnet",
    cliVersion: "1.0.0",
    contractHash,
    promptHash: contentHash,
    schemaVariantHash: reviewSchemaHash,
    // Token nonce must match the canary challenge nonce.
    nonce: "nonce-canary",
    issuedAt: "2026-08-02T12:01:00.000Z",
    expiresAt: "2026-08-02T12:05:00.000Z",
  };

  it("decodes canonical compiled prompt, canary challenge/response/receipt", () => {
    expect(
      Schema.decodeUnknownSync(CanonicalCompiledPromptV1)(compiledPrompt),
    ).toEqual(compiledPrompt);
    expect(Schema.decodeUnknownSync(CanaryChallengeV1)(challenge)).toEqual(
      challenge,
    );
    expect(Schema.decodeUnknownSync(CanaryResponseV1)(canaryResponse)).toEqual(
      canaryResponse,
    );
    expect(Schema.decodeUnknownSync(CanaryReceiptV1)(canaryReceipt)).toEqual(
      canaryReceipt,
    );
  });

  it("rejects duplicate compiled prompt artifact ids", () => {
    expect(() =>
      Schema.decodeUnknownSync(CanonicalCompiledPromptV1)({
        ...compiledPrompt,
        artifactIds: [artifactId, artifactId],
      }),
    ).toThrow();
  });

  it("rejects a compiled prompt responseSchemaArtifactId absent from artifactIds", () => {
    expect(() =>
      Schema.decodeUnknownSync(CanonicalCompiledPromptV1)({
        ...compiledPrompt,
        responseSchemaArtifactId: `sha256:${"9".repeat(64)}`,
      }),
    ).toThrow();
  });

  it("rejects canary response nonce mismatch", () => {
    expect(() =>
      Schema.decodeUnknownSync(CanaryReceiptV1)({
        ...canaryReceipt,
        response: { ...canaryResponse, nonce: "other-nonce" },
      }),
    ).toThrow();
  });

  it("rejects canary check-result mismatch", () => {
    expect(() =>
      Schema.decodeUnknownSync(CanaryReceiptV1)({
        ...canaryReceipt,
        response: { ...canaryResponse, checkResult: "3" },
      }),
    ).toThrow();
  });

  it("rejects canary expiresAt not strictly later than observedAt", () => {
    expect(() =>
      Schema.decodeUnknownSync(CanaryReceiptV1)({
        ...canaryReceipt,
        expiresAt: canaryReceipt.observedAt,
      }),
    ).toThrow();
  });

  it("rejects canary with non-successful terminal and top-level spool digests", () => {
    expect(() =>
      Schema.decodeUnknownSync(CanaryReceiptV1)({
        ...canaryReceipt,
        terminal: {
          ...terminalCompleted,
          terminalState: "cancelled",
        },
      }),
    ).toThrow();
    expect(() =>
      decodeStrictSync(CanaryReceiptV1, {
        ...canaryReceipt,
        stdoutDigest: sha64,
        stderrDigest: sha64,
      }),
    ).toThrow();
  });

  it("decodes closed prompt-preflight ready and failure results", () => {
    const ready = {
      _tag: "ready" as const,
      schemaVersion: 1 as const,
      prompt: compiledPrompt,
      canary: canaryReceipt,
      token: readyToken,
    };
    const failure = {
      _tag: "failure" as const,
      schemaVersion: 1 as const,
      failure: {
        stage: "provider" as const,
        reason: "schema rejected",
        retry: "changed_preflight" as const,
      },
      terminal: null,
    };
    expect(Schema.decodeUnknownSync(PromptPreflightResultV1)(ready)._tag).toBe(
      "ready",
    );
    expect(
      Schema.decodeUnknownSync(PromptPreflightResultV1)(failure)._tag,
    ).toBe("failure");
  });

  it("rejects prompt-preflight ready when prompt/canary/token disagree", () => {
    const ready = {
      _tag: "ready" as const,
      schemaVersion: 1 as const,
      prompt: compiledPrompt,
      canary: canaryReceipt,
      token: readyToken,
    };
    expect(() =>
      Schema.decodeUnknownSync(PromptPreflightResultV1)({
        ...ready,
        token: { ...readyToken, model: "other-model" },
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(PromptPreflightResultV1)({
        ...ready,
        token: {
          ...readyToken,
          promptHash: `sha256:${"1".repeat(64)}`,
        },
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(PromptPreflightResultV1)({
        ...ready,
        token: {
          ...readyToken,
          contractHash: `sha256:${"2".repeat(64)}`,
        },
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(PromptPreflightResultV1)({
        ...ready,
        canary: {
          ...canaryReceipt,
          observedAt: "2026-08-02T12:06:00.000Z",
        },
      }),
    ).toThrow();
  });

  it("rejects ready when token nonce differs from canary challenge nonce", () => {
    const ready = {
      _tag: "ready" as const,
      schemaVersion: 1 as const,
      prompt: compiledPrompt,
      canary: canaryReceipt,
      token: {
        ...readyToken,
        nonce: "other-nonce",
        // issuedAt equals observedAt so only the nonce binding fails.
        issuedAt: "2026-08-02T12:00:00.000Z",
      },
    };
    expect(() => decodeStrictSync(PromptPreflightResultV1, ready)).toThrow();
  });

  it("rejects ready when canary contractClass differs from prompt profile", () => {
    const ready = {
      _tag: "ready" as const,
      schemaVersion: 1 as const,
      prompt: compiledPrompt,
      canary: { ...canaryReceipt, contractClass: "other-profile" },
      token: {
        ...readyToken,
        // issuedAt equals observedAt so only the contract-class binding fails.
        issuedAt: "2026-08-02T12:00:00.000Z",
      },
    };
    expect(() => decodeStrictSync(PromptPreflightResultV1, ready)).toThrow();
  });

  it("rejects ready when token is issued before canary observation", () => {
    const ready = {
      _tag: "ready" as const,
      schemaVersion: 1 as const,
      prompt: compiledPrompt,
      canary: canaryReceipt,
      token: {
        ...readyToken,
        issuedAt: "2026-08-02T11:59:00.000Z",
        expiresAt: "2026-08-02T12:05:00.000Z",
      },
    };
    expect(() => decodeStrictSync(PromptPreflightResultV1, ready)).toThrow();
  });

  it("rejects ready when token expires after canary expiry", () => {
    const ready = {
      _tag: "ready" as const,
      schemaVersion: 1 as const,
      prompt: compiledPrompt,
      canary: canaryReceipt,
      token: {
        ...readyToken,
        // issuedAt equals observedAt so only the canary-expiry bound fails.
        issuedAt: "2026-08-02T12:00:00.000Z",
        expiresAt: "2026-08-02T12:11:00.000Z",
      },
    };
    expect(() => decodeStrictSync(PromptPreflightResultV1, ready)).toThrow();
  });
});

describe("TerminalObservationV1", () => {
  it("decodes a provider-neutral terminal observation", () => {
    expect(
      Schema.decodeUnknownSync(TerminalObservationV1)(terminalCompleted),
    ).toEqual(terminalCompleted);
  });

  it("rejects an unknown terminal state", () => {
    expect(() =>
      Schema.decodeUnknownSync(TerminalObservationV1)({
        ...terminalCompleted,
        terminalState: "maybe_done",
      }),
    ).toThrow();
  });

  it("rejects a fractional pending tool count", () => {
    expect(() =>
      Schema.decodeUnknownSync(TerminalObservationV1)({
        ...terminalCompleted,
        pendingToolCalls: 0.5,
      }),
    ).toThrow();
  });

  it("decodes null tool counts when the provider did not expose tool state", () => {
    expect(
      Schema.decodeUnknownSync(TerminalObservationV1)(
        terminalWithUnknownToolCounts,
      ),
    ).toEqual(terminalWithUnknownToolCounts);
  });

  it("does not accept unknown tool counts as a successful terminal", () => {
    expect(() =>
      Schema.decodeUnknownSync(SuccessfulTerminalObservationV1)({
        ...terminalCompleted,
        pendingToolCalls: null,
        failedToolCalls: null,
      }),
    ).toThrow();
  });

  it("rejects null stdout or stderr digests", () => {
    expect(() =>
      Schema.decodeUnknownSync(TerminalObservationV1)({
        ...terminalCompleted,
        stdoutDigest: null,
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(TerminalObservationV1)({
        ...terminalCompleted,
        stderrDigest: null,
      }),
    ).toThrow();
  });
});

describe("FinalReviewResponseV1 disjoint branches", () => {
  it("decodes approved, changes-requested, and abstention responses", () => {
    expect(
      Schema.decodeUnknownSync(FinalApprovedResponseV1)(approvedResponse),
    ).toEqual(approvedResponse);
    expect(
      Schema.decodeUnknownSync(FinalChangesRequestedResponseV1)(
        changesResponse,
      ),
    ).toEqual(changesResponse);
    expect(
      Schema.decodeUnknownSync(FinalAbstentionResponseV1)(abstentionResponse),
    ).toEqual(abstentionResponse);
    expect(
      Schema.decodeUnknownSync(FinalReviewResponseV1)(approvedResponse).advice
        .kind,
    ).toBe("approved");
  });

  it("rejects approved responses that carry a changes branch", () => {
    expect(() =>
      decodeStrictSync(FinalApprovedResponseV1, {
        ...identityFields,
        advice: {
          kind: "approved",
          findings: changesResponse.advice.findings,
        },
      }),
    ).toThrow();
  });

  it("requires at least one material finding for changes_requested", () => {
    expect(() =>
      Schema.decodeUnknownSync(FinalChangesRequestedResponseV1)({
        ...identityFields,
        advice: {
          kind: "changes_requested",
          findings: [],
        },
      }),
    ).toThrow();
  });

  it("rejects an empty inspected-artifact list", () => {
    expect(() =>
      Schema.decodeUnknownSync(FinalReviewResponseV1)({
        ...approvedResponse,
        inspectedArtifactIds: [],
      }),
    ).toThrow();
  });

  it("requires readyTokenHash on every final response", () => {
    const withoutToken = {
      schemaVersion: approvedResponse.schemaVersion,
      contractHash: approvedResponse.contractHash,
      promptHash: approvedResponse.promptHash,
      bundle: approvedResponse.bundle,
      reviewerId: approvedResponse.reviewerId,
      candidateId: approvedResponse.candidateId,
      inspectedArtifactIds: approvedResponse.inspectedArtifactIds,
      advice: approvedResponse.advice,
    };
    expect(() =>
      Schema.decodeUnknownSync(FinalReviewResponseV1)(withoutToken),
    ).toThrow();
  });
});

describe("Completed classification without duplicated advice", () => {
  it("decodes CompletedVerdict with only approved or changes response", () => {
    const completedVerdict = {
      _tag: "CompletedVerdict" as const,
      response: changesResponse,
      terminal: terminalCompleted,
      quorumEligible: true as const,
      deliberationEligible: true as const,
    };
    expect(
      Schema.decodeUnknownSync(CompletedVerdictV1)(completedVerdict)._tag,
    ).toBe("CompletedVerdict");
  });

  it("decodes CompletedAbstention with only abstention response", () => {
    const completedAbstention = {
      _tag: "CompletedAbstention" as const,
      response: abstentionResponse,
      terminal: terminalCompleted,
      quorumEligible: false as const,
      deliberationEligible: true as const,
    };
    expect(
      Schema.decodeUnknownSync(CompletedAbstentionV1)(completedAbstention)
        .quorumEligible,
    ).toBe(false);
  });

  it("rejects contradictory CompletedVerdict with abstention response", () => {
    expect(() =>
      Schema.decodeUnknownSync(CompletedVerdictV1)({
        _tag: "CompletedVerdict",
        response: abstentionResponse,
        terminal: terminalCompleted,
        quorumEligible: true,
        deliberationEligible: true,
      }),
    ).toThrow();
  });

  it("rejects contradictory CompletedAbstention with approved response", () => {
    expect(() =>
      Schema.decodeUnknownSync(CompletedAbstentionV1)({
        _tag: "CompletedAbstention",
        response: approvedResponse,
        terminal: terminalCompleted,
        quorumEligible: false,
        deliberationEligible: true,
      }),
    ).toThrow();
  });

  it("rejects contradictory CompletedAbstention with changes_requested response", () => {
    expect(() =>
      Schema.decodeUnknownSync(CompletedAbstentionV1)({
        _tag: "CompletedAbstention",
        response: changesResponse,
        terminal: terminalCompleted,
        quorumEligible: false,
        deliberationEligible: true,
      }),
    ).toThrow();
  });

  it("rejects legacy duplicated top-level verdict and abstention fields", () => {
    expect(() =>
      decodeStrictSync(CompletedVerdictV1, {
        _tag: "CompletedVerdict",
        verdict: "approved",
        response: approvedResponse,
        terminal: terminalCompleted,
        quorumEligible: true,
        deliberationEligible: true,
      }),
    ).toThrow();
    expect(() =>
      decodeStrictSync(CompletedAbstentionV1, {
        _tag: "CompletedAbstention",
        abstention: abstentionResponse.advice.abstention,
        response: abstentionResponse,
        terminal: terminalCompleted,
        quorumEligible: false,
        deliberationEligible: true,
      }),
    ).toThrow();
  });

  it.each([
    [
      "cancelled",
      {
        ...terminalCompleted,
        terminalState: "cancelled" as const,
      },
    ],
    [
      "error",
      {
        ...terminalCompleted,
        terminalState: "error" as const,
        errorMessage: "provider error",
      },
    ],
    [
      "nonzero-exit",
      {
        ...terminalCompleted,
        exitCode: 1,
      },
    ],
    [
      "tool-active",
      {
        ...terminalCompleted,
        pendingToolCalls: 1,
      },
    ],
    [
      "parser-incomplete",
      {
        ...terminalCompleted,
        parserComplete: false,
      },
    ],
    [
      "structured-output-error",
      {
        ...terminalCompleted,
        structuredOutputError: "invalid json",
      },
    ],
  ])(
    "rejects CompletedVerdict and CompletedAbstention for %s terminal",
    (_label, terminal) => {
      expect(() =>
        Schema.decodeUnknownSync(CompletedVerdictV1)({
          _tag: "CompletedVerdict",
          response: approvedResponse,
          terminal,
          quorumEligible: true,
          deliberationEligible: true,
        }),
      ).toThrow();
      expect(() =>
        Schema.decodeUnknownSync(CompletedAbstentionV1)({
          _tag: "CompletedAbstention",
          response: abstentionResponse,
          terminal,
          quorumEligible: false,
          deliberationEligible: true,
        }),
      ).toThrow();
    },
  );

  it("rejects whitespace-only material finding operational text", () => {
    expect(() =>
      Schema.decodeUnknownSync(FinalChangesRequestedResponseV1)({
        ...identityFields,
        advice: {
          kind: "changes_requested",
          findings: [
            {
              artifactId,
              location: "   ",
              summary: "defect",
              nextAction: "fix",
            },
          ],
        },
      }),
    ).toThrow();
  });

  it("decodes the five closed classification tags", () => {
    const preflight = {
      _tag: "ProviderPreflightFailed" as const,
      failure: {
        stage: "provider" as const,
        reason: "schema rejected",
        retry: "changed_preflight" as const,
      },
      terminal: {
        ...terminalCompleted,
        modelTurnStarted: false,
        terminalState: "preflight_failed" as const,
        exitCode: 1,
        structuredOutputPresent: false,
      },
      quorumEligible: false as const,
      deliberationEligible: false as const,
    };
    const attemptFailed = {
      _tag: "ReviewAttemptFailed" as const,
      failure: {
        stage: "transport" as const,
        reason: "cancelled",
        retry: "same_contract" as const,
      },
      terminal: {
        ...terminalCompleted,
        terminalState: "cancelled" as const,
        structuredOutputPresent: false,
      },
      quorumEligible: false as const,
      deliberationEligible: false as const,
    };
    const completedVerdict = {
      _tag: "CompletedVerdict" as const,
      response: changesResponse,
      terminal: terminalCompleted,
      quorumEligible: true as const,
      deliberationEligible: true as const,
    };
    const completedAbstention = {
      _tag: "CompletedAbstention" as const,
      response: abstentionResponse,
      terminal: terminalCompleted,
      quorumEligible: false as const,
      deliberationEligible: true as const,
    };
    const completedInvalid = {
      _tag: "CompletedInvalidResponse" as const,
      reason: "schema_invalid" as const,
      terminal: terminalCompleted,
      quorumEligible: false as const,
      deliberationEligible: false as const,
    };

    expect(
      Schema.decodeUnknownSync(ReviewAttemptClassificationV1)(preflight)._tag,
    ).toBe("ProviderPreflightFailed");
    expect(
      Schema.decodeUnknownSync(ReviewAttemptClassificationV1)(attemptFailed)
        ._tag,
    ).toBe("ReviewAttemptFailed");
    expect(
      Schema.decodeUnknownSync(ReviewAttemptClassificationV1)(completedVerdict)
        ._tag,
    ).toBe("CompletedVerdict");
    expect(
      Schema.decodeUnknownSync(ReviewAttemptClassificationV1)(
        completedAbstention,
      )._tag,
    ).toBe("CompletedAbstention");
    expect(
      Schema.decodeUnknownSync(ReviewAttemptClassificationV1)(completedInvalid)
        ._tag,
    ).toBe("CompletedInvalidResponse");
  });

  it("decodes CompletedInvalidResponse with closed reasons and no response payload", () => {
    for (const reason of [
      "schema_invalid",
      "identity_mismatch",
      "findings_invalid",
      "abstention_invalid",
    ] as const) {
      const decoded = Schema.decodeUnknownSync(CompletedInvalidResponseV1)({
        _tag: "CompletedInvalidResponse",
        reason,
        terminal: terminalCompleted,
        quorumEligible: false,
        deliberationEligible: false,
      });
      expect(decoded.reason).toBe(reason);
      expect(decoded.quorumEligible).toBe(false);
      expect(decoded.deliberationEligible).toBe(false);
    }
    expect(Schema.decodeUnknownSync(InvalidReviewResponseReasonV1)(
      "schema_invalid",
    )).toBe("schema_invalid");
    expect(() =>
      Schema.decodeUnknownSync(InvalidReviewResponseReasonV1)("parse_error"),
    ).toThrow();
    expect(() =>
      decodeStrictSync(CompletedInvalidResponseV1, {
        _tag: "CompletedInvalidResponse",
        reason: "schema_invalid",
        terminal: terminalCompleted,
        quorumEligible: false,
        deliberationEligible: false,
        response: approvedResponse,
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(CompletedInvalidResponseV1)({
        _tag: "CompletedInvalidResponse",
        reason: "schema_invalid",
        terminal: {
          ...terminalCompleted,
          terminalState: "cancelled",
        },
        quorumEligible: false,
        deliberationEligible: false,
      }),
    ).toThrow();
  });
});

describe("review outcome type split", () => {
  it("limits review verdicts to approved and changes_requested", () => {
    expect(Schema.decodeUnknownSync(ReviewVerdict)("approved")).toBe(
      "approved",
    );
    expect(Schema.decodeUnknownSync(ReviewVerdict)("changes_requested")).toBe(
      "changes_requested",
    );
    expect(() =>
      Schema.decodeUnknownSync(ReviewVerdict)("insufficient_evidence"),
    ).toThrow();
  });

  it("keeps infrastructure failures off the closure outcome set", () => {
    expect(
      Schema.decodeUnknownSync(ReviewInfrastructureFailure)({
        stage: "parse",
        reason: "truncated",
        retry: "same_contract",
      }).stage,
    ).toBe("parse");
    for (const outcome of [
      "quorum_not_met",
      "judge_unstable",
      "policy_blocked",
      "budget_exhausted",
      "unsupported_claims",
      "outcome_unknown",
    ]) {
      expect(Schema.decodeUnknownSync(CouncilClosureOutcome)(outcome)).toBe(
        outcome,
      );
    }
    expect(() =>
      Schema.decodeUnknownSync(CouncilClosureOutcome)("insufficient_evidence"),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(CouncilClosureOutcome)("schema_invalid"),
    ).toThrow();
  });
});

describe("ReviewAttemptInputV1 uniqueness", () => {
  const baseInput = {
    preflightStageFailed: false,
    terminal: terminalCompleted,
    readyTokenCurrent: true,
    expectedReadyTokenHash: readyTokenHash,
    expectedContractHash: contractHash,
    expectedPromptHash: contentHash,
    expectedBundle: bundle,
    expectedReviewerId: "reviewer-a",
    expectedCandidateId: candidateId,
    expectedArtifactIds: [artifactId] as const,
    verifiedArtifactIds: [artifactId],
    bundleVerified: true,
    designatedStructuredValid: true,
    declaredEvidenceNamespace: ["acceptance-criteria", "diff-patch"],
    response: approvedResponse,
  };

  it("decodes unique expected, verified, and evidence namespace entries", () => {
    expect(
      Schema.decodeUnknownSync(ReviewAttemptInputV1)(baseInput)
        .expectedArtifactIds,
    ).toEqual([artifactId]);
  });

  it("rejects duplicate expected artifact ids", () => {
    expect(() =>
      Schema.decodeUnknownSync(ReviewAttemptInputV1)({
        ...baseInput,
        expectedArtifactIds: [artifactId, artifactId],
      }),
    ).toThrow();
  });

  it("rejects duplicate verified artifact ids", () => {
    expect(() =>
      Schema.decodeUnknownSync(ReviewAttemptInputV1)({
        ...baseInput,
        verifiedArtifactIds: [artifactId, artifactId],
      }),
    ).toThrow();
  });

  it("rejects duplicate declared evidence namespace entries", () => {
    expect(() =>
      Schema.decodeUnknownSync(ReviewAttemptInputV1)({
        ...baseInput,
        declaredEvidenceNamespace: ["diff-patch", "diff-patch"],
      }),
    ).toThrow();
  });
});

describe("finding 1: separate review and canary schema identities", () => {
  const reviewSchemaHash = `sha256:${"a1".repeat(32)}`;
  const canarySchemaHash = `sha256:${"b2".repeat(32)}`;
  const otherReviewSchemaHash = `sha256:${"c3".repeat(32)}`;

  const challenge = {
    schemaVersion: 1 as const,
    nonce: "nonce-canary",
    checkExpression: "1+1" as const,
    expectedCheckResult: "2" as const,
  };
  const challengeHash = hashCanaryChallenge(challenge);

  const compiledPrompt = {
    schemaVersion: 1 as const,
    profile: "council-ace-1" as const,
    contractHash,
    promptHash: contentHash,
    schemaVariantHash: reviewSchemaHash,
    canonicalAceText: "Every reviewer must verify the bundle-identity.",
    promptByteLength: 48,
    candidateId,
    bundle,
    artifactIds: [artifactId] as const,
    responseSchemaArtifactId: artifactId,
  };

  const canaryReceipt = {
    schemaVersion: 1 as const,
    providerFamily: "anthropic" as const,
    model: "claude-sonnet",
    cliVersion: "1.0.0",
    contractClass: "council-ace-1",
    promptHash: contentHash,
    schemaVariantHash: reviewSchemaHash,
    canarySchemaVariantHash: canarySchemaHash,
    challengeHash,
    challenge,
    response: {
      schemaVersion: 1 as const,
      nonce: "nonce-canary",
      checkResult: "2" as const,
      status: "ready" as const,
    },
    terminal: terminalCompleted,
    observedAt: "2026-08-02T12:00:00.000Z",
    expiresAt: "2026-08-02T12:10:00.000Z",
  };

  const readyToken = {
    schemaVersion: 1 as const,
    providerFamily: "anthropic" as const,
    model: "claude-sonnet",
    cliVersion: "1.0.0",
    contractHash,
    promptHash: contentHash,
    schemaVariantHash: reviewSchemaHash,
    nonce: "nonce-canary",
    issuedAt: "2026-08-02T12:01:00.000Z",
    expiresAt: "2026-08-02T12:05:00.000Z",
  };

  it("requires schemaVariantHash on CanonicalCompiledPromptV1", () => {
    const { schemaVariantHash: _removed, ...without } = compiledPrompt;
    void _removed;
    expect(() =>
      Schema.decodeUnknownSync(CanonicalCompiledPromptV1)(without),
    ).toThrow();
  });

  it("requires canarySchemaVariantHash on CanaryReceiptV1", () => {
    const { canarySchemaVariantHash: _removed, ...without } = canaryReceipt;
    void _removed;
    expect(() => Schema.decodeUnknownSync(CanaryReceiptV1)(without)).toThrow();
  });

  it("accepts a ready triple with distinct canary-schema hash", () => {
    expect(reviewSchemaHash).not.toBe(canarySchemaHash);
    const ready = {
      _tag: "ready" as const,
      schemaVersion: 1 as const,
      prompt: compiledPrompt,
      canary: canaryReceipt,
      token: readyToken,
    };
    expect(Schema.decodeUnknownSync(PromptPreflightResultV1)(ready)._tag).toBe(
      "ready",
    );
  });

  it("rejects ready when prompt and token review-schema hashes disagree", () => {
    const ready = {
      _tag: "ready" as const,
      schemaVersion: 1 as const,
      prompt: compiledPrompt,
      canary: canaryReceipt,
      token: { ...readyToken, schemaVariantHash: otherReviewSchemaHash },
    };
    expect(() =>
      Schema.decodeUnknownSync(PromptPreflightResultV1)(ready),
    ).toThrow();
  });

  it("rejects ready when prompt and canary review-schema hashes disagree", () => {
    const ready = {
      _tag: "ready" as const,
      schemaVersion: 1 as const,
      prompt: compiledPrompt,
      canary: {
        ...canaryReceipt,
        schemaVariantHash: otherReviewSchemaHash,
      },
      token: readyToken,
    };
    expect(() =>
      Schema.decodeUnknownSync(PromptPreflightResultV1)(ready),
    ).toThrow();
  });

  it("rejects ready when token and canary review-schema hashes disagree", () => {
    const ready = {
      _tag: "ready" as const,
      schemaVersion: 1 as const,
      prompt: {
        ...compiledPrompt,
        schemaVariantHash: otherReviewSchemaHash,
      },
      canary: canaryReceipt,
      token: { ...readyToken, schemaVariantHash: otherReviewSchemaHash },
    };
    // prompt === token, but both disagree with canary.schemaVariantHash
    expect(() =>
      Schema.decodeUnknownSync(PromptPreflightResultV1)(ready),
    ).toThrow();
  });
});

describe("finding 3: cancellation cannot become completion", () => {
  it("rejects SuccessfulTerminalObservationV1 when stopReason is Cancelled", () => {
    expect(() =>
      Schema.decodeUnknownSync(SuccessfulTerminalObservationV1)({
        ...terminalCompleted,
        stopReason: "Cancelled",
      }),
    ).toThrow();
  });

  it.each([
    "Cancelled",
    "cancelled",
    "cancellation",
    "timeout",
    "signal",
    "max_tokens",
    "length",
    "error",
    "arbitrary_success",
  ])(
    "rejects non-successful stop reason %p on successful terminal",
    (stopReason) => {
      expect(() =>
        Schema.decodeUnknownSync(SuccessfulTerminalObservationV1)({
          ...terminalCompleted,
          stopReason,
        }),
      ).toThrow();
    },
  );

  it.each(["end_turn", "stop", null])(
    "accepts closed successful stop reason %p",
    (stopReason) => {
      expect(
        Schema.decodeUnknownSync(SuccessfulTerminalObservationV1)({
          ...terminalCompleted,
          stopReason,
        }).stopReason,
      ).toBe(stopReason);
    },
  );
});

describe("finding 4: preflight-failure signals cannot contradict", () => {
  const baseInput = {
    preflightStageFailed: false,
    terminal: terminalCompleted,
    readyTokenCurrent: true,
    expectedReadyTokenHash: readyTokenHash,
    expectedContractHash: contractHash,
    expectedPromptHash: contentHash,
    expectedBundle: bundle,
    expectedReviewerId: "reviewer-a",
    expectedCandidateId: candidateId,
    expectedArtifactIds: [artifactId] as const,
    verifiedArtifactIds: [artifactId],
    bundleVerified: true,
    designatedStructuredValid: true,
    declaredEvidenceNamespace: ["acceptance-criteria", "diff-patch"],
    response: approvedResponse,
  };

  const failure = {
    stage: "provider" as const,
    reason: "schema rejected",
    retry: "changed_preflight" as const,
  };

  it("rejects preflightStageFailed false with populated preflightFailure", () => {
    expect(() =>
      Schema.decodeUnknownSync(ReviewAttemptInputV1)({
        ...baseInput,
        preflightStageFailed: false,
        preflightFailure: failure,
      }),
    ).toThrow();
  });

  it("rejects preflightStageFailed true without preflightFailure", () => {
    expect(() =>
      Schema.decodeUnknownSync(ReviewAttemptInputV1)({
        ...baseInput,
        preflightStageFailed: true,
      }),
    ).toThrow();
  });

  it("accepts true with failure and false without failure", () => {
    expect(
      Schema.decodeUnknownSync(ReviewAttemptInputV1)({
        ...baseInput,
        preflightStageFailed: true,
        preflightFailure: failure,
        designatedStructuredValid: false,
        response: undefined,
      }).preflightStageFailed,
    ).toBe(true);
    expect(
      Schema.decodeUnknownSync(ReviewAttemptInputV1)(baseInput)
        .preflightStageFailed,
    ).toBe(false);
  });
});

describe("finding 5: canary correctness cannot be self-certified", () => {
  // challengeHash must be recomputed from the challenge; fixed check is 1+1 → 2.
  const challenge = {
    schemaVersion: 1 as const,
    nonce: "nonce-canary",
    checkExpression: "1+1" as const,
    expectedCheckResult: "2" as const,
  };
  const validChallengeHash = hashCanaryChallenge(challenge);

  const baseReceipt = {
    schemaVersion: 1 as const,
    providerFamily: "anthropic" as const,
    model: "claude-sonnet",
    cliVersion: "1.0.0",
    contractClass: "council-ace-1",
    promptHash: contentHash,
    schemaVariantHash: contentHash,
    canarySchemaVariantHash: `sha256:${"ab".repeat(32)}`,
    challengeHash: validChallengeHash,
    challenge,
    response: {
      schemaVersion: 1 as const,
      nonce: "nonce-canary",
      checkResult: "2" as const,
      status: "ready" as const,
    },
    terminal: terminalCompleted,
    observedAt: "2026-08-02T12:00:00.000Z",
    expiresAt: "2026-08-02T12:10:00.000Z",
  };

  it("rejects a mutated challengeHash that does not match the challenge bytes", () => {
    expect(() =>
      Schema.decodeUnknownSync(CanaryReceiptV1)({
        ...baseReceipt,
        challengeHash: `sha256:${"99".repeat(32)}`,
      }),
    ).toThrow();
  });

  it("rejects a mutated challenge nonce even when the hash is left unchanged", () => {
    expect(() =>
      Schema.decodeUnknownSync(CanaryReceiptV1)({
        ...baseReceipt,
        // Keep the original challengeHash; only the nonce changes.
        challenge: { ...challenge, nonce: "mutated-nonce" },
        response: {
          schemaVersion: 1 as const,
          nonce: "mutated-nonce",
          checkResult: "2" as const,
          status: "ready" as const,
        },
      }),
    ).toThrow();
  });

  it("rejects expected and returned check result both set to 3", () => {
    expect(() =>
      Schema.decodeUnknownSync(CanaryReceiptV1)({
        ...baseReceipt,
        challenge: {
          ...challenge,
          expectedCheckResult: "3",
        },
        response: {
          schemaVersion: 1 as const,
          nonce: "nonce-canary",
          checkResult: "3",
          status: "ready" as const,
        },
      }),
    ).toThrow();
  });

  it("rejects a non-v1 canary expression", () => {
    expect(() =>
      Schema.decodeUnknownSync(CanaryChallengeV1)({
        ...challenge,
        checkExpression: "2+2",
        expectedCheckResult: "4",
      }),
    ).toThrow();
  });

  it("matches the known-vector canonical bytes and SHA-256 hash", () => {
    const known = {
      schemaVersion: 1 as const,
      nonce: "nonce-canary",
      checkExpression: "1+1" as const,
      expectedCheckResult: "2" as const,
    };
    const bytes = encodeCanaryChallengeCanonical(known);
    const expectedJson =
      '{"schemaVersion":1,"nonce":"nonce-canary","checkExpression":"1+1","expectedCheckResult":"2"}';
    expect(new TextDecoder().decode(bytes)).toBe(expectedJson);
    // Independent precomputed SHA-256 of the known JSON UTF-8 bytes.
    const knownHash =
      "sha256:0925154a006b8c1acaf5718484e7c0039179806437c4a141fcd8adba4a3978f8";
    expect(hashCanaryChallenge(known)).toBe(knownHash);
    expect(
      Schema.decodeUnknownSync(CanaryReceiptV1)({
        ...baseReceipt,
        challenge: known,
        challengeHash: knownHash,
      }).challengeHash,
    ).toBe(knownHash);
  });
});
