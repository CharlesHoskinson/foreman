import type {
  PromptMaterializerInput,
  PromptMaterializerService,
} from "@council/application";
import {
  PromptMaterializationError,
  PromptMaterializer,
} from "@council/application";
import { Effect, Layer } from "effect";
import { canonicalJsonBytes } from "./canonical-json.js";

/**
 * Materialize the council-prompt-v1 envelope as canonical JSON UTF-8 bytes.
 * Object keys are recursively sorted. Evidence remains under untrustedEvidence.
 */
export const materializePromptBytes = (
  input: PromptMaterializerInput,
): Uint8Array => {
  const envelope = {
    format: input.format,
    trustedAuthority: {
      aceText: input.trustedAuthority.aceText,
      profile: input.trustedAuthority.profile,
    },
    taskData: {
      bundle: input.taskData.bundle,
      candidateId: input.taskData.candidateId,
      limits: input.taskData.limits,
    },
    untrustedEvidence: input.untrustedEvidence.map((item) => ({
      alias: item.alias,
      artifactId: item.artifactId,
      byteLength: item.byteLength,
      content: item.content,
      contentEncoding: item.contentEncoding,
      mediaType: item.mediaType,
      sha256: item.sha256,
    })),
    responseSchema: input.responseSchema,
  };
  return canonicalJsonBytes(envelope);
};

export const NodePromptMaterializer: PromptMaterializerService = {
  materialize: (input) =>
    Effect.try({
      try: () => {
        const bytes = materializePromptBytes(input);
        if (bytes.byteLength < 1) {
          throw new PromptMaterializationError({
            stage: "prompt_materialize",
            reason: "materialized prompt is empty",
          });
        }
        return bytes;
      },
      catch: (error) => {
        if (error instanceof PromptMaterializationError) {
          return error;
        }
        return new PromptMaterializationError({
          stage: "prompt_materialize",
          reason:
            error instanceof Error
              ? error.message
              : "prompt materialization failed",
        });
      },
    }),
};

export const NodePromptMaterializerLive = Layer.succeed(
  PromptMaterializer,
  NodePromptMaterializer,
);
