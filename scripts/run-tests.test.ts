/**
 * Positive/negative controls for scripts/run-tests.ts, the test-entry-point
 * wrapper that closed two accountability defects measured in
 * docs/evidence/w1/2026-08-08-ts-suite-audit.md:
 *
 *  - Claim 4: node --test exits 0 over a pattern that selects zero files.
 *    The negative-control test below requires the wrapper to reject that
 *    with a non-zero exit and a message naming the empty pattern.
 *  - Claim 3: unquoted glob patterns let sh pre-expand a package's pattern
 *    to a single literal path the moment a nested src/ test file exists,
 *    silently dropping every sibling non-nested test file from the run.
 *    The regression-control test below reproduces that exact shape (two
 *    top-level sibling files plus one nested file) against the real
 *    wrapper and requires all three to run.
 *
 * Fixtures live under a mkdtemp'd directory and are addressed by absolute
 * glob pattern so this file's own cwd (the repo root, required for the
 * wrapper's "--import tsx" to resolve) never has to change.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const runTestsScript = join(scriptsDir, "run-tests.ts");

const PASSING_FIXTURE = (label: string) =>
  'import { test } from "node:test";\n' +
  'import assert from "node:assert/strict";\n' +
  'test("' + label + '", () => { assert.equal(1, 1); });\n';

function runWrapper(patterns: string[]) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", runTestsScript, ...patterns],
    { encoding: "utf8" },
  );
}

test("run-tests: negative control - a pattern selecting zero files fails loudly", () => {
  const dir = mkdtempSync(join(tmpdir(), "run-tests-neg-"));
  try {
    const pattern = join(dir, "nonexistent-*.test.ts");
    const result = runWrapper([pattern]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /selected zero test files/);
    assert.ok(result.stderr.includes(pattern));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("run-tests: positive control - a pattern selecting a real file runs it and exits 0", () => {
  const dir = mkdtempSync(join(tmpdir(), "run-tests-pos-"));
  try {
    writeFileSync(join(dir, "ok.test.ts"), PASSING_FIXTURE("positive control passes"));
    const result = runWrapper([join(dir, "*.test.ts")]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /positive control passes/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("run-tests: regression control - a nested test file does not hide its siblings", () => {
  const dir = mkdtempSync(join(tmpdir(), "run-tests-nest-"));
  try {
    writeFileSync(join(dir, "sibling-a.test.ts"), PASSING_FIXTURE("sibling a runs"));
    writeFileSync(join(dir, "sibling-b.test.ts"), PASSING_FIXTURE("sibling b runs"));
    mkdirSync(join(dir, "sub"));
    writeFileSync(join(dir, "sub", "nested.test.ts"), PASSING_FIXTURE("nested file runs"));

    const result = runWrapper([join(dir, "**", "*.test.ts")]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /sibling a runs/);
    assert.match(result.stdout, /sibling b runs/);
    assert.match(result.stdout, /nested file runs/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
