import { createApiTransport } from "./api-transport.js";
import type { ApiTransportOptions } from "./api-transport.js";
import {
  artifactInput,
  consumeResponse,
  responseComplete,
} from "./api-protocol.js";
import type { ApiDialect } from "./api-protocol.js";
export const openaiResponsesDialect: ApiDialect = {
  id: "openai-responses",
  provider: "openai",
  models: ["gpt-6-astra", "gpt-5.6-sol"],
  baseUrl: "https://api.openai.com",
  endpointRevision: "v1",
  path: "/v1/responses",
  replay: "starting_after",
  retrieve: true,
  cancel: true,
  encode: (r, schema) => ({
    model: r.profileId,
    instructions: r.trustedInstructions,
    input: [{ role: "user", content: artifactInput(r) }],
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
    background: r.controls.execution.mode === "background",
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
export const createOpenaiResponsesTransport = (options: ApiTransportOptions) =>
  createApiTransport(openaiResponsesDialect, options);
export const createOpenAIResponsesTransport = createOpenaiResponsesTransport;
