import { Effect } from "effect";
import { runEndstopCli } from "./execution-guard-cli.js";

const program = runEndstopCli(process.argv, {
  writeStdout: (text) => process.stdout.write(text),
  writeStderr: (text) => process.stderr.write(text),
});

Effect.runPromise(program).then(
  (code) => process.exit(code),
  () => {
    process.stderr.write("Foreman Endstop: internal failure\n");
    process.exit(1);
  },
);
