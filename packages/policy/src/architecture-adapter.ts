/**
 * Closed thin-adapter allowlist grammar for modified legacy executables.
 *
 * Only POSIX shell (`.sh`, `.bash`, `.zsh`, `.ksh`) has a documented closed
 * grammar. Other legacy languages fail closed until they gain their own tested
 * grammar.
 *
 * ## Canonical POSIX sequence (comments/blanks ignored)
 *
 * Exactly this order, no missing, duplicate, or reordered steps:
 *
 * 1. `shebang` — first physical line only (allowed interpreter forms)
 * 2. `strict_set` — closed strict-mode set line
 * 3. `assign_root` — one `ROOT|REPO_ROOT|SCRIPT_DIR|HERE` dirname/`pwd` locator
 * 4. `assign_node` — one of:
 *    - hard: `NODE|NODE_BIN="$(command -v node)"` (six-production form)
 *    - soft: `NODE|NODE_BIN="$(command -v node || true)"` (required when
 *      fail-closed checks follow, so missing node reaches the check)
 * 5. `assign_bundle` — one bundle assignment rooted at the declared root:
 *    - repository-root form (default): ends in
 *      `/skills/foreman/runtime/dist/<safe-name>.js`
 *    - skill-script form (only `skills/foreman/scripts/*.sh`): ends in
 *      `/runtime/dist/<safe-name>.js` with exactly one parent locator
 * 6. Optional fail-closed boundary checks (both or neither; eight-production):
 *    - `check_node` — exact
 *      `if [ -z "$<nodeVar>" ]; then echo "<distBase>: node is required" >&2; exit 3; fi`
 *    - `check_bundle` — exact
 *      `if [ ! -f "$<bundleVar>" ]; then echo "<distBase>: runtime bundle missing" >&2; exit 3; fi`
 * 7. `exec_node` — final line only:
 *    `exec "$<nodeVar>" "$<bundleVar>" "$@"` using the exact declared names
 *
 * Caller-controlled `$NODE`/`$BUNDLE` without prior closed assignments, bare
 * `node` exec, option-shaped entry arguments (`-e`, `--eval`, `-r`, …), and
 * operator smuggling are rejected. Fail-closed checks are boundary exit
 * handling only — not domain logic.
 */

import { createHash } from "node:crypto";
import { pathExtension } from "./architecture-extensions.js";
import type { PolicyReason } from "./architecture-schema.js";

const DENY = "legacy_adapter_domain_logic" as const;

/**
 * Exact legacy migration artifacts admitted by reviewed changes.
 * These paths still fail closed on any byte change or relocation. The v0.4
 * entries freeze the release convergence and retained helper behavior.
 * New shell work beyond these artifacts must use the closed
 * thin-adapter grammar.
 */
