/**
 * Bundled entry for foreman-setup.js — thin adapter target.
 *
 * Sets process.exitCode and never terminates via process.exit on the outcome
 * path, so a backpressured stdout/stderr stream can finish before exit.
 * A failed stdout/stderr write is a runtime boundary failure (exit 3).
 * Stream error details are never written to the operator.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import {
  tryGetEmbeddedCapabilityTable,
  loadCapabilityTableFromTomlText,
} from "./vendor-preflight-embedded.js";
import {
  EXIT_BOUNDARY_FAILURE,
  MSG_CAPABILITY_TABLE_LOAD_FAILED,
  MSG_INTERNAL_FAILURE,
  finalizeSetupExitCode,
  resolveRepoRoot,
  runForemanSetup,
} from "./foreman-setup.js";

/** Sticky flag: any stdout/stderr failure becomes exit 3. */
let streamWriteFailed = false;

/**
 * Durable listeners: a late EPIPE after a write callback must not become an
 * unhandled 'error' crash (exit 1). Mark the stream broken instead.
 */
function armStream(stream: NodeJS.WriteStream): void {
  stream.on("error", () => {
    streamWriteFailed = true;
  });
}
armStream(process.stdout);
armStream(process.stderr);

/**
 * Write all of `text` to `stream`. Settles once from the write callback.
 * Synchronous throw and callback errors reject the promise and set
 * streamWriteFailed. Durable stream 'error' listeners above absorb late
 * EPIPE so the process does not crash with an unhandled error.
 */
function writeFully(
  stream: NodeJS.WriteStream,
  text: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (err: Error | null | undefined) => {
      if (settled) return;
      settled = true;
      if (err) {
        streamWriteFailed = true;
        reject(err);
      } else {
        resolve();
      }
    };
    try {
      stream.write(text, (err) => settle(err));
    } catch (err) {
      settle(err instanceof Error ? err : new Error("write_failed"));
    }
  });
}

const pending: Promise<void>[] = [];

function trackWrite(p: Promise<void>): void {
  // Mark handled early so a delayed settleExit cannot surface unhandledRejection;
  // Promise.all in finalizeSetupExitCode still observes the rejection.
  void p.catch(() => {
    streamWriteFailed = true;
  });
  pending.push(p);
}

const io = {
  writeStdout: (text: string) => {
    trackWrite(writeFully(process.stdout, text));
  },
  writeStderr: (text: string) => {
    trackWrite(writeFully(process.stderr, text));
  },
};
async function settleExit(domainExitCode: number): Promise<number> {
  const fromWrites = await finalizeSetupExitCode(domainExitCode, pending);
  if (streamWriteFailed) return EXIT_BOUNDARY_FAILURE;
  return fromWrites;
}

function loadCapabilityTable(repoRoot: string) {
  const embedded = tryGetEmbeddedCapabilityTable();
  if (embedded !== null) return embedded;
  const tomlPath = join(repoRoot, "env/reference-manifest.toml");
  const text = readFileSync(tomlPath, "utf8");
  return loadCapabilityTableFromTomlText(text);
}

const repoRoot = resolveRepoRoot(import.meta.url);

let table;
try {
  table = loadCapabilityTable(repoRoot);
} catch {
  // Fixed sanitized diagnostic only — never embed exception text.
  pending.push(
    writeFully(process.stderr, MSG_CAPABILITY_TABLE_LOAD_FAILED + "\n"),
  );
  process.exitCode = await settleExit(EXIT_BOUNDARY_FAILURE);
}

if (table !== undefined) {
  Effect.runPromise(
    runForemanSetup(process.argv, io, {
      repoRoot,
      capabilityTable: table,
    }),
  ).then(
    async (code) => {
      process.exitCode = await settleExit(code);
    },
    async () => {
      pending.push(writeFully(process.stderr, MSG_INTERNAL_FAILURE + "\n"));
      process.exitCode = await settleExit(EXIT_BOUNDARY_FAILURE);
    },
  );
}
