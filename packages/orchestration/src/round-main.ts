/**
 * Bundled entry for lane-round.js — thin adapter target.
 *
 * Sets process.exitCode and never terminates via process.exit on the outcome
 * or diagnostic path, so a backpressured stdout/stderr stream can finish the
 * required final line before the process ends.
 */

import { Effect } from "effect";
import { runRoundCli } from "./round-cli.js";

function writeFully(
  stream: NodeJS.WriteStream,
  text: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => {
      stream.off("error", onError);
      reject(err);
    };
    stream.once("error", onError);
    stream.write(text, (err) => {
      stream.off("error", onError);
      if (err) reject(err);
      else resolve();
    });
  });
}

const pending: Promise<void>[] = [];

const io = {
  writeStdout: (text: string) => {
    pending.push(writeFully(process.stdout, text));
  },
  writeStderr: (text: string) => {
    pending.push(writeFully(process.stderr, text));
  },
};

Effect.runPromise(runRoundCli(process.argv, io)).then(
  async (code) => {
    try {
      await Promise.all(pending);
    } catch {
      /* stream errors still set a definite exit code */
    }
    process.exitCode = code;
  },
  async () => {
    pending.push(
      writeFully(process.stderr, "lane-round: internal failure\n"),
    );
    try {
      await Promise.all(pending);
    } catch {
      /* ignore */
    }
    process.exitCode = 1;
  },
);
