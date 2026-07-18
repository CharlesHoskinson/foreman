#!/usr/bin/env bash
# @description Queue-based lane admission wrapper over pueue (v4.0.4 staged at
#   $HOME/.foreman/tools/pueue/{pueue.exe,pueued.exe}). Foreman lanes call this
#   instead of spawning coding-CLI processes directly whenever pueue is
#   available, so per-vendor concurrency groups (grok/codex/claude) plus a
#   host-wide `gate` group (parallel=1, meant to eventually serialize every
#   bats invocation on the host) are enforced centrally rather than left to
#   each lane's own judgment. `misc` is the catch-all group for everything
#   else; it is created with an EXPLICIT cap of 2 (`pueue parallel 2 --group
#   misc`) -- a deliberate architect decision (Rework Round 1, F1), not an
#   accident: pueue's own inherited default for a freshly created group
#   happens to be 1, but leaving that unset here would make the cap
#   incidental rather than intentional, and truly unlimited (parallel 0)
#   would violate this host's keep-concurrency-low doctrine. 2 is the
#   deliberate middle ground for a catch-all bucket that is not one of the
#   three named vendor lanes.
#
#   When pueue is unavailable -- not on PATH, not staged under
#   $HOME/.foreman/tools/pueue, or LANE_QUEUE_FORCE_MISSING=1 is set (test
#   hook, mirrors DOCS_CHECK_FORCE_MISSING in docs-check.sh:25-33) -- this
#   degrades to direct foreground spawn and emits a one-time "degraded"
#   marker on stderr so callers/log-scrapers can tell queueing was skipped.
#   This fallback keys STRICTLY on BINARY ABSENCE (pueue not resolvable via
#   PATH or the staged dir) or the FORCE_MISSING test hook -- never on
#   daemon liveness. If pueue is installed but the daemon dies between an
#   `ensure` call and a later `add`/`status`/`kill` call, that later call
#   fails loudly (pueue's own nonzero exit, surfaced here as EXIT_FAIL) --
#   it is a hard exit 1 by design, NEVER a silent fall-through to direct
#   spawn. Silently running CMD outside the queue when the caller explicitly
#   asked for queued admission would be worse than a hard, visible failure.
#
#   AUTOSTART DOCTRINE (empirically determined on this host: pueue 4.0.4,
#   Windows/Git-Bash -- full transcript in FOREMAN_REPORT.md): the pueue
#   CLIENT never starts the daemon itself.
#     - First ever run (no config file yet, no daemon): `pueue status` fails
#       immediately, exit 1, "Couldn't find a configuration file. Did you
#       start the daemon yet?".
#     - Config file present (pueued has run at least once) but the daemon is
#       down: `pueue status` fails immediately, exit 1, "Failed to connect to
#       the daemon on 127.0.0.1:<port>. Did you start it?".
#   Neither path spawns pueued -- both are plain, immediate client errors.
#   `ensure` below therefore always spawns `pueued -d` itself (`-d`/
#   --daemonize forks pueued into the background; confirmed via `tasklist`
#   that the forked pueued.exe process survives the launching shell)
#   whenever the first `pueue status` probe fails, then bounded-retries the
#   probe for up to ~5s before giving up.
# Usage: lane-queue.sh ensure
#        lane-queue.sh add GROUP -- CMD [ARGS...]
#        lane-queue.sh status [TASK_ID]
#        lane-queue.sh kill TASK_ID
# Env: LANE_QUEUE_FORCE_MISSING=1 forces the pueue-absent fallback path
#      regardless of PATH/staged-binary presence (test hook).
# @exitcode 0 success (ensure: ready; add: enqueued/CMD's own code in
#   fallback; status/kill: pueue's own outcome)
# @exitcode 1 daemon unreachable after bounded retry (ensure); a pueue call
#   itself failed (add/status/kill, non-fallback)
# @exitcode 2 usage error (bad subcommand/args, invalid GROUP, kill with no
#   TASK_ID); kill in fallback mode (nothing to kill)
# @exitcode 3 pueue absent -- fallback mode (ensure only)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

