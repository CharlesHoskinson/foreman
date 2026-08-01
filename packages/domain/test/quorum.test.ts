import type { FailureDomainId } from "@council/schema";
import { describe, expect, it } from "vitest";
import {
  confidenceWeightEligible,
  evaluateAutomaticQuorum,
} from "../src/index.js";

describe("automatic quorum", () => {
  it("rejects three aliases from one failure domain", () => {
    expect(
      evaluateAutomaticQuorum([
        { admissible: true, failureDomain: "family-a" as FailureDomainId },
        { admissible: true, failureDomain: "family-a" as FailureDomainId },
        { admissible: true, failureDomain: "family-a" as FailureDomainId },
      ]),
    ).toEqual({
      _tag: "QuorumNotMet",
      admissibleProposals: 3,
      independentDomains: 1,
    });
  });

  it("accepts three proposals from two domains", () => {
    expect(
      evaluateAutomaticQuorum([
        { admissible: true, failureDomain: "family-a" as FailureDomainId },
        { admissible: true, failureDomain: "family-a" as FailureDomainId },
        { admissible: true, failureDomain: "family-b" as FailureDomainId },
      ]),
    ).toEqual({
      _tag: "QuorumMet",
      admissibleProposals: 3,
      independentDomains: 2,
    });
  });

  it("groups every unknown lineage into one common domain", () => {
    expect(
      evaluateAutomaticQuorum([
        { admissible: true, failureDomain: null },
        { admissible: true, failureDomain: null },
        { admissible: true, failureDomain: null },
      ]),
    ).toMatchObject({ independentDomains: 1 });
  });

  it("excludes inadmissible proposals from quorum counts", () => {
    expect(
      evaluateAutomaticQuorum([
        { admissible: true, failureDomain: "family-a" as FailureDomainId },
        { admissible: true, failureDomain: "family-b" as FailureDomainId },
        { admissible: false, failureDomain: "family-c" as FailureDomainId },
      ]),
    ).toEqual({
      _tag: "QuorumNotMet",
      admissibleProposals: 2,
      independentDomains: 2,
    });
  });

  it("honors explicit proposal and domain thresholds", () => {
    expect(
      evaluateAutomaticQuorum(
        [
          { admissible: true, failureDomain: "family-a" as FailureDomainId },
          { admissible: true, failureDomain: "family-b" as FailureDomainId },
        ],
        2,
        2,
      ),
    ).toEqual({
      _tag: "QuorumMet",
      admissibleProposals: 2,
      independentDomains: 2,
    });
  });
});

describe("confidence weighting", () => {
  const calibration = {
    schemaVersion: 1 as const,
    modelTaskKey: "model-a:research",
    validUntilEpochMs: 2_000,
    calibrationArtifactId: "calibration-a",
  };

  it("requires an applicable unexpired calibration record", () => {
    expect(
      confidenceWeightEligible(calibration, "model-a:research", 1_000),
    ).toBe(true);
    expect(confidenceWeightEligible(null, "model-a:research", 1_000)).toBe(
      false,
    );
  });

  it("rejects a calibration for a different model-task key", () => {
    expect(
      confidenceWeightEligible(calibration, "model-b:research", 1_000),
    ).toBe(false);
  });

  it("rejects an expired calibration and accepts its exact expiry", () => {
    expect(
      confidenceWeightEligible(calibration, "model-a:research", 2_001),
    ).toBe(false);
    expect(
      confidenceWeightEligible(calibration, "model-a:research", 2_000),
    ).toBe(true);
  });
});
