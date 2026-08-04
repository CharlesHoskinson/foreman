import { Effect } from "effect";
import { sha256Hex } from "@foreman/core";
import { extractRegister, type ExtractSuccess } from "./register.js";
import {
  CANONICAL_REGISTER_RELPATH,
  type DenialReason,
} from "./schema.js";
import {
  GitIdentity,
  PolicyGitError,
  type GitCommitSnapshot,
} from "./services.js";

export type BoundAuthority = ExtractSuccess & {
  readonly snapshot: GitCommitSnapshot;
  readonly relativePath: typeof CANONICAL_REGISTER_RELPATH;
};

/**
 * Load sole production authority from commit C (HEAD snapshot):
 * - Register blob at C:canonical path
 * - Worktree+index match C blob for that path
 * - Approval eligibility: sole parent P and only register path changed P..C
 */
export function loadCommittedAuthority(
  repoRoot: string,
): Effect.Effect<BoundAuthority, PolicyGitError, GitIdentity> {
  return Effect.gen(function* () {
    const git = yield* GitIdentity;
    const { snapshot, commitBlobBytes } = yield* git.snapshotAuthority(
      repoRoot,
      CANONICAL_REGISTER_RELPATH,
    );
    const extracted = extractRegister(commitBlobBytes);
    if ("_tag" in extracted) {
      return yield* Effect.fail(new PolicyGitError(extracted.reason));
    }
    const dig = sha256Hex(extracted.canonicalJson);
    if (dig !== extracted.registerSha256) {
      return yield* Effect.fail(new PolicyGitError("internal_failed"));
    }
    return {
      ...extracted,
      snapshot,
      relativePath: CANONICAL_REGISTER_RELPATH,
    };
  });
}

export function mapAuthorityError(e: PolicyGitError): DenialReason {
  return e.reason;
}