# --- arity guard (before unguarded positional use under set -u) ---
if (( $# < 1 )); then
  echo "usage: lane-queue.sh ensure|add GROUP -- CMD [ARGS...]|status [TASK_ID]|kill TASK_ID" >&2
  exit "$EXIT_CONFIG"
fi

# @description Resolve the pueue CLIENT executable: PATH first, then the
#   staged install dir ($HOME/.foreman/tools/pueue). LANE_QUEUE_FORCE_MISSING=1
#   short-circuits to "not found" regardless of what is actually on disk
#   (test hook mirroring docs-check.sh's DOCS_CHECK_FORCE_MISSING pattern,
#   docs-check.sh:25-33).
# @stdout the resolved executable path (CR-free)
# @exitcode 0 found; 1 absent
lq_pueue_bin() {
  [[ "${LANE_QUEUE_FORCE_MISSING:-0}" == "1" ]] && return 1
  if command -v pueue >/dev/null 2>&1; then
    command -v pueue
    return 0
  fi
  local staged="$HOME/.foreman/tools/pueue/pueue.exe"
  if [[ -x "$staged" ]]; then
    printf '%s\n' "$staged"
    return 0
  fi
  staged="$HOME/.foreman/tools/pueue/pueue"
  if [[ -x "$staged" ]]; then
    printf '%s\n' "$staged"
    return 0
  fi
  return 1
}

# @description Resolve the pueued DAEMON executable using the same
#   PATH-then-staged resolution as lq_pueue_bin (and the same
#   LANE_QUEUE_FORCE_MISSING test hook). Only `ensure` needs this --
#   add/status/kill never start the daemon themselves.
# @stdout the resolved executable path (CR-free)
# @exitcode 0 found; 1 absent
lq_pueued_bin() {
  [[ "${LANE_QUEUE_FORCE_MISSING:-0}" == "1" ]] && return 1
  if command -v pueued >/dev/null 2>&1; then
    command -v pueued
    return 0
  fi
  local staged="$HOME/.foreman/tools/pueue/pueued.exe"
  if [[ -x "$staged" ]]; then
    printf '%s\n' "$staged"
    return 0
  fi
  staged="$HOME/.foreman/tools/pueue/pueued"
  if [[ -x "$staged" ]]; then
    printf '%s\n' "$staged"
    return 0
  fi
  return 1
}

# @description Probe whether the pueue daemon is reachable.
# @arg $1 pueue_bin resolved pueue client executable path
# @exitcode 0 daemon reachable; nonzero otherwise
lq_status_probe() {
  "$1" status >/dev/null 2>&1
}

# @description Idempotently create one pueue group and, when a parallelism N
#   is supplied, set it. "already exists" from `pueue group add` is tolerated
#   (not an error, per the durable-lanes portability checklist); any other
#   group-add/parallel failure is logged to stderr but does not abort ensure
#   -- the daemon already answered the status probe before this is called, so
#   a genuine failure here is unexpected but should not block the caller's
#   ability to still enqueue work.
# @arg $1 pueue_bin resolved pueue client executable path
# @arg $2 name group name
# @arg $3 parallel optional parallelism; empty means "leave pueue's default"
lq_ensure_group() {
  local pueue_bin="$1" name="$2" parallel="$3" err rc
  rc=0
  err="$("$pueue_bin" group add "$name" 2>&1 >/dev/null)" || rc=$?
  if [[ "$rc" != 0 ]]; then
    err="${err//$'\r'/}"
    [[ "$err" == *"already exists"* ]] || echo "lane-queue: group add $name: $err" >&2
  fi
  if [[ -n "$parallel" ]]; then
    rc=0
    err="$("$pueue_bin" parallel "$parallel" --group "$name" 2>&1 >/dev/null)" || rc=$?
    if [[ "$rc" != 0 ]]; then
      err="${err//$'\r'/}"
      echo "lane-queue: parallel $parallel --group $name: $err" >&2
    fi
  fi
  return 0
}

# @description `ensure` subcommand: resolve pueue, start pueued if the daemon
#   is unreachable (empirically, the pueue CLIENT never autostarts it -- see
#   the AUTOSTART DOCTRINE note in this file's header), then idempotently
#   create the fixed group topology (grok=1, codex=1, claude=3, misc=2
#   EXPLICIT -- see the header's Rework Round 1 F1 note, gate=1).
# @exitcode 0 ready; 1 daemon unreachable after bounded retry; 3 pueue absent
cmd_ensure() {
  local pueue_bin pueued_bin
  if ! pueue_bin="$(lq_pueue_bin)"; then
    echo "lane-queue: pueue not found on PATH or \$HOME/.foreman/tools/pueue -- fallback mode" >&2
    return "$EXIT_MISSING_CLI"
  fi
  if ! pueued_bin="$(lq_pueued_bin)"; then
    echo "lane-queue: pueue client found but pueued daemon binary missing -- fallback mode" >&2
    return "$EXIT_MISSING_CLI"
  fi

  if ! lq_status_probe "$pueue_bin"; then
    # AUTOSTART DOCTRINE (see header): the client never spawns the daemon --
    # this script has to do it explicitly.
    "$pueued_bin" -d >/dev/null 2>&1 || true
    local waited=0 ready=1
    while (( waited < 5 )); do
      if lq_status_probe "$pueue_bin"; then
        ready=0
        break
      fi
      sleep 1
      waited=$((waited + 1))
    done
    if (( ready != 0 )); then
      echo "lane-queue: pueued daemon unreachable after spawn + ${waited}s retry" >&2
      return "$EXIT_FAIL"
    fi
  fi

  local spec
  for spec in grok:1 codex:1 claude:3 misc:2 gate:1; do
    lq_ensure_group "$pueue_bin" "${spec%%:*}" "${spec#*:}"
  done
  echo "lane-queue: ready (groups: grok codex claude misc gate)" >&2
  return "$EXIT_OK"
}

# @description `add` subcommand: enqueue CMD/ARGS into pueue group GROUP, or
#   -- in fallback mode (pueue absent / LANE_QUEUE_FORCE_MISSING=1) -- run CMD
#   directly in the foreground and print `direct` instead of a task id. CMD
#   and ARGS are always passed through to `pueue add` as separate argv
#   elements (never joined into a shell string by this script).
# @arg $1 group target pueue group name, must match ^[a-z][a-z0-9_-]*$
# @arg $2 dashdash literal "--" separating GROUP from CMD
# @arg $@ cmd_and_args CMD followed by its ARGS
# @stdout the pueue task id, CR-free (fallback: the literal string `direct`)
# @exitcode 0 enqueued (fallback: CMD's own exit code); 1 pueue add failed; 2 usage error
cmd_add() {
  local group="${1:-}" dashdash="${2:-}"
  if [[ -z "$group" || "$dashdash" != "--" ]]; then
    echo "usage: lane-queue.sh add GROUP -- CMD [ARGS...]" >&2
    return "$EXIT_CONFIG"
  fi
  if [[ ! "$group" =~ ^[a-z][a-z0-9_-]*$ ]]; then
    echo "lane-queue: invalid GROUP '$group' (must match ^[a-z][a-z0-9_-]*\$)" >&2
    return "$EXIT_CONFIG"
  fi
  shift 2
  if [[ $# -eq 0 ]]; then
    echo "usage: lane-queue.sh add GROUP -- CMD [ARGS...]" >&2
    return "$EXIT_CONFIG"
  fi

  local pueue_bin
  if ! pueue_bin="$(lq_pueue_bin)"; then
    echo "lane-queue: degraded direct-spawn (pueue absent)" >&2
    local rc=0
    "$@" || rc=$?
    echo "direct"
    return "$rc"
  fi

  local out rc=0
  out="$("$pueue_bin" add --group "$group" --print-task-id -- "$@" 2>&1)" || rc=$?
  out="${out//$'\r'/}"
  if [[ "$rc" != 0 ]]; then
    echo "$out" >&2
    return "$EXIT_FAIL"
  fi
  printf '%s\n' "$out"
  return "$EXIT_OK"
}

# @description `status` subcommand: whole-queue or single-task JSON via
#   `pueue status --json`. Fallback mode (pueue absent) prints a fixed
#   degraded sentinel instead of querying anything.
# @arg $1 task_id optional; when given, filters to that task's object
# @stdout JSON, CR-free: the full `pueue status --json` body, or one task's
#   object (`{}` if the id is absent -- tolerate missing fields), or
#   `{"degraded":true}` in fallback mode
# @exitcode 0 ok / fallback; 1 pueue status failed, or (single-task path) the
#   jq filter itself failed -- its rc is captured explicitly, never left to
#   abort via a bare set -e/pipefail pipeline exit
cmd_status() {
  local task_id="${1:-}"
  local pueue_bin
  if ! pueue_bin="$(lq_pueue_bin)"; then
    printf '%s\n' '{"degraded":true}'
    return "$EXIT_OK"
  fi
  local raw rc=0
  raw="$("$pueue_bin" status --json 2>&1)" || rc=$?
  raw="${raw//$'\r'/}"
  if [[ "$rc" != 0 ]]; then
    echo "$raw" >&2
    return "$EXIT_FAIL"
  fi
  if [[ -n "$task_id" ]]; then
    local filtered
    if ! filtered="$(printf '%s' "$raw" | jq -c --arg id "$task_id" '.tasks[$id] // {}' 2>&1)"; then
      echo "${filtered//$'\r'/}" >&2
      return "$EXIT_FAIL"
    fi
    printf '%s\n' "${filtered//$'\r'/}"
  else
    printf '%s\n' "$raw"
  fi
  return "$EXIT_OK"
}

# @description `kill` subcommand: `pueue kill TASK_ID`. Fallback mode has
#   nothing to kill -- direct spawns are owned by the caller's own foreground
#   process, not by lane-queue.sh -- so this is a usage error there.
# @arg $1 task_id required, must match ^[0-9]+$
# @stdout pueue's own confirmation text, CR-free
# @exitcode 0 killed; 1 pueue kill failed; 2 usage error (missing/non-numeric
#   TASK_ID) / fallback mode
cmd_kill() {
  local task_id="${1:-}"
  if [[ -z "$task_id" ]]; then
    echo "usage: lane-queue.sh kill TASK_ID" >&2
    return "$EXIT_CONFIG"
  fi
  if [[ ! "$task_id" =~ ^[0-9]+$ ]]; then
    echo "lane-queue: invalid TASK_ID '$task_id' (must match ^[0-9]+\$)" >&2
    return "$EXIT_CONFIG"
  fi
  local pueue_bin
  if ! pueue_bin="$(lq_pueue_bin)"; then
    echo "lane-queue: kill unsupported in fallback mode (direct spawns are owned by the caller)" >&2
    return "$EXIT_CONFIG"
  fi
  local out rc=0
  out="$("$pueue_bin" kill "$task_id" 2>&1)" || rc=$?
  out="${out//$'\r'/}"
  if [[ "$rc" != 0 ]]; then
    echo "$out" >&2
    return "$EXIT_FAIL"
  fi
  printf '%s\n' "$out"
  return "$EXIT_OK"
}

SUBCOMMAND="$1"
shift
case "$SUBCOMMAND" in
  ensure) cmd_ensure "$@" ;;
  add) cmd_add "$@" ;;
  status) cmd_status "$@" ;;
  kill) cmd_kill "$@" ;;
  *)
    echo "usage: lane-queue.sh ensure|add GROUP -- CMD [ARGS...]|status [TASK_ID]|kill TASK_ID" >&2
    exit "$EXIT_CONFIG"
    ;;
esac
exit $?
