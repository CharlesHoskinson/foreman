/**
 * Compiled entry point for skills/foreman/runtime/dist/architecture-policy.js
 * Commands: check | verify-install | plugin-drift
 */
import { Effect } from "effect";
import { runArchitectureCli } from "./architecture-cli.js";
import { liveArchitectureGit } from "./architecture-git.js";
import {
  isInstallCommand,
  runInstallCli,
} from "./install-verify-cli.js";
import { liveInstallFs } from "./install-verify-fs.js";

const io = {
  writeStdout: (line: string) => {
    process.stdout.write(line);
  },
  writeStderr: (line: string) => {
    process.stderr.write(line);
  },
};

const program = isInstallCommand(process.argv)
  ? runInstallCli(process.argv, io).pipe(Effect.provide(liveInstallFs))
  : runArchitectureCli(process.argv, io, process.cwd()).pipe(
      Effect.provide(liveArchitectureGit),
    );

Effect.runPromise(program).then(
  (code) => {
    process.exit(code);
  },
  () => {
    if (isInstallCommand(process.argv)) {
      process.stdout.write(
        '{"_tag":"Failed","artifact":null,"reason":"internal_failed","schemaVersion":1}\n',
      );
    } else {
      process.stdout.write(
        '{"_tag":"Failed","base":null,"findings":[],"head":null,"legacyDebt":[],"mergeBase":null,"reason":"internal_failed","schemaVersion":1}\n',
      );
    }
    process.exit(1);
  },
);
