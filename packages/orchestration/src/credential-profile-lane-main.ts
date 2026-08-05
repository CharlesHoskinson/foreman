/**
 * Bundled entry for credential-profile-lane.js.
 */

import { Effect, Layer } from "effect";
import {
  liveCredentialProfile,
  writeFully,
} from "./credential-profile.js";
import { liveCredentialProfilePreflightStore } from "./credential-profile-preflight.js";
import {
  CREDENTIAL_PROFILE_LANE_EXIT_REFUSED,
  runCredentialProfileLaneCli,
} from "./credential-profile-lane-cli.js";

function startCredentialProfileLaneMain(): void {
  const pending: Promise<void>[] = [];
  const io = {
    writeStdout: (text: string) => {
      pending.push(writeFully(process.stdout, text));
    },
    writeStderr: (text: string) => {
      pending.push(writeFully(process.stderr, text));
    },
  };
  const layer = Layer.merge(
    liveCredentialProfile,
    liveCredentialProfilePreflightStore,
  );
  const program = runCredentialProfileLaneCli(process.argv, io).pipe(
    Effect.provide(layer),
  );

  Effect.runPromise(program).then(
    async (code) => {
      try {
        await Promise.all(pending);
      } catch {
        /* stream failures still set a definite exit code */
      }
      process.exitCode = code;
    },
    async () => {
      pending.push(
        writeFully(
          process.stderr,
          "Foreman credential profile lane refused: unreadable\n",
        ),
      );
      try {
        await Promise.all(pending);
      } catch {
        /* ignore */
      }
      process.exitCode = CREDENTIAL_PROFILE_LANE_EXIT_REFUSED;
    },
  );
}

startCredentialProfileLaneMain();
