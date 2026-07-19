#!/usr/bin/env bash
# @description WORKER stage (hard mode) — supervises an untrusted worker
#   under foreman-launch, mirrors its heartbeats into the event log, extracts
#   evidence, and host-side commits the diff. The worker NEVER commits and
#   NEVER holds host secrets: the host stages+commits its edits afterward via
#   git_nohooks, and the worker's env is rebuilt from scratch (env -i) off a
#   small allowlist — never the ambient environment, never FOREMAN_GH_PAT.
#
#   Two profiles, selected by `--profile`/`hard_mode.profile` (default
#   launcher-only):
#     - launcher-only (this file, shipped): runs the worker directly in the
#       run's worktree ($WT), no Docker.
#     - container (Task 4, NOT YET IMPLEMENTED): runs the worker in a
#       hardened devcontainer on an egress-firewalled bridge, working on a
#       clean file copy synced back afterward. Selecting it today dies with
#       EXIT_MISSING_CLI — implement in Task 4, do not bolt it on here.
#
#   Test-only seam: FOREMAN_WORKER_CMD_SHIM. wc_build_argv (lib/worker-cmd.sh)
#   always builds a real vendor invocation (argv[0] literally "grok" or
#   "codex"); when FOREMAN_WORKER_CMD_SHIM is set (non-empty), argv[0] is
#   replaced with it before spawning, so tests can substitute a fake worker
#   executable without a real vendor CLI installed — the same pattern
#   FOREMAN_LAUNCH already uses for the launcher binary itself
#   (fl_resolve_launcher, lib/launch.sh).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"
# shellcheck source=lib/launch.sh
source "$SCRIPT_DIR/lib/launch.sh"
# shellcheck source=lib/worker-cmd.sh
source "$SCRIPT_DIR/lib/worker-cmd.sh"
# shellcheck source=lib/eventlog.sh
source "$SCRIPT_DIR/lib/eventlog.sh"
# shellcheck source=lib/worktree.sh
source "$SCRIPT_DIR/lib/worktree.sh"

TASK_ID="${1:?usage: worker-run.sh TASK_ID [--profile launcher-only|container] [--vendor V]}"
shift

PROFILE_ARG="" VENDOR_ARG=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile) PROFILE_ARG="${2:?--profile requires a value}"; shift 2 ;;
    --vendor)  VENDOR_ARG="${2:?--vendor requires a value}"; shift 2 ;;
    *) die "$EXIT_CONFIG" "unknown argument: $1" ;;
  esac
done

require_cmd jq
require_cmd git

RD="$(run_dir "$TASK_ID")"
[[ -f "$RD/meta.json" ]] || die "$EXIT_CONFIG" "no such task: $TASK_ID (run task-new.sh first)"

WT="$(jq -r .worktree "$RD/meta.json")"
BASE_SHA="$(jq -r .base_sha "$RD/meta.json")"
ROOT="$(jq -r .repo_root "$RD/meta.json")"
CONFIG="$ROOT/.foreman/config.toml"

el_init "$TASK_ID"

# N1: toml_get (common.sh:50), NEVER config_get (nonexistent) / cfg_get
# (closed allowlist, no hard_mode.*).
PROFILE="${PROFILE_ARG:-$(toml_get "$CONFIG" hard_mode.profile launcher-only)}"
VENDOR="${VENDOR_ARG:-$(toml_get "$CONFIG" hard_mode.vendor codex)}"
TO="$(toml_get "$CONFIG" hard_mode.timeout 600)"
# N13: lane label must match ^[A-Za-z0-9._-]+$ — hyphen, no colon.
LANE="worker-$VENDOR"

wt_sweep_stale_locks "$WT"

case "$PROFILE" in
  launcher-only) : ;;
  container)
    die "$EXIT_MISSING_CLI" "hard-mode container profile is not implemented yet (Task 4) — use --profile launcher-only / hard_mode.profile = \"launcher-only\""
    ;;
  *)
    die "$EXIT_CONFIG" "unknown hard_mode.profile: $PROFILE (expected launcher-only|container)"
    ;;
esac

LAUNCHER="$(fl_resolve_launcher)" || die "$EXIT_MISSING_CLI" "hard mode requires foreman-launch"

# Prompt: hard-mode preamble (the worker never commits) + the task goal.
PROMPT_FILE="$RD/worker-prompt.txt"
{
  printf 'Edit files in the worktree only. Do NOT run git or commit — the host commits your changes.\n\n'
  [[ -f "$RD/task.md" ]] && cat "$RD/task.md"
} > "$PROMPT_FILE"

wc_build_argv "$VENDOR" "$PROMPT_FILE" "$WT"
# Test seam (see header comment): swap in a fake worker executable. Gated on
# executability, mirroring the FOREMAN_LAUNCH override (launch.sh) — a set-but-
# non-executable value is ignored, so a stray env var cannot silently redirect
# the worker to a bogus path.
[[ -n "${FOREMAN_WORKER_CMD_SHIM:-}" && -x "${FOREMAN_WORKER_CMD_SHIM:-}" ]] \
  && WC_ARGV[0]="$FOREMAN_WORKER_CMD_SHIM"

