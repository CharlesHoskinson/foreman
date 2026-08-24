import { lstatSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { buildGraphContextV1, type GraphContextRoleV1 } from "./graph-context.js";

const MAX_GRAPH_BYTES = 32 * 1024 * 1024;
const MAX_METADATA_BYTES = 1024 * 1024;
const MAX_TASK_BYTES = 64 * 1024;
const USAGE =
  "usage: graph-context build --graph ABS --metadata ABS --task ABS --role implementer|auditor --budget INTEGER\n";

function readBounded(path: string, maxBytes: number): Uint8Array {
  const before = lstatSync(path);
  if (!before.isFile() || before.isSymbolicLink() || before.size > maxBytes) {
    throw new Error("invalid file");
  }
  const bytes = readFileSync(path);
  const after = lstatSync(path);
  if (
    bytes.byteLength > maxBytes ||
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

function parseArgv(argv: readonly string[]): {
  readonly graph: string;
  readonly metadata: string;
  readonly task: string;
  readonly role: GraphContextRoleV1;
  readonly budget: number;
} | null {
  const args = argv.slice(2);
  if (
    args.length !== 11 ||
    args[0] !== "build" ||
    args[1] !== "--graph" ||
    args[3] !== "--metadata" ||
    args[5] !== "--task" ||
    args[7] !== "--role" ||
    args[9] !== "--budget"
  ) {
    return null;
  }
  const graph = args[2];
  const metadata = args[4];
  const task = args[6];
  const role = args[8];
  const budgetText = args[10];
  if (
    graph === undefined ||
    metadata === undefined ||
    task === undefined ||
    !isAbsolute(graph) ||
    !isAbsolute(metadata) ||
    !isAbsolute(task) ||
    (role !== "implementer" && role !== "auditor") ||
    budgetText === undefined ||
    !/^[1-9][0-9]*$/u.test(budgetText)
  ) {
    return null;
  }
  const budget = Number(budgetText);
  if (!Number.isSafeInteger(budget)) return null;
  return { graph, metadata, task, role, budget };
}

let exitCode = 0;
const parsed = parseArgv(process.argv);
if (parsed === null) {
  process.stderr.write(USAGE);
  exitCode = 64;
} else {
  try {
    const taskText = new TextDecoder("utf-8", { fatal: true }).decode(
      readBounded(parsed.task, MAX_TASK_BYTES),
    );
    const result = buildGraphContextV1({
      graphBytes: readBounded(parsed.graph, MAX_GRAPH_BYTES),
      metadataBytes: readBounded(parsed.metadata, MAX_METADATA_BYTES),
      taskText,
      role: parsed.role,
      budgetTokens: parsed.budget,
    });
    if (result._tag === "Built") {
      process.stdout.write(result.blockBytes);
    } else if (result._tag === "NoContext") {
      process.stdout.write(`${result.marker}\n`);
    } else {
      process.stderr.write("graph-context: refused\n");
      exitCode = 1;
    }
  } catch {
    process.stderr.write("graph-context: refused\n");
    exitCode = 1;
  }
}
process.exitCode = exitCode;
