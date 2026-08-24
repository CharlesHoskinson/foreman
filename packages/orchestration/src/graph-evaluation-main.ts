import { lstatSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { buildGraphEvaluationReportV1 } from "./graph-evaluation.js";

const MAX_RUN_SET_BYTES = 16 * 1024 * 1024;
const USAGE = "usage: graph-evaluation report --run-set ABS\n";

function readBounded(path: string): Uint8Array {
  const before = lstatSync(path);
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.size > MAX_RUN_SET_BYTES
  ) {
    throw new Error("invalid file");
  }
  const bytes = readFileSync(path);
  const after = lstatSync(path);
  if (
    bytes.byteLength > MAX_RUN_SET_BYTES ||
    !after.isFile() ||
    after.isSymbolicLink() ||
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs
  ) {
    throw new Error("file changed");
  }
  return Uint8Array.from(bytes);
}

const args = process.argv.slice(2);
let exitCode = 0;
if (
  args.length !== 3 ||
  args[0] !== "report" ||
  args[1] !== "--run-set" ||
  args[2] === undefined ||
  !isAbsolute(args[2])
) {
  process.stderr.write(USAGE);
  exitCode = 64;
} else {
  try {
    const result = buildGraphEvaluationReportV1(readBounded(args[2]));
    if (result._tag === "Built") {
      process.stdout.write(result.reportBytes);
    } else {
      process.stderr.write("graph-evaluation: refused\n");
      exitCode = 1;
    }
  } catch {
    process.stderr.write("graph-evaluation: refused\n");
    exitCode = 1;
  }
}
process.exitCode = exitCode;
