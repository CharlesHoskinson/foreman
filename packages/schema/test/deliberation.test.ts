import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import { CalibrationRecord, ProposalEligibility } from "../src/index.js";

const artifactId =
  "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("deliberation schemas", () => {
  it("requires schema version 1 on a proposal eligibility boundary", () => {
    const proposal = {
      schemaVersion: 1,
      candidateId: "cand_01ARZ3NDEKTSV4RRFFQ69G5FAV",
      admissible: true,
      failureDomain: "model-family",
      sealedAt: "2026-08-01T12:00:00.000Z",
    };
    expect(
      Schema.decodeUnknownSync(ProposalEligibility)(proposal).schemaVersion,
    ).toBe(1);
    expect(() =>
      Schema.decodeUnknownSync(ProposalEligibility)({
        ...proposal,
        schemaVersion: undefined,
      }),
    ).toThrow();
  });

  it("validates calibration time and artifact identity", () => {
    const valid = {
      schemaVersion: 1,
      modelTaskKey: "model-a:research",
      validUntilEpochMs: 0,
      calibrationArtifactId: artifactId,
    };
    expect(
      Schema.decodeUnknownSync(CalibrationRecord)(valid).calibrationArtifactId,
    ).toBe(artifactId);

    for (const validUntilEpochMs of [
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      expect(() =>
        Schema.decodeUnknownSync(CalibrationRecord)({
          ...valid,
          validUntilEpochMs,
        }),
      ).toThrow();
    }
    expect(() =>
      Schema.decodeUnknownSync(CalibrationRecord)({
        ...valid,
        calibrationArtifactId: "calibration-a",
      }),
    ).toThrow();
  });
});
