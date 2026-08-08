/**
 * repo-hygiene — refuse the document debt that accumulated through v0.2.9.
 *
 * TypeScript port of the former `tools/repo-hygiene.sh`, which is now a thin
 * adapter. Every rule is preserved verbatim, including its message text, and
 * one capability is added that the shell version promised but could not
 * implement: a declaration for a deliberate file-mode change (rule 5).
 *
 * Each rule exists because the thing it forbids actually happened and cost real
 * time. None is a style preference.
 *
 *   1. Root markdown allowlist. Two lane artifacts were committed to the
 *      repository root, so every worktree checkout contained them, and a sweep
 *      of 18 worktree roots copied them out as if lane-local — one template
 *      checked in 16 times, 27 redundant files. The root is what arms that gun.
 *   2. No state-document sprawl. Four resume/checkpoint documents accumulated
 *      at root, all disagreeing; the undated one read as canonical and named a
 *      branch dead for days. Status belongs in the session store.
 *   3. No byte-identical duplicates under docs/evidence. Archives are sacred;
 *      copies of archives are not archives.
 *   4. No root file byte-identical to one under docs/. That is rule 1's failure
 *      mode caught from the other side.
 *   5. No file-mode regression against the base branch.
 *
 * Exit 0 = clean. Exit 1 = violations, itemised. Exit 2 = cannot run.
 */

import { spawnSync } from "node:child_process";
import { openSync, readSync, closeSync } from "node:fs";

export const EXIT_CLEAN = 0;
export const EXIT_VIOLATIONS = 1;
export const EXIT_CANNOT_RUN = 2;

/**
 * Markdown permitted at the repository root. Everything else belongs under
 * docs/. Keep this list SHORT — each entry is a claim that the file is a
 * doctrine document or a canonical ledger, not a work product.
 * AGENTS.md is repository doctrine. typescriptmigration.md is the canonical
 * post-v0.2.8.2 migration checklist.
 */
export const ALLOWED_ROOT_MD: readonly string[] = [
  "README.md",
  "CLAUDE.md",
  "AGENTS.md",
  "ROADMAP.md",
  "RESUME.md",
  "AGENT_TRAPS.md",
  "bugeventlog.md",
  // The incident ledger's forward-looking sibling: bugeventlog.md records what
  // already went wrong, brokenwindows.md records what is known-broken and
  // unclaimed. It sits at the root for the same reason bugeventlog.md and
  // AGENT_TRAPS.md do — a cold reader must find it without knowing to look.
  "brokenwindows.md",
  "checklist.md",
  "typescriptmigration.md",
];

/**
 * Deliberate file-mode changes, each with the reason it is not a regression.
 *
 * Rule 5 compares against the base branch, so a *correct* mode fix on a branch
 * reads as a violation until it merges. The shell version's failure text said
 * "if deliberate, say so" while providing nowhere to say it, so the only way to
 * pass was to revert the correct fix. Adding the declaration there was rejected
 * by the architecture policy as `legacy_adapter_domain_logic` — new logic may
 * not enter a legacy POSIX shell file. It lives here instead.
 *
 * An entry suppresses the violation and reports INFO. It never suppresses any
 * other rule.
 */
export const ALLOWED_MODE_CHANGES: readonly {
  readonly path: string;
  readonly reason: string;
}[] = [
  {
    path: "openspec/changes/graph-store-port/tasks.md",
    reason:
      "8a5900f cleared a spurious executable bit from a markdown file; the fix is the change rule 5 flags",
  },
];

export type HygieneSnapshot = {
  /** Tracked paths, repo-relative, forward slashes. */
  readonly trackedMarkdownRoot: readonly string[];
  /** `docs/*` and `*.md` tracked paths with their stored blob object ids. */
  readonly hashedPaths: readonly { readonly path: string; readonly oid: string }[];
  /** Base ref that resolved, or null when none did. */
  readonly base: string | null;
  /** Paths changed between base and HEAD. Empty when base is null. */
  readonly changedPaths: readonly string[];
  /** Mode at base per path; absent means the path is new on this branch. */
  readonly baseModes: ReadonlyMap<string, string>;
  /** Mode in the index per path; absent means deleted on this branch. */
  readonly headModes: ReadonlyMap<string, string>;
  /** True when the worktree file begins with `#!`. Consulted for new files. */
  readonly hasShebang: (path: string) => boolean;
};

