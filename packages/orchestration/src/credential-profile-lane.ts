/**
 * Profile-bound lane admission (Sprint 3 R7B2-A).
 *
 * The service resolves one external credential profile, reads its bound
 * preflight record, and resolves the profile again before admission. It does
 * not inspect credentials or start a vendor process.
 */

import { Effect } from "effect";
import {
  resolveProfile,
  type CredentialProfileInput,
  type CredentialProfileRefusalReason,
  type CredentialVendor,
  CredentialProfileFs,
} from "./credential-profile.js";
import {
  CredentialProfilePreflightStore,
  type ProfilePreflightStoreFailureReason,
  profilePreflightRecordPath,
} from "./credential-profile-preflight.js";
import { recordIsFullyReady } from "./vendor-preflight-contract.js";

export const CREDENTIAL_PROFILE_LANE_REFUSAL_REASONS = [
  "invalid_arguments",
  "authority_missing",
  "authority_invalid",
  "profile_mismatch",
  "preflight_not_ready",
  "linked_path",
  "identity_changed",
  "unreadable",
] as const;

export type CredentialProfileLaneRefusalReason =
  (typeof CREDENTIAL_PROFILE_LANE_REFUSAL_REASONS)[number];

export type CredentialProfileLaneResult =
  | {
      readonly _tag: "Admitted";
      readonly profileId: string;
      readonly vendor: CredentialVendor;
      readonly configRoot: string;
      readonly profileIdentity: string;
    }
  | {
      readonly _tag: "Refused";
      readonly reason: CredentialProfileLaneRefusalReason;
    };

function refuse(
  reason: CredentialProfileLaneRefusalReason,
): CredentialProfileLaneResult {
  return { _tag: "Refused", reason };
}

function mapProfileRefusal(
  reason: CredentialProfileRefusalReason,
): CredentialProfileLaneRefusalReason {
  switch (reason) {
    case "invalid_arguments":
    case "invalid_profile_id":
    case "invalid_state_root":
    case "state_root_in_worktree":
      return "invalid_arguments";
    case "authority_missing":
      return "authority_missing";
    case "linked_path":
      return "linked_path";
    case "identity_changed":
      return "identity_changed";
    case "unreadable":
      return "unreadable";
    case "authority_invalid":
    case "authority_conflict":
    case "write_failed":
      return "authority_invalid";
  }
}

function mapStoreFailure(
  reason: ProfilePreflightStoreFailureReason,
): CredentialProfileLaneRefusalReason {
  switch (reason) {
    case "absent":
      return "authority_missing";
    case "linked_path":
      return "linked_path";
    case "identity_changed":
      return "identity_changed";
    case "unreadable":
      return "unreadable";
    case "path_invalid":
    case "oversized":
    case "malformed":
    case "decode_failed":
    case "write_failed":
      return "authority_invalid";
  }
}

/**
 * Admit one lane from a ready profile-bound preflight record.
 */
export function admitCredentialProfileLane(
  input: CredentialProfileInput,
): Effect.Effect<
  CredentialProfileLaneResult,
  never,
  CredentialProfileFs | CredentialProfilePreflightStore
> {
  return Effect.gen(function* () {
    const first = yield* resolveProfile(input);
    if (first._tag === "Refused") {
      return refuse(mapProfileRefusal(first.reason));
    }
    if (first._tag !== "Ready") return refuse("authority_invalid");

    const store = yield* CredentialProfilePreflightStore;
    const read = yield* store
      .read(
        profilePreflightRecordPath(
          input.stateRoot,
          input.profileId,
          input.vendor,
        ),
        {
          profileId: first.profileId,
          profileIdentity: first.profileIdentity,
          vendor: first.vendor,
        },
      )
      .pipe(
        Effect.map((wrapper) => ({ _tag: "Read" as const, wrapper })),
        Effect.catchAll((failure) =>
          Effect.succeed({
            _tag: "ReadRefused" as const,
            reason: mapStoreFailure(failure.reason),
          }),
        ),
      );
    if (read._tag === "ReadRefused") return refuse(read.reason);

    const wrapper = read.wrapper;
    if (
      wrapper.profileId !== first.profileId ||
      wrapper.profileIdentity !== first.profileIdentity ||
      wrapper.vendor !== first.vendor
    ) {
      return refuse("profile_mismatch");
    }
    if (!recordIsFullyReady(wrapper.record)) {
      return refuse("preflight_not_ready");
    }

    const second = yield* resolveProfile(input);
    if (second._tag === "Refused") {
      return refuse(mapProfileRefusal(second.reason));
    }
    if (second._tag !== "Ready") return refuse("authority_invalid");
    if (
      second.profileId !== first.profileId ||
      second.vendor !== first.vendor ||
      second.profileIdentity !== first.profileIdentity ||
      second.configRoot !== first.configRoot
    ) {
      return refuse("profile_mismatch");
    }

    return {
      _tag: "Admitted",
      profileId: second.profileId,
      vendor: second.vendor,
      configRoot: second.configRoot,
      profileIdentity: second.profileIdentity,
    };
  });
}
