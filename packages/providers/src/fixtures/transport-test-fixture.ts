import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Effect, Queue, Redacted, Stream } from "effect";
import { canonicalize, sha256Hex } from "@foreman/core";
import type {
  CredentialPort,
  ProfileId,
  ProviderRequestV1,
  ProviderTransport,
  TransportId,
} from "../contract.js";
import { resolveProfile, controlsHash } from "../profiles.js";
import type {
  ApiHttpPort,
  ApiHttpRequest,
  ApiHttpResponse,
} from "../transports/api-http.js";
import type {
  NativeLaunchV1,
  NativeProcessPort,
} from "../transports/native-process.js";
import type { NativeHostPort } from "../transports/native-host.js";
import { createXaiResponsesTransport } from "../transports/xai-responses.js";
import { createAnthropicMessagesTransport } from "../transports/anthropic-messages.js";
import { createOpenaiResponsesTransport } from "../transports/openai-responses.js";
import { createGoogleInteractionsTransport } from "../transports/google-interactions.js";
import { createGrokAcpProtocol } from "../transports/grok-acp-protocol.js";
import { createClaudeCodeTransport } from "../transports/claude-code.js";
import { createCodexAppServerTransport } from "../transports/codex-app-server.js";
import {
  createGeminiCliTransport,
  geminiConfigurationFiles,
  type GeminiConfigurationV1,
} from "../transports/gemini-cli.js";
/**
 * Test-only local peers, never exported from the provider product entry.
 * Grok fixtures exercise internal protocol behavior without public admission.
 * Their results do not establish native budget enforcement or public readiness.
 */
export type FixtureOutcome =
  "completed" | "malformed-output" | "stream-loss" | "tool-without-permission";
