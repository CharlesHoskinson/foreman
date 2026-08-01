import type {
  ArtifactId,
  DomainEvent,
  RunId,
  UtcTimestamp,
} from "@council/schema";
import { describe, expect, it } from "vitest";
import {
  decide,
  evolve,
  initialRunState,
  isTerminal,
  replay,
} from "../src/index.js";

const runId = "run_01ARZ3NDEKTSV4RRFFQ69G5FAV" as RunId;
const planId =
  "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as ArtifactId;
const resultId =
  "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as ArtifactId;
const at = "2026-08-01T12:00:00.000Z" as UtcTimestamp;

describe("run reducer", () => {
  it("decides, evolves, and replays a successful run", () => {
    const planned = decide(initialRunState, {
      schemaVersion: 1,
      _tag: "PlanRun",
      runId,
      planArtifactId: planId,
      at,
    });
    expect(planned._tag).toBe("Accepted");
    if (planned._tag === "Rejected") return;

    const plannedState = evolve(initialRunState, planned.events[0]);
    const started = decide(plannedState, {
      schemaVersion: 1,
      _tag: "StartRun",
      runId,
      at,
    });
    expect(started._tag).toBe("Accepted");
    if (started._tag === "Rejected") return;

    const runningState = evolve(plannedState, started.events[0]);
    const completed = decide(runningState, {
      schemaVersion: 1,
      _tag: "CompleteRun",
      runId,
      resultArtifactId: resultId,
      at,
    });
    expect(completed._tag).toBe("Accepted");
    if (completed._tag === "Rejected") return;

    const events = [...planned.events, ...started.events, ...completed.events];
    expect(replay(events)).toEqual(events.reduce(evolve, initialRunState));
    expect(isTerminal(replay(events))).toBe(true);
  });

  it("rejects every state-changing command after cancellation", () => {
    const cancelled = {
      _tag: "Cancelled",
      runId,
      reason: "user request",
      at,
    } as const;

    const decision = decide(cancelled, {
      schemaVersion: 1,
      _tag: "StartRun",
      runId,
      at,
    });

    expect(decision).toEqual({
      _tag: "Rejected",
      error: { _tag: "TerminalStateIsAbsorbing", state: "Cancelled" },
    });
  });

  it("keeps the first terminal state when later events are evolved or replayed", () => {
    const events = [
      {
        schemaVersion: 1,
        _tag: "RunPlanned",
        runId,
        planArtifactId: planId,
        at,
      },
      { schemaVersion: 1, _tag: "RunStarted", runId, at },
      {
        schemaVersion: 1,
        _tag: "RunCompleted",
        runId,
        resultArtifactId: resultId,
        at,
      },
      { schemaVersion: 1, _tag: "RunFailed", runId, code: "late", at },
    ] as const satisfies readonly DomainEvent[];
    const completed = replay(events.slice(0, 3));

    expect(evolve(completed, events[3])).toBe(completed);
    expect(replay(events)).toEqual(completed);
  });
});
