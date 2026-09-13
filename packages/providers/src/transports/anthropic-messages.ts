import { createApiTransport } from "./api-transport.js";
import type { ApiTransportOptions } from "./api-transport.js";
import {
  artifactInput,
  object,
  objects,
  string,
  usage,
  noTool,
  classifyOutputItem,
} from "./api-protocol.js";
import type {
  ApiDialect,
  ApiState,
  WireObject,
  WireDelta,
} from "./api-protocol.js";
import { apiFailure } from "./api-http.js";
/** Messages content blocks that carry no action. Unknown blocks fail closed. */
const inertBlocks = new Set(["text", "thinking", "redacted_thinking"]);
/** Documented Messages tool blocks, including server-side and remote-server tools. */
const toolBlocks = new Set([
  "tool_use",
  "server_tool_use",
  "mcp_tool_use",
  "web_search_tool_result",
  "code_execution_tool_result",
  "mcp_tool_result",
]);
const classifyBlock = (type: string) =>
  classifyOutputItem(type, inertBlocks, toolBlocks);
/** Content block deltas that carry no action. Unknown deltas fail closed. */
const inertDeltas = new Set([
  "text_delta",
  "thinking_delta",
  "signature_delta",
  "citations_delta",
]);
/** Documented deltas that stream tool input into an open block. */
const toolDeltas = new Set(["input_json_delta"]);
const classifyDelta = (type: string) =>
  classifyOutputItem(type, inertDeltas, toolDeltas);
function stop(state: ApiState, reason: unknown): WireDelta {
  if (reason === "max_tokens" || reason === "model_context_window_exceeded")
    return {
      failure: apiFailure(
        "OutputIncomplete",
        "Messages output reached a token or context limit",
      ),
    };
  if (reason === "tool_use") return noTool();
  if (reason === "refusal") {
    state.status = "refused";
    return {};
  }
  if (reason === "end_turn" || reason === "stop_sequence") {
    state.status = "completed";
    return {};
  }
  return {
    failure: apiFailure(
      "OutcomeUnknown",
      "Messages stopped without a supported terminal reason",
    ),
  };
}
export const anthropicMessagesDialect: ApiDialect = {
  id: "anthropic-messages",
  provider: "anthropic",
  models: ["claude-opus-5", "claude-fable-5-1"],
  baseUrl: "https://api.anthropic.com",
  endpointRevision: "2023-06-01",
  path: "/v1/messages",
  replay: false,
  retrieve: false,
  cancel: false,
  headers: { "anthropic-version": "2023-06-01" },
  encode: (r, schema) => ({
    model: r.profileId,
    system: r.trustedInstructions,
    messages: [{ role: "user", content: artifactInput(r) }],
    max_tokens: r.limits.maxOutputTokens,
    stream: true,
    thinking:
      r.controls.thinking.mode === "disabled"
        ? { type: "disabled" }
        : r.controls.thinking.mode === "enabled"
          ? { type: "enabled", budget_tokens: r.controls.thinking.budgetTokens }
          : { type: "adaptive" },
    output_config: {
      effort: r.controls.effort,
      format: { type: "json_schema", schema },
    },
    ...(r.controls.sampling.temperature === undefined
      ? {}
      : { temperature: r.controls.sampling.temperature }),
    ...(r.controls.sampling.topP === undefined
      ? {}
      : { top_p: r.controls.sampling.topP }),
    ...(r.controls.sampling.topK === undefined
      ? {}
      : { top_k: r.controls.sampling.topK }),
  }),
  consume: (s, e) => {
    const type = string(e.type);
    if (type === "__full")
      return anthropicMessagesDialect.complete(s, object(e.response));
    if (type === "message_start") {
      const m = object(e.message);
      s.id = string(m.id);
      s.model = string(m.model);
      s.usage = usage(m.usage);
      return {};
    }
    if (type === "content_block_start") {
      const block = object(e.content_block);
      const classified = classifyBlock(string(block.type));
      if (classified !== "inert") return classified;
      s.blocks.set(Number(e.index), block);
      return {};
    }
    if (type === "content_block_delta") {
      const d = object(e.delta);
      const block = s.blocks.get(Number(e.index));
      if (!block)
        return {
          failure: apiFailure(
            "MalformedEvent",
            "Messages delta references an unopened block",
          ),
        };
      const classified = classifyDelta(string(d.type));
      if (classified !== "inert") return classified;
      if (d.type === "text_delta" && block.type === "text") {
        const text = string(d.text);
        s.text += text;
        return { text };
      }
      return {};
    }
    if (type === "content_block_stop") {
      if (!s.blocks.delete(Number(e.index)))
        return {
          failure: apiFailure(
            "MalformedEvent",
            "Messages stop references an unopened block",
          ),
        };
      return {};
    }
    if (type === "message_delta") {
      const next = usage(e.usage);
      s.usage = {
        ...s.usage,
        ...next,
        providerCounters: {
          ...s.usage.providerCounters,
          ...next.providerCounters,
        },
      };
      return stop(s, object(e.delta).stop_reason);
    }
    if (type === "message_stop") {
      if (s.blocks.size)
        return {
          failure: apiFailure(
            "MalformedEvent",
            "Messages ended with an open content block",
          ),
        };
      if (s.status === "pending")
        return {
          failure: apiFailure(
            "OutcomeUnknown",
            "Messages stream lacks a terminal reason",
          ),
        };
      return { terminal: true };
    }
    if (type === "error")
      return {
        failure: apiFailure(
          "OutcomeUnknown",
          "Messages stream returned an error",
        ),
      };
    return {};
  },
  complete: (s, r) => {
    s.id = string(r.id);
    s.model = string(r.model);
    s.usage = usage(r.usage);
    for (const b of objects(r.content)) {
      const classified = classifyBlock(string(b.type));
      if (classified !== "inert") return classified;
      if (b.type === "text") s.text += string(b.text);
    }
    const result = stop(s, r.stop_reason);
    return { ...result, terminal: !result.failure };
  },
};
export const createAnthropicMessagesTransport = (
  options: ApiTransportOptions,
) => createApiTransport(anthropicMessagesDialect, options);
