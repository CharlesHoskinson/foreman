import { describe, expect, it } from "vitest";
import { decodeStrictSync } from "../src/index.js";
import * as SchemaRoot from "../src/index.js";
import {
  InventedCompletionV1,
  SpecCorrectnessCoverageRatioV1,
  SpecCorrectnessEvaluationResultV1,
  SpecCorrectnessItemResultV1,
  SpecCorrectnessMetricsV1,
  SpecCorrectnessProviderResponseV1,
  portableEncodeUtf8,
  portableSha256Hex,
} from "@council/schema/spec-correctness";

const sha64 = (nibble: string): string => nibble.repeat(64);

const mappedItem = (itemId: string) => ({
  schemaVersion: 1 as const,
  itemId,
  disposition: "mapped" as const,
  sprint: "0",
  requirement: `requirement for ${itemId}`,
  acceptanceEvidence: `evidence for ${itemId}`,
  status: "open",
});

const evidencedDeferItem = (itemId: string) => ({
  schemaVersion: 1 as const,
  itemId,
  disposition: "evidenced_defer" as const,
  reason: "blocked on dependency",
  owner: "release-owner",
  targetRelease: "v0.3.1",
  blockingDependency: "dep-a",
  acceptanceEvidence: "defer-evidence",
});

const defectItem = (
  itemId: string,
  disposition: "omitted" | "contradiction" | "unevidenced_defer",
) => ({
  schemaVersion: 1 as const,
  itemId,
  disposition,
  assessment: `assessment for ${itemId}`,
});

const acceptResponse = (itemResults: readonly unknown[]) => ({
  schemaVersion: 1 as const,
  outcome: "accept" as const,
  itemResults,
  inventedCompletions: [] as const,
  findings: [] as const,
  summary: "all baseline items are covered",
});

const changesResponse = (itemResults: readonly unknown[]) => ({
  schemaVersion: 1 as const,
  outcome: "changes_requested" as const,
  itemResults,
  inventedCompletions: [] as const,
  findings: [
    {
      location: "coverage-matrix.md",
      summary: "one defect",
      nextAction: "repair the candidate",
    },
  ],
  summary: "defects remain",
});

const invention = {
  schemaVersion: 1 as const,
  artifactAlias: "candidate-spec",
  artifactSha256: sha64("a"),
  startByte: 0,
  endByte: 12,
  claimSha256: sha64("b"),
  recordSha256: sha64("c"),
  summary: "invented completion claim",
  correctiveAction: "remove the claim",
};

const cleanMetrics = {
  schemaVersion: 1 as const,
  baselineItemCount: 44 as const,
  mappedItemCount: 44,
  evidencedDeferCount: 0,
  omittedItemCount: 0,
  contradictionCount: 0,
  unevidencedDeferCount: 0,
  inventedCompletionCount: 0,
  coverageRatio: { numerator: 44, denominator: 44 as const },
};

const defectMetrics = {
  schemaVersion: 1 as const,
  baselineItemCount: 44 as const,
  mappedItemCount: 43,
  evidencedDeferCount: 0,
  omittedItemCount: 1,
  contradictionCount: 0,
  unevidencedDeferCount: 0,
  inventedCompletionCount: 0,
  coverageRatio: { numerator: 43, denominator: 44 as const },
};

