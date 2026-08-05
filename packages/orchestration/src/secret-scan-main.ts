/**
 * Bundled entry for secret-scan.js — thin CLI adapter target.
 */

import { Effect } from "effect";
import { liveSecretScan, runSecretScanCli } from "./secret-scan.js";

const io = {
  writeStdout: (text: string) => {
    process.stdout.write(text);
  },
  writeStderr: (text: string) => {
    process.stderr.write(text);
  },
};

const program = runSecretScanCli(process.argv, io).pipe(
  Effect.provide(liveSecretScan),
);

Effect.runPromise(program).then(
  (code) => {
    process.exit(code);
  },
  () => {
    process.stderr.write("secret-scan: internal failure\n");
    process.exit(1);
  },
);