export type HygieneLine =
  | { readonly kind: "violation"; readonly text: string }
  | { readonly kind: "info"; readonly text: string };

export type HygieneReport = {
  readonly lines: readonly HygieneLine[];
  readonly violations: number;
  readonly exitCode: number;
};

function isRootPath(path: string): boolean {
  return !path.includes("/");
}

/** Rules 1 and 2 both read tracked root markdown. */
function checkRootMarkdown(
  snapshot: HygieneSnapshot,
  push: (line: HygieneLine) => void,
): void {
  const allowed = new Set(ALLOWED_ROOT_MD);
  for (const f of snapshot.trackedMarkdownRoot) {
    if (allowed.has(f)) continue;
    push({
      kind: "violation",
      text:
        `root markdown not in the allowlist: ${f} -- move it under docs/, or ` +
        `add it to ALLOWED_ROOT_MD in packages/policy/src/repo-hygiene.ts with a reason`,
    });
  }

  // RESUME.md itself is allowed by rule 1; what is banned is a SECOND one, and
  // any dated snapshot beside it.
  const sprawl = /^(RESUME|CHECKPOINT|STATE)[^/]*\.md$/;
  for (const f of snapshot.trackedMarkdownRoot) {
    if (f === "RESUME.md") continue;
    if (!sprawl.test(f)) continue;
    push({
      kind: "violation",
      text:
        `state-document sprawl: ${f} -- there is exactly one RESUME.md and it ` +
        `carries no status; put status in the session store and history in devlog/`,
    });
  }
}

/** Rule 3: duplicate content under docs/evidence. */
function checkEvidenceDuplicates(
  snapshot: HygieneSnapshot,
  push: (line: HygieneLine) => void,
): void {
  const byOid = new Map<string, string[]>();
  for (const { path, oid } of snapshot.hashedPaths) {
    const list = byOid.get(oid);
    if (list) list.push(path);
    else byOid.set(oid, [path]);
  }
  const seen = new Set<string>();
  for (const { path, oid } of snapshot.hashedPaths) {
    if (!path.startsWith("docs/evidence/")) continue;
    if (seen.has(oid)) continue;
    const paths = byOid.get(oid)!;
    const evidenceCount = paths.filter((p) =>
      p.startsWith("docs/evidence/"),
    ).length;
    if (evidenceCount < 2) continue;
    seen.add(oid);
    push({
      kind: "violation",
      text:
        `duplicate content under docs/evidence: ${paths.join(" ")} -- ` +
        `keep one canonical copy and reference it`,
    });
  }
}

/** Rule 4: a root file byte-identical to one under docs/. */
function checkRootDuplicatesDocs(
  snapshot: HygieneSnapshot,
  push: (line: HygieneLine) => void,
): void {
  const docsByOid = new Map<string, string[]>();
  for (const { path, oid } of snapshot.hashedPaths) {
    if (!path.startsWith("docs/")) continue;
    const list = docsByOid.get(oid);
    if (list) list.push(path);
    else docsByOid.set(oid, [path]);
  }
  for (const { path, oid } of snapshot.hashedPaths) {
    if (!isRootPath(path)) continue;
    const match = docsByOid.get(oid);
    if (!match || match.length === 0) continue;
    push({
      kind: "violation",
      text:
        `root file duplicates documentation: ${path} is byte-identical to ` +
        `${match.join(" ")} -- delete the root copy`,
    });
  }
}

/**
 * Rule 5: file-mode regression against the base branch.
 *
 * Deliberately a REGRESSION check, not an absolute rule. "A file with a shebang
 * must be executable" sounds right and is wrong here: 105 of 189 tracked
 * shebang files are correctly 100644, because .bats files are run by bats
 * rather than executed. Asserting the absolute form would reproduce the
 * documented failure where a hand re-derivation flagged 42 files against the
 * real checker's one, by ignoring exclusions the real checker documents.
 */
