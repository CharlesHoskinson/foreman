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
 * 4. `assign_node` — one `NODE|NODE_BIN="$(command -v node)"`
 * 5. `assign_bundle` — one bundle assignment rooted at the declared root:
 *    - repository-root form (default): ends in
 *      `/skills/foreman/runtime/dist/<safe-name>.js`
 *    - skill-script form (only `skills/foreman/scripts/*.sh`): ends in
 *      `/runtime/dist/<safe-name>.js` with exactly one parent locator
 * 6. `exec_node` — final line only:
 *    `exec "$<nodeVar>" "$<bundleVar>" "$@"` using the exact declared names
 *
 * Caller-controlled `$NODE`/`$BUNDLE` without prior closed assignments, bare
 * `node` exec, option-shaped entry arguments (`-e`, `--eval`, `-r`, …), and
 * operator smuggling are rejected.
 */

import { pathExtension } from "./architecture-extensions.js";
import type { PolicyReason } from "./architecture-schema.js";

const DENY = "legacy_adapter_domain_logic" as const;

const SHEBANG =
  /^#!(\/usr\/bin\/env\s+(bash|sh|dash)|\/bin\/(bash|sh|dash)|\/usr\/bin\/(bash|sh|dash))\s*$/;

const STRICT_SET =
  /^set\s+(-euo\s+pipefail|-eu\s+pipefail|-euo|-eu|-e|-o\s+pipefail)\s*$/;

const ASSIGN_ROOT =
  /^(ROOT|REPO_ROOT|SCRIPT_DIR|HERE)="\$\(cd "\$\(dirname "\$0"\)(\/\.\.)?" && pwd\)"\s*$/;

const ASSIGN_NODE =
  /^(NODE|NODE_BIN)="\$\(command -v node\)"\s*$/;

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
  kind: "root" | "node" | "other",
): boolean {
  if (/;\s*\S/.test(line) || /;\s*$/.test(line)) return true;
  if (/\s&\s*$/.test(line) || /\s&$/.test(line)) return true;
  if (line.includes("|")) return true;
  if (/(^|[^0-9])[0-9]?>{1,2}/.test(line) || /</.test(line)) return true;
  if (line.includes("`")) return true;
  if (/[\u0000\u000b\u000c]/.test(line)) return true;
  if (kind === "other") {
    if (line.includes("$(")) return true;
    if (line.includes("&&") || line.includes("||")) return true;
  } else if (kind === "node") {
    const subs = line.split("$(").length - 1;
    if (subs !== 1) return true;
    if (line.includes("&&") || line.includes("||")) return true;
  } else {
    const subs = line.split("$(").length - 1;
    if (subs !== 2) return true;
  }
  return false;
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

  // Exactly 6 productions in fixed order
  if (codeLines.length !== 6) return DENY;

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

  // 4. assign_node
  const l3 = codeLines[3]!;
  const nodeM = l3.text.match(ASSIGN_NODE);
  if (!nodeM || hasSmuggledOperators(l3.text, "node")) return DENY;
  const nodeName = nodeM[1]!;

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

  // 6. exec using exact declared names only
  const l5 = codeLines[5]!;
  if (l5.text.includes("$(") || l5.text.includes("`")) return DENY;
  if (hasSmuggledOperators(l5.text, "other")) return DENY;

  if (/\s(-e|--eval|-r|--require|--print|-p|--input-type|--experimental)\b/.test(l5.text)) {
    return DENY;
  }
  if (/"-[^"]*"/.test(l5.text) || /'-[^']*'/.test(l5.text)) return DENY;
  if (/^exec\s+node(\s|$)/.test(l5.text)) return DENY;

  const execM = l5.text.match(EXEC_VARS);
  if (!execM) return DENY;
  if (execM[1] !== nodeName || execM[2] !== bundleName) return DENY;

  return null;
}

/**
 * Returns null when the adapter body is within the thin-adapter grammar;
 * otherwise returns legacy_adapter_domain_logic.
 */
export function inspectLegacyAdapter(
  path: string,
  sourceText: string,
): PolicyReason | null {
  const ext = pathExtension(path);

  if (ext === ".sh" || ext === ".bash" || ext === ".zsh" || ext === ".ksh") {
    return inspectPosixShellAdapter(path, sourceText);
  }

  return DENY;
}
