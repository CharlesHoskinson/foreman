import { Effect } from "effect";
import { openSync, closeSync } from "node:fs";
import { isCoreFailure, MAX_INPUT_BYTES, readFdBounded } from "@foreman/core";
import { runCli } from "./cli.js";
import { liveServices } from "./live-services.js";

function readStdinBounded(): Uint8Array {
  try {
    if (process.stdin.isTTY) {
      return new Uint8Array(0);
    }
    // Bound before retaining complete input (max+1 probe).
    const fd = openSync("/dev/stdin", "r");
    try {
      const r = readFdBounded(fd, MAX_INPUT_BYTES);
      if (isCoreFailure(r)) {
        // Signal oversize by returning a sentinel length the CLI rejects
        // via empty + we write Failed from outer if needed. Prefer throw path:
        if (r._tag === "OversizeInput") {
          process.stdout.write(
            '{"_tag":"Failed","reason":"oversize_input","schemaVersion":1}\n',
          );
          process.exit(1);
        }
        return new Uint8Array(0);
      }
      return r;
    } finally {
      closeSync(fd);
    }
  } catch {
    // Fallback: fd 0
    try {
      const r = readFdBounded(0, MAX_INPUT_BYTES);
      if (isCoreFailure(r)) {
        if (r._tag === "OversizeInput") {
          process.stdout.write(
            '{"_tag":"Failed","reason":"oversize_input","schemaVersion":1}\n',
          );
          process.exit(1);
        }
        return new Uint8Array(0);
      }
      return r;
    } catch {
      return new Uint8Array(0);
    }
  }
}

const program = Effect.gen(function* () {
  const stdinBytes = readStdinBounded();
  return yield* runCli(process.argv, stdinBytes, {
    writeStdout: (line) => {
      process.stdout.write(line);
    },
    writeStderr: (line) => {
      process.stderr.write(line);
    },
  });
}).pipe(Effect.provide(liveServices));

Effect.runPromise(program).then(
  (code) => {
    process.exit(code);
  },
  () => {
    process.stdout.write(
      '{"_tag":"Failed","reason":"internal_failed","schemaVersion":1}\n',
    );
    process.exit(1);
  },
);
