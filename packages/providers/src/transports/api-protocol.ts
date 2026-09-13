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
  for (const item of output) {
    if (item.type === "function_call") return noTool();
    if (item.type === "message")
      for (const part of objects(item.content)) {
        if (part.type === "refusal") {
          state.status = "refused";
          return { terminal: true };
        }
        if (part.type === "output_text") text += string(part.text);
      }
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
    type === "response.output_item.added" &&
    object(event.item).type === "function_call"
  )
    return noTool();
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
