import { Effect, Layer } from "effect";
import { ProviderSchemaLowerer } from "./ports.js";
import { lowerProviderSchema } from "./schema-lowering.js";

/**
 * Default pure provider-schema lowerer. Adapters may replace this Layer with a
 * profile that records additional live-canary findings; version 1 uses the
 * closed recursive keyword walker only.
 */
export const ProviderSchemaLowererLive = Layer.succeed(ProviderSchemaLowerer, {
  lower: (input) =>
    Effect.gen(function* () {
      const result = yield* lowerProviderSchema(
        input.providerFamily,
        input.canonicalSchema,
      );
      return {
        loweredSchema: result.loweredSchema,
        loweredSchemaBytes: result.loweredSchemaBytes,
        transformations: result.transformations,
        constraintReceipts: result.constraintReceipts,
      };
    }),
});
