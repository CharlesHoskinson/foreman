import { evaluateSpecCorrectnessAdmission } from "@council/application/spec-correctness-admission";
import { filesystemArtifactReaderLayer } from "@council/platform-node";
import { NodeSpecCorrectnessPrimitivesLive } from "@council/platform-node/spec-correctness-primitives";
import { decodeStrictSync } from "@council/schema";
import type {
  SpecCorrectnessAdmissionResultV1,
  SpecCorrectnessCliRequestV1,
} from "@council/schema/spec-correctness-admission";
import { SpecCorrectnessAdmissionResultV1 as SpecCorrectnessAdmissionResultSchema } from "@council/schema/spec-correctness-admission";
import { Effect, Layer } from "effect";

/**
 * Execute a strict SpecCorrectness CLI request: build the filesystem artifact
 * path map and primitives layer, run the application coordinator, and strictly
 * decode the closed result. Paths never appear in the returned value.
 */
export const executeSpecCorrectnessRequest = async (
  request: SpecCorrectnessCliRequestV1,
): Promise<SpecCorrectnessAdmissionResultV1> => {
  const pathMap = new Map<string, string>();
  for (const item of request.artifactPaths) {
    pathMap.set(item.artifactId, item.path);
  }

  const layer = Layer.merge(
    filesystemArtifactReaderLayer(pathMap),
    NodeSpecCorrectnessPrimitivesLive,
  );

  const raw = await Effect.runPromise(
    evaluateSpecCorrectnessAdmission(request.input).pipe(Effect.provide(layer)),
  );

  return decodeStrictSync(SpecCorrectnessAdmissionResultSchema, raw);
};
