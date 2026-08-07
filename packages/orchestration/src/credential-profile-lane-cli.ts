/**
 * Strict CLI for profile-bound lane admission.
 */

import { isAbsolute } from "node:path";
import { Effect } from "effect";
import {
  isCredentialVendor,
  isValidProfileId,
  type CredentialProfileInput,
  CredentialProfileFs,
} from "./credential-profile.js";
import { CredentialProfilePreflightStore } from "./credential-profile-preflight.js";
import { admitCredentialProfileLane } from "./credential-profile-lane.js";

export const CREDENTIAL_PROFILE_LANE_EXIT_OK = 0;
export const CREDENTIAL_PROFILE_LANE_EXIT_REFUSED = 1;

export type CredentialProfileLaneCliIo = {
  readonly writeStdout: (text: string) => void;
  readonly writeStderr: (text: string) => void;
};

export type ParsedCredentialProfileLaneArgv =
  | { readonly _tag: "Ok"; readonly input: CredentialProfileInput }
  | { readonly _tag: "Invalid" };

const FLAG_ORDER = [
  "--state-root",
  "--worktree",
  "--profile",
  "--vendor",
] as const;

function stripNodeArgv(argv: readonly string[]): readonly string[] {
  let args = [...argv];
  if (args[0]?.match(/(?:^|[\\/])node(?:\.exe)?$/u)) args = args.slice(1);
  if (args[0]?.includes("credential-profile-lane")) args = args.slice(1);
  return args;
}

function isSafeArgument(value: string): boolean {
  return (
    value.length > 0 &&
    !value.startsWith("--") &&
    !value.includes("\0") &&
    !value.includes("\r") &&
    !value.includes("\n")
  );
}

/**
 * Parse the exact fixed-order command. Reject all optional or extra input.
 */
export function parseCredentialProfileLaneArgv(
  argv: readonly string[],
): ParsedCredentialProfileLaneArgv {
  const args = stripNodeArgv(argv);
  if (args[0] !== "admit" || args.length !== 9) {
    return { _tag: "Invalid" };
  }

  const values: string[] = [];
  let offset = 1;
  for (const flag of FLAG_ORDER) {
    if (args[offset] !== flag) return { _tag: "Invalid" };
    const value = args[offset + 1];
    if (value === undefined || !isSafeArgument(value)) {
      return { _tag: "Invalid" };
    }
    values.push(value);
    offset += 2;
  }

  const stateRoot = values[0]!;
  const worktreeRoot = values[1]!;
  const profileId = values[2]!;
  const vendor = values[3]!;
  if (
    !isAbsolute(stateRoot) ||
    !isAbsolute(worktreeRoot) ||
    !isValidProfileId(profileId) ||
    !isCredentialVendor(vendor)
  ) {
    return { _tag: "Invalid" };
  }

  return {
    _tag: "Ok",
    input: { stateRoot, worktreeRoot, profileId, vendor },
  };
}

function refusalLine(reason: string): string {
  return `Foreman credential profile lane refused: ${reason}\n`;
}

/**
 * Emit one verified config root on success or one closed refusal on stderr.
 */
export function runCredentialProfileLaneCli(
  argv: readonly string[],
  io: CredentialProfileLaneCliIo,
): Effect.Effect<
  number,
  never,
  CredentialProfileFs | CredentialProfilePreflightStore
> {
  return Effect.gen(function* () {
    const parsed = parseCredentialProfileLaneArgv(argv);
    if (parsed._tag === "Invalid") {
      io.writeStderr(refusalLine("invalid_arguments"));
      return CREDENTIAL_PROFILE_LANE_EXIT_REFUSED;
    }

    const result = yield* admitCredentialProfileLane(parsed.input);
    if (result._tag === "Refused") {
      io.writeStderr(refusalLine(result.reason));
      return CREDENTIAL_PROFILE_LANE_EXIT_REFUSED;
    }
    io.writeStdout(result.configRoot + "\n");
    return CREDENTIAL_PROFILE_LANE_EXIT_OK;
  });
}