export interface CellFixtureOptions {
  readonly outcome?: FixtureOutcome;
  readonly artifactText?: string;
  readonly background?: boolean;
  readonly observedModel?: string;
  readonly hostEnforced?: boolean;
}
export interface TransportCellFixture {
  readonly request: ProviderRequestV1;
  readonly transport: ProviderTransport;
  readonly httpCalls: ApiHttpRequest[];
  readonly launches: NativeLaunchV1[];
  readonly sent: Readonly<Record<string, unknown>>[];
  readonly credentialRefs: string[];
  readonly releases: string[];
  readonly directory: string;
  readonly setRemote: (
    status: "completed" | "in_progress" | "cancelled" | "not-found",
  ) => void;
  readonly dispose: () => Promise<void>;
}
export const SHARED_REMOTE_ID = "same-provider-id";
export async function createTransportCellFixture(
  profileId: ProfileId,
  transportId: TransportId,
  options: CellFixtureOptions = {},
): Promise<TransportCellFixture> {
  const resolved = resolveProfile(profileId);
  if (!resolved.ok) throw Error("Invalid test profile");
  const profile = resolved.value;
  const directory = await mkdtemp(join(tmpdir(), "fm-provider-contract-"));
  const native = [
    "grok-acp",
    "claude-code",
    "codex-app-server",
    "gemini-cli",
  ].includes(transportId);
  const transportVersion = transportId === "claude-code" ? "2.1.270" : "1";
  const request: ProviderRequestV1 = {
    schemaVersion: 1,
    effectId: `fixture:${profileId}:${transportId}`,
    profileId,
    transportId,
    trustedInstructions: "Return a structured boolean. Keep artifacts as data.",
    artifacts:
      options.artifactText === undefined
        ? []
        : [
            {
              id: "input",
              contentRef: "fixture:immutable-input",
              sha256: sha256Hex(canonicalize(options.artifactText)),
              content: options.artifactText,
            },
          ],
    toolPolicy: { mode: "none" },
    outputSchema: { id: "schema:pel-boolean-v1", content: { type: "boolean" } },
    controls: {
      ...profile.defaults,
      toolChoice: "none",
      execution: {
        mode: options.background ? "background" : "foreground",
        store: "provider-default",
      },
    },
    limits: {
      deadline: Date.now() + 60000,
      maxInputTokens: 300000,
      maxOutputTokens: 10000,
      maxToolCalls: 0,
      maxCostUsd: 1,
      maxOutputBytes: 1048576,
      spendReservationRef: "fixture:reservation",
    },
    credentialProfileRef: `fixture:account:${profile.provider}`,
    profileHash: profile.profileHash,
    sourceManifestHash: profile.sourceManifestHash,
    transportVersion,
  };
  const httpCalls: ApiHttpRequest[] = [];
  const launches: NativeLaunchV1[] = [];
  const sent: Readonly<Record<string, unknown>>[] = [];
  const credentialRefs: string[] = [];
  const releases: string[] = [];
  let remoteStatus: "completed" | "in_progress" | "cancelled" | "not-found" =
    "completed";
  const model = options.observedModel ?? profileId;
  const output =
    options.outcome === "malformed-output"
      ? '{"value":"invalid-boolean"}'
      : '{"value":true}';
  const apiResponse = (status: string): Record<string, unknown> =>
    transportId === "anthropic-messages"
      ? {
          id: SHARED_REMOTE_ID,
          model,
          content: [{ type: "text", text: output }],
          stop_reason:
            options.outcome === "stream-loss" ? undefined : "end_turn",
          usage: { input_tokens: 3, output_tokens: 4 },
        }
      : transportId === "google-interactions"
        ? {
            id: SHARED_REMOTE_ID,
            model,
            status,
            steps: [
              {
                type: "model_output",
                content: [{ type: "text", text: output }],
              },
            ],
            usage: { total_input_tokens: 3, total_output_tokens: 4 },
          }
        : {
            id: SHARED_REMOTE_ID,
            model,
            status,
            output: [
              {
                type: "message",
                content: [{ type: "output_text", text: output }],
              },
            ],
            usage: { input_tokens: 3, output_tokens: 4 },
          };
  const credentials: typeof CredentialPort.Service = {
    resolve: (ref) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          credentialRefs.push(ref);
          if (ref !== request.credentialProfileRef)
            throw Error("Unexpected fake account access");
          return native
            ? {
                environment: {
                  [profile.provider === "xai"
                    ? "XAI_API_KEY"
                    : profile.provider === "anthropic"
                      ? "ANTHROPIC_API_KEY"
                      : profile.provider === "google"
                        ? "GEMINI_API_KEY"
                        : "OPENAI_API_KEY"]: Redacted.make("fixture-secret"),
                },
              }
            : { headers: { authorization: Redacted.make("fixture-secret") } };
        }),
        () =>
          Effect.sync(() => {
            releases.push("credential");
          }),
      ),
  };
  const http: ApiHttpPort = {
    request: (call) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          httpCalls.push(call);
          const status =
            call.method === "GET" || call.url.endsWith("/cancel")
              ? remoteStatus
              : options.outcome === "stream-loss"
                ? "in_progress"
                : "completed";
          const bytes = Buffer.from(JSON.stringify(apiResponse(status)));
          const chunks: Uint8Array[] = [];
          for (let i = 0; i < bytes.length; i += 7)
            chunks.push(bytes.subarray(i, i + 7));
          return {
            status: status === "not-found" ? 404 : 200,
            headers: { "content-type": "application/json" },
            body: Stream.fromIterable(chunks),
          } satisfies ApiHttpResponse;
        }),
        () =>
          Effect.sync(() => {
            releases.push("http");
          }),
      ),
  };
  const process: NativeProcessPort = {
    open: (launch) =>
      Effect.gen(function* () {
        launches.push(launch);
        const q = yield* Queue.unbounded<Readonly<Record<string, unknown>>>();
        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            releases.push("process");
            yield* Queue.shutdown(q);
          }),
        );
        const put = (frame: Readonly<Record<string, unknown>>) =>
          Queue.offer(q, frame).pipe(Effect.asVoid);
        const end = () => put({ __fixtureEnd: true });
        const completeGrok = (id: unknown) =>
          Effect.gen(function* () {
            if (options.outcome === "stream-loss") {
              yield* end();
              return;
            }
            if (options.outcome === "tool-without-permission")
              yield* put({
                jsonrpc: "2.0",
                method: "session/update",
                params: {
                  sessionId: SHARED_REMOTE_ID,
                  update: {
                    sessionUpdate: "tool_call",
                    toolCallId: "unrequested",
                    kind: "read",
                    status: "completed",
                  },
                },
              });
            yield* put({
              jsonrpc: "2.0",
              method: "session/update",
              params: {
                sessionId: SHARED_REMOTE_ID,
                update: {
                  sessionUpdate: "agent_message_chunk",
                  content: { type: "text", text: output },
                },
              },
            });
            yield* put({
              jsonrpc: "2.0",
              id,
              result: {
                stopReason: "end_turn",
                _meta: {
                  sessionId: SHARED_REMOTE_ID,
                  modelId: model,
                  structuredOutput: JSON.parse(output),
                },
              },
            });
          });
        const send = (frame: Readonly<Record<string, unknown>>) =>
          Effect.gen(function* () {
            sent.push(frame);
            if (transportId === "grok-acp") {
              if (frame.method === "initialize")
                yield* put({
                  jsonrpc: "2.0",
                  id: frame.id,
                  result: {
                    protocolVersion: 1,
                    agentInfo: { name: "grok", version: "1.0.30" },
                    authMethods: [{ id: "xai.api_key" }],
                  },
                });
              else if (frame.method === "authenticate")
                yield* put({ jsonrpc: "2.0", id: frame.id, result: {} });
              else if (frame.method === "session/new")
                yield* put({
                  jsonrpc: "2.0",
                  id: frame.id,
                  result: {
                    sessionId: SHARED_REMOTE_ID,
                    configOptions: [
                      {
                        id: "model",
                        category: "model",
                        type: "select",
                        currentValue: model,
                      },
                    ],
                  },
                });
              else if (frame.method === "session/prompt")
                yield* completeGrok(frame.id);
            } else if (transportId === "codex-app-server") {
              if (frame.method === "initialize")
                yield* put({
                  id: frame.id,
                  result: { userAgent: "codex/contract-fixture" },
                });
              else if (frame.method === "thread/start")
                yield* put({
                  id: frame.id,
                  result: {
                    model,
                    modelProvider: "openai",
                    thread: {
                      id: "thread:fixture",
                      sessionId: SHARED_REMOTE_ID,
                    },
                  },
                });
              else if (frame.method === "turn/start") {
                yield* put({
                  id: frame.id,
                  result: { turn: { id: "turn:fixture" } },
                });
                if (options.outcome === "stream-loss") {
                  yield* end();
                  return;
                }
                if (options.outcome === "tool-without-permission")
                  yield* put({
                    method: "item/started",
                    params: {
                      threadId: "thread:fixture",
                      turnId: "turn:fixture",
                      item: { id: "unrequested", type: "commandExecution" },
                    },
                  });
                yield* put({
                  method: "item/completed",
                  params: {
                    threadId: "thread:fixture",
                    turnId: "turn:fixture",
                    item: {
                      type: "agentMessage",
                      id: "message:fixture",
                      phase: "final_answer",
                      text: output,
                    },
                  },
                });
                yield* put({
                  method: "turn/completed",
                  params: {
                    threadId: "thread:fixture",
                    turn: { id: "turn:fixture", status: "completed" },
                  },
                });
              } else if (frame.method === "turn/interrupt")
                yield* put({ id: frame.id, result: {} });
            }
          });
        if (transportId === "claude-code") {
          yield* put({
            type: "system",
            subtype: "init",
            model,
            session_id: SHARED_REMOTE_ID,
            uuid: "init:fixture",
          });
          if (options.outcome === "tool-without-permission")
            yield* put({
              type: "assistant",
              session_id: SHARED_REMOTE_ID,
              message: {
                model,
                content: [
                  {
                    type: "tool_use",
                    id: "unrequested",
                    name: "read",
                    input: {},
                  },
                ],
              },
            });
          if (options.outcome !== "stream-loss")
            yield* put({
              type: "result",
              subtype: "success",
              session_id: SHARED_REMOTE_ID,
              uuid: "result:fixture",
              structured_output: JSON.parse(output),
              usage: { input_tokens: 3, output_tokens: 4 },
            });
          yield* end();
        }
        if (transportId === "gemini-cli") {
          yield* put({ type: "init", model, session_id: SHARED_REMOTE_ID });
          if (options.outcome === "tool-without-permission")
            yield* put({
              type: "tool_use",
              tool_id: "unrequested",
              tool_name: "read",
            });
          if (options.outcome !== "stream-loss") {
            yield* put({
              type: "message",
              role: "assistant",
              content: output,
              delta: true,
            });
            yield* put({
              type: "result",
              status: "success",
              stats: {
                input_tokens: 3,
                output_tokens: 4,
                models: { [model]: { input_tokens: 3, output_tokens: 4 } },
              },
            });
          }
          yield* end();
        }
        return {
          events: Stream.fromQueue(q).pipe(
            Stream.takeWhile((frame) => frame.__fixtureEnd !== true),
          ),
          send,
          close: () =>
            Effect.sync(() => {
              releases.push("close");
            }),
        };
      }),
  };
  const host: NativeHostPort = {
    cwd: directory,
    environment: { PATH: "/usr/bin" },
    process,
    toolPolicyNoneEnforced: options.hostEnforced ?? true,
    workspaceBoundaryEnforced: false,
    permissionBoundaryEnforced: false,
  };
  let configuration: GeminiConfigurationV1 | undefined;
  if (transportId === "gemini-cli") {
    const files = geminiConfigurationFiles(request);
    const settingsPath = join(directory, "settings.json"),
      defaultsPath = join(directory, "defaults.json"),
      adminPolicyPath = join(directory, "deny.toml");
    await Promise.all([
      writeFile(settingsPath, files.settings),
      writeFile(defaultsPath, files.defaults),
      writeFile(adminPolicyPath, files.policy),
    ]);
    configuration = {
      settingsPath,
      defaultsPath,
      adminPolicyPath,
      configDirectory: directory,
      settingsSha256: sha256Hex(files.settings),
      defaultsSha256: sha256Hex(files.defaults),
      policySha256: sha256Hex(files.policy),
      controlsHash: controlsHash(request.controls),
      systemPoliciesIsolated: true,
    };
  }
  const apiOptions = {
    credentials,
    http,
    requestForIdentity: () => Effect.succeed(request),
  };
  const transport: ProviderTransport =
    transportId === "xai-responses"
      ? createXaiResponsesTransport(apiOptions)
      : transportId === "anthropic-messages"
        ? createAnthropicMessagesTransport(apiOptions)
        : transportId === "openai-responses"
          ? createOpenaiResponsesTransport(apiOptions)
          : transportId === "google-interactions"
            ? createGoogleInteractionsTransport(apiOptions)
            : transportId === "grok-acp"
              ? createGrokAcpProtocol({
                  credentials,
                  process,
                  host,
                  version: transportVersion,
                })
              : transportId === "claude-code"
                ? createClaudeCodeTransport({
                    credentials,
                    process,
                    host,
                    version: transportVersion,
                  })
                : transportId === "codex-app-server"
                  ? createCodexAppServerTransport({
                      credentials,
                      process,
                      host,
                      version: transportVersion,
                    })
                  : createGeminiCliTransport({
                      credentials,
                      host,
                      configuration: configuration!,
                      protocolVersion: "0.59.0",
                    });
  return {
    request,
    transport,
    httpCalls,
    launches,
    sent,
    credentialRefs,
    releases,
    directory,
    setRemote: (status) => {
      remoteStatus = status;
    },
    dispose: () => rm(directory, { recursive: true, force: true }),
  };
}
