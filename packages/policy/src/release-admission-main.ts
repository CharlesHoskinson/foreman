import { canonicalize } from "@foreman/core";
import { Effect } from "effect";

import {
  liveReleaseAdmissionCliServices,
  runReleaseAdmissionCli,
} from "./release-admission-cli.js";

const fallback = `${canonicalize({
  schemaVersion: 1,
  _tag: "EvidenceInvalid",
  reason: "git_resolution_failure",
})}\n`;

Effect.runPromise(
  runReleaseAdmissionCli(
    process.argv,
    {
      writeStdout: (line) => {
        process.stdout.write(line);
      },
      writeStderr: (line) => {
        process.stderr.write(line);
      },
    },
    liveReleaseAdmissionCliServices,
  ),
).then(
  (code) => {
    process.exitCode = code;
  },
  () => {
    process.stdout.write(fallback);
    process.exitCode = 1;
  },
);
