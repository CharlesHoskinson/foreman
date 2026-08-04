/**
 * Bundled entry for vendor-preflight.js — thin adapter target.
 *
 * Sets process.exitCode and never terminates via process.exit on the outcome
 * path, so a backpressured stdout/stderr stream can finish before exit.
 */

import { Effect } from "effect";
import { runVendorPreflightCli } from "./vendor-preflight-cli.js";
import { tryGetEmbeddedCapabilityTable } from "./vendor-preflight-embedded.js";

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

const table = tryGetEmbeddedCapabilityTable();
if (table === null) {
  pending.push(
    writeFully(
      process.stderr,
      "vendor-preflight: embedded capability table missing\n",
    ),
  );
  await Promise.all(pending).catch(() => undefined);
  process.exitCode = 3;
} else {
  Effect.runPromise(
    runVendorPreflightCli(process.argv, io, { capabilityTable: table }),
  ).then(
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
        writeFully(process.stderr, "vendor-preflight: internal failure\n"),
      );
      try {
        await Promise.all(pending);
      } catch {
        /* ignore */
      }
      process.exitCode = 3;
    },
  );
}
