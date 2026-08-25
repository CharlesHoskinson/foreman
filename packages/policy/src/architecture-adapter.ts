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
 * Closed migration path for the R4C3 lane-run strangler only.
 * Repository-relative, forward-slash form; not a general path exception.
 */
const LANE_RUN_MIGRATION_PATH = "skills/foreman/scripts/lane-run.sh";

/**
 * Closed migration path for the R5D lane-supervise thin adapter only.
 * Repository-relative, forward-slash form; not a general path exception.
 * Injects `--state-root` from FOREMAN_HOME before the Node supervisor CLI;
 * that is outside the six/eight-production pure-exec grammar.
 */
const LANE_SUPERVISE_MIGRATION_PATH =
  "skills/foreman/scripts/lane-supervise.sh";

/** Exact R7B2-B profile-bound lane adapter body. */
const LANE_RUN_BODY_SHA256 =
  "07d1f57953eb1c3cb4b7a8090743ef05c723ff900e0d3881fb8b1efc0be93f31";

/**
 * SHA-256 of every byte of the approved R5D lane-supervise.sh thin adapter.
 * Full-body pin: the short adapter is the entire migration artifact. A
 * one-byte change or domain-logic edit fails. Recomputed only when an
 * intentional adapter change is approved with the R5D migration artifact.
 * Caller-supplied digests are never accepted.
 */
const LANE_SUPERVISE_BODY_SHA256 =
  "a09929d92ce817fc861800b38529300889a62b8324fc67fea9a305ea32ac7062";

/**
 * Exact release-migration artifacts admitted by the v0.4 convergence.
 * These paths still fail closed on any byte change or relocation. New shell
 * work must use the closed thin-adapter grammar instead of extending this map.
 */
const V040_MIGRATION_BODY_SHA256 = new Map<string, string>([
  [
    "skills/foreman/scripts/gate-eval.sh",
    "bd0a5e404cb97dfe356084764f797a2852b8a6d84862e038aaecad085f70b546",
  ],
  [
    "skills/foreman/scripts/lib/release-policy.sh",
    "5d20047eef1cf0d63da32e237b64d16e27a40a148cbe2f557cd22c88ada021df",
  ],
  [
    "skills/foreman/scripts/maintenance.sh",
    "2bed0680efbfa6bc2eb474aa9c11e35bd43dc9d34adca6193a80f6fffe5f2048",
  ],
  [
    "skills/foreman/scripts/merge-gate.sh",
    "8854bd9bf4ddc0234989c156ca32287d2ade4e3b68bbb8c66e560e4a093fd95b",
  ],
]);

export function isPinnedLegacyMigrationArtifact(
  path: string,
  sourceText: string,
): boolean {
  const normalizedPath = path.replace(/\\/g, "/");
  const expected = V040_MIGRATION_BODY_SHA256.get(normalizedPath);
  if (expected === undefined) return false;
  return (
    createHash("sha256").update(sourceText, "utf8").digest("hex") === expected
  );
}

/**
 * Closed validator for the single approved lane-run.sh migration artifact.
 * Accepts only the exact profile-bound adapter body. Rejects every other
 * change with legacy_adapter_domain_logic.
 */
function inspectLaneRunMigrationAdapter(sourceText: string): PolicyReason | null {
  if (/[\u0000]/.test(sourceText)) return DENY;

  const digest = createHash("sha256").update(sourceText, "utf8").digest("hex");
  return digest === LANE_RUN_BODY_SHA256 ? null : DENY;
}

/**
 * Closed validator for the single approved lane-supervise.sh migration
 * artifact. Accepts only the exact thin adapter body (full SHA-256 pin).
 * Rejects every other change with legacy_adapter_domain_logic.
 */
function inspectLaneSuperviseMigrationAdapter(
  sourceText: string,
): PolicyReason | null {
  if (/[\u0000]/.test(sourceText)) return DENY;
  const digest = createHash("sha256")
    .update(sourceText, "utf8")
    .digest("hex");
  if (digest !== LANE_SUPERVISE_BODY_SHA256) return DENY;
  return null;
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
 * The 1,482-line lane-run.sh migration artifact is admitted only by the
 * closed R4C3 validator (exact forwarding block + pinned prefix and suffix
 * digests that pin block position). The R5D lane-supervise.sh thin adapter
 * is admitted only by the closed full-body SHA-256 pin for its exact path.
 * All other paths keep the six-production / eight-production grammar.
 */
export function inspectLegacyAdapter(
  path: string,
  sourceText: string,
): PolicyReason | null {
  const normalizedPath = path.replace(/\\/g, "/");
  if (normalizedPath === LANE_RUN_MIGRATION_PATH) {
    return inspectLaneRunMigrationAdapter(sourceText);
  }
  if (normalizedPath === LANE_SUPERVISE_MIGRATION_PATH) {
    return inspectLaneSuperviseMigrationAdapter(sourceText);
  }
  const pinnedV040Digest = V040_MIGRATION_BODY_SHA256.get(normalizedPath);
  if (pinnedV040Digest !== undefined) {
    return isPinnedLegacyMigrationArtifact(path, sourceText) ? null : DENY;
  }

  const ext = pathExtension(path);

  if (ext === ".sh" || ext === ".bash" || ext === ".zsh" || ext === ".ksh") {
    return inspectPosixShellAdapter(path, sourceText);
  }

  return DENY;
}
