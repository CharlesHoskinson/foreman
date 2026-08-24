import { Effect } from "effect";
import { runReleaseAuthorityCli } from "./release-authority-cli.js";

void Effect.runPromise(
  runReleaseAuthorityCli(process.argv, {
    writeStdout: (text) => process.stdout.write(text),
    writeStderr: (text) => process.stderr.write(text),
  }),
).then(
  (code) => {
    process.exitCode = code;
  },
  () => {
    process.stderr.write("Foreman Release Authority: internal failure\n");
    process.exitCode = 1;
  },
);