function checkModeRegression(
  snapshot: HygieneSnapshot,
  push: (line: HygieneLine) => void,
): void {
  if (snapshot.base === null) {
    // Absence of a base is reported, never silently treated as clean: a
    // diagnostic that cannot say "I did not run" is the same defect as one that
    // cannot fail.
    push({
      kind: "info",
      text:
        "mode-regression check SKIPPED: no base ref " +
        "(tried FOREMAN_HYGIENE_BASE, origin/main, main)",
    });
    return;
  }

  const declared = new Map(
    ALLOWED_MODE_CHANGES.map((e) => [e.path, e.reason] as const),
  );

  for (const f of snapshot.changedPaths) {
    const headMode = snapshot.headModes.get(f);
    if (headMode === undefined) continue; // deleted on this branch
    const baseMode = snapshot.baseModes.get(f);

    if (baseMode === undefined) {
      // NEW file: there is no base mode to regress from, so the rule above is
      // blind to it. Reported, not failed. The authoritative inventory lives in
      // tests/line-endings.bats, which encodes exclusions this cannot see.
      if (
        headMode !== "100755" &&
        !f.endsWith(".bats") &&
        snapshot.hasShebang(f)
      ) {
        push({
          kind: "info",
          text:
            `new file has a shebang and is not executable: ${f} (${headMode}) ` +
            `-- run via an interpreter on purpose, or missing ` +
            `git update-index --chmod=+x? tests/line-endings.bats is the authority.`,
        });
      }
      continue;
    }

    if (baseMode === headMode) continue;

    const reason = declared.get(f);
    if (reason !== undefined) {
      push({
        kind: "info",
        text:
          `declared mode change: ${f} ${baseMode} -> ${headMode} ` +
          `(ALLOWED_MODE_CHANGES: ${reason})`,
      });
      continue;
    }

    push({
      kind: "violation",
      text:
        `file mode changed vs ${snapshot.base}: ${f} ${baseMode} -> ${headMode} ` +
        `-- if deliberate, add it to ALLOWED_MODE_CHANGES in ` +
        `packages/policy/src/repo-hygiene.ts with a reason; if not, ` +
        `git update-index --chmod=+x`,
    });
  }
}

/** Pure evaluation over a captured snapshot. No IO. */
export function evaluateRepoHygiene(snapshot: HygieneSnapshot): HygieneReport {
  const lines: HygieneLine[] = [];
  const push = (line: HygieneLine): void => {
    lines.push(line);
  };

  checkRootMarkdown(snapshot, push);
  checkEvidenceDuplicates(snapshot, push);
  checkRootDuplicatesDocs(snapshot, push);
  checkModeRegression(snapshot, push);

  const violations = lines.filter((l) => l.kind === "violation").length;
  return {
    lines,
    violations,
    exitCode: violations > 0 ? EXIT_VIOLATIONS : EXIT_CLEAN,
  };
}

/** Render exactly the shell version's output for a report. */
export function renderRepoHygiene(report: HygieneReport): string {
  let out = "";
  for (const line of report.lines) {
    out +=
      line.kind === "violation"
        ? `VIOLATION ${line.text}\n`
        : `INFO  ${line.text}\n`;
  }
  if (report.violations > 0) {
    out += `\nREPO HYGIENE FAILED: ${report.violations} violation(s).\n`;
    return out;
  }
  out +=
    "repo-hygiene: clean (root allowlist, no state sprawl, no duplicate evidence)\n";
  return out;
}

// ---------------------------------------------------------------------------
// Live capture
// ---------------------------------------------------------------------------

const MAX_GIT_OUTPUT_BYTES = 64 * 1024 * 1024;

export class RepoHygieneCaptureError {
  readonly _tag = "RepoHygieneCaptureError";
  constructor(readonly message: string) {}
}

function git(repoRoot: string, args: readonly string[]): string {
  const r = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "buffer",
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
  });
  if (r.error) throw new RepoHygieneCaptureError(`git ${args[0]} failed to run`);
  if (r.status !== 0) {
    throw new RepoHygieneCaptureError(
      `git ${args[0]} exited ${String(r.status)}`,
    );
  }
  return r.stdout.toString("utf8");
}

function gitStatus(repoRoot: string, args: readonly string[]): number {
  const r = spawnSync("git", args, { cwd: repoRoot, stdio: "ignore" });
  if (r.error) throw new RepoHygieneCaptureError("git failed to run");
  return r.status ?? 1;
}

/** `git ls-files -s` lines: `<mode> <oid> <stage>\t<path>`. */
function parseLsFilesStage(
  text: string,
): { path: string; mode: string; oid: string }[] {
  const out: { path: string; mode: string; oid: string }[] = [];
  for (const raw of text.split("\0")) {
    if (!raw) continue;
    const tab = raw.indexOf("\t");
    if (tab < 0) continue;
    const meta = raw.slice(0, tab).split(/\s+/);
    const path = raw.slice(tab + 1);
    if (meta.length < 3 || !path) continue;
    out.push({ mode: meta[0]!, oid: meta[1]!, path });
  }
  return out;
}

