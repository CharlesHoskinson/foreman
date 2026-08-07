/**
 * Bundled entry for lane-supervise.js — thin adapter target.
 *
 * Uses the drained-output pattern from round-main.ts so a backpressured
 * stdout/stderr stream can finish the final line before the process ends.
 */

import { Effect } from "effect";
import { runSupervisorCli } from "./supervisor-cli.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

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

// Resolve skill root: runtime bundle lives at skills/foreman/runtime/dist/
// so skill root is two parents up from the directory containing this file
// when running from the tracked bundle; when running via tsx from source,
// fall back to FOREMAN_SKILL_ROOT or sibling layout.
function resolveSkillRoot(): string {
  if (
    typeof process.env["FOREMAN_SKILL_ROOT"] === "string" &&
    process.env["FOREMAN_SKILL_ROOT"].length > 0
  ) {
    return process.env["FOREMAN_SKILL_ROOT"];
  }
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // dist/ → runtime/ → skill root
    return join(here, "..", "..");
  } catch {
    return process.cwd();
  }
}

const skillRoot = resolveSkillRoot();

Effect.runPromise(
  runSupervisorCli(process.argv, io, {
    skillRoot,
    env: process.env,
  }),
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
      writeFully(process.stderr, "lane-supervise: internal failure\n"),
    );
    try {
      await Promise.all(pending);
    } catch {
      /* ignore */
    }
    process.exitCode = 1;
  },
);
