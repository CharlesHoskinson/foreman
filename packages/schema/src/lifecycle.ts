import * as Schema from "effect/Schema";
import {
  ActorId,
  ArtifactId,
  CausationId,
  ContentHash,
  CorrelationId,
  EventId,
  RunId,
  UtcTimestamp,
} from "./identifiers.js";
import { AuthorityClass } from "./authority.js";

const VersionOne = Schema.Literal(1);
const NonNegativeInteger = Schema.Number.pipe(
  Schema.int(),
  Schema.nonNegative(),
);
const Extensions = Schema.Record({
  key: Schema.String,
  value: Schema.Unknown,
});

const baseCommand = {
  schemaVersion: VersionOne,
  runId: RunId,
  at: UtcTimestamp,
} as const;

export const DomainCommand = Schema.Union(
  Schema.Struct({
    ...baseCommand,
    _tag: Schema.Literal("PlanRun"),
    planArtifactId: ArtifactId,
  }),
  Schema.Struct({
    ...baseCommand,
    _tag: Schema.Literal("StartRun"),
  }),
  Schema.Struct({
    ...baseCommand,
    _tag: Schema.Literal("CompleteRun"),
    resultArtifactId: ArtifactId,
  }),
  Schema.Struct({
    ...baseCommand,
    _tag: Schema.Literal("FailRun"),
    code: Schema.String,
    diagnosticArtifactId: Schema.optional(ArtifactId),
  }),
  Schema.Struct({
    ...baseCommand,
    _tag: Schema.Literal("CancelRun"),
    reason: Schema.String,
  }),
);
export type DomainCommand = typeof DomainCommand.Type;

export const DomainEvent = Schema.Union(
  Schema.Struct({
    schemaVersion: VersionOne,
    _tag: Schema.Literal("RunPlanned"),
    runId: RunId,
    planArtifactId: ArtifactId,
    at: UtcTimestamp,
  }),
  Schema.Struct({
    schemaVersion: VersionOne,
    _tag: Schema.Literal("RunStarted"),
    runId: RunId,
    at: UtcTimestamp,
  }),
  Schema.Struct({
    schemaVersion: VersionOne,
    _tag: Schema.Literal("RunCompleted"),
    runId: RunId,
    resultArtifactId: ArtifactId,
    at: UtcTimestamp,
  }),
  Schema.Struct({
    schemaVersion: VersionOne,
    _tag: Schema.Literal("RunFailed"),
    runId: RunId,
    code: Schema.String,
    diagnosticArtifactId: Schema.optional(ArtifactId),
    at: UtcTimestamp,
  }),
  Schema.Struct({
    schemaVersion: VersionOne,
    _tag: Schema.Literal("RunCancelled"),
    runId: RunId,
    reason: Schema.String,
    at: UtcTimestamp,
  }),
);
export type DomainEvent = typeof DomainEvent.Type;

export const RunTerminalStatus = Schema.Literal(
  "completed",
  "failed",
  "cancelled",
);
export type RunTerminalStatus = typeof RunTerminalStatus.Type;

export const DomainEventEnvelope = Schema.Struct({
  schemaVersion: VersionOne,
  projectionVersion: NonNegativeInteger,
  eventId: EventId,
  runId: RunId,
  runSequence: NonNegativeInteger,
  recordedAt: UtcTimestamp,
  correlationId: CorrelationId,
  causationId: CausationId,
  actor: ActorId,
  authority: AuthorityClass,
  previousEventHash: Schema.NullOr(ContentHash),
  eventHash: ContentHash,
  payload: DomainEvent,
  extensions: Schema.optional(Extensions),
});
export type DomainEventEnvelope = typeof DomainEventEnvelope.Type;
