/**
 * Bundled entry for secret-scan.js — thin CLI adapter target.
 * Always emits exactly one canonical JSON line; never plain-text leaks.
 *
 * Sets process.exitCode and never terminates via process.exit on the outcome
 * or diagnostic path, so a backpressured stdout stream can finish the
 * required final JSON line before the process ends.
 */

import { Effect } from "effect";
import {
  EXIT_NOT_CLEAN,
  liveSecretScan,
  renderSecretScanJson,
  runSecretScanCli,
} from "./secret-scan.js";

/**
 * Minimal stream surface for writeFully (Node WriteStream or test double).
 */
export type SecretScanWriteStream = {
  write(chunk: string, cb?: (err?: Error | null) => void): boolean;
  once(event: "error", listener: (err: Error) => void): unknown;
  off(event: "error", listener: (err: Error) => void): unknown;
};

/**
 * Write all of `text` to `stream`, settling once from the write callback.
 *
 * After a successful callback, remove the one-time `error` listener.
 * After a callback error, keep the listener armed so a subsequent stream
 * `error` event is consumed and cannot become an uncaught exception (Node
 * may deliver the callback error before the matching `error` event).
 */
export function writeFully(
  stream: SecretScanWriteStream,
  text: string,
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    let settled = false;
    const settleReject = (err: Error) => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    const onError = (err: Error) => {
      stream.off("error", onError);
      settleReject(err);
    };
    stream.once("error", onError);
    stream.write(text, (err) => {
      if (err) {
        // Keep onError until the stream emits `error` (or the process ends).
        settleReject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      stream.off("error", onError);
      if (!settled) {
        settled = true;
        resolvePromise();
      }
    });
  });
}

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

// Skip auto-start when this module is imported under node:test so writeFully
// can be unit-tested without spawning the CLI side effects.
if (process.env.NODE_TEST_CONTEXT === undefined) {
  startSecretScanMain();
}