describe("SpecCorrectnessV1 schemas", () => {
  it("decodes a mapped item result", () => {
    const decoded = decodeStrictSync(
      SpecCorrectnessItemResultV1,
      mappedItem("CW-001"),
    );
    expect(decoded.disposition).toBe("mapped");
    if (decoded.disposition === "mapped") {
      expect(decoded.sprint).toBe("0");
      expect(decoded.requirement).toContain("CW-001");
      expect(decoded.acceptanceEvidence).toContain("CW-001");
      expect(decoded.status).toBe("open");
    }
  });

  it("decodes an evidenced_defer item result", () => {
    const decoded = decodeStrictSync(
      SpecCorrectnessItemResultV1,
      evidencedDeferItem("CW-002"),
    );
    expect(decoded.disposition).toBe("evidenced_defer");
    if (decoded.disposition === "evidenced_defer") {
      expect(decoded.reason).toBe("blocked on dependency");
      expect(decoded.owner).toBe("release-owner");
      expect(decoded.targetRelease).toBe("v0.3.1");
      expect(decoded.blockingDependency).toBe("dep-a");
      expect(decoded.acceptanceEvidence).toBe("defer-evidence");
    }
  });

  it("decodes each defect disposition with assessment only", () => {
    for (const disposition of [
      "omitted",
      "contradiction",
      "unevidenced_defer",
    ] as const) {
      const decoded = decodeStrictSync(
        SpecCorrectnessItemResultV1,
        defectItem("CW-003", disposition),
      );
      expect(decoded.disposition).toBe(disposition);
      if (
        decoded.disposition === "omitted" ||
        decoded.disposition === "contradiction" ||
        decoded.disposition === "unevidenced_defer"
      ) {
        expect(decoded.assessment).toContain("CW-003");
      }
    }
  });

  it("rejects whitespace-only mapped fields", () => {
    for (const field of [
      "sprint",
      "requirement",
      "acceptanceEvidence",
      "status",
    ] as const) {
      expect(() =>
        decodeStrictSync(SpecCorrectnessItemResultV1, {
          ...mappedItem("CW-001"),
          [field]: "   ",
        }),
      ).toThrow();
    }
  });

  it("rejects whitespace-only evidenced_defer fields", () => {
    for (const field of [
      "reason",
      "owner",
      "targetRelease",
      "blockingDependency",
      "acceptanceEvidence",
    ] as const) {
      expect(() =>
        decodeStrictSync(SpecCorrectnessItemResultV1, {
          ...evidencedDeferItem("CW-001"),
          [field]: " \t ",
        }),
      ).toThrow();
    }
  });

  it("rejects defect items that carry mapped or defer fields", () => {
    expect(() =>
      decodeStrictSync(SpecCorrectnessItemResultV1, {
        ...defectItem("CW-001", "omitted"),
        sprint: "0",
      }),
    ).toThrow();
    expect(() =>
      decodeStrictSync(SpecCorrectnessItemResultV1, {
        ...defectItem("CW-001", "contradiction"),
        reason: "defer-shaped",
      }),
    ).toThrow();
  });

  it("decodes an invented completion record", () => {
    const decoded = decodeStrictSync(InventedCompletionV1, invention);
    expect(decoded.artifactAlias).toBe("candidate-spec");
    expect(decoded.startByte).toBe(0);
    expect(decoded.endByte).toBe(12);
    expect(decoded.summary).toBe("invented completion claim");
    expect(decoded.correctiveAction).toBe("remove the claim");
  });

  it("rejects non-positive exclusive end byte and negative start byte", () => {
    expect(() =>
      decodeStrictSync(InventedCompletionV1, { ...invention, endByte: 0 }),
    ).toThrow();
    expect(() =>
      decodeStrictSync(InventedCompletionV1, { ...invention, startByte: -1 }),
    ).toThrow();
  });

  it("rejects unsafe-integer invention ranges at the schema boundary", () => {
    expect(() =>
      decodeStrictSync(InventedCompletionV1, {
        ...invention,
        startByte: Number.MAX_SAFE_INTEGER + 1,
      }),
    ).toThrow();
    expect(() =>
      decodeStrictSync(InventedCompletionV1, {
        ...invention,
        endByte: Number.MAX_SAFE_INTEGER + 1,
      }),
    ).toThrow();
  });

  it("decodes accept and changes_requested provider responses", () => {
    const items = [mappedItem("CW-001"), mappedItem("CW-002")];
    expect(
      decodeStrictSync(SpecCorrectnessProviderResponseV1, acceptResponse(items))
        .outcome,
    ).toBe("accept");
    expect(
      decodeStrictSync(
        SpecCorrectnessProviderResponseV1,
        changesResponse([defectItem("CW-001", "contradiction")]),
      ).outcome,
    ).toBe("changes_requested");
  });

  it("decodes a named abstention and rejects an unexplained abstention", () => {
    const abstain = {
      schemaVersion: 1 as const,
      outcome: "abstain" as const,
      itemResults: [mappedItem("CW-001")],
      inventedCompletions: [] as const,
      findings: [] as const,
      summary: "cannot complete review",
      evidenceGaps: [
        {
          evidenceRef: "ledger-bytes",
          unmetCondition: "ledger artifact is missing",
        },
      ],
      nextAction: "attach the ledger and re-run",
    };
    const decoded = decodeStrictSync(
      SpecCorrectnessProviderResponseV1,
      abstain,
    );
    expect(decoded.outcome).toBe("abstain");
    if (decoded.outcome === "abstain") {
      expect(decoded.evidenceGaps).toHaveLength(1);
      expect(decoded.nextAction).toContain("attach");
    }

    expect(() =>
      decodeStrictSync(SpecCorrectnessProviderResponseV1, {
        schemaVersion: 1,
        outcome: "abstain",
        itemResults: [],
        inventedCompletions: [],
        findings: [],
        summary: "no reason",
      }),
    ).toThrow();
    expect(() =>
      decodeStrictSync(SpecCorrectnessProviderResponseV1, {
        ...abstain,
        evidenceGaps: [],
      }),
    ).toThrow();
  });

  it("rejects an extra response property under strict decoding", () => {
    expect(() =>
      decodeStrictSync(SpecCorrectnessProviderResponseV1, {
        ...acceptResponse([mappedItem("CW-001")]),
        mappedItemCount: 1,
      }),
    ).toThrow();
  });

  it("rejects an invalid outcome", () => {
    expect(() =>
      decodeStrictSync(SpecCorrectnessProviderResponseV1, {
        ...acceptResponse([mappedItem("CW-001")]),
        outcome: "approved",
      }),
    ).toThrow();
  });

  it("decodes a derived metrics record", () => {
    const metrics = decodeStrictSync(SpecCorrectnessMetricsV1, {
      schemaVersion: 1,
      baselineItemCount: 44,
      mappedItemCount: 43,
      evidencedDeferCount: 1,
      omittedItemCount: 0,
      contradictionCount: 0,
      unevidencedDeferCount: 0,
      inventedCompletionCount: 0,
      coverageRatio: { numerator: 44, denominator: 44 },
    });
    expect(metrics.mappedItemCount).toBe(43);
    expect(metrics.coverageRatio.numerator).toBe(44);
    expect(metrics.coverageRatio.denominator).toBe(44);
  });

  it("direct strict decode of SpecCorrectnessMetricsV1 rejects a disposition count sum that is not 44", () => {
    expect(() =>
      decodeStrictSync(SpecCorrectnessMetricsV1, {
        schemaVersion: 1,
        baselineItemCount: 44,
        mappedItemCount: 40,
        evidencedDeferCount: 0,
        omittedItemCount: 0,
        contradictionCount: 0,
        unevidencedDeferCount: 0,
        inventedCompletionCount: 0,
        coverageRatio: { numerator: 40, denominator: 44 },
      }),
    ).toThrow();
  });

  it("direct strict decode of SpecCorrectnessMetricsV1 rejects coverage numerator not equal to mapped plus evidenced-defer", () => {
    expect(() =>
      decodeStrictSync(SpecCorrectnessMetricsV1, {
        schemaVersion: 1,
        baselineItemCount: 44,
        mappedItemCount: 40,
        evidencedDeferCount: 2,
        omittedItemCount: 1,
        contradictionCount: 1,
        unevidencedDeferCount: 0,
        inventedCompletionCount: 0,
        // Sum of dispositions is 44, but numerator 44 ≠ mapped(40)+defer(2).
        coverageRatio: { numerator: 44, denominator: 44 },
      }),
    ).toThrow();
  });

  it("direct strict decode of SpecCorrectnessMetricsV1 accepts clean and defect-consistent fixtures", () => {
    const clean = decodeStrictSync(SpecCorrectnessMetricsV1, cleanMetrics);
    expect(clean.mappedItemCount).toBe(44);
    expect(clean.coverageRatio.numerator).toBe(44);

    const defect = decodeStrictSync(SpecCorrectnessMetricsV1, defectMetrics);
    expect(defect.omittedItemCount).toBe(1);
    expect(defect.coverageRatio.numerator).toBe(43);

    const mixed = decodeStrictSync(SpecCorrectnessMetricsV1, {
      schemaVersion: 1,
      baselineItemCount: 44,
      mappedItemCount: 40,
      evidencedDeferCount: 2,
      omittedItemCount: 1,
      contradictionCount: 1,
      unevidencedDeferCount: 0,
      inventedCompletionCount: 3,
      coverageRatio: { numerator: 42, denominator: 44 },
    });
    expect(mixed.inventedCompletionCount).toBe(3);
    expect(mixed.coverageRatio.numerator).toBe(42);
  });

  it("direct strict decode of SpecCorrectnessCoverageRatioV1 rejects numerators above 44", () => {
    for (const numerator of [45, 999, Number.MAX_SAFE_INTEGER]) {
      expect(() =>
        decodeStrictSync(SpecCorrectnessCoverageRatioV1, {
          numerator,
          denominator: 44,
        }),
      ).toThrow();
    }
  });

  it("direct strict decode of SpecCorrectnessCoverageRatioV1 accepts 0 and 44", () => {
    expect(
      decodeStrictSync(SpecCorrectnessCoverageRatioV1, {
        numerator: 0,
        denominator: 44,
      }),
    ).toEqual({ numerator: 0, denominator: 44 });
    expect(
      decodeStrictSync(SpecCorrectnessCoverageRatioV1, {
        numerator: 44,
        denominator: 44,
      }),
    ).toEqual({ numerator: 44, denominator: 44 });
  });

  it("strict result decoding rejects accept with omissions", () => {
    expect(() =>
      decodeStrictSync(SpecCorrectnessEvaluationResultV1, {
        schemaVersion: 1,
        _tag: "Valid",
        outcome: "accept",
        metrics: defectMetrics,
        findings: [],
      }),
    ).toThrow();
  });

  it("strict result decoding rejects count sum not 44", () => {
    expect(() =>
      decodeStrictSync(SpecCorrectnessEvaluationResultV1, {
        schemaVersion: 1,
        _tag: "Valid",
        outcome: "accept",
        metrics: {
          ...cleanMetrics,
          mappedItemCount: 40,
          coverageRatio: { numerator: 40, denominator: 44 },
        },
        findings: [],
      }),
    ).toThrow();
  });

  it("strict result decoding rejects wrong coverage numerator", () => {
    expect(() =>
      decodeStrictSync(SpecCorrectnessEvaluationResultV1, {
        schemaVersion: 1,
        _tag: "Valid",
        outcome: "changes_requested",
        metrics: {
          ...defectMetrics,
          coverageRatio: { numerator: 44, denominator: 44 },
        },
        findings: [
          {
            location: "x",
            summary: "y",
            nextAction: "z",
          },
        ],
      }),
    ).toThrow();
  });

  it("strict result decoding rejects changes with no defect", () => {
    expect(() =>
      decodeStrictSync(SpecCorrectnessEvaluationResultV1, {
        schemaVersion: 1,
        _tag: "Valid",
        outcome: "changes_requested",
        metrics: cleanMetrics,
        findings: [],
      }),
    ).toThrow();
  });

  it("strict result decoding rejects unexplained abstention", () => {
    expect(() =>
      decodeStrictSync(SpecCorrectnessEvaluationResultV1, {
        schemaVersion: 1,
        _tag: "Valid",
        outcome: "abstain",
        metrics: cleanMetrics,
      }),
    ).toThrow();
    expect(() =>
      decodeStrictSync(SpecCorrectnessEvaluationResultV1, {
        schemaVersion: 1,
        _tag: "Valid",
        outcome: "abstain",
        metrics: cleanMetrics,
        evidenceGaps: [],
        nextAction: "do something",
      }),
    ).toThrow();
  });

  it("strict result decoding rejects abstain with metric defects or inventions", () => {
    expect(() =>
      decodeStrictSync(SpecCorrectnessEvaluationResultV1, {
        schemaVersion: 1,
        _tag: "Valid",
        outcome: "abstain",
        metrics: defectMetrics,
        evidenceGaps: [
          {
            evidenceRef: "ledger",
            unmetCondition: "missing",
          },
        ],
        nextAction: "attach ledger",
      }),
    ).toThrow();
    expect(() =>
      decodeStrictSync(SpecCorrectnessEvaluationResultV1, {
        schemaVersion: 1,
        _tag: "Valid",
        outcome: "abstain",
        metrics: {
          ...cleanMetrics,
          inventedCompletionCount: 1,
        },
        evidenceGaps: [
          {
            evidenceRef: "ledger",
            unmetCondition: "missing",
          },
        ],
        nextAction: "attach ledger",
      }),
    ).toThrow();
  });

  it("strict result decoding accepts a clean named abstention", () => {
    const abstain = decodeStrictSync(SpecCorrectnessEvaluationResultV1, {
      schemaVersion: 1,
      _tag: "Valid",
      outcome: "abstain",
      metrics: cleanMetrics,
      evidenceGaps: [
        {
          evidenceRef: "ledger",
          unmetCondition: "missing",
        },
      ],
      nextAction: "attach ledger",
    });
    expect(abstain._tag).toBe("Valid");
    if (abstain._tag === "Valid") {
      expect(abstain.outcome).toBe("abstain");
    }
  });

  it("strict result decoding accepts a clean accept and a defect changes result", () => {
    const accept = decodeStrictSync(SpecCorrectnessEvaluationResultV1, {
      schemaVersion: 1,
      _tag: "Valid",
      outcome: "accept",
      metrics: cleanMetrics,
      findings: [],
    });
    expect(accept._tag).toBe("Valid");
    if (accept._tag === "Valid") {
      expect(accept.outcome).toBe("accept");
    }

    const changes = decodeStrictSync(SpecCorrectnessEvaluationResultV1, {
      schemaVersion: 1,
      _tag: "Valid",
      outcome: "changes_requested",
      metrics: defectMetrics,
      findings: [],
    });
    expect(changes._tag).toBe("Valid");
    if (changes._tag === "Valid") {
      expect(changes.outcome).toBe("changes_requested");
    }

    const findingsOnly = decodeStrictSync(SpecCorrectnessEvaluationResultV1, {
      schemaVersion: 1,
      _tag: "Valid",
      outcome: "changes_requested",
      metrics: cleanMetrics,
      findings: [
        {
          location: "candidate",
          summary: "actionable dissent",
          nextAction: "repair",
        },
      ],
    });
    expect(findingsOnly._tag).toBe("Valid");
    if (findingsOnly._tag === "Valid") {
      expect(findingsOnly.outcome).toBe("changes_requested");
    }
  });

  it("exports a portable SHA-256 helper that matches known digests", () => {
    const empty = portableSha256Hex(new Uint8Array());
    expect(empty).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    const abc = portableSha256Hex(portableEncodeUtf8("abc"));
    expect(abc).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("exposes SpecCorrectness schemas only on the schema subpath, not the root barrel", () => {
    expect(SpecCorrectnessProviderResponseV1).toBeDefined();
    expect(SpecCorrectnessItemResultV1).toBeDefined();
    expect(SpecCorrectnessMetricsV1).toBeDefined();
    expect(SpecCorrectnessEvaluationResultV1).toBeDefined();
    expect(InventedCompletionV1).toBeDefined();
    expect(
      Object.prototype.hasOwnProperty.call(
        SchemaRoot,
        "SpecCorrectnessProviderResponseV1",
      ),
    ).toBe(false);
    expect(
      Object.prototype.hasOwnProperty.call(SchemaRoot, "portableSha256Hex"),
    ).toBe(false);
    expect(
      Object.prototype.hasOwnProperty.call(SchemaRoot, "portableEncodeUtf8"),
    ).toBe(false);
  });
});
