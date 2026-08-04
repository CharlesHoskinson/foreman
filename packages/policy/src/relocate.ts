import { Effect } from "effect";
import { admitCheck } from "./admit.js";
import { loadCommittedAuthority, mapAuthorityError } from "./authority.js";
import {
  Clock,
  GitIdentity,
  MutationProbe,
} from "./services.js";
import type { AdmissionRequest, DenialReason, RelocateResult } from "./schema.js";

export type RelocateArgs = {
  readonly repoRoot: string;
  readonly request: AdmissionRequest;
};

function denied(entryId: string | null, reason: DenialReason): RelocateResult {
  return { schemaVersion: 1, _tag: "Denied", entryId, reason };
}

function failed(reason: DenialReason): RelocateResult {
  return { schemaVersion: 1, _tag: "Failed", reason };
}

/**
 * Production relocate-artifact path (R2): fail closed before any mutation.
 * Node pathname APIs do not provide a portable no-replace rename or bound
 * source identity across lstat/read/unlink. Until Linux and Windows prove
 * both primitives with deterministic race tests, every production request
 * returns platform_invariant_unproven and never mutates.
 */
export function relocateArtifact(
  args: RelocateArgs,
): Effect.Effect<
  RelocateResult,
  never,
  GitIdentity | Clock | MutationProbe
> {
  return Effect.gen(function* () {
    const clock = yield* Clock;
    const probe = yield* MutationProbe;

    const authE = yield* Effect.either(loadCommittedAuthority(args.repoRoot));
    if (authE._tag === "Left") {
      return failed(mapAuthorityError(authE.left));
    }
    const auth = authE.right;
    const nowMs = yield* clock.nowMs();
    const check = admitCheck(
      auth.register,
      auth.registerSha256,
      args.request,
      nowMs,
      auth.snapshot,
    );
    if (check._tag === "Denied") {
      return denied(check.entryId, check.reason);
    }
    if (check._tag === "Failed") {
      return failed(check.reason);
    }

    // Authorized by pure policy, but live mutation is fail-closed in R2.
    yield* probe.record("live_relocate_refused");
    return failed("platform_invariant_unproven");
  }).pipe(
    Effect.catchAllDefect(() => Effect.succeed(failed("internal_failed"))),
  );
}
