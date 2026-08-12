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
 * The seed (__golden__/seed.ndjson) is a fixed, hand-selected subset of the
 * live sidecar at /root/foreman/.foreman/session.ndjson -- the header, the
 * first 11 facts, five measurements (ids 3-7) and six obligations (ids 1-6,
 * including a blocked one), one session and the schema_meta row. It covers
 * all four entity kinds so the corpus is not blind to most of the CLI's
 * output (a reviewer proved this: replacing renderFreshness's entire per-row
 * template with garbage text still passed every case against the old,
 * facts-only seed). The subset is selected deterministically by position,
 * never randomly, and the live file itself is read only to build this
 * checked-in snapshot -- it is never copied wholesale and never modified.
 *
 * Five of the seed's measurement rows carry fields that are NOT verbatim
 * copies of the live row, and the divergence is not all the same kind:
 *   - ids 3, 5, 6 and 7: `measured_sha` is overridden to point at one of the
 *     two commits `workspace()` creates below (GOLDEN_BASE_SHA /
 *     GOLDEN_TOUCH_SHA), so that `measurementValidity()`'s git-diffing path
 *     runs against revisions that actually exist in the scratch repo instead
 *     of throwing. A live sha copied as-is would not resolve in a freshly
 *     `git init`'d repo, and the resulting `git rev-list` failure embeds
 *     git's own "fatal: ..." text into stdout -- exactly the kind of
 *     git-version-and-locale-sensitive third-party text this file exists to
 *     keep out of a golden (see the HEAD-commit note below for the same
 *     problem in miniature).
 *   - id 6: `scope_paths` is additionally changed from its live value to
 *     `src/measured-scope.txt`, the one file the BASE -> TOUCH commit pair
 *     actually modifies, so this row has real scratch-repo history to diff.
 *   - id 4: `measured_sha` is NOT remapped -- it is nulled outright. The
 *     live row's value
 *     (`4b549197bc390890414372ca072c0239d166fa64`) is simply discarded, not
 *     pointed at a scratch-repo commit.
 *   - id 5: `scope_paths` is likewise nulled outright, discarding the live
 *     value (`tools/ci-local.sh\nskills/foreman/scripts\nenv`) rather than
 *     remapping it to a scratch-repo path.
 * The id-4 and id-5 nullings are a different kind of change than the shape
 * remaps above: a null field never reaches git, so nothing about making
 * `measurementValidity()` resolve required them. They exist because they are
 * what produce this corpus's two `unknown` freshness verdicts -- so those
 * verdicts are synthesized, not observed in the live v1 sidecar. See
 * GOLDEN_BASE_SHA / GOLDEN_TOUCH_SHA.
 *
 * Three substitutions are applied to captured output before it is written or
 * compared, all narrowly targeted at values that are non-deterministic by
 * construction and would otherwise make every recorded fixture unreproducible
 * on the very next run:
 *   - the ephemeral workspace directory's absolute path (a fresh mkdtemp
 *     per test), which the CLI echoes verbatim into its own rehydrate/
 *     refresh stderr lines -> replaced with the literal token <WORKSPACE>.
 *   - the live wall-clock timestamp the CLI stamps into `recover`'s
 *     `recovered_at` / `at=` field via `nowIso()` (there is no clock
 *     injection in the CLI) -> replaced with the literal token <TS>. This
 *     mask is scoped as tightly as the text allows: to the `recovered_at`
 *     JSON key and, in the human-readable header, to the single
 *     "FOREMAN RECOVERY  head=...  at=..." line -- not a blanket
 *     `at=<ISO8601>` match over the whole output, which would also catch a
 *     fact or obligation statement that happens to contain that substring.
 *   - the scratch repo's own HEAD commit sha (`recover`'s `head_sha` / the
 *     header's `head=` field). `workspace()` gives HEAD a real commit so
 *     that `git rev-parse HEAD` and friends don't fail with git's own
 *     "ambiguous argument 'HEAD'" text on an empty repo, but that final
 *     commit is intentionally NOT given a pinned author/committer date (only
 *     a fixed message and identity, so it works on any host) -- so its sha
 *     is non-deterministic and is masked -> the literal token <HEAD>, scoped
 *     the same way as <TS> above.
 * Every other byte -- every fact, measurement and obligation's text and
 * fields, the one session, counts, error strings, formatting and exit codes
 * -- is compared exactly.
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
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sanitizedCheckpointEnv } from "./round-live-services.js";

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

// Fixed identity used for every commit `workspace()` makes. Real (well-
// formed, but plainly not a person) rather than blank, so nothing downstream
// that shells out to `git log`/`blame` chokes on an empty name or email.
const PROVENANCE_NAME = "Golden Oracle";
const PROVENANCE_EMAIL = "golden@example.invalid";

