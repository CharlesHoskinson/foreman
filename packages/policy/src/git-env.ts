/**
 * Sanitized environment for production Git subprocesses.
 * Removes inherited redirect/config/object/index/worktree variables and
 * forces no-replace, no prompt, no optional locks.
 */

const STRIP_PREFIXES = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_INDEX_FILE",
  "GIT_INDEX_VERSION",
  "GIT_NAMESPACE",
  "GIT_CEILING_DIRECTORIES",
  "GIT_DISCOVERY_ACROSS_FILESYSTEM",
  "GIT_CONFIG",
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_SYSTEM",
  "GIT_CONFIG_NOSYSTEM",
  "GIT_CONFIG_COUNT",
  "GIT_CONFIG_KEY_",
  "GIT_CONFIG_VALUE_",
  "GIT_CONFIG_PARAMETERS",
  "GIT_EXEC_PATH",
  "GIT_TEMPLATE_DIR",
  "GIT_PREFIX",
  "GIT_SUPER_PREFIX",
  "GIT_DIR_FINAL",
  "GIT_WORK_TREE_FINAL",
  "GIT_REPLACE_REF_BASE",
  "GIT_SSH",
  "GIT_SSH_COMMAND",
  "GIT_TRACE",
  "GIT_TRACE2",
  "GIT_CURL_VERBOSE",
  "GIT_HTTP_USER_AGENT",
  "GIT_PROXY_COMMAND",
  "GIT_SSL_NO_VERIFY",
  "GIT_ATTR_SOURCE",
  "GIT_OPTIONAL_LOCKS",
  "GIT_TERMINAL_PROMPT",
  "GIT_NO_REPLACE_OBJECTS",
];

function shouldStrip(key: string): boolean {
  const normalizedKey = key.toUpperCase();
  if (!normalizedKey.startsWith("GIT_")) return false;
  for (const p of STRIP_PREFIXES) {
    if (normalizedKey === p || normalizedKey.startsWith(p)) return true;
  }
  // Strip any remaining GIT_* redirect-ish keys; keep author/committer for
  // read-only ops harmless either way (we strip to be safe).
  if (
    normalizedKey.startsWith("GIT_AUTHOR_") ||
    normalizedKey.startsWith("GIT_COMMITTER_") ||
    normalizedKey === "GIT_EDITOR" ||
    normalizedKey === "GIT_PAGER" ||
    normalizedKey === "GIT_REFLOG_ACTION"
  ) {
    return true;
  }
  return true; // strip all GIT_* for production child
}

/**
 * Build a child process env for git that cannot be redirected by the parent
 * and disables replace refs / prompts / optional locks.
 */
export function sanitizedGitEnv(
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(base)) {
    if (v === undefined) continue;
    if (shouldStrip(k)) continue;
    out[k] = v;
  }
  out["GIT_NO_REPLACE_OBJECTS"] = "1";
  out["GIT_TERMINAL_PROMPT"] = "0";
  out["GIT_OPTIONAL_LOCKS"] = "0";
  // Never inherit FORCE_COLOR/NO_COLOR conflict noise into git itself
  delete out["FORCE_COLOR"];
  delete out["NO_COLOR"];
  return out;
}

/** Prefix every production git argv with no-replace documented switch. */
export function gitArgv(args: readonly string[]): string[] {
  return ["--no-replace-objects", ...args];
}
