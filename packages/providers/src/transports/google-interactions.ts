import { createApiTransport } from "./api-transport.js";
import type { ApiTransportOptions } from "./api-transport.js";
import {
  artifactInput,
  object,
  objects,
  string,
  usage,
  noTool,
} from "./api-protocol.js";
import type {
  ApiDialect,
  ApiState,
  WireObject,
  WireDelta,
} from "./api-protocol.js";
import { apiFailure } from "./api-http.js";
function complete(s: ApiState, r: WireObject): WireDelta {
  s.id = string(r.id) || s.id;
  s.model = string(r.model) || s.model;
  if (r.usage) s.usage = usage(r.usage, true);
  if (r.status === "cancelled") {
    s.status = "cancelled";
    return { terminal: true };
  }
  if (r.status === "incomplete")
    return {
      failure: apiFailure(
        "OutputIncomplete",
        "Interaction output reached its token limit",
      ),
    };
  if (r.status === "requires_action") return noTool();
  if (r.status === "failed")
    return {
      failure: apiFailure(
        "OutcomeUnknown",
        "Interaction failed without a completed result",
      ),
    };
  if (r.status === "completed") {
    if (Array.isArray(r.steps)) {
      s.text = "";
      for (const step of objects(r.steps)) {
        if (step.type === "function_call") return noTool();
        if (step.type === "model_output")
          for (const c of objects(step.content)) {
            if (c.type === "text") s.text += string(c.text);
          }
      }
    }
    s.status = "completed";
    return { terminal: true };
  }
  return {};
}
export const googleInteractionsDialect: ApiDialect = {
  id: "google-interactions",
  provider: "google",
  models: ["gemini-3.8-flash"],
  baseUrl: "https://generativelanguage.googleapis.com",
  endpointRevision: "v1beta",
  path: "/v1beta/interactions",
  replay: "last_event_id",
  retrieve: true,
  cancel: true,
  encode: (r, schema) => ({
    model: r.profileId,
    system_instruction: r.trustedInstructions,
    input: artifactInput(r),
    stream: true,
    generation_config: {
      thinking_level: r.controls.effort,
      max_output_tokens: r.limits.maxOutputTokens,
      ...(r.controls.sampling.temperature === undefined
        ? {}
        : { temperature: r.controls.sampling.temperature }),
      ...(r.controls.sampling.topP === undefined
        ? {}
        : { top_p: r.controls.sampling.topP }),
      ...(r.controls.sampling.topK === undefined
        ? {}
        : { top_k: r.controls.sampling.topK }),
    },
    response_format: { type: "text", mime_type: "application/json", schema },
    background: r.controls.execution.mode === "background",
    ...(r.controls.execution.store === "provider-default"
      ? {}
      : { store: r.controls.execution.store }),
  }),
  consume: (s, e) => {
    const type = string(e.event_type);
    if (type === "interaction.created") {
      const r = object(e.interaction);
      s.id = string(r.id);
      s.model = string(r.model);
      return {};
    }
    if (type === "step.start") {
      const step = object(e.step);
      if (step.type === "function_call") return noTool();
      s.blocks.set(Number(e.index), step);
      return {};
    }
    if (type === "step.delta") {
      const block = s.blocks.get(Number(e.index));
      if (!block)
        return {
          failure: apiFailure(
            "MalformedEvent",
            "Interaction delta references an unopened step",
          ),
        };
      const d = object(e.delta);
      if (block.type === "model_output" && d.type === "text") {
        const text = string(d.text);
        s.text += text;
        return { text };
      }
      return {};
    }
    if (type === "step.stop") {
      if (!s.blocks.delete(Number(e.index)))
        return {
          failure: apiFailure(
            "MalformedEvent",
            "Interaction stop references an unopened step",
          ),
        };
      return {};
    }
    if (type === "interaction.completed") {
      if (s.blocks.size)
        return {
          failure: apiFailure(
            "MalformedEvent",
            "Interaction ended with an open step",
          ),
        };
      return complete(s, object(e.interaction));
    }
    if (type === "error")
      return {
        failure: apiFailure(
          "OutcomeUnknown",
          "Interaction stream returned an error",
        ),
      };
    return {};
  },
  complete,
};
export const createGoogleInteractionsTransport = (
  options: ApiTransportOptions,
) => createApiTransport(googleInteractionsDialect, options);
