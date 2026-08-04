import { createHash } from "node:crypto";
import {
  SpecCorrectnessPrimitives,
  type SpecCorrectnessPrimitivesService,
} from "@council/application/spec-correctness-primitives";
import type { Sha256Digest } from "@council/schema";
import { Layer } from "effect";

/**
 * Snapshot bytes before hashing or decoding so a caller-owned buffer cannot be
 * mutated through the primitive boundary and so the implementation always sees
 * a private copy.
 */
const snapshot = (bytes: Uint8Array): Uint8Array => Uint8Array.from(bytes);

/**
 * Node SpecCorrectness primitives: SHA-256 via node:crypto and fatal UTF-8
 * TextDecoder. Never throws for invalid UTF-8 — returns null instead.
 */
export const NodeSpecCorrectnessPrimitives: SpecCorrectnessPrimitivesService = {
  sha256: (bytes) => {
    const copy = snapshot(bytes);
    const digest = createHash("sha256").update(copy).digest("hex");
    return digest as Sha256Digest;
  },
  decodeUtf8: (bytes) => {
    const copy = snapshot(bytes);
    try {
      return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        copy,
      );
    } catch {
      return null;
    }
  },
};

export const NodeSpecCorrectnessPrimitivesLive = Layer.succeed(
  SpecCorrectnessPrimitives,
  NodeSpecCorrectnessPrimitives,
);
