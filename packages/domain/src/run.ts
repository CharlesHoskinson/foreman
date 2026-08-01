import type {
  ArtifactId,
  DomainCommand,
  DomainEvent,
  RunId,
  UtcTimestamp,
} from "@council/schema";
import type { Decision } from "./decision.js";

export type RunState =
  | { readonly _tag: "NotStarted" }
  | {
      readonly _tag: "Planned";
      readonly runId: RunId;
      readonly planArtifactId: ArtifactId;
      readonly at: UtcTimestamp;
    }
  | {
      readonly _tag: "Running";
      readonly runId: RunId;
      readonly at: UtcTimestamp;
    }
  | {
      readonly _tag: "Completed";
      readonly runId: RunId;
      readonly resultArtifactId: ArtifactId;
      readonly at: UtcTimestamp;
    }
  | {
      readonly _tag: "Failed";
      readonly runId: RunId;
      readonly code: string;
      readonly diagnosticArtifactId?: ArtifactId;
      readonly at: UtcTimestamp;
    }
  | {
      readonly _tag: "Cancelled";
      readonly runId: RunId;
      readonly reason: string;
      readonly at: UtcTimestamp;
    };

export type DomainRejection =
  | {
      readonly _tag: "CommandNotAllowed";
      readonly command: DomainCommand["_tag"];
      readonly state: RunState["_tag"];
    }
  | {
      readonly _tag: "RunIdMismatch";
      readonly expected: RunId;
      readonly actual: RunId;
    }
  | {
      readonly _tag: "TerminalStateIsAbsorbing";
      readonly state: "Completed" | "Failed" | "Cancelled";
    };

export const initialRunState: RunState = { _tag: "NotStarted" };

export const isTerminal = (
  state: RunState,
): state is Extract<RunState, { _tag: "Completed" | "Failed" | "Cancelled" }> =>
  state._tag === "Completed" ||
  state._tag === "Failed" ||
  state._tag === "Cancelled";

const accepted = (
  event: DomainEvent,
): Decision<DomainEvent, DomainRejection> => ({
  _tag: "Accepted",
  events: [event],
});

export const decide = (
  state: RunState,
  command: DomainCommand,
): Decision<DomainEvent, DomainRejection> => {
  if (isTerminal(state)) {
    return {
      _tag: "Rejected",
      error: { _tag: "TerminalStateIsAbsorbing", state: state._tag },
    };
  }

  if (state._tag !== "NotStarted" && state.runId !== command.runId) {
    return {
      _tag: "Rejected",
      error: {
        _tag: "RunIdMismatch",
        expected: state.runId,
        actual: command.runId,
      },
    };
  }

  switch (command._tag) {
    case "PlanRun":
      return state._tag === "NotStarted"
        ? accepted({
            schemaVersion: 1,
            _tag: "RunPlanned",
            runId: command.runId,
            planArtifactId: command.planArtifactId,
            at: command.at,
          })
        : {
            _tag: "Rejected",
            error: {
              _tag: "CommandNotAllowed",
              command: command._tag,
              state: state._tag,
            },
          };
    case "StartRun":
      return state._tag === "Planned"
        ? accepted({
            schemaVersion: 1,
            _tag: "RunStarted",
            runId: command.runId,
            at: command.at,
          })
        : {
            _tag: "Rejected",
            error: {
              _tag: "CommandNotAllowed",
              command: command._tag,
              state: state._tag,
            },
          };
    case "CompleteRun":
      return state._tag === "Running"
        ? accepted({
            schemaVersion: 1,
            _tag: "RunCompleted",
            runId: command.runId,
            resultArtifactId: command.resultArtifactId,
            at: command.at,
          })
        : {
            _tag: "Rejected",
            error: {
              _tag: "CommandNotAllowed",
              command: command._tag,
              state: state._tag,
            },
          };
    case "FailRun":
      return state._tag === "Running"
        ? accepted({
            schemaVersion: 1,
            _tag: "RunFailed",
            runId: command.runId,
            code: command.code,
            ...(command.diagnosticArtifactId === undefined
              ? {}
              : { diagnosticArtifactId: command.diagnosticArtifactId }),
            at: command.at,
          })
        : {
            _tag: "Rejected",
            error: {
              _tag: "CommandNotAllowed",
              command: command._tag,
              state: state._tag,
            },
          };
    case "CancelRun":
      return state._tag === "Planned" || state._tag === "Running"
        ? accepted({
            schemaVersion: 1,
            _tag: "RunCancelled",
            runId: command.runId,
            reason: command.reason,
            at: command.at,
          })
        : {
            _tag: "Rejected",
            error: {
              _tag: "CommandNotAllowed",
              command: command._tag,
              state: state._tag,
            },
          };
  }
};

export const evolve = (state: RunState, event: DomainEvent): RunState => {
  if (isTerminal(state)) {
    return state;
  }

  switch (event._tag) {
    case "RunPlanned":
      return {
        _tag: "Planned",
        runId: event.runId,
        planArtifactId: event.planArtifactId,
        at: event.at,
      };
    case "RunStarted":
      return { _tag: "Running", runId: event.runId, at: event.at };
    case "RunCompleted":
      return {
        _tag: "Completed",
        runId: event.runId,
        resultArtifactId: event.resultArtifactId,
        at: event.at,
      };
    case "RunFailed":
      return {
        _tag: "Failed",
        runId: event.runId,
        code: event.code,
        ...(event.diagnosticArtifactId === undefined
          ? {}
          : { diagnosticArtifactId: event.diagnosticArtifactId }),
        at: event.at,
      };
    case "RunCancelled":
      return {
        _tag: "Cancelled",
        runId: event.runId,
        reason: event.reason,
        at: event.at,
      };
  }
};

export const replay = (events: ReadonlyArray<DomainEvent>): RunState =>
  events.reduce(evolve, initialRunState);
