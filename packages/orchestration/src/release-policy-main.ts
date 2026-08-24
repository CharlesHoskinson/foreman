import { Effect } from "effect";
import {
  liveReleasePolicyServices,
  runReleasePolicyCli,
} from "./release-policy.js";

Effect.runPromise(
  runReleasePolicyCli(
    process.argv,
    {
      writeStdout: (text) => process.stdout.write(text),
      writeStderr: (text) => process.stderr.write(text),
    },
    liveReleasePolicyServices,
  ),
).then(
  (code) => { process.exitCode = code; },
  () => {
    process.stderr.write("release-policy: internal failure\n");
    process.exitCode = 1;
  },
);
