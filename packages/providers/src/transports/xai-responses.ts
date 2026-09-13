import { createApiTransport } from "./api-transport.js";
import type { ApiTransportOptions } from "./api-transport.js";
import {
  artifactInput,
  consumeResponse,
  responseComplete,
} from "./api-protocol.js";
import type { ApiDialect } from "./api-protocol.js";
/** xAI's own Responses endpoint. No OpenAI background/cancel/replay compatibility is inferred. */
export const xaiResponsesDialect: ApiDialect = {
  id: "xai-responses",
  provider: "xai",
  models: ["grok-4.6"],
  baseUrl: "https://api.x.ai",
  endpointRevision: "v1",
  path: "/v1/responses",
  replay: false,
  retrieve: true,
  cancel: false,
  encode: (r, schema) => ({
    model: r.profileId,
    input: [
      { role: "system", content: r.trustedInstructions },
      { role: "user", content: artifactInput(r) },
    ],
    stream: true,
    reasoning: { effort: r.controls.effort },
    include: ["reasoning.encrypted_content"],
    max_output_tokens: r.limits.maxOutputTokens,
    tools: [],
    tool_choice: "none",
    text: {
      format: {
        type: "json_schema",
        name: "foreman_output",
        strict: true,
        schema,
      },
    },
    ...(r.controls.execution.store === "provider-default"
      ? {}
      : { store: r.controls.execution.store }),
    ...(r.controls.sampling.temperature === undefined
      ? {}
      : { temperature: r.controls.sampling.temperature }),
    ...(r.controls.sampling.topP === undefined
      ? {}
      : { top_p: r.controls.sampling.topP }),
  }),
  consume: consumeResponse,
  complete: responseComplete,
};
export const createXaiResponsesTransport = (options: ApiTransportOptions) =>
  createApiTransport(xaiResponsesDialect, options);
export const createXAIResponsesTransport = createXaiResponsesTransport;