# --- Clean-slate env (N6) ---------------------------------------------
# Built from scratch (env -i below); NEVER FOREMAN_GH_PAT or the ambient
# environment. Base allowlist + per-vendor home dir, plus the vendor API
# key ONLY under API-key auth (hard_mode.auth, default oauth — under
# OAuth/home-isolated auth no key is passed at all: a documented narrowing).
# shellcheck disable=SC2034  # read indirectly via ${!_v} in the ENV_KV loop below
FOREMAN_TASK_ID="$TASK_ID"
# shellcheck disable=SC2034  # read indirectly via ${!_v} in the ENV_KV loop below
LANE_VENDOR="$VENDOR"
WORKER_ENV_ALLOW=(PATH HOME USERPROFILE FOREMAN_TASK_ID LANE_VENDOR)
case "$VENDOR" in
  grok)  WORKER_ENV_ALLOW+=(GROK_HOME) ;;
  codex) WORKER_ENV_ALLOW+=(CODEX_HOME) ;;
esac

AUTH_MODE="$(toml_get "$CONFIG" hard_mode.auth oauth)"
if [[ "$AUTH_MODE" == "api-key" ]]; then
  case "$VENDOR" in
    grok)  WORKER_ENV_ALLOW+=(XAI_API_KEY) ;;
    codex) WORKER_ENV_ALLOW+=(OPENAI_API_KEY) ;;
  esac
fi

# Windows-essential vars (native launcher-only worker only — Node's TLS/
# DNS/crypto + auth-file discovery need them); container profile (Linux)
# never adds these.
case "$(uname -s)" in
  *NT*|MINGW*|MSYS*|CYGWIN*)
    WORKER_ENV_ALLOW+=(SYSTEMROOT WINDIR APPDATA LOCALAPPDATA TEMP TMP PATHEXT COMSPEC NUMBER_OF_PROCESSORS)
    ;;
esac

ENV_KV=()
for _v in "${WORKER_ENV_ALLOW[@]}"; do
  [[ -n "${!_v:-}" ]] && ENV_KV+=("$_v=${!_v}")
done

# --- Spawn under supervision (cwd $WT) ---------------------------------
# The `|| rc=$?` is load-bearing under `set -e`: a 124 timeout / 125
# launcher-error is a non-zero exit, and a bare `rc=$?` would abort before
# the mirror + evidence + alert path below ever runs.
rc=0
( cd "$WT" && env -i "${ENV_KV[@]}" "$LAUNCHER" --timeout "$TO" \
    --heartbeat-file "$RD/worker-heartbeat.jsonl" -- "${WC_ARGV[@]}" \
    >"$RD/worker-stdout.log" 2>"$RD/worker-stderr.log" ) || rc=$?

# --- Batch heartbeat mirror (N14) --------------------------------------
# No background process, no tail/FIFO, no lock race: a single pass over the
# heartbeat file after the worker has already exited. foreman-launch's own
# --heartbeat-file is the live view; the event log is the durable mirror.
if [[ -f "$RD/worker-heartbeat.jsonl" ]]; then
  # `|| [[ -n "$line" ]]` so a final line with no trailing newline is not dropped.
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -n "$line" ]] && { el_emit "$TASK_ID" heartbeat "$LANE" "$line" >/dev/null 2>&1 || true; }
  done < "$RD/worker-heartbeat.jsonl"
fi

# --- Stage worker edits + extract evidence (host-side, N10) -------------
# `add -A` FIRST so both evidence and the commit include NEW/untracked files
# (a plain `diff BASE_SHA` compares base->working-tree and omits untracked
# files — the common "worker created a file" case would look empty). The
# staged index vs BASE_SHA is the worker's full change, new files included.
git_nohooks -C "$WT" add -A
mkdir -p "$RD/evidence"
git_nohooks -C "$WT" diff --cached --stat "$BASE_SHA" > "$RD/evidence/diff-stat.txt"
[[ -f "$RD/worker-stdout.log" ]] && cp "$RD/worker-stdout.log" "$RD/evidence/transcript.log"

# --- Host-side commit (N10) --------------------------------------------
# No commit inside the sandbox — this stage runs on the host, over the
# worker's staged edits, only once the worker itself has exited cleanly and
# there is actually something staged.
if [[ "$rc" -eq 0 ]] && ! git_nohooks -C "$WT" diff --cached --quiet; then
  if ! git_nohooks -C "$WT" config user.email >/dev/null 2>&1 \
     || ! git_nohooks -C "$WT" config user.name >/dev/null 2>&1; then
    die "$EXIT_CONFIG" "host git identity (user.name/user.email) is not configured for $WT — cannot host-side commit"
  fi
  git_retry git_nohooks -C "$WT" commit -m "foreman(worker): $TASK_ID"
fi

# --- Outcome -------------------------------------------------------------
case "$rc" in
  124)
    el_emit "$TASK_ID" alert "$LANE" '{"kind":"worker_timeout"}' >/dev/null 2>&1 || true
    exit 124
    ;;
  125)
    el_emit "$TASK_ID" alert "$LANE" '{"kind":"worker_launcher_error"}' >/dev/null 2>&1 || true
    exit 125
    ;;
  *)
    exit "$rc"
    ;;
esac
