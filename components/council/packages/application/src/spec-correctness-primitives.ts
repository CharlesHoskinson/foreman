import type { Sha256Digest } from "@council/schema";
import { Context } from "effect";

/**
 * Synchronous SpecCorrectness primitives. Callers must snapshot bytes before
 * invoking either method so a hostile implementation cannot mutate shared
 * buffers or observe paths.
 *
 * Admission-only port: import via
 * `@council/application/spec-correctness-primitives`. Not exported from the
 * package root barrel so council-preflight cannot pull these symbols.
 */
export interface SpecCorrectnessPrimitivesService {
  readonly sha256: (bytes: Uint8Array) => Sha256Digest;
  readonly decodeUtf8: (bytes: Uint8Array) => string | null;
}

export class SpecCorrectnessPrimitives extends Context.Tag(
  "@council/application/SpecCorrectnessPrimitives",
)<SpecCorrectnessPrimitives, SpecCorrectnessPrimitivesService>() {}