// M6 adds exact reviewed comment-cleanup bodies; executable bytes match committed HEAD.
// These pins permit no additional mutation or relocation.
const LEGACY_MIGRATION_BODY_SHA256 = new Map<string, string>([
  // User-approved exact historical restoration. Migration owner: lane-runtime-typescript.
  ["skills/foreman/scripts/adapters/agy.sh", "ae4440daacdff5edee6174844bed7af932792d4b58cf5c9528561c9f179210be"],
  ["skills/foreman/scripts/adapters/claude.sh", "5ab6b2a7e152154d53533cfe4cfeed7d8c46d8664d90fed99ad969b461a4f652"],
  ["skills/foreman/scripts/adapters/codex.sh", "cbfaf8ee7e40ce54e2ca0788a08a59c5dc3e8d380b5ed98c5be67179c96452eb"],
  ["skills/foreman/scripts/adapters/grok.sh", "6dcf82398b49681f66129e38f52e7b8c5a70257044028ee1ed7b6381ff3a4232"],
  ["skills/foreman/scripts/audit-run.sh", "0cc03c9c20a103d591413fc576619235077ff41c00e8766e6b5d186a4a5e8263"],
  ["skills/foreman/scripts/lane-run.sh", "5368260642cac6d0ff9d38a45597dc359e6c5a0b9a008f49dee3383bc7f16110"],
  ["skills/foreman/scripts/lane-supervise.sh", "a09929d92ce817fc861800b38529300889a62b8324fc67fea9a305ea32ac7062"],
  ["skills/foreman/scripts/lib/worker-cmd.sh", "47deb36862a7bda1c9a174caf215667378e2d03d0ee9796abd81b2f7e364f508"],
  ["skills/foreman/scripts/resume.sh", "8509bacc869c9c06d26030eeef6abe8cd61fa326fe307ef7bf7c6be7af16fe97"],
  ["skills/foreman/scripts/vendor-multiround.sh", "07686f1cad9d660d1b62ccb34de6e0d5171f75a648b1f8fdb6cf380fc917f406"],
  ["skills/foreman/scripts/watch.sh", "6ee0c22f756bf7395c93ff1876d42a877e0c7a0e091b06fe592d23a5b320ff14"],
  ["skills/foreman/scripts/worker-run.sh", "359d694a836c722ff9bb9fca243bdcce24188bef62046c8f9a66d78b456bf480"],
  [
    "skills/foreman/scripts/gate-eval.sh",
    "bd0a5e404cb97dfe356084764f797a2852b8a6d84862e038aaecad085f70b546",
  ],
  [
    "skills/foreman/scripts/lib/release-policy.sh",
    "5d20047eef1cf0d63da32e237b64d16e27a40a148cbe2f557cd22c88ada021df",
  ],
  [
    "skills/foreman/scripts/lib/lock.sh",
    "f0bde2ac3174269f1bc6388549e79f696be0cf955c58483a067d9f99f5d799e0",
  ],
  [
    "skills/foreman/scripts/maintenance.sh",
    "2bed0680efbfa6bc2eb474aa9c11e35bd43dc9d34adca6193a80f6fffe5f2048",
  ],
  [
    "skills/foreman/scripts/merge-gate.sh",
    "5af0591b3b458da11b602037582da4fed6a81d60d05b54198a3d4cd31c8a9cfb",
  ],
  [
    "skills/foreman/scripts/vendor-concurrency-test.sh",
    "543d0827ea0039dd5cb0452e0f27b5a6df61171b91e1535fa22fff27e8bbb0e7",
  ],

  ["env/wsl-clock-preflight.sh", "50e5244978ec1760a34a80e9d0ede947e00c1a8dbe4abf5bb1d1e4f455531a98"],
  ["skills/foreman/scripts/foreman-cleanup.sh", "12945ea8367e4cad4294440d8449cf32501064921f063651060a1dff55dd2e23"],
  ["skills/foreman/scripts/lane-complete-check.sh", "60e4010797b1d03bdcc153f2520cb3aaf2284e06da6d12c7206221591f9f6770"],
  ["skills/foreman/scripts/lib/config.sh", "f721c5c4eb1d603e3ccafcfd328c41210958d96162a47c31e8cc07e521f57d29"],
  ["skills/foreman/scripts/lib/eventlog.sh", "7fbf4436350e56b5f21dcab8714a7040e0f5bc8863212cbb0ab8bffd4965f392"],
  ["skills/foreman/scripts/lib/evidence.sh", "04fa2b71f40288fd7500f429c7d9715dc9bbebc8848e121fb9137c5673e9e5e8"],
  ["skills/foreman/scripts/lib/launch.sh", "e26a233bcd01553719f359276ef6d4695306124a102751cc0a9fb03ab93d18fd"],
  ["skills/foreman/scripts/lib/telemetry.sh", "f305b1a792ba8f066a77d8581ae51b4df5942622ad43f04a10e42a031cc689dd"],
  ["skills/foreman/scripts/wt-cleanup.sh", "2709e63ecfd0fcff7e649bf321937261c73fa6ddce1933190981b100a35e9902"],
  ["skills/foreman/scripts/wt-new.sh", "84e1df1c1be23a5c0b9d181fe188cf720b5487649a773a11507b28cf52172bed"],
]);

