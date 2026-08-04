/**
 * Compiled entry point for skills/foreman/runtime/dist/architecture-policy.js
 */
import { Effect } from "effect";
import { runArchitectureCli } from "./architecture-cli.js";
import { liveArchitectureGit } from "./architecture-git.js";

const program = Effect.gen(function* () {
  return yield* runArchitectureCli(process.argv, {
    writeStdout: (line) => {
      process.stdout.write(line);
    },
    writeStderr: (line) => {
      process.stderr.write(line);
    },
  }, process.cwd());
}).pipe(Effect.provide(liveArchitectureGit));

Effect.runPromise(program).then(
  (code) => {
    process.exit(code);
  },
  () => {
    process.stdout.write(
      '{"_tag":"Failed","base":null,"findings":[],"head":null,"legacyDebt":[],"mergeBase":null,"reason":"internal_failed","schemaVersion":1}\n',
    );
    process.exit(1);
  },
);
