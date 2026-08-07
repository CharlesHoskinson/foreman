/**
 * Bundled entry for tool-check.js — thin adapter target.
 *
 * Sets process.exitCode and never terminates via process.exit on the outcome
 * path, so a backpressured stdout/stderr stream can finish before exit.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import {
  tryGetEmbeddedCapabilityTable,
  loadCapabilityTableFromTomlText,
} from "./vendor-preflight-embedded.js";
import { resolveRepoRoot, runToolCheck } from "./tool-check-run.js";

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
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  pending.push(
    writeFully(process.stderr, `tool-check: capability table load failed: ${msg}\n`),
  );
  await Promise.all(pending).catch(() => undefined);
  process.exitCode = 2;
  // stop
}

if (table !== undefined) {
  Effect.runPromise(
    runToolCheck(process.argv, io, {
      repoRoot,
      capabilityTable: table,
    }),
  ).then(
    async (result) => {
      try {
        await Promise.all(pending);
      } catch {
        /* stream errors still set a definite exit code */
      }
      process.exitCode = result.exitCode;
    },
    async () => {
      pending.push(writeFully(process.stderr, "tool-check: internal failure\n"));
      try {
        await Promise.all(pending);
      } catch {
        /* ignore */
      }
      process.exitCode = 2;
    },
  );
}