// The two provenance commits below are given a pinned author/committer date
// (unlike the final HEAD commit -- see the file-level doc comment), which
// makes their sha fully reproducible: a git commit object hashes its tree,
// parent(s), author and committer (name, email, date) and message, and none
// of those vary here. Recomputed independently twice on this host before
// being pinned; assert it below so a real drift (e.g. a git object-format
// change) fails loudly here instead of as a baffling git error deep inside
// measurementValidity().
const GOLDEN_BASE_SHA = "d5fb7a0263646c88cec57ef9eb771d49054bf2fe";
const GOLDEN_TOUCH_SHA = "2765ecaebc071a25f6ae1ad20d9e371aa6769a63";

/** One pinned-identity, pinned-date commit; returns its (deterministic) sha. */
function commitPinned(dir: string, message: string, epochSeconds: number): string {
  const when = `${epochSeconds} +0000`;
  // Every git invocation below runs on `sanitizedCheckpointEnv(process.env)`,
  // never bare `process.env`. Without that scrub, an ambient GIT_DIR (e.g.
  // exported by skills/foreman/scripts/lib/checkpoint.sh for a real foreman
  // session) redirects `add`/`commit`/`rev-parse` at whatever repo GIT_DIR
  // names instead of this scratch `dir` -- silently writing real commits
  // onto a real branch. Demonstrated, not theorised; see the file-level
  // comment's sibling note in `run()` below.
  const env = sanitizedCheckpointEnv(process.env);
  execFileSync(
    "git",
    ["-c", "core.autocrlf=false", "add", "-A"],
    { cwd: dir, env },
  );
  execFileSync(
    "git",
    ["-c", "core.autocrlf=false", "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", "commit", "-q", "-m", message],
    {
      cwd: dir,
      env: {
        ...env,
        GIT_AUTHOR_NAME: PROVENANCE_NAME,
        GIT_AUTHOR_EMAIL: PROVENANCE_EMAIL,
        GIT_AUTHOR_DATE: when,
        GIT_COMMITTER_NAME: PROVENANCE_NAME,
        GIT_COMMITTER_EMAIL: PROVENANCE_EMAIL,
        GIT_COMMITTER_DATE: when,
      },
    },
  );
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: dir,
    encoding: "utf8",
    env,
  }).trim();
}

/** A scratch repo seeded from the frozen v1 sidecar. */
function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "fm-golden-"));
  // Scrubbed for the same reason as commitPinned()'s git calls: an
  // ambient GIT_DIR/GIT_WORK_TREE would make `git init` "initialize" a repo
  // that already exists elsewhere instead of this fresh `dir`, and every
  // later git call in this function would then operate on that repo too.
  const env = sanitizedCheckpointEnv(process.env);
  execFileSync("git", ["init", "-q", "."], { cwd: dir, env });

  // Two deterministic commits give the seed's measurement rows (see
  // seed.ndjson and GOLDEN_BASE_SHA/GOLDEN_TOUCH_SHA above) a real, git-
  // resolvable history to be measured against: BASE precedes a change to
  // src/measured-scope.txt, TOUCH is that change. Every other measurement's
  // scope_paths names a path this repo's history never touches, so it reads
  // as fresh against either sha.
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "measured-scope.txt"), "v1\n", "utf8");
  const base = commitPinned(dir, "golden seed: base state", 1577836800);
  writeFileSync(join(dir, "src", "measured-scope.txt"), "v2\n", "utf8");
  const touch = commitPinned(dir, "golden seed: touch scope", 1577836801);
  assert.equal(
    base,
    GOLDEN_BASE_SHA,
    "provenance BASE commit sha drifted; update GOLDEN_BASE_SHA and the " +
      "measured_sha fields in seed.ndjson that reference it together",
  );
  assert.equal(
    touch,
    GOLDEN_TOUCH_SHA,
    "provenance TOUCH commit sha drifted; update GOLDEN_TOUCH_SHA and the " +
      "measured_sha fields in seed.ndjson that reference it together",
  );

  // A real HEAD commit, so `recover`'s head_sha is a real (masked) value
  // instead of git failing on an empty repo with its own "ambiguous
  // argument 'HEAD'" text -- see the file-level doc comment. Deliberately
  // NOT given a pinned date: only identity and message are fixed, which is
  // enough to work on any host; the resulting sha is masked, not frozen.
  execFileSync(
    "git",
    [
      "-c",
      `user.email=${PROVENANCE_EMAIL}`,
      "-c",
      `user.name=${PROVENANCE_NAME}`,
      "-c",
      "commit.gpgsign=false",
      "-c",
      "tag.gpgsign=false",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "golden seed: workspace head",
    ],
    { cwd: dir, env },
  );

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
    env: {
      // Scrubbed, not raw `process.env`: the CLI itself shells out to git
      // (gitSha(), measurement-validity's diffing) as a grandchild of this
      // process, and it inherits whatever env this spawnSync call gives it.
      // An ambient GIT_DIR/GIT_WORK_TREE (skills/foreman/scripts/lib/
      // checkpoint.sh exports exactly this for a real foreman session)
      // would redirect those grandchild git calls at a real repo, same as
      // commitPinned()/workspace() above.
      ...sanitizedCheckpointEnv(process.env),
      GOLDEN_UPDATE: "",
      // dbPath() (fm-session-main.ts) short-circuits on FOREMAN_SESSION_DB
      // before it ever looks at the scratch repo, and lane-run.sh exports
      // that variable for every foreman lane. Forwarding the parent
      // environment unpinned lets an ambient FOREMAN_SESSION_DB redirect
      // every case -- including the mutating `supersede` case -- at an
      // external path outside the workspace. Pin it here, the same way
      // tests/session.bats does, so the CLI can never see or touch
      // anything outside this disposable directory.
      FOREMAN_SESSION_DB: join(cwd, ".foreman", "session.db"),
    },
  });
}

