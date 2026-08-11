/**
 * Golden oracle for the fm-session CLI.
 *
 * Freezes exact stdout, stderr and exit code for a fixed command corpus.
 * session.bats asserts shapes; this asserts values, so a change to a printed
 * number fails here and nowhere else.
 *
 * Record or re-record with GOLDEN_UPDATE=1. Re-recording is a deliberate act:
 * review the fixture diff before committing it.
 *
 * Two substitutions are applied to captured output before it is written or
 * compared, both narrowly targeted at values that are non-deterministic by
 * construction and would otherwise make every recorded fixture unreproducible
 * on the very next run:
 *   - the ephemeral workspace directory's absolute path (a fresh mkdtemp
 *     per test), which the CLI echoes verbatim into its own rehydrate/
 *     refresh stderr lines -> replaced with the literal token <WORKSPACE>.
 *   - the live wall-clock timestamp the CLI stamps into `recover`'s
 *     `recovered_at` / `at=` field via `nowIso()` (there is no clock
 *     injection in the CLI) -> replaced with the literal token <TS>.
 * Every other byte -- all 11 facts' text, evidence and established_ts,
 * counts, error strings, formatting and exit codes -- is compared exactly.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN = join(HERE, "__golden__");
const ENTRY = join(HERE, "fm-session-main.ts");
const UPDATE = process.env["GOLDEN_UPDATE"] === "1";

// `--import tsx` resolves the bare specifier "tsx" against the child's cwd,
// which is a freshly mkdtemp'd workspace with no node_modules of its own.
// Resolve tsx's loader entrypoint once, from this file's own location (part
// of the npm workspace, so it sees the root node_modules), and pass the
// resolved absolute path instead of the bare specifier.
const TSX_LOADER = createRequire(import.meta.url).resolve("tsx");

/** A scratch repo seeded from the frozen v1 sidecar. */
function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "fm-golden-"));
  execFileSync("git", ["init", "-q", "."], { cwd: dir });
  mkdirSync(join(dir, ".foreman"), { recursive: true });
  copyFileSync(join(GOLDEN, "seed.ndjson"), join(dir, ".foreman", "session.ndjson"));
  // No explicit `import-sidecar` here: fm-session-main.ts's `connect()` path
  // (rebuildFromSidecarIfEmpty) auto-imports .foreman/session.ndjson the
  // first time any command connects to an empty store. An explicit call
  // here would need a positional sidecar path (the bare `import-sidecar`
  // form throws, not this workspace's fault) and, once given one, would
  // race the auto-rehydrate and refuse with "target store already has
  // rows" on the second import into the now-nonempty store.
  return dir;
}

/** Run the CLI from source. tsx keeps this honest against an unbuilt bundle. */
function run(cwd: string, args: readonly string[]) {
  return spawnSync(process.execPath, ["--import", TSX_LOADER, ENTRY, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GOLDEN_UPDATE: "" },
  });
}

/** Mask the two known-nondeterministic substrings; leave everything else exact. */
function normalize(dir: string, text: string): string {
  let out = text.split(dir).join("<WORKSPACE>");
  out = out.replace(/at=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/g, "at=<TS>");
  out = out.replace(
    /"recovered_at":\s*"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z"/g,
    '"recovered_at": "<TS>"',
  );
  return out;
}

function golden(name: string, args: readonly string[]): void {
  const dir = workspace();
  const res = run(dir, args);
  const code = String(res.status ?? -1);
  const stdout = normalize(dir, res.stdout);
  const stderr = normalize(dir, res.stderr);

  if (UPDATE) {
    writeFileSync(join(GOLDEN, `${name}.out`), stdout, "utf8");
    writeFileSync(join(GOLDEN, `${name}.err`), stderr, "utf8");
    writeFileSync(join(GOLDEN, `${name}.exit`), `${code}\n`, "utf8");
    return;
  }

  const outPath = join(GOLDEN, `${name}.out`);
  assert.ok(
    existsSync(outPath),
    `no golden recorded for ${name}; run with GOLDEN_UPDATE=1`,
  );
  assert.equal(stdout, readFileSync(outPath, "utf8"), `${name}: stdout drifted`);
  assert.equal(
    stderr,
    readFileSync(join(GOLDEN, `${name}.err`), "utf8"),
    `${name}: stderr drifted`,
  );
  assert.equal(
    `${code}\n`,
    readFileSync(join(GOLDEN, `${name}.exit`), "utf8"),
    `${name}: exit code drifted`,
  );
}

test("golden: recover", () => golden("recover", ["recover"]));
test("golden: recover --json", () => golden("recover-json", ["recover", "--json"]));
test("golden: freshness", () => golden("freshness", ["freshness"]));

// KNOWN DEFECT, frozen deliberately. Today this exits 0 and reports success for
// a fact that does not exist, inserting an orphan row. Task 6 changes it to a
// non-zero exit; re-record this golden in the same commit that changes the
// behaviour, never before and never on its own.
test("golden: supersede a missing fact", () =>
  golden("supersede-missing", ["supersede", "9999", "replacement", "--reason", "r"]));

test("golden: close with an unknown status", () =>
  golden("close-unknown", ["close", "1", "--status", "nonsense"]));
