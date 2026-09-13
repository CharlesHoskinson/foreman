import type { ProviderRequestV1, ProviderUsageV1 } from "../contract.js";
import type { ProviderFailure } from "../errors.js";
import { apiFailure } from "./api-http.js";
export type WireObject = Record<string, unknown>;
export const object = (v: unknown): WireObject =>
  v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as WireObject)
    : {};
export const objects = (v: unknown): WireObject[] =>
  Array.isArray(v) ? v.map(object) : [];
export const string = (v: unknown): string => (typeof v === "string" ? v : "");
export interface ApiState {
  id: string;
  model: string;
  text: string;
  status: "pending" | "completed" | "cancelled" | "refused";
  usage: ProviderUsageV1;
  blocks: Map<number, WireObject>;
  opaque: string[];
}
export const initialState = (): ApiState => ({
  id: "",
  model: "",
  text: "",
  status: "pending",
  usage: { providerCounters: {} },
  blocks: new Map(),
  opaque: [],
});
export interface WireDelta {
  readonly text?: string;
  readonly terminal?: boolean;
  readonly failure?: ProviderFailure;
}
export interface ApiDialect {
  readonly id:
    | "xai-responses"
    | "openai-responses"
    | "anthropic-messages"
    | "google-interactions";
  readonly provider: "xai" | "openai" | "anthropic" | "google";
  readonly models: readonly string[];
  readonly baseUrl: string;
  readonly endpointRevision: string;
  readonly path: string;
  readonly replay: false | "starting_after" | "last_event_id";
  readonly retrieve: boolean;
  readonly cancel: boolean;
  readonly headers?: Readonly<Record<string, string>>;
  readonly encode: (request: ProviderRequestV1, schema: unknown) => WireObject;
  readonly consume: (state: ApiState, event: WireObject) => WireDelta;
  readonly complete: (state: ApiState, response: WireObject) => WireDelta;
}
export function usage(v: unknown, google = false): ProviderUsageV1 {
  const u = object(v);
  const numeric = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;
  const input = numeric(u[google ? "total_input_tokens" : "input_tokens"]);
  const output = numeric(u[google ? "total_output_tokens" : "output_tokens"]);
  const cache = numeric(
    google
      ? u.total_cached_tokens
      : (u.cache_read_input_tokens ??
          object(u.input_tokens_details).cached_tokens),
  );
  const writes = numeric(u.cache_creation_input_tokens);
  const counters: Record<string, number | string> = {};
  for (const [key, value] of Object.entries(u))
    if (typeof value === "number" && Number.isFinite(value) && value >= 0)
      counters[key] = value;
  return {
    ...(input === undefined ? {} : { inputTokens: input }),
    ...(output === undefined ? {} : { outputTokens: output }),
    ...(cache === undefined ? {} : { cachedReadTokens: cache }),
    ...(writes === undefined ? {} : { cacheWriteTokens: writes }),
    providerCounters: counters,
  };
}
export const noTool = (): WireDelta => ({
  failure: apiFailure(
    "UnsupportedCapability",
    "Provider requested a tool under toolPolicy none",
    "toolPolicy",
  ),
});
/**
 * Fail closed. An output item that this release does not recognize can carry
 * action, so it never becomes text and never supports no-tool evidence.
 */
export const unknownOutput = (): WireDelta => ({
  failure: apiFailure(
    "MalformedEvent",
    "Provider returned unrecognized action-bearing output under toolPolicy none",
    "output",
  ),
});
/** Response output items that carry no action. Every other item is tool or unknown activity. */
const inertResponseItems = new Set(["message", "reasoning"]);
/** Documented Responses tool items, including built-in and remote-server tools. */
const responseToolItems = new Set([
  "function_call",
  "custom_tool_call",
  "web_search_call",
  "file_search_call",
  "computer_call",
  "code_interpreter_call",
  "image_generation_call",
  "local_shell_call",
  "mcp_call",
  "mcp_list_tools",
  "mcp_approval_request",
]);
/** Classify one output item without inferring that an unknown item is inert. */
export function classifyOutputItem(
  type: string,
  inert: ReadonlySet<string>,
  tools: ReadonlySet<string>,
): "inert" | WireDelta {
  if (tools.has(type)) return noTool();
  if (inert.has(type)) return "inert";
  return unknownOutput();
}
export const classifyResponseItem = (type: string) =>
  classifyOutputItem(type, inertResponseItems, responseToolItems);
/**
 * Content parts that carry no action inside a recognized message or reasoning
 * item. One set covers every part boundary because a streaming content part
 * does not name the item that owns it.
 */
const inertResponseParts = new Set([
  "output_text",
  "refusal",
  "summary_text",
  "reasoning_text",
]);
/** Classify one nested content part. A tool name nested here is tool activity. */
export const classifyResponsePart = (type: string) =>
  classifyOutputItem(type, inertResponseParts, responseToolItems);
