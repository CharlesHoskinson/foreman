/**
 * Test entry point wrapper: resolves each glob pattern with node's own glob
 * (never the shell's), rejects any pattern that selects zero files, then
 * runs node --test over the resolved patterns.
 *
 * Exists because the previous "test" script passed unquoted glob patterns
 * straight to npm's sh runner. dash has no globstar, so `**` narrows to a
 * single path segment; the moment any package grew a nested src/ test file,
 * sh pre-expanded that package's pattern to the one literal match and every
 * sibling non-nested test file in that package silently dropped out of the
 * run with no error (docs/evidence/w1/2026-08-08-ts-suite-audit.md, Claim 3).
 * Separately, node --test exits 0 over a pattern that selects zero files
 * (same doc, Claim 4). This wrapper closes both: patterns arrive here as
 * argv elements (quoted in package.json, so the shell never touches them),
 * and each one is required to match at least one file before node --test is
 * allowed to run at all.
 */
import { globSync } from "node:fs";
import { spawnSync } from "node:child_process";

function fail(msg: string): never {
  process.stderr.write("run-tests: " + msg + "\n");
  process.exit(1);
}

const patterns = process.argv.slice(2);

if (patterns.length === 0) {
  fail("no test glob patterns given");
}

const empty: string[] = [];
let totalMatches = 0;
for (const pattern of patterns) {
  const matches = globSync(pattern, { cwd: process.cwd() });
  if (matches.length === 0) {
    empty.push(pattern);
  }
  totalMatches += matches.length;
}

if (empty.length > 0) {
  fail(
    "the following pattern(s) selected zero test files:\n" +
      empty.map((p) => "  " + p).join("\n"),
  );
}

if (totalMatches === 0) {
  fail("zero test files selected across all " + patterns.length + " pattern(s)");
}

// node --test marks its own process (and any inherited-env child) with
// NODE_TEST_CONTEXT / NODE_TEST_WORKER_ID. If this wrapper is itself run
// from inside a node --test process (as scripts/run-tests.test.ts does, to
// exercise the wrapper as a positive/negative control), the child below
// would inherit those variables, and node --test would treat the launch as
// a recursive self-invocation, print a warning, and skip running any files
// entirely rather than failing loudly. Strip them so a nested invocation of
// this wrapper always runs the child suite for real.
const childEnv = { ...process.env };
delete childEnv.NODE_TEST_CONTEXT;
delete childEnv.NODE_TEST_WORKER_ID;

const result = spawnSync(
  process.execPath,
  ["--import", "tsx", "--test", ...patterns],
  { stdio: "inherit", env: childEnv },
);

if (result.error) {
  fail("failed to launch node --test: " + result.error.message);
}

if (result.signal) {
  fail("node --test terminated by signal " + result.signal);
}

process.exit(result.status ?? 1);