/** Mask the known-nondeterministic substrings; leave everything else exact. */
function normalize(dir: string, text: string): string {
  let out = text.split(dir).join("<WORKSPACE>");
  // Scoped to the one line the CLI ever prints these two fields on
  // ("FOREMAN RECOVERY  head=<sha>  at=<ts>"), not a blanket match over the
  // whole output -- a fact or obligation statement containing a literal
  // `at=<ISO8601>` substring must not be silently masked too.
  out = out.replace(
    /^FOREMAN RECOVERY {2}head=[0-9a-f]{12} {2}at=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/m,
    "FOREMAN RECOVERY  head=<HEAD>  at=<TS>",
  );
  out = out.replace(
    /"recovered_at":\s*"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z"/,
    '"recovered_at": "<TS>"',
  );
  out = out.replace(/"head_sha":\s*"[0-9a-f]{12}"/, '"head_sha": "<HEAD>"');
  return out;
}

function golden(name: string, args: readonly string[]): void {
  const dir = workspace();
  let passed = false;
  try {
    const res = run(dir, args);
    const code = String(res.status ?? -1);
    const stdout = normalize(dir, res.stdout);
    const stderr = normalize(dir, res.stderr);

    if (UPDATE) {
      writeFileSync(join(GOLDEN, `${name}.out`), stdout, "utf8");
      writeFileSync(join(GOLDEN, `${name}.err`), stderr, "utf8");
      writeFileSync(join(GOLDEN, `${name}.exit`), `${code}\n`, "utf8");
      passed = true;
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
    passed = true;
  } finally {
    // Clean up only on success: a failing case's workspace is the diagnostic
    // evidence for why it failed, so leave it on disk rather than delete it
    // out from under whoever is about to go look.
    if (passed) rmSync(dir, { recursive: true, force: true });
  }
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

// Obligation 1 exists in the seed (see seed.ndjson), so this isolates the
// "unknown status accepted" defect from "nonexistent obligation accepted" --
// the two were conflated when the seed had no obligations at all and this
// case's target id was necessarily nonexistent too.
test("golden: close with an unknown status", () =>
  golden("close-unknown", ["close", "1", "--status", "nonsense"]));

// Seed measurements are 3,4,5,6,7 and none is superseded (see seed.ndjson).
// retire has no recorded defect, so these four must stay byte-identical
// through the cutover.
test("golden: retire a measurement", () =>
  golden("retire", ["retire", "3", "--by", "7", "--reason", "superseded by a fresh reading"]));

test("golden: retire refuses self-supersession", () =>
  golden("retire-self", ["retire", "3", "--by", "3", "--reason", "r"]));

test("golden: retire refuses a missing target", () =>
  golden("retire-missing-target", ["retire", "9999", "--by", "7", "--reason", "r"]));

test("golden: retire refuses a missing superseder", () =>
  golden("retire-missing-by", ["retire", "3", "--by", "9999", "--reason", "r"]));

// KNOWN DEFECT, frozen deliberately. Fact 16 is already superseded by 32 in the
// seed. Today the legacy path overwrites that pointer; supersession is meant to
// be set-once. Task 7 changes this to a refusal and re-records this golden in
// the same commit.
test("golden: supersede an already-superseded fact", () =>
  golden("supersede-superseded", ["supersede", "16", "replacement", "--reason", "r"]));

// KNOWN DEFECT, frozen deliberately. Obligation 7 is already done in the seed.
// Today the legacy path closes it again and wipes its blocker. Task 6 changes
// this to a refusal and re-records this golden in the same commit.
test("golden: close an already-done obligation", () =>
  golden("close-done", ["close", "7", "--status", "done"]));