export function isPinnedLegacyMigrationArtifact(
  path: string,
  sourceText: string,
): boolean {
  const normalizedPath = path.replace(/\\/g, "/");
  const expected = LEGACY_MIGRATION_BODY_SHA256.get(normalizedPath);
  if (expected === undefined) return false;
  return (
    createHash("sha256").update(sourceText, "utf8").digest("hex") === expected
  );
}

const SHEBANG =
  /^#!(\/usr\/bin\/env\s+(bash|sh|dash)|\/bin\/(bash|sh|dash)|\/usr\/bin\/(bash|sh|dash))\s*$/;

const STRICT_SET =
  /^set\s+(-euo\s+pipefail|-eu\s+pipefail|-euo|-eu|-e|-o\s+pipefail)\s*$/;

const ASSIGN_ROOT =
  /^(ROOT|REPO_ROOT|SCRIPT_DIR|HERE)="\$\(cd "\$\(dirname "\$0"\)(\/\.\.)?" && pwd\)"\s*$/;

/** Hard form: missing node fails the assignment under set -e (six-production). */
const ASSIGN_NODE_HARD =
  /^(NODE|NODE_BIN)="\$\(command -v node\)"\s*$/;

/**
 * Soft form: missing node yields empty; required when fail-closed checks follow
 * so the check can map to exit 3 with a fixed diagnostic.
 */
const ASSIGN_NODE_SOFT =
  /^(NODE|NODE_BIN)="\$\(command -v node \|\| true\)"\s*$/;

/** Repository-root bundle: "$ROOT/skills/foreman/runtime/dist/<safe>.js". */
const ASSIGN_BUNDLE_REPO =
  /^(BUNDLE|ENTRY|GUARD|POLICY)="\$([A-Z_][A-Z0-9_]*)\/skills\/foreman\/runtime\/dist\/([A-Za-z0-9][A-Za-z0-9._+-]*)\.js"\s*$/;

/** Skill-root bundle: "$ROOT/runtime/dist/<safe>.js" (installed skill layout). */
const ASSIGN_BUNDLE_SKILL =
  /^(BUNDLE|ENTRY|GUARD|POLICY)="\$([A-Z_][A-Z0-9_]*)\/runtime\/dist\/([A-Za-z0-9][A-Za-z0-9._+-]*)\.js"\s*$/;

const EXEC_VARS =
  /^exec\s+"\$([A-Z_][A-Z0-9_]*)"\s+"\$([A-Z_][A-Z0-9_]*)"\s+"\$@"\s*$/;

/**
 * Repository-relative skill script path: exactly one basename under
 * skills/foreman/scripts/. Normalized to forward slashes.
 */
function isSkillScriptPath(path: string): boolean {
  const n = path.replace(/\\/g, "/");
  return /^skills\/foreman\/scripts\/[^/]+\.sh$/.test(n);
}

function isCommentOrBlank(line: string): boolean {
  const t = line.trim();
  if (t.length === 0) return true;
  if (t.startsWith("#") && !t.startsWith("#!")) return true;
  return false;
}

