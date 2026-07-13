#!/usr/bin/env bash
# Shared helpers for foreman harness scripts. Source this file; do not execute.
# shellcheck disable=SC2034

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

# All harness git calls disable repo-provided hooks (spec §7 S5).
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
# Fails loudly (nonzero) if WORKTREE is not a git worktree or git errors, so
# callers never mistake "error" for "no files".
hash_snapshot() {
  local wt="$1"; shift
  local specs=() g
  for g in "$@"; do specs+=(":(glob)$g"); done
  git_nohooks -C "$wt" rev-parse --is-inside-work-tree >/dev/null || return 1
  local files
  files="$(git_nohooks -C "$wt" ls-files -- "${specs[@]}")" || return 1
  [[ -z "$files" ]] && return 0
  local f
  sort -u <<<"$files" | while read -r f; do
    printf '%s  %s\n' "$f" "$(sha256sum "$wt/$f" | cut -d' ' -f1)"
  done
}

# docker_run_wrapper — locate sandbox/docker-run.sh relative to THIS file
# (lib/common.sh), so callers work whether run in-repo or from an installed
# skill layout ($SKILLS_HOME/foreman/{scripts/lib,sandbox}).
docker_run_wrapper() {
  local here; here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  for cand in "$here/../../../../sandbox/docker-run.sh" "$here/../../sandbox/docker-run.sh"; do
    [[ -x "$cand" ]] && { echo "$cand"; return 0; }
  done
  die "$EXIT_CONFIG" "docker-run.sh not found relative to $here"
}

repo_lock_path() {
  local repo="$1" common
  common="$(git_nohooks -C "$repo" rev-parse --git-common-dir)"
  [[ "$common" = /* ]] || common="$repo/$common"
  touch "$common/foreman.lock"
  echo "$common/foreman.lock"
}

# --- session transport (spec 2026-07-13) -----------------------------------

# transport_mode CONFIG_FILE — "container" (default) or "mcp"; exit 2 otherwise.
transport_mode() {
  local mode
  mode="$(toml_get "$1" transport.mode container)"
  case "$mode" in
    container|mcp) echo "$mode" ;;
    *) die "$EXIT_CONFIG" "transport.mode must be \"container\" or \"mcp\", got: $mode" ;;
  esac
}

# vendor_family VENDOR — the model family behind a vendor CLI (spec §4).
vendor_family() {
  case "$1" in
    claude) echo anthropic ;;
    codex)  echo openai ;;
    grok)   echo xai ;;
    *) die "$EXIT_CONFIG" "unknown vendor: $1" ;;
  esac
}

# enforce_mcp_decorrelation CONFIG ROLE VENDOR [WORKER_VENDOR]
# mcp-mode ≠ rules compare model families, not harness names (spec §4):
#   worker: family(VENDOR) != orchestrator.model_family (key is required)
#   audit:  family(VENDOR) != family(WORKER_VENDOR)
enforce_mcp_decorrelation() {
  local config="$1" role="$2" vendor="$3" worker="${4:-}"
  local fam ofam wfam
  fam="$(vendor_family "$vendor")"
  case "$role" in
    worker)
      ofam="$(toml_get "$config" orchestrator.model_family '')"
      [[ -n "$ofam" ]] || die "$EXIT_CONFIG" \
        "orchestrator.model_family is required when transport.mode = \"mcp\""
      [[ "$fam" != "$ofam" ]] || die "$EXIT_CONFIG" \
        "worker family ($fam) must differ from orchestrator model family ($ofam)"
      ;;
    audit)
      [[ -n "$worker" ]] || die "$EXIT_CONFIG" "enforce_mcp_decorrelation audit: missing worker vendor"
      wfam="$(vendor_family "$worker")"
      [[ "$fam" != "$wfam" ]] || die "$EXIT_CONFIG" \
        "audit family ($fam) must differ from worker family ($wfam)"
      ;;
    *) die "$EXIT_CONFIG" "enforce_mcp_decorrelation: unknown role $role" ;;
  esac
}
