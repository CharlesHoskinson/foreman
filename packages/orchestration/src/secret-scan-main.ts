/**
 * Bundled entry for secret-scan.js — thin CLI adapter target.
 * Always emits exactly one canonical JSON line; never plain-text leaks.
 */

import { Effect } from "effect";
import {
  EXIT_NOT_CLEAN,
  liveSecretScan,
  renderSecretScanJson,
  runSecretScanCli,
} from "./secret-scan.js";

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
    // Fail closed with the same canonical JSON shape as every other refusal.
    // Do not emit stacks, paths, exception text, or environment content.
    process.stdout.write(
      renderSecretScanJson({
        _tag: "Refused",
        reason: "unsupported_traversal",
      }) + "\n",
    );
    process.exit(EXIT_NOT_CLEAN);
  },
);
