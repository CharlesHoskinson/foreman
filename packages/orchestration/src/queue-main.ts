/**
 * Bundled entry for lane-queue.js — thin adapter target.
 */

import { Effect } from "effect";
import { runQueueCli } from "./queue-cli.js";
import { liveQueueServices } from "./queue-services.js";

const io = {
  writeStdout: (text: string) => {
    process.stdout.write(text);
  },
  writeStderr: (text: string) => {
    process.stderr.write(text);
  },
};

const program = runQueueCli(process.argv, io).pipe(
  Effect.provide(liveQueueServices),
);

Effect.runPromise(program).then(
  (code) => {
    process.exit(code);
  },
  () => {
    process.stderr.write("lane-queue: internal failure\n");
    process.exit(1);
  },
);
