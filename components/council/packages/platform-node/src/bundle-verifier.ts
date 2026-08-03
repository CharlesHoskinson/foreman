import type { BundleVerifierService } from "@council/application";
import { BundleVerificationError, BundleVerifier } from "@council/application";
import type { ReviewBundleIdentityV1, Sha256Digest } from "@council/schema";
import { Effect, Layer } from "effect";
import { sha256Hex } from "./digest.js";

/**
 * Pure-identity bundle verifier for tests and host wiring.
 * Compares the contract bundle against supplied observed identity values.
 */
export type ObservedBundleIdentity = {
  readonly baseSha: string;
  readonly headSha: string;
  readonly diffBytes: Uint8Array;
};

export const createIdentityBundleVerifier = (
  observed: ObservedBundleIdentity,
): BundleVerifierService => ({
  verify: (bundle: ReviewBundleIdentityV1) =>
    Effect.gen(function* () {
      if (bundle.baseSha !== observed.baseSha) {
        return yield* Effect.fail(
          new BundleVerificationError({
            stage: "bundle_verify",
            reason: `baseSha mismatch: expected ${observed.baseSha}, got ${bundle.baseSha}`,
            field: "baseSha",
          }),
        );
      }
      if (bundle.headSha !== observed.headSha) {
        return yield* Effect.fail(
          new BundleVerificationError({
            stage: "bundle_verify",
            reason: `headSha mismatch: expected ${observed.headSha}, got ${bundle.headSha}`,
            field: "headSha",
          }),
        );
      }
      const actualDiff = sha256Hex(observed.diffBytes);
      if (actualDiff !== (bundle.diffSha256 as string)) {
        return yield* Effect.fail(
          new BundleVerificationError({
            stage: "bundle_verify",
            reason: `diffSha256 mismatch: expected ${actualDiff}, got ${bundle.diffSha256}`,
            field: "diffSha256",
          }),
        );
      }
    }),
});

export const identityBundleVerifierLayer = (observed: ObservedBundleIdentity) =>
  Layer.succeed(BundleVerifier, createIdentityBundleVerifier(observed));

/**
 * Always-ok verifier for unit tests that isolate later pipeline stages.
 */
export const acceptingBundleVerifierLayer = Layer.succeed(BundleVerifier, {
  verify: () => Effect.void,
});

export type { Sha256Digest };
