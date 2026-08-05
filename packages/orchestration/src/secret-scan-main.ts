/**
 * Bundled entry for secret-scan.js — thin CLI adapter target.
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
  EXIT_NOT_CLEAN,
  liveSecretScan,
  renderSecretScanJson,
  runSecretScanCli,
  writeFully,
} from "./secret-scan.js";

function startSecretScanMain(): void {
  const pending: Promise<void>[] = [];

  const io = {
    writeStdout: (text: string) => {
      pending.push(writeFully(process.stdout, text));
    },
    writeStderr: (text: string) => {
      pending.push(writeFully(process.stderr, text));
    },
  };

  const program = runSecretScanCli(process.argv, io).pipe(
    Effect.provide(liveSecretScan),
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
          renderSecretScanJson({
            _tag: "Refused",
            reason: "unsupported_traversal",
          }) + "\n",
        ),
      );
      try {
        await Promise.all(pending);
      } catch {
        /* ignore */
      }
      process.exitCode = EXIT_NOT_CLEAN;
    },
  );
}

startSecretScanMain();
