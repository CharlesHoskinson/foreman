import { createHash } from "node:crypto";
import type { DigestService } from "@council/application";
import { DigestError } from "@council/application";
import type { Sha256Digest } from "@council/schema";
import { Effect, Layer } from "effect";
import { Digest } from "@council/application";

export const sha256Hex = (bytes: Uint8Array): Sha256Digest => {
  const digest = createHash("sha256").update(bytes).digest("hex");
  return digest as Sha256Digest;
};

export const NodeDigest: DigestService = {
  sha256: (bytes) =>
    Effect.try({
      try: () => sha256Hex(bytes),
      catch: (error) =>
        new DigestError({
          stage: "digest",
          reason:
            error instanceof Error
              ? error.message
              : "sha256 digest computation failed",
        }),
    }),
};

export const NodeDigestLive = Layer.succeed(Digest, NodeDigest);