function hasSmuggledOperators(
  line: string,
  kind: "root" | "node-hard" | "node-soft" | "other",
): boolean {
  if (/;\s*\S/.test(line) || /;\s*$/.test(line)) return true;
  if (/\s&\s*$/.test(line) || /\s&$/.test(line)) return true;
  if (line.includes("|") && kind !== "node-soft") return true;
  if (/(^|[^0-9])[0-9]?>{1,2}/.test(line) || /</.test(line)) return true;
  if (line.includes("`")) return true;
  if (/[\u0000\u000b\u000c]/.test(line)) return true;
  if (kind === "other") {
    if (line.includes("$(")) return true;
    if (line.includes("&&") || line.includes("||")) return true;
  } else if (kind === "node-hard") {
    const subs = line.split("$(").length - 1;
    if (subs !== 1) return true;
    if (line.includes("&&") || line.includes("||")) return true;
  } else if (kind === "node-soft") {
    const subs = line.split("$(").length - 1;
    if (subs !== 1) return true;
    // Exactly one closed `|| true` inside the single command substitution.
    if (!/\$\(command -v node \|\| true\)/.test(line)) return true;
    if (line.includes("&&")) return true;
    // No extra pipes beyond the single soft-or form.
    const pipeCount = (line.match(/\|/g) ?? []).length;
    if (pipeCount !== 2) return true;
  } else {
    const subs = line.split("$(").length - 1;
    if (subs !== 2) return true;
  }
  return false;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Exact fail-closed node check: empty node → fixed diagnostic → exit 3.
 * Deliberately closed; does not use generic smuggle detection so the fixed
 * `>&2` and `;` separators are admitted only in this exact form.
 */
function isExactCheckNode(
  line: string,
  nodeName: string,
  distBase: string,
): boolean {
  const re = new RegExp(
    `^if \\[ -z "\\$${escapeRegExp(nodeName)}" \\]; then echo "${escapeRegExp(distBase)}: node is required" >&2; exit 3; fi$`,
  );
  return re.test(line);
}

/**
 * Exact fail-closed bundle check: missing file → fixed diagnostic → exit 3.
 */
function isExactCheckBundle(
  line: string,
  bundleName: string,
  distBase: string,
): boolean {
  const re = new RegExp(
    `^if \\[ ! -f "\\$${escapeRegExp(bundleName)}" \\]; then echo "${escapeRegExp(distBase)}: runtime bundle missing" >&2; exit 3; fi$`,
  );
  return re.test(line);
}

/**
 * Validate a POSIX shell adapter against the closed canonical state machine.
 * `adapterPath` is the repository-relative path (forward or backslash).
 */
function inspectPosixShellAdapter(
  adapterPath: string,
  sourceText: string,
): PolicyReason | null {
  if (/[\u0000]/.test(sourceText)) return DENY;
  const rawLines = sourceText.split(/\r?\n/);
  while (rawLines.length > 0 && rawLines[rawLines.length - 1] === "") {
    rawLines.pop();
  }

  const codeLines: { text: string; index: number }[] = [];
  for (let i = 0; i < rawLines.length; i += 1) {
    const line = rawLines[i]!;
    if (isCommentOrBlank(line)) continue;
    if (line.includes("#") && !line.startsWith("#!")) return DENY;
    if (/^\s/.test(line)) return DENY;
    codeLines.push({ text: line, index: i });
  }

  // Six-production (no checks) or eight-production (node + bundle checks).
  if (codeLines.length !== 6 && codeLines.length !== 8) return DENY;
  const withChecks = codeLines.length === 8;

  // 1. shebang — must be physical line 0
  const l0 = codeLines[0]!;
  if (l0.index !== 0 || !SHEBANG.test(l0.text)) return DENY;
  if (hasSmuggledOperators(l0.text, "other")) return DENY;

  // 2. strict_set
  const l1 = codeLines[1]!;
  if (!STRICT_SET.test(l1.text) || hasSmuggledOperators(l1.text, "other")) {
    return DENY;
  }

  // 3. assign_root — exactly one
  const l2 = codeLines[2]!;
  const rootM = l2.text.match(ASSIGN_ROOT);
  if (!rootM || hasSmuggledOperators(l2.text, "root")) return DENY;
  const rootName = rootM[1]!;
  const parentCount = rootM[2] === "/.." ? 1 : 0;

  // 4. assign_node — hard for six-production; soft when fail-closed checks follow
  const l3 = codeLines[3]!;
  let nodeName: string;
  if (withChecks) {
    const softM = l3.text.match(ASSIGN_NODE_SOFT);
    if (!softM || hasSmuggledOperators(l3.text, "node-soft")) return DENY;
    nodeName = softM[1]!;
  } else {
    const hardM = l3.text.match(ASSIGN_NODE_HARD);
    if (!hardM || hasSmuggledOperators(l3.text, "node-hard")) return DENY;
    nodeName = hardM[1]!;
  }

  // 5. assign_bundle — path-scoped form
  const l4 = codeLines[4]!;
  if (l4.text.includes("$(") || l4.text.includes("`")) return DENY;
  if (hasSmuggledOperators(l4.text, "other")) return DENY;

  const skillScript = isSkillScriptPath(adapterPath);
  const skillBundle = l4.text.match(ASSIGN_BUNDLE_SKILL);
  const repoBundle = l4.text.match(ASSIGN_BUNDLE_REPO);

  let bundleName: string;
  let bundleRootRef: string;
  let distBase: string;

  if (skillScript) {
    // Exactly one parent + skill-root runtime path; never the repo form.
    if (parentCount !== 1) return DENY;
    if (!skillBundle || repoBundle) return DENY;
    bundleName = skillBundle[1]!;
    bundleRootRef = skillBundle[2]!;
    distBase = skillBundle[3]!;
  } else {
    // Repository-root form only; reject skill-root bundle paths elsewhere.
    if (skillBundle) return DENY;
    if (!repoBundle) return DENY;
    bundleName = repoBundle[1]!;
    bundleRootRef = repoBundle[2]!;
    distBase = repoBundle[3]!;
  }

  if (bundleRootRef !== rootName) return DENY;
  if (distBase.startsWith("-")) return DENY;

  let execLine: { text: string; index: number };

  if (withChecks) {
    // 6a. check_node — exact fixed form only
    const l5 = codeLines[5]!;
    if (!isExactCheckNode(l5.text, nodeName, distBase)) return DENY;
    // 6b. check_bundle — exact fixed form only
    const l6 = codeLines[6]!;
    if (!isExactCheckBundle(l6.text, bundleName, distBase)) return DENY;
    execLine = codeLines[7]!;
  } else {
    execLine = codeLines[5]!;
  }

  // 7. exec using exact declared names only
  if (execLine.text.includes("$(") || execLine.text.includes("`")) return DENY;
  if (hasSmuggledOperators(execLine.text, "other")) return DENY;

  if (/\s(-e|--eval|-r|--require|--print|-p|--input-type|--experimental)\b/.test(execLine.text)) {
    return DENY;
  }
  if (/"-[^"]*"/.test(execLine.text) || /'-[^']*'/.test(execLine.text)) return DENY;
  if (/^exec\s+node(\s|$)/.test(execLine.text)) return DENY;

  const execM = execLine.text.match(EXEC_VARS);
  if (!execM) return DENY;
  if (execM[1] !== nodeName || execM[2] !== bundleName) return DENY;

  return null;
}

/**
 * Returns null when the adapter body is within the thin-adapter grammar;
 * otherwise returns legacy_adapter_domain_logic.
 *
 * All unpinned paths use the closed six/eight-production grammar.
 */
export function inspectLegacyAdapter(
  path: string,
  sourceText: string,
): PolicyReason | null {
  const normalizedPath = path.replace(/\\/g, "/");
  const pinnedLegacyDigest = LEGACY_MIGRATION_BODY_SHA256.get(normalizedPath);
  if (pinnedLegacyDigest !== undefined) {
    return isPinnedLegacyMigrationArtifact(path, sourceText) ? null : DENY;
  }

  const ext = pathExtension(path);

  if (ext === ".sh" || ext === ".bash" || ext === ".zsh" || ext === ".ksh") {
    return inspectPosixShellAdapter(path, sourceText);
  }

  return DENY;
}