export interface ItemScan {
  /** Output text of this item. Empty while the item carries no text part. */
  readonly text: string;
  readonly refused: boolean;
  /** Set when a nested part is tool or unrecognized activity. */
  readonly failure?: WireDelta;
}
/**
 * Decode the nested content of one already recognized output item. A part that
 * this release does not recognize can carry action, so it never becomes text
 * and never supports no-tool evidence, even beside valid output text.
 */
export function scanResponseItem(item: WireObject): ItemScan {
  let text = "";
  let refused = false;
  const message = item.type === "message";
  for (const part of [...objects(item.content), ...objects(item.summary)]) {
    const classified = classifyResponsePart(string(part.type));
    if (classified !== "inert")
      return { text: "", refused: false, failure: classified };
    if (!message) continue;
    if (part.type === "refusal") refused = true;
    if (part.type === "output_text") text += string(part.text);
  }
  return { text, refused };
}
/** Request keys that can offer a tool surface in any admitted API dialect. */
const toolSurfaceKeys = new Set([
  "tools",
  "tool_choice",
  "tool_config",
  "toolConfig",
  "tool_resources",
  "allowed_tools",
  "functions",
  "function_call",
  "server_tools",
  "builtin_tools",
  "system_tools",
  "mcp_servers",
]);
/**
 * Request-side enforcement evidence only. It reports that the exact serialized
 * body offered no tool surface under an admitted `none` tool policy. It observes
 * nothing about the response and establishes no provider-side catalog claim.
 */
export function noToolRequestSurface(
  request: ProviderRequestV1,
  body: WireObject,
): boolean {
  if (request.toolPolicy.mode !== "none") return false;
  if (request.controls.toolChoice !== "none") return false;
  for (const [key, value] of Object.entries(body)) {
    if (!toolSurfaceKeys.has(key)) continue;
    if (value === undefined || value === null) continue;
    if (key === "tool_choice" || key === "function_call") {
      if (value !== "none") return false;
      continue;
    }
    if (!Array.isArray(value) || value.length !== 0) return false;
  }
  return true;
}
export function responseComplete(
  state: ApiState,
  response: WireObject,
): WireDelta {
  state.id = string(response.id) || state.id;
  state.model = string(response.model) || state.model;
  if (response.usage) state.usage = usage(response.usage);
  if (response.status === "cancelled") {
    state.status = "cancelled";
    return { terminal: true };
  }
  if (response.status === "incomplete")
    return {
      failure: apiFailure(
        "OutputIncomplete",
        "Provider response was truncated",
      ),
    };
  if (response.status === "failed" || response.error)
    return {
      failure: apiFailure(
        "OutcomeUnknown",
        "Provider reported failure without a completed output",
      ),
    };
  const output = objects(response.output);
  let text = "";
  let refused = false;
  for (const item of output) {
    const classified = classifyResponseItem(string(item.type));
    if (classified !== "inert") return classified;
    const scan = scanResponseItem(item);
    if (scan.failure) return scan.failure;
    text += scan.text;
    refused ||= scan.refused;
  }
  // Every item is validated before a refusal reports its terminal outcome.
  if (refused) {
    state.status = "refused";
    return { terminal: true };
  }
  if (output.length) state.text = text;
  if (response.status === "completed") {
    state.status = "completed";
    return { terminal: true };
  }
  return {};
}
export function consumeResponse(state: ApiState, event: WireObject): WireDelta {
  const type = string(event.type);
  if (type === "response.created" || type === "response.in_progress") {
    const r = object(event.response);
    state.id = string(r.id) || state.id;
    state.model = string(r.model) || state.model;
    return {};
  }
  if (type === "response.output_text.delta") {
    const text = string(event.delta);
    state.text += text;
    return { text };
  }
  if (type === "response.refusal.delta" || type === "response.refusal.done") {
    state.status = "refused";
    return {};
  }
  if (
    type === "response.output_item.added" ||
    type === "response.output_item.done"
  ) {
    const item = object(event.item);
    const classified = classifyResponseItem(string(item.type));
    if (classified !== "inert") return classified;
    const scan = scanResponseItem(item);
    if (scan.failure) return scan.failure;
    return {};
  }
  if (
    type === "response.content_part.added" ||
    type === "response.content_part.done"
  ) {
    const classified = classifyResponsePart(string(object(event.part).type));
    if (classified !== "inert") return classified;
    return {};
  }
  if (
    type === "response.completed" ||
    type === "response.done" ||
    type === "response.incomplete" ||
    type === "response.failed"
  )
    return responseComplete(state, object(event.response));
  if (type === "error")
    return {
      failure: apiFailure(
        "OutcomeUnknown",
        "Provider stream returned an error",
      ),
    };
  return {};
}
export function artifactInput(request: ProviderRequestV1): string {
  return JSON.stringify(
    request.artifacts.map((a) => ({
      id: a.id,
      contentRef: a.contentRef,
      sha256: a.sha256,
      content: a.content,
    })),
  );
}
