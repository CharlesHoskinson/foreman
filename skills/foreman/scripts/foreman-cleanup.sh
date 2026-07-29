#!/usr/bin/env bash
# @description Cleanup stage wrapper (v0.2.7.5 lifecycle-three-stage, Task 4):
#   an ORDERED, IDEMPOTENT teardown for one run, composing existing scripts
#   rather than reimplementing them (plan architecture: thin wrapper, not a
#   rewrite). Order (spec: "Cleanup runs a deterministic teardown set"):
#     (a) best-effort SIGINT any lane subprocess this run's event log still
#         shows alive, BEFORE any worktree removal -- a genuinely
#         still-running lane gets a chance to exit cleanly instead of having
#         its worktree yanked out from under it mid-round;
#     (b) delegate to wt-cleanup.sh, which already owns the
#         porcelain-check-before-delete + report-archive rules
#         (worktree-hardening) -- NOT reimplemented here;
#     (c) stop a foreman-owned pueued daemon ONLY when this run's own
#         `.pueued-owned` marker says THIS run started it -- NEVER a blind
#         `pueue shutdown` (the daemon is shared, host-wide state other
#         concurrent runs may legitimately depend on; nothing in this repo
#         writes the marker yet, so this branch is presently inert -- a
#         documented, not silently-assumed, limitation);
#     (d) sweep this run's OWN stale mkdir-mutex lock directories
#         (.seq.lock/.attempt.lock/.supervise.lock under its run dir) --
#         NEVER the global ~/.foreman/gate.lock (the host-wide bats mutex; a
#         concurrent gate may legitimately own it) and never a worktree's own
#         .harness/lane.lock (a live-lane concern, out of scope for a
#         run-dir sweep -- wt-cleanup.sh's own porcelain guard already
#         refuses to remove a worktree that is still genuinely busy).
#   Every step tolerates already-done state: re-running this script twice
#   against the same run is a no-op the second time (idempotent, per spec:
#   "IF Cleanup is interrupted, THEN a re-run SHALL complete the remaining
#   teardown without error").
# Usage: foreman-cleanup.sh RUN_ID [--force]
# @exitcode 0 cleanup completed (or was already done)
# @exitcode 2 usage error (bad RUN_ID, or no such run dir)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"
# shellcheck source=lib/eventlog.sh
source "$SCRIPT_DIR/lib/eventlog.sh"

RUN_ID="${1:?usage: foreman-cleanup.sh RUN_ID [--force]}"
shift || true
FORCE=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --force) FORCE=1; shift ;;
    *) die "$EXIT_CONFIG" "unknown flag: $1" ;;
  esac
done
[[ "$RUN_ID" =~ ^[A-Za-z0-9._-]+$ ]] || die "$EXIT_CONFIG" "bad run id: $RUN_ID"

RD="$(run_dir "$RUN_ID")"
[[ -d "$RD" ]] || die "$EXIT_CONFIG" "no such run: $RUN_ID ($RD)"

# @description Best-effort SIGINT of one lane's latest-round owning pid, IF
#   it is still alive (kill -0). A signal-delivery failure (already dead, no
#   permission, no such pid) is silently tolerated -- this is a courtesy
#   heads-up before worktree removal, never a hard gate on cleanup
#   proceeding. Mirrors lane-supervise.sh's own ownership-pid liveness check
#   (launcher_pid falling back to pid) so the two scripts agree on what
#   "alive" means for a lane.
# @arg $1 events full run event log (newline-delimited JSON, CR-free)
# @arg $2 lane
fc_sigint_lane() {
  local events="$1" lane="$2"
  local last_ownership lpid pid check_pid
  last_ownership="$(jq -c --arg lane "$lane" 'select(.lane==$lane and .type=="ownership")' <<<"$events" 2>/dev/null | tail -n1 | tr -d '\r')"
  [[ -z "$last_ownership" ]] && return 0
  lpid="$(jq -r '.payload.launcher_pid // empty' <<<"$last_ownership" 2>/dev/null | tr -d '\r')"
  pid="$(jq -r '.payload.pid // empty' <<<"$last_ownership" 2>/dev/null | tr -d '\r')"
  check_pid="${lpid:-$pid}"
  [[ -z "$check_pid" ]] && return 0
  if kill -0 "$check_pid" 2>/dev/null; then
    log "cleanup $RUN_ID: SIGINT lane $lane (pid $check_pid) before teardown"
    kill -INT "$check_pid" 2>/dev/null || true
  fi
  return 0
}

# --- (a) SIGINT any still-alive lane subprocess, before any worktree touch ---
if [[ -f "$RD/events.jsonl" ]]; then
  events=""
  events="$(el_read "$RUN_ID" 0 2>/dev/null)" || true
  if [[ -n "$events" ]]; then
    lanes="$(jq -r '.lane' <<<"$events" 2>/dev/null | tr -d '\r' | sort -u)"
    while IFS= read -r lane; do
      [[ -z "$lane" ]] && continue
      fc_sigint_lane "$events" "$lane"
    done <<<"$lanes"
  fi
fi

# --- (b) delegate to wt-cleanup.sh (porcelain guard + report archive) ---
wtc_args=("$RUN_ID")
(( FORCE == 1 )) && wtc_args+=(--force)
bash "$SCRIPT_DIR/wt-cleanup.sh" "${wtc_args[@]}"

# --- (c) stop a foreman-owned pueued ONLY if this run's own marker says so ---
PUEUED_MARKER="$RD/.pueued-owned"
if [[ -f "$PUEUED_MARKER" ]]; then
  pueue_bin=""
  if command -v pueue >/dev/null 2>&1; then
    pueue_bin="$(command -v pueue)"
  elif [[ -x "$HOME/.foreman/tools/pueue/pueue.exe" ]]; then
    pueue_bin="$HOME/.foreman/tools/pueue/pueue.exe"
  elif [[ -x "$HOME/.foreman/tools/pueue/pueue" ]]; then
    pueue_bin="$HOME/.foreman/tools/pueue/pueue"
  fi
  if [[ -n "$pueue_bin" ]]; then
    log "cleanup $RUN_ID: .pueued-owned marker present -- stopping the pueued daemon this run started"
    "$pueue_bin" shutdown >/dev/null 2>&1 || true
  fi
  rm -f "$PUEUED_MARKER"
fi

# --- (d) sweep this run's own stale mkdir-mutex lock directories ---
# NEVER the global ~/.foreman/gate.lock (host-wide bats mutex; a concurrent
# gate may legitimately own it) and never a worktree's own .harness/lane.lock
# (live-lane concern, out of scope for a run-dir sweep).
for stale in "$RD/.seq.lock" "$RD/.attempt.lock" "$RD/.supervise.lock"; do
  if [[ -d "$stale" ]]; then
    rmdir "$stale" 2>/dev/null || true
  fi
done

log "cleanup $RUN_ID complete"
echo "$RD"
