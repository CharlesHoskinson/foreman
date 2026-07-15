#!/usr/bin/env bash
# Shared helpers for foreman harness scripts. Source this file; do not execute.

readonly EXIT_OK=0
readonly EXIT_FAIL=1
readonly EXIT_CONFIG=2
readonly EXIT_MISSING_CLI=3

FOREMAN_HOME="${FOREMAN_HOME:-$HOME/.foreman}"

log() { printf '[foreman] %s\n' "$*" >&2; }

die() {
  local code="$1"; shift
  log "ERROR: $*"
  exit "$code"
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 \
    || die "$EXIT_MISSING_CLI" "required command not found: $1${2:+ — $2}"
}

run_dir() { echo "$FOREMAN_HOME/runs/$1"; }

# All harness git calls disable repo-provided hooks.
git_nohooks() { git -c core.hooksPath= "$@"; }

# toml_get FILE DOTTED.KEY [DEFAULT] — scalar or newline-joined array.
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
hash_snapshot() {
  local wt="$1"; shift
  local specs=()
  local g
  for g in "$@"; do specs+=(":(glob)$g"); done
  git_nohooks -C "$wt" ls-files -- "${specs[@]}" | sort -u | while read -r f; do
    printf '%s  %s\n' "$f" "$(sha256sum "$wt/$f" | cut -d' ' -f1)"
  done
}

repo_lock_path() {
  local repo="$1" common
  common="$(git_nohooks -C "$repo" rev-parse --git-common-dir)"
  [[ "$common" = /* ]] || common="$repo/$common"
  touch "$common/foreman.lock"
  echo "$common/foreman.lock"
}