/** `git ls-tree -r` lines: `<mode> <type> <oid>\t<path>`. */
function parseLsTree(text: string): Map<string, string> {
  const modes = new Map<string, string>();
  for (const raw of text.split("\0")) {
    if (!raw) continue;
    const tab = raw.indexOf("\t");
    if (tab < 0) continue;
    const meta = raw.slice(0, tab).split(/\s+/);
    const path = raw.slice(tab + 1);
    if (meta.length < 3 || !path) continue;
    modes.set(path, meta[0]!);
  }
  return modes;
}

function fileStartsWithShebang(repoRoot: string, path: string): boolean {
  let fd: number;
  try {
    fd = openSync(`${repoRoot}/${path}`, "r");
  } catch {
    return false;
  }
  try {
    const buf = Buffer.alloc(2);
    const n = readSync(fd, buf, 0, 2, 0);
    return n === 2 && buf[0] === 0x23 && buf[1] === 0x21;
  } catch {
    return false;
  } finally {
    try {
      closeSync(fd);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Capture the snapshot with a bounded number of git invocations.
 *
 * The shell version hashed each worktree file with `git hash-object`. This
 * reads the index object id instead, in one call: the comment there said the
 * hash is taken from git's own object database "so it agrees with what the
 * repository actually stores", and the index id is exactly that, without N
 * subprocesses.
 */
export function captureRepoHygieneSnapshot(
  repoRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): HygieneSnapshot {
  const staged = parseLsFilesStage(
    git(repoRoot, ["ls-files", "-s", "-z", "--", "docs/*", "*.md"]),
  );
  const headModes = new Map<string, string>();
  const hashedPaths: { path: string; oid: string }[] = [];
  for (const e of staged) {
    hashedPaths.push({ path: e.path, oid: e.oid });
  }
  for (const e of parseLsFilesStage(git(repoRoot, ["ls-files", "-s", "-z"]))) {
    headModes.set(e.path, e.mode);
  }

  const trackedMarkdownRoot = hashedPaths
    .map((e) => e.path)
    .filter((p) => isRootPath(p) && p.endsWith(".md"))
    .sort();

  let base: string | null = null;
  for (const candidate of [env.FOREMAN_HYGIENE_BASE, "origin/main", "main"]) {
    if (!candidate) continue;
    if (gitStatus(repoRoot, ["rev-parse", "--verify", "--quiet", candidate]) === 0) {
      base = candidate;
      break;
    }
  }

  let changedPaths: string[] = [];
  let baseModes = new Map<string, string>();
  if (base !== null) {
    changedPaths = git(repoRoot, ["diff", "--name-only", "-z", `${base}...HEAD`])
      .split("\0")
      .filter((p) => p.length > 0);
    baseModes = parseLsTree(git(repoRoot, ["ls-tree", "-r", "-z", base]));
  }

  return {
    trackedMarkdownRoot,
    hashedPaths,
    base,
    changedPaths,
    baseModes,
    headModes,
    hasShebang: (p) => fileStartsWithShebang(repoRoot, p),
  };
}

export type RepoHygieneIo = {
  readonly writeStdout: (text: string) => void;
  readonly writeStderr: (text: string) => void;
};

export function runRepoHygiene(repoRoot: string, io: RepoHygieneIo): number {
  let snapshot: HygieneSnapshot;
  try {
    snapshot = captureRepoHygieneSnapshot(repoRoot);
  } catch (e) {
    const msg =
      e instanceof RepoHygieneCaptureError ? e.message : "cannot inspect repository";
    io.writeStderr(`ERROR ${msg}\n`);
    return EXIT_CANNOT_RUN;
  }
  const report = evaluateRepoHygiene(snapshot);
  io.writeStdout(renderRepoHygiene(report));
  return report.exitCode;
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

const isEntry = (() => {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  return (
    argv1.endsWith("repo-hygiene.js") || argv1.endsWith("repo-hygiene.ts")
  );
})();

if (isEntry) {
  const repoRoot = process.cwd();
  const code = runRepoHygiene(repoRoot, {
    writeStdout: (t) => {
      process.stdout.write(t);
    },
    writeStderr: (t) => {
      process.stderr.write(t);
    },
  });
  process.exitCode = code;
}
