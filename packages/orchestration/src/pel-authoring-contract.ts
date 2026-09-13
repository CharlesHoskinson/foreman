import type { Effect } from "effect";
import type {
  AuthoringDiagnostic,
  AuthoringSnapshotV1,
  AuthoringProviderControlsV1,
} from "@foreman/pel";
import type {
  GeneratedPlanV1,
  PelGenerationFailure,
} from "./pel-generation.js";
export const AUTHORING_EXIT = {
  success: 0,
  failed: 1,
  invalid: 2,
  needsAction: 3,
  cancelled: 4,
  pending: 5,
} as const;
export interface AuthoringFailure {
  readonly _tag: "AuthoringFailure";
  readonly code: string;
  readonly message: string;
  readonly exitCode: 1 | 2 | 4;
  readonly input?: string;
  readonly diagnostics?: readonly AuthoringDiagnostic[];
}
export interface CliResult {
  readonly exitCode: 0 | 1 | 2 | 3 | 4 | 5;
}
export interface AuthoringInputPort {
  read(
    path: string,
    maxBytes: number,
  ): Effect.Effect<Uint8Array, AuthoringFailure>;
}
export interface AuthoringOutputPort {
  stdout(text: string): Effect.Effect<void, AuthoringFailure>;
  stderr(text: string): Effect.Effect<void, AuthoringFailure>;
}
export interface AuthoringContextPort {
  readonly defaultSnapshotPath: string;
}
export interface AuthoringGenerateInput {
  readonly prompt: string;
  readonly snapshot: AuthoringSnapshotV1;
  readonly modelProfileId: string;
  readonly transportId: string;
  readonly controls: AuthoringProviderControlsV1;
  readonly credentialProfileRef: string;
  readonly grammarMode: "auto" | "grammar-required" | "envelope";
}
export interface AuthoringTerminalPort {
  readLine(prompt: string): Effect.Effect<string | null, AuthoringFailure>;
  setCompleter?(complete: (prefix: string) => readonly string[]): void;
}
export interface AuthoringServices {
  readonly lifecycle?: import('./pel-lifecycle-cli.js').PelLifecycleCliServices;
  readonly providers?: import('./pel-provider-cli.js').ProviderCliServices;
  readonly input: AuthoringInputPort;
  readonly output: AuthoringOutputPort;
  readonly context: AuthoringContextPort;
  readonly generate?: (
    input: AuthoringGenerateInput,
  ) => Effect.Effect<GeneratedPlanV1, PelGenerationFailure>;
  readonly terminal?: AuthoringTerminalPort;
}
export interface ForemanCli {
  run(argv: readonly string[]): Effect.Effect<CliResult, AuthoringFailure>;
}
export function authoringFailure(
  code: string,
  message: string,
  exitCode: 1 | 2 | 4 = 2,
  input?: string,
): AuthoringFailure {
  return {
    _tag: "AuthoringFailure",
    code,
    message,
    exitCode,
    ...(input === undefined ? {} : { input }),
  };
}
