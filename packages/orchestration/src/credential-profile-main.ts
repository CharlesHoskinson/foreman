/**
 * Bundled entry for credential-profile.js — thin CLI adapter target.
 * Always emits exactly one canonical JSON line; never plain-text leaks.
 *
 * Sets process.exitCode and never terminates via process.exit on the outcome
 * or diagnostic path, so a backpressured stdout stream can finish the
 * required final JSON line before the process ends.
 *
 * Production startup is unconditional: no environment variable or test flag
 * may disable the CLI entry.
 */

import { Effect } from "effect";
import {
  EXIT_REFUSED,
  liveCredentialProfile,
  renderCredentialProfileJson,
  runCredentialProfileCli,
  writeFully,
} from "./credential-profile.js";

function startCredentialProfileMain(): void {
  const pending: Promise<void>[] = [];

  const io = {
    writeStdout: (text: string) => {
      pending.push(writeFully(process.stdout, text));
    },
    writeStderr: (text: string) => {
      pending.push(writeFully(process.stderr, text));
    },
  };

  const program = runCredentialProfileCli(process.argv, io).pipe(
    Effect.provide(liveCredentialProfile),
  );

  Effect.runPromise(program).then(
    async (code) => {
      try {
        await Promise.all(pending);
      } catch {
        /* stream errors still set a definite exit code */
      }
      process.exitCode = code;
    },
    async () => {
      // Fail closed with the same canonical JSON shape as every other refusal.
      // Do not emit stacks, paths, exception text, or environment content.
      pending.push(
        writeFully(
          process.stdout,
          renderCredentialProfileJson({
            _tag: "Refused",
            reason: "unreadable",
          }) + "\n",
        ),
      );
      try {
        await Promise.all(pending);
      } catch {
        /* ignore */
      }
      process.exitCode = EXIT_REFUSED;
    },
  );
}

startCredentialProfileMain();
