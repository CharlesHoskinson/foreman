#!/usr/bin/env bash
# Shared helpers for foreman harness scripts. Source this file; do not execute.

readonly EXIT_OK=0
readonly EXIT_FAIL=1
readonly EXIT_CONFIG=2
readonly EXIT_MISSING_CLI=3

FOREMAN_HOME="${FOREMAN_HOME:-$HOME/.foreman}"

# @description Print a message with the Foreman harness prefix.
# @arg $1 message message text; additional arguments are joined with spaces
# @stderr the prefixed Foreman message
log() { printf '[foreman] %s\n' "$*" >&2; }

# @description Report a Foreman error and terminate the current harness process with the supplied status.
# @arg $1 code process exit status
# @arg $2 message error message text; additional arguments are joined with spaces
die() {
  local code="$1"; shift
  log "ERROR: $*"
  exit "$code"
}

# @description Require an executable on PATH or terminate with the harness missing-CLI status.
# @arg $1 command executable name to require
# @arg $2 hint optional installation or recovery hint
# @exitcode 3 if the required executable is unavailable
require_cmd() {
  command -v "$1" >/dev/null 2>&1 \
    || die "$EXIT_MISSING_CLI" "required command not found: $1${2:+ — $2}"
}

# @description Build the Foreman state directory path for a run identifier.
# @arg $1 run_id Foreman run identifier
# @stdout the run directory path under FOREMAN_HOME
run_dir() { echo "$FOREMAN_HOME/runs/$1"; }

# All harness git calls disable repo-provided hooks.
# @description Run git with repository-provided hooks disabled for the invocation.
# @arg $1 git_arg first git option or subcommand; remaining arguments are forwarded unchanged
git_nohooks() { git -c core.hooksPath= "$@"; }

# toml_get FILE DOTTED.KEY [DEFAULT] — scalar or newline-joined array.
# @description Read a dotted TOML key, optionally substituting a default when the key is absent.
# @arg $1 file TOML file to read
# @arg $2 key dotted key path to resolve
# @arg $3 default optional value returned when the key is absent
# @stdout the scalar value or one array element per line
toml_get() {
  local file="$1" key="$2" default="${3-__FOREMAN_NODEFAULT__}"
  python3 - "$file" "$key" "$default" <<'PY'
import sys, os, tomllib
path, key, default = sys.argv[1], sys.argv[2], sys.argv[3]
data = {}
if os.path.isfile(path):
    with open(path, "rb") as f:
        data = tomllib.load(f)
cur = data
for part in key.split("."):
    if isinstance(cur, dict) and part in cur:
        cur = cur[part]
    else:
        if default != "__FOREMAN_NODEFAULT__":
            print(default)
            sys.exit(0)
        sys.exit(1)
if isinstance(cur, list):
    print("\n".join(str(x) for x in cur))
else:
    print(cur)
PY
}

# hash_snapshot WORKTREE GLOB... — sha256 of tracked files matching git glob pathspecs.
# @description Hash tracked files matching the supplied git glob pathspecs for a worktree snapshot.
# @arg $1 worktree worktree path whose tracked files are inspected
# @arg $2 glob first git glob pathspec; additional pathspecs are also accepted
# @stdout one tracked path and SHA-256 digest per matching file
hash_snapshot() {
  local wt="$1"; shift
  local specs=()
  local g
  for g in "$@"; do specs+=(":(glob)$g"); done
  git_nohooks -C "$wt" ls-files -- "${specs[@]}" | sort -u | while read -r f; do
    printf '%s  %s\n' "$f" "$(sha256sum "$wt/$f" | cut -d' ' -f1)"
  done
}

# @description Create and return the shared Foreman lock file in a repository's common Git directory.
# @arg $1 repo repository or worktree path
# @stdout the repository-common Foreman lock file path
repo_lock_path() {
  local repo="$1" common
  common="$(git_nohooks -C "$repo" rev-parse --git-common-dir)"
  [[ "$common" = /* ]] || common="$repo/$common"
  touch "$common/foreman.lock"
  echo "$common/foreman.lock"
}
