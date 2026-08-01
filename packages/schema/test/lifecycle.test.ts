import { describe, expect, it } from "vitest";
import {
  decodeStrictSync,
  DomainCommand,
  DomainEventEnvelope,
} from "../src/index.js";

const runId = "run_01ARZ3NDEKTSV4RRFFQ69G5FAV";
const planId =
  "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("lifecycle contracts", () => {
  it("decodes a versioned PlanRun command", () => {
    const value = decodeStrictSync(DomainCommand, {
      schemaVersion: 1,
      _tag: "PlanRun",
      runId,
      planArtifactId: planId,
      at: "2026-08-01T12:00:00.000Z",
    });
    expect(value._tag).toBe("PlanRun");
  });

  it("rejects unknown core properties", () => {
    expect(() =>
      decodeStrictSync(DomainCommand, {
        schemaVersion: 1,
        _tag: "StartRun",
        runId,
        at: "2026-08-01T12:00:01.000Z",
        injected: true,
      }),
    ).toThrow();
  });

  it("requires an explicit envelope schema version", () => {
    expect(() =>
      decodeStrictSync(DomainEventEnvelope, {
        eventId: "evt_01ARZ3NDEKTSV4RRFFQ69G5FAV",
      }),
    ).toThrow();
  });
});
