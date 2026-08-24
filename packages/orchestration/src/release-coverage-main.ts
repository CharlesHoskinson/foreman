import { Effect } from "effect";
import { canonicalize } from "@foreman/core";
import {
  liveReleaseCoverageCliServices,
  runReleaseCoverageCli,
} from "./release-coverage-cli.js";

const io = {
  writeStdout: (text: string) => {
    process.stdout.write(text);
  },
  writeStderr: (text: string) => {
    process.stderr.write(text);
  },
};

const dependencyFailureLine = `${canonicalize({
  schemaVersion: 1,
  _tag: "Invalid",
  reason: "dependency_failure",
})}\n`;

Effect.runPromise(
  runReleaseCoverageCli(process.argv, io, liveReleaseCoverageCliServices),
).then(
  (code) => {
    process.exitCode = code;
  },
  () => {
    process.stdout.write(dependencyFailureLine);
    process.exitCode = 1;
  },
);
