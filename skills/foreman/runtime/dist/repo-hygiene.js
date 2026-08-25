// packages/policy/src/repo-hygiene.ts
import { spawnSync } from "node:child_process";
import { openSync, readSync, closeSync } from "node:fs";
var EXIT_CLEAN = 0;
var EXIT_VIOLATIONS = 1;
var EXIT_CANNOT_RUN = 2;
var ALLOWED_ROOT_MD = [
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
  "typescriptmigration.md"
];
var ALLOWED_MODE_CHANGES = [
  {
    path: "openspec/changes/graph-store-port/tasks.md",
    reason: "8a5900f cleared a spurious executable bit from a markdown file; the fix is the change rule 5 flags"
  },
  {
    path: "openspec/changes/graph-eval-falsification/design.md",
    reason: "v0.4 clears a spurious executable bit from the graph-evaluation design document"
  },
  {
    path: "openspec/changes/graph-eval-falsification/proposal.md",
    reason: "v0.4 clears a spurious executable bit from the graph-evaluation proposal document"
  },
  {
    path: "openspec/changes/graph-eval-falsification/specs/evaluation/spec.md",
    reason: "v0.4 clears a spurious executable bit from the graph-evaluation specification document"
  },
  {
    path: "openspec/changes/graph-eval-falsification/tasks.md",
    reason: "v0.4 clears a spurious executable bit from the graph-evaluation task document"
  }
];
function isRootPath(path) {
  return !path.includes("/");
}
function checkRootMarkdown(snapshot, push) {
  const allowed = new Set(ALLOWED_ROOT_MD);
  for (const f of snapshot.trackedMarkdownRoot) {
    if (allowed.has(f)) continue;
    push({
      kind: "violation",
      text: `root markdown not in the allowlist: ${f} -- move it under docs/, or add it to ALLOWED_ROOT_MD in packages/policy/src/repo-hygiene.ts with a reason`
    });
  }
  const sprawl = /^(RESUME|CHECKPOINT|STATE)[^/]*\.md$/;
  for (const f of snapshot.trackedMarkdownRoot) {
    if (f === "RESUME.md") continue;
    if (!sprawl.test(f)) continue;
    push({
      kind: "violation",
      text: `state-document sprawl: ${f} -- there is exactly one RESUME.md and it carries no status; put status in the session store and history in devlog/`
    });
  }
}
function checkEvidenceDuplicates(snapshot, push) {
  const byOid = /* @__PURE__ */ new Map();
  for (const { path, oid } of snapshot.hashedPaths) {
    const list = byOid.get(oid);
    if (list) list.push(path);
    else byOid.set(oid, [path]);
  }
  const seen = /* @__PURE__ */ new Set();
  for (const { path, oid } of snapshot.hashedPaths) {
    if (!path.startsWith("docs/evidence/")) continue;
    if (seen.has(oid)) continue;
    const paths = byOid.get(oid);
    const evidenceCount = paths.filter(
      (p) => p.startsWith("docs/evidence/")
    ).length;
    if (evidenceCount < 2) continue;
    seen.add(oid);
    push({
      kind: "violation",
      text: `duplicate content under docs/evidence: ${paths.join(" ")} -- keep one canonical copy and reference it`
    });
  }
}
function checkRootDuplicatesDocs(snapshot, push) {
  const docsByOid = /* @__PURE__ */ new Map();
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
      text: `root file duplicates documentation: ${path} is byte-identical to ${match.join(" ")} -- delete the root copy`
    });
  }
}
function checkModeRegression(snapshot, push) {
  if (snapshot.base === null) {
    push({
      kind: "info",
      text: "mode-regression check SKIPPED: no base ref (tried FOREMAN_HYGIENE_BASE, origin/main, main)"
    });
    return;
  }
  const declared = new Map(
    ALLOWED_MODE_CHANGES.map((e) => [e.path, e.reason])
  );
  for (const f of snapshot.changedPaths) {
    const headMode = snapshot.headModes.get(f);
    if (headMode === void 0) continue;
    const baseMode = snapshot.baseModes.get(f);
    if (baseMode === void 0) {
      if (headMode !== "100755" && !f.endsWith(".bats") && snapshot.hasShebang(f)) {
        push({
          kind: "info",
          text: `new file has a shebang and is not executable: ${f} (${headMode}) -- run via an interpreter on purpose, or missing git update-index --chmod=+x? tests/line-endings.bats is the authority.`
        });
      }
      continue;
    }
    if (baseMode === headMode) continue;
    const reason = declared.get(f);
    if (reason !== void 0) {
      push({
        kind: "info",
        text: `declared mode change: ${f} ${baseMode} -> ${headMode} (ALLOWED_MODE_CHANGES: ${reason})`
      });
      continue;
    }
    push({
      kind: "violation",
      text: `file mode changed vs ${snapshot.base}: ${f} ${baseMode} -> ${headMode} -- if deliberate, add it to ALLOWED_MODE_CHANGES in packages/policy/src/repo-hygiene.ts with a reason; if not, git update-index --chmod=+x`
    });
  }
}
function evaluateRepoHygiene(snapshot) {
  const lines = [];
  const push = (line) => {
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
    exitCode: violations > 0 ? EXIT_VIOLATIONS : EXIT_CLEAN
  };
}
function renderRepoHygiene(report) {
  let out = "";
  for (const line of report.lines) {
    out += line.kind === "violation" ? `VIOLATION ${line.text}
` : `INFO  ${line.text}
`;
  }
  if (report.violations > 0) {
    out += `
REPO HYGIENE FAILED: ${report.violations} violation(s).
`;
    return out;
  }
  out += "repo-hygiene: clean (root allowlist, no state sprawl, no duplicate evidence)\n";
  return out;
}
var MAX_GIT_OUTPUT_BYTES = 64 * 1024 * 1024;
var RepoHygieneCaptureError = class {
  constructor(message) {
    this.message = message;
  }
  _tag = "RepoHygieneCaptureError";
};
function git(repoRoot, args) {
  const r = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "buffer",
    maxBuffer: MAX_GIT_OUTPUT_BYTES
  });
  if (r.error) throw new RepoHygieneCaptureError(`git ${args[0]} failed to run`);
  if (r.status !== 0) {
    throw new RepoHygieneCaptureError(
      `git ${args[0]} exited ${String(r.status)}`
    );
  }
  return r.stdout.toString("utf8");
}
function gitStatus(repoRoot, args) {
  const r = spawnSync("git", args, { cwd: repoRoot, stdio: "ignore" });
  if (r.error) throw new RepoHygieneCaptureError("git failed to run");
  return r.status ?? 1;
}
function parseLsFilesStage(text) {
  const out = [];
  for (const raw of text.split("\0")) {
    if (!raw) continue;
    const tab = raw.indexOf("	");
    if (tab < 0) continue;
    const meta = raw.slice(0, tab).split(/\s+/);
    const path = raw.slice(tab + 1);
    if (meta.length < 3 || !path) continue;
    out.push({ mode: meta[0], oid: meta[1], path });
  }
  return out;
}
function parseLsTree(text) {
  const modes = /* @__PURE__ */ new Map();
  for (const raw of text.split("\0")) {
    if (!raw) continue;
    const tab = raw.indexOf("	");
    if (tab < 0) continue;
    const meta = raw.slice(0, tab).split(/\s+/);
    const path = raw.slice(tab + 1);
    if (meta.length < 3 || !path) continue;
    modes.set(path, meta[0]);
  }
  return modes;
}
function fileStartsWithShebang(repoRoot, path) {
  let fd;
  try {
    fd = openSync(`${repoRoot}/${path}`, "r");
  } catch {
    return false;
  }
  try {
    const buf = Buffer.alloc(2);
    const n = readSync(fd, buf, 0, 2, 0);
    return n === 2 && buf[0] === 35 && buf[1] === 33;
  } catch {
    return false;
  } finally {
    try {
      closeSync(fd);
    } catch {
    }
  }
}
function captureRepoHygieneSnapshot(repoRoot, env = process.env) {
  const staged = parseLsFilesStage(
    git(repoRoot, ["ls-files", "-s", "-z", "--", "docs/*", "*.md"])
  );
  const headModes = /* @__PURE__ */ new Map();
  const hashedPaths = [];
  for (const e of staged) {
    hashedPaths.push({ path: e.path, oid: e.oid });
  }
  for (const e of parseLsFilesStage(git(repoRoot, ["ls-files", "-s", "-z"]))) {
    headModes.set(e.path, e.mode);
  }
  const trackedMarkdownRoot = hashedPaths.map((e) => e.path).filter((p) => isRootPath(p) && p.endsWith(".md")).sort();
  let base = null;
  for (const candidate of [env.FOREMAN_HYGIENE_BASE, "origin/main", "main"]) {
    if (!candidate) continue;
    if (gitStatus(repoRoot, ["rev-parse", "--verify", "--quiet", candidate]) === 0) {
      base = candidate;
      break;
    }
  }
  let changedPaths = [];
  let baseModes = /* @__PURE__ */ new Map();
  if (base !== null) {
    changedPaths = git(repoRoot, ["diff", "--name-only", "-z", `${base}...HEAD`]).split("\0").filter((p) => p.length > 0);
    baseModes = parseLsTree(git(repoRoot, ["ls-tree", "-r", "-z", base]));
  }
  return {
    trackedMarkdownRoot,
    hashedPaths,
    base,
    changedPaths,
    baseModes,
    headModes,
    hasShebang: (p) => fileStartsWithShebang(repoRoot, p)
  };
}
function runRepoHygiene(repoRoot, io) {
  let snapshot;
  try {
    snapshot = captureRepoHygieneSnapshot(repoRoot);
  } catch (e) {
    const msg = e instanceof RepoHygieneCaptureError ? e.message : "cannot inspect repository";
    io.writeStderr(`ERROR ${msg}
`);
    return EXIT_CANNOT_RUN;
  }
  const report = evaluateRepoHygiene(snapshot);
  io.writeStdout(renderRepoHygiene(report));
  return report.exitCode;
}
var isEntry = (() => {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  return argv1.endsWith("repo-hygiene.js") || argv1.endsWith("repo-hygiene.ts");
})();
if (isEntry) {
  const repoRoot = process.cwd();
  const code = runRepoHygiene(repoRoot, {
    writeStdout: (t) => {
      process.stdout.write(t);
    },
    writeStderr: (t) => {
      process.stderr.write(t);
    }
  });
  process.exitCode = code;
}
export {
  ALLOWED_MODE_CHANGES,
  ALLOWED_ROOT_MD,
  EXIT_CANNOT_RUN,
  EXIT_CLEAN,
  EXIT_VIOLATIONS,
  RepoHygieneCaptureError,
  captureRepoHygieneSnapshot,
  evaluateRepoHygiene,
  renderRepoHygiene,
  runRepoHygiene
};
