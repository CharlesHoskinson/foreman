import { describe, expect, it } from "vitest";
import {
  decodeStrictSync,
  DomainCommand,
  DomainEventEnvelope,
} from "../src/index.js";

const runId = "run_01ARZ3NDEKTSV4RRFFQ69G5FAV";
const planId =
  "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const eventId = "evt_01ARZ3NDEKTSV4RRFFQ69G5FAV";
const correlationId = "cor_01ARZ3NDEKTSV4RRFFQ69G5FAV";
const causationId = "cau_01ARZ3NDEKTSV4RRFFQ69G5FAV";
const actorId = "act_01ARZ3NDEKTSV4RRFFQ69G5FAV";

const validEnvelope = {
  schemaVersion: 1,
  projectionVersion: 0,
  eventId,
  runId,
  runSequence: 0,
  recordedAt: "2026-08-01T12:00:00.000Z",
  correlationId,
  causationId,
  actor: actorId,
  authority: "trusted_instruction",
  previousEventHash: null,
  eventHash: planId,
  payload: {
    schemaVersion: 1,
    _tag: "RunStarted",
    runId,
    at: "2026-08-01T12:00:00.000Z",
  },
};

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
    const { schemaVersion: _schemaVersion, ...envelopeWithoutVersion } =
      validEnvelope;
    void _schemaVersion;

    expect(() =>
      decodeStrictSync(DomainEventEnvelope, envelopeWithoutVersion),
    ).toThrow(/schemaVersion/);
  });

  it("rejects an unversioned extensions record", () => {
    expect(() =>
      decodeStrictSync(DomainEventEnvelope, {
        ...validEnvelope,
        extensions: {
          "example.extension": {
            enabled: true,
          },
        },
      }),
    ).toThrow();
  });
});
