import { Effect } from "effect";
import { runPelCliFixture } from "../src/pel-cli-fixture-main.js";
process.exitCode = await Effect.runPromise(
  runPelCliFixture(process.argv.slice(2)),
);
