#!/usr/bin/env bash
# @description Bounded auto-resume supervisor (v0.2.5 T8). A single-pass
#   sweeper that classifies each lane's LATEST round from the event log alone
#   and, for lanes classified ABANDONED, restores the last checkpoint via
#   resume.sh and re-enqueues a fresh round -- capped by
#   `[durable] resume_max_attempts` (default 2, env RESUME_MAX_ATTEMPTS) so it
#   can never respawn-loop. It owns NO new state store: everything here
#   derives from the v0.2.0/T3 event log, checkpoint refs, and the T1/T2
#   ownership/heartbeat artifacts lane-run.sh already writes.
#
# Usage: lane-supervise.sh [--dry-run] --once RUN | --all
#   --once RUN   sweep one run (the testable unit)
#   --all        sweep every run dir under $FOREMAN_HOME/runs
#   --dry-run    print the verdict and planned action per lane; mutate nothing
#     (no el_emit, no resume.sh, no lane-queue.sh -- the events.jsonl file is
#     byte-identical before and after a --dry-run sweep)
#
# PUEUE-DAEMON SCHEDULING DOCTRINE (plan "NEW Task 8", 2026-07-18 audit): this
#   script is a single sweep, not a daemon -- there is no `while true` loop in
#   here and there never should be. Run it on a fixed interval EXTERNALLY,
#   under the pueue daemon (a scheduled/cron-like trigger enqueuing
#   `lane-supervise.sh --all` on a timer), degrading to a periodic invocation
#   from `scripts/maintenance.sh` when pueue itself is unavailable. Adding an
#   internal poll loop here would duplicate the external scheduler's job and
#   reintroduce exactly the unsupervised long-lived-process class v0.2.5
#   exists to kill.
#
# NEVER-RULES (verbatim from the plan's Task 8 section + SC-E; enforced below,
#   not aspirational):
#   - NEVER respawn while the prior attempt's Job Object/CLI is alive OR the
#     worktree's `.harness/lane.lock` is held (a stale lock from a hard-killed
#     lane-run.sh -- e.g. `kill -9`, which bypasses its cleanup trap -- makes
#     a lane look permanently ALIVE to this script; that is an accepted,
#     conservative safety/liveness tradeoff, not a bug).
#   - NEVER exceed `resume_max_attempts`.
#   - NEVER respawn a lane that already completed (a `round_done` exists for
#     its latest round).
#   - NEVER bypass resume.sh's pre-resume backup -- this script never passes
#     `--force`; a dirty-tree refusal (exit 5) is surfaced as an alert, not
#     silently retried with `--force`.
#   - NEVER count a refused (dirty-tree) resume as progress toward the cap.
#
# ACCEPTED ARCHITECT DECISIONS (rework round 1, recorded so a future reader
#   does not "fix" either of these as an oversight):
#   (a) This script deliberately does NOT re-arm watch.sh on the resumed
#       lane's new attempt. watch.sh is event-log-driven (it auto-detects
#       its own baseline from the lane's latest prompt event, per its own
#       header doc); the re-enqueued round's own new prompt event is enough
#       for a watch.sh instance to rediscover and track it on its own next
#       poll. Spawning a watch.sh process directly from here would itself be
#       an unsupervised, unowned background process -- exactly the class
#       this whole release exists to eliminate -- so this sweeper never
#       spawns one.
#   (b) A launcher-absent round (lane-run.sh's direct-spawn fallback path)
#       never emits an ownership event, so it has no recorded worktree
#       pointer anywhere in the event log. Such lanes are deliberately OUT OF
#       SCOPE for auto-resume (see ls_handle_abandoned's early "cannot
#       recover its worktree path" SKIP) -- a conservative choice: never
#       blind-resume without a WORKTREE, even though it means a
#       launcher-absent lane's abandonment is never auto-healed by this
#       script.
#
# GROUND-TRUTH SHAPES (read from the merged base on this branch; nothing here
#   is invented -- see lane-run.sh/resume.sh/lane-queue.sh/lib/eventlog.sh):
#   - The ownership event payload is exactly {attempt, launcher_pid, pid,
#     job_id, worktree, config_dir, launcher:true} (lane_emit_ownership).
#   - The worktree's single-writer lock is a plain mkdir directory at
#     "$WT/.harness/lane.lock" (lane-run.sh) -- NOT ".lane-run.lock".
#   - lane-run.sh's prompt/round_done/heartbeat/waiting_child/alert payloads
#     carry NO payload.attempt field in the currently shipped code (only the
#     ownership event does, and only on the launcher-PRESENT path). "The
#     latest attempt's events" is therefore derived STRUCTURALLY, as the
#     suffix of a lane's events starting at its LAST prompt event -- not by
#     filtering on a payload.attempt value that most event types never carry.
#   - prompt event payload is `{cmd:"<CMD words joined by a single space>"}"`
#     -- the original argv array is not recoverable byte-for-byte; recovery
#     re-wraps it as `bash -c "$cmd"`, a documented, not a silently-assumed,
#     limitation.
#   - Neither the prompt payload nor any other event records whether a round
#     ran in `--round GATE_CMD REPORT_PATH` mode -- GATE_CMD/REPORT_PATH are
#     lane-run.sh's OWN argv, never mirrored into any event payload. Recovery
#     therefore always re-enqueues PLAIN mode and says so on stderr when a
#     prior round's own round_done/waiting_child shows the lane normally runs
#     in --round mode (payload.gate_rc present), matching the spec's "recover
#     ... if T2 recorded them, else re-dispatch plain and note it".
#   - resume.sh usage: `resume.sh [--force] [--exact] RUN LANE WORKTREE`;
#     exit 5 = dirty-tree refusal (never mutates the tree in that case).
#   - lane-queue.sh usage: `lane-queue.sh add GROUP -- CMD [ARGS...]`. When
#     the pueue BINARY itself is absent, `add`'s own fallback path directly
#     foreground-executes CMD in the CALLING process -- calling `add` blind
#     from a sweeper would recreate the orphan class v0.2.5 exists to kill.
#     This script therefore probes with `lane-queue.sh ensure` FIRST (never
#     executes CMD, only checks/starts the daemon) and only calls `add` when
#     `ensure` reports ready; otherwise it prints the ready-to-run command
#     instead of running anything itself (see ls_reenqueue/ls_print_ready_command).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"
# shellcheck source=lib/eventlog.sh
source "$SCRIPT_DIR/lib/eventlog.sh"
# shellcheck source=lib/config.sh
source "$SCRIPT_DIR/lib/config.sh"

# @description Print usage to stderr.
ls_usage() {
  echo "Usage: lane-supervise.sh [--dry-run] --once RUN | --all" >&2
}

# @description Prefix a diagnostic line with this script's name and write it
#   to stderr. Never touches stdout -- stdout is reserved for the one
#   machine-readable artifact this script ever prints (a ready-to-run command
#   when pueue re-enqueue is unavailable, see ls_print_ready_command).
# @arg $@ message message text; joined with spaces
ls_log() {
  echo "lane-supervise: $*" >&2
}

# @description Resolve the resume.sh sibling to invoke. Precedence:
#   LANE_SUPERVISE_RESUME_BIN env override (authoritative when set) > PATH
#   lookup > co-located "$SCRIPT_DIR/resume.sh". PATH is checked BEFORE the
#   co-located fallback (the opposite order from lane-run.sh's
#   lane_resolve_launcher) deliberately: resume.sh is a same-repo sibling
#   SCRIPT always present at a fixed relative path in real deployments, so
#   the co-located fallback alone would already be correct in production --
#   PATH-first exists purely as the bats test-injection seam the spec calls
#   for ("a fake resume.sh ... on PATH"), and is harmless in practice since a
#   real host essentially never has a `resume.sh` ahead of anything else on
#   PATH. Never execs directly (no -x check needed) -- callers invoke the
#   resolved path via `bash "$resolved" ...`, mirroring how this repo's own
#   bats suite always calls sibling scripts (`bash "$SCRIPTS/resume.sh"`).
# @stdout resolved script path
# @exitcode 0 found; 1 absent (env override set but missing, or not found anywhere)
ls_resolve_resume() {
  if [[ -n "${LANE_SUPERVISE_RESUME_BIN:-}" ]]; then
    [[ -f "$LANE_SUPERVISE_RESUME_BIN" ]] && { printf '%s\n' "$LANE_SUPERVISE_RESUME_BIN"; return 0; }
    return 1
  fi
  local candidate
  if candidate="$(command -v resume.sh 2>/dev/null)" && [[ -n "$candidate" ]]; then
    printf '%s\n' "$candidate"
    return 0
  fi
  candidate="$SCRIPT_DIR/resume.sh"
  [[ -f "$candidate" ]] && { printf '%s\n' "$candidate"; return 0; }
  return 1
}

# @description Resolve the lane-queue.sh sibling to invoke. Same precedence
#   and PATH-first rationale as ls_resolve_resume (test-injection seam for "a
#   fake ... lane-queue.sh on PATH").
# @stdout resolved script path
# @exitcode 0 found; 1 absent
ls_resolve_lane_queue() {
  if [[ -n "${LANE_SUPERVISE_LANE_QUEUE_BIN:-}" ]]; then
    [[ -f "$LANE_SUPERVISE_LANE_QUEUE_BIN" ]] && { printf '%s\n' "$LANE_SUPERVISE_LANE_QUEUE_BIN"; return 0; }
    return 1
  fi
  local candidate
  if candidate="$(command -v lane-queue.sh 2>/dev/null)" && [[ -n "$candidate" ]]; then
    printf '%s\n' "$candidate"
    return 0
  fi
  candidate="$SCRIPT_DIR/lane-queue.sh"
  [[ -f "$candidate" ]] && { printf '%s\n' "$candidate"; return 0; }
  return 1
}

# @description Print the ready-to-run recovered round invocation to stdout
#   (properly shell-quoted, one line) instead of executing it -- the pueue-
#   absent degrade path. An unsupervised direct spawn from a sweeper would
#   recreate the very orphan-process class v0.2.5 exists to kill, so this
#   script NEVER falls back to running the round itself; a human (or another
#   supervised path) must run the printed command.
# @arg $1 lane_run_bin path to lane-run.sh
# @arg $2 run
# @arg $3 lane
# @arg $4 wt worktree path
# @arg $5 cmd recovered CMD string (from the prompt payload)
# @stdout the ready-to-run command line, quoted
ls_print_ready_command() {
  local lane_run_bin="$1" run="$2" lane="$3" wt="$4" cmd="$5"
  local q
  q="$(printf '%q ' bash "$lane_run_bin" "$run" "$lane" "$wt" -- bash -c "$cmd")"
  ls_log "run $run lane $lane: pueue unavailable for re-enqueue -- printing the ready-to-run command instead of spawning it directly (a sweeper direct-spawn would recreate the orphan class v0.2.5 exists to kill)"
  printf '%s\n' "$q"
}

# @description Re-enqueue the recovered round for a resumed lane. Probes
#   `lane-queue.sh ensure` FIRST (never executes CMD -- only checks/starts the
#   pueue daemon and creates groups) so this script can tell "pueue usable"
#   from "pueue absent" WITHOUT ever risking lane-queue.sh add's own
#   pueue-absent fallback (which foreground-executes CMD in the CALLER).
#   Falls back to ls_print_ready_command whenever lane-queue.sh itself cannot
#   be resolved, `ensure` reports non-ready, or `add` itself fails.
# @arg $1 run  @arg $2 lane  @arg $3 wt  @arg $4 cmd  @arg $5 lane_run_bin
ls_reenqueue() {
  local run="$1" lane="$2" wt="$3" cmd="$4" lane_run_bin="$5"
  local lane_queue_bin
  if ! lane_queue_bin="$(ls_resolve_lane_queue)"; then
    ls_log "run $run lane $lane: cannot resolve lane-queue.sh"
    ls_print_ready_command "$lane_run_bin" "$run" "$lane" "$wt" "$cmd"
    return 0
  fi

  local ensure_rc=0
  bash "$lane_queue_bin" ensure >/dev/null 2>&1 || ensure_rc=$?
  if (( ensure_rc != 0 )); then
    ls_log "run $run lane $lane: lane-queue.sh ensure rc=$ensure_rc (pueue unavailable)"
    ls_print_ready_command "$lane_run_bin" "$run" "$lane" "$wt" "$cmd"
    return 0
  fi

  local add_out add_rc=0
  add_out="$(bash "$lane_queue_bin" add misc -- bash "$lane_run_bin" "$run" "$lane" "$wt" -- bash -c "$cmd" 2>&1)" || add_rc=$?
  add_out="${add_out//$'\r'/}"
  if (( add_rc != 0 )); then
    ls_log "run $run lane $lane: lane-queue.sh add failed rc=$add_rc: $add_out"
    ls_print_ready_command "$lane_run_bin" "$run" "$lane" "$wt" "$cmd"
    return 0
  fi
  ls_log "run $run lane $lane: re-enqueued (misc group, task id: $add_out)"
  return 0
}

# @description Act on an ABANDONED lane: enforce the resume_max_attempts cap
#   (emitting exactly one terminal `abandoned` alert on exhaustion,
#   idempotently), else run resume.sh (never --force), classify its outcome
#   (dirty refusal vs failure vs success), and on success emit the `resume`
#   event and re-enqueue the recovered round. Never touches el_emit/resume.sh/
#   lane-queue.sh under --dry-run.
# @arg $1 run  @arg $2 lane  @arg $3 events (full run log, newline-delimited
#   JSON)  @arg $4 round_events (the latest round's events only)  @arg $5 wt
#   (worktree path, empty if never recoverable) @arg $6 dry_run (0|1)
ls_handle_abandoned() {
  local run="$1" lane="$2" events="$3" round_events="$4" wt="$5" dry_run="$6"

  if [[ -z "$wt" ]]; then
    ls_log "run $run lane $lane: ABANDONED but no ownership event was ever recorded for this lane -- cannot recover its worktree path; SKIP (never blind-resume without a known WORKTREE)"
    return 0
  fi

  local max resume_count
  max="$(cfg_get durable resume_max_attempts 2)"
  resume_count="$(jq -c --arg lane "$lane" 'select(.lane==$lane and .type=="resume")' <<<"$events" | wc -l)"

  if (( resume_count >= max )); then
    local already
    already="$(jq -c --arg lane "$lane" 'select(.type=="alert" and .lane==$lane and .payload.kind=="abandoned")' <<<"$events" | wc -l)"
    if (( already > 0 )); then
      ls_log "run $run lane $lane: cap reached (resume_count=$resume_count/$max); terminal alert already emitted; STOP (idempotent no-op)"
      return 0
    fi
    if (( dry_run == 1 )); then
      ls_log "run $run lane $lane: [dry-run] would emit terminal alert {kind:abandoned, attempts:$resume_count} (cap $max reached); STOP"
      return 0
    fi
    local alert_payload
    alert_payload="$(jq -cn --arg lane "$lane" --argjson attempts "$resume_count" '{kind:"abandoned", lane:$lane, attempts:$attempts}' | tr -d '\r')"
    if ! el_emit "$run" alert "$lane" "$alert_payload" >/dev/null; then
      ls_log "run $run lane $lane: el_emit alert (abandoned) failed"
    fi
    ls_log "run $run lane $lane: cap reached (resume_count=$resume_count/$max); terminal abandoned alert emitted; STOP"
    return 0
  fi

  if (( dry_run == 1 )); then
    ls_log "run $run lane $lane: [dry-run] would run resume.sh $run $lane $wt (resume_count=$resume_count/$max, no --force) and, on success, re-enqueue"
    return 0
  fi

  local resume_bin
  if ! resume_bin="$(ls_resolve_resume)"; then
    ls_log "run $run lane $lane: cannot resolve resume.sh; SKIP"
    return 0
  fi

  local out rc=0
  out="$(bash "$resume_bin" "$run" "$lane" "$wt" 2>&1)" || rc=$?
  out="${out//$'\r'/}"

  if (( rc == 5 )); then
    ls_log "run $run lane $lane: resume.sh refused (dirty worktree, exit 5): $out"
    # Rework round 1 (LOW, Opus audit): a persistently-dirty lane is
    # reconsidered EVERY sweep (dirty refusal never advances resume_count,
    # so it is never capped) -- without an idempotency guard this alert
    # would be re-emitted unbounded, once per sweep, forever. Existence
    # probe first, same idempotency style as the terminal `abandoned` alert
    # below. resume.sh itself is still retried every sweep regardless (an
    # operator cleaning the tree should let a later sweep succeed
    # normally) -- only the ALERT is deduplicated, not the retry.
    local dirty_already
    dirty_already="$(jq -c --arg lane "$lane" 'select(.type=="alert" and .lane==$lane and .payload.kind=="resume_refused_dirty")' <<<"$events" | wc -l)"
    if (( dirty_already > 0 )); then
      ls_log "run $run lane $lane: resume_refused_dirty alert already emitted for this lane; not re-emitting (idempotent)"
    else
      local dirty_payload
      dirty_payload="$(jq -cn --arg lane "$lane" '{kind:"resume_refused_dirty", lane:$lane}' | tr -d '\r')"
      if ! el_emit "$run" alert "$lane" "$dirty_payload" >/dev/null; then
        ls_log "run $run lane $lane: el_emit alert (resume_refused_dirty) failed"
      fi
    fi
    ls_log "run $run lane $lane: dirty refusal counts as this sweep's action; resume_count NOT incremented (never --force, never counted as progress)"
    return 0
  fi

  if (( rc != 0 )); then
    ls_log "run $run lane $lane: resume.sh failed rc=$rc (not a dirty refusal): $out"
    ls_log "run $run lane $lane: not counted as progress; will be reconsidered next sweep"
    return 0
  fi

  # Success. from_checkpoint is best-effort, parsed from resume.sh's OWN
  # stdout (spec: "sha-from-resume-output-or-empty") -- this script never
  # passes --force, so resume.sh's dirty+force "pre-resume backup: SHA (...)"
  # line never fires on this path in practice; empty is the expected normal
  # case, not a failure to extract.
  local from_checkpoint=""
  # `|| true` (rework round 1, LOW): this pipeline legitimately exits 1 in
  # the normal (non---force) path -- grep finds no "pre-resume backup:"
  # line (resume.sh only prints one on its dirty+--force branch, which this
  # script never takes), and under `pipefail` that nonzero grep exit becomes
  # the whole pipeline's exit status even though head/awk trivially succeed
  # on empty input. Stating "no match is the expected common case" explicitly
  # here, rather than relying on incidental set -e-suppression elsewhere in
  # the call chain, is the point of this fix.
  from_checkpoint="$(grep -oE 'pre-resume backup: [0-9a-fA-F]{4,40}' <<<"$out" | head -n1 | awk '{print $3}' || true)"
  from_checkpoint="${from_checkpoint%$'\r'}"
  local new_count=$(( resume_count + 1 ))
  local resume_payload
  resume_payload="$(jq -cn --arg lane "$lane" --argjson resume_count "$new_count" --arg fc "$from_checkpoint" \
    '{lane:$lane, resume_count:$resume_count, from_checkpoint:$fc}' | tr -d '\r')"
  if ! el_emit "$run" resume "$lane" "$resume_payload" >/dev/null; then
    ls_log "run $run lane $lane: el_emit resume failed"
  fi
  ls_log "run $run lane $lane: resume.sh succeeded (resume_count now $new_count/$max); recovering round for re-enqueue"

  local cmd
  cmd="$(jq -r 'select(.type=="prompt") | .payload.cmd' <<<"$round_events" | tail -n1)"
  cmd="${cmd%$'\r'}"

  if jq -e --arg lane "$lane" 'select(.lane==$lane and (.type=="round_done" or .type=="waiting_child") and (.payload.gate_rc != null))' <<<"$events" >/dev/null 2>&1; then
    ls_log "run $run lane $lane: prior rounds used --round mode, but GATE_CMD/REPORT_PATH are never recorded in any event payload in the currently shipped schema -- re-dispatching PLAIN mode (not --round); the resumed round loses gate-phase automation until re-dispatched manually with --round"
  fi

  ls_reenqueue "$run" "$lane" "$wt" "$cmd" "$SCRIPT_DIR/lane-run.sh"
}

# @description Classify one lane's LATEST round and act. "Latest round" is
#   the structural suffix of this lane's events starting at its last prompt
#   event (see the header GROUND-TRUTH note on why this is not a
#   payload.attempt filter). Classification order: no prompt ever -> SKIP;
#   round_done present in the latest round -> COMPLETED (noop); the
#   ownership event's launcher_pid (fallback pid) answers `kill -0`, OR the
#   worktree's ".harness/lane.lock" exists -> ALIVE (noop); else -> ABANDONED
#   (act, via ls_handle_abandoned).
# @arg $1 run  @arg $2 lane  @arg $3 events (full run log)  @arg $4 dry_run (0|1)
ls_sweep_lane() {
  local run="$1" lane="$2" events="$3" dry_run="$4"

  local last_prompt_seq
  last_prompt_seq="$(jq -r --arg lane "$lane" 'select(.lane==$lane and .type=="prompt") | .seq' <<<"$events" | tail -n1)"
  last_prompt_seq="${last_prompt_seq%$'\r'}"
  if [[ -z "$last_prompt_seq" ]]; then
    ls_log "run $run lane $lane: no prompt event ever recorded (no round ever started); SKIP"
    return 0
  fi

  # This host's Windows jq.exe emits CRLF regardless of input cleanliness
  # (every jq invocation in this file strips it, matching the rest of this
  # codebase's convention) -- round_events is fed back into jq as INPUT
  # below, so a stray \r must not survive to poison a later --argjson/numeric use.
  local round_events
  round_events="$(jq -c --arg lane "$lane" --argjson seq "$last_prompt_seq" 'select(.lane==$lane and .seq>=$seq)' <<<"$events" | tr -d '\r')"

  if jq -e 'select(.type=="round_done")' <<<"$round_events" >/dev/null 2>&1; then
    ls_log "run $run lane $lane: COMPLETED (round_done present in the latest round); noop"
    return 0
  fi

  # WT for the lock-file check and (if abandoned) resume.sh: from the LATEST
  # ownership event recorded anywhere for this lane (the worktree does not
  # change across a lane's rounds; a launcher-absent round simply never
  # emits one, in which case wt stays empty and ABANDONED handling refuses
  # to blind-resume -- see ls_handle_abandoned).
  local wt=""
  local last_ownership_any
  last_ownership_any="$(jq -c --arg lane "$lane" 'select(.lane==$lane and .type=="ownership")' <<<"$events" | tail -n1 | tr -d '\r')"
  if [[ -n "$last_ownership_any" ]]; then
    wt="$(jq -r '.payload.worktree // empty' <<<"$last_ownership_any")"
    wt="${wt%$'\r'}"
  fi

  # Liveness pid check uses ONLY the latest ROUND's own ownership event (a
  # stale pid from an earlier, already-completed round must never keep a new
  # round looking alive).
  local alive=0
  local round_ownership
  round_ownership="$(jq -c 'select(.type=="ownership")' <<<"$round_events" | tail -n1 | tr -d '\r')"
  if [[ -n "$round_ownership" ]]; then
    local lpid pid check_pid
    lpid="$(jq -r '.payload.launcher_pid // empty' <<<"$round_ownership")"
    lpid="${lpid%$'\r'}"
    pid="$(jq -r '.payload.pid // empty' <<<"$round_ownership")"
    pid="${pid%$'\r'}"
    check_pid="${lpid:-$pid}"
    if [[ -n "$check_pid" ]] && kill -0 "$check_pid" 2>/dev/null; then
      alive=1
    fi
  fi
  if [[ -n "$wt" && -d "$wt/.harness/lane.lock" ]]; then
    alive=1
  fi

  if (( alive == 1 )); then
    ls_log "run $run lane $lane: ALIVE (owning pid live, or lane.lock held); noop -- never respawn a live/locked lane"
    return 0
  fi

  ls_log "run $run lane $lane: ABANDONED (has a prompt, no round_done, not alive/locked)"
  ls_handle_abandoned "$run" "$lane" "$events" "$round_events" "$wt" "$dry_run"
}

# @description Sweep one run: read its event log once (tolerating a torn/
#   malformed tail the same way resume.sh does -- proceed with the valid
#   prefix, never abort), discover its distinct lanes, and classify+act on
#   each. A missing run directory / empty log is a trivial no-op (0 lanes),
#   not a failure.
# @arg $1 run  @arg $2 dry_run (0|1)
# @exitcode 0 swept (per-lane outcomes are events, not exit-code signals);
#   1 the log exists but el_read could not produce even a usable prefix
ls_sweep_run_body() {
  local run="$1" dry_run="$2"
  local events rc=0
  events="$(el_read "$run" 0)" || rc=$?
  if (( rc != 0 && rc != 2 )); then
    ls_log "run $run: el_read failed rc=$rc"
    return 1
  fi
  if (( rc == 2 )); then
    ls_log "run $run: event log has a malformed/torn line; proceeding with the valid prefix only (never fatal -- matches resume.sh's own tolerance)"
  fi
  if [[ -z "$events" ]]; then
    ls_log "run $run: no events; nothing to sweep"
    return 0
  fi

  local lanes
  lanes="$(jq -r '.lane' <<<"$events" | tr -d '\r' | sort -u)"
  local lane
  while IFS= read -r lane; do
    [[ -z "$lane" ]] && continue
    ls_sweep_lane "$run" "$lane" "$events" "$dry_run"
  done <<<"$lanes"
  return 0
}

# Rework round 1 (MEDIUM, Opus audit): the currently-held `.supervise.lock`
# directory and its owned-flag, as SCRIPT-GLOBAL state -- mirrors
# lane-run.sh's own `lane_lock_owned`/`cleanup()` globals exactly
# (lane-run.sh:529,553-578), just scoped to whichever run ls_sweep_run
# currently holds the lock for. Only ever one at a time: this script sweeps
# runs strictly sequentially, even in --all mode, never concurrently within
# one process.
_LS_LOCK_DIR=""
_LS_LOCK_OWNED=0

# @description Release the currently-held `.supervise.lock`, only if THIS
#   process created it (lane-run.sh's cleanup()/lane_lock_owned doctrine,
#   mirrored exactly: never rmdir a lock directory this process did not
#   itself mkdir). Idempotent -- safe to call more than once (once from the
#   normal end-of-sweep path, and again from a trap if a signal arrives
#   after that but before the trap is torn down).
ls_lock_cleanup() {
  if [[ "$_LS_LOCK_OWNED" == "1" ]]; then
    rmdir "$_LS_LOCK_DIR" 2>/dev/null || true
    _LS_LOCK_OWNED=0
  fi
}

# @description Acquire a per-run `.supervise.lock` (plain mkdir, no stale-lock
#   reclaim -- same ABA-unsafe-on-Git-Bash/MSYS doctrine as el_emit's
#   .seq.lock and lane-run.sh's own worktree lane.lock) so two concurrent
#   sweepers can never race the same run, sweep its lanes, then release.
#   Rework round 1 (MEDIUM, Opus audit): a SIGINT/TERM arriving mid-sweep
#   (e.g. during the slow resume.sh/lane-queue.sh calls inside
#   ls_handle_abandoned) used to strand this lock forever with no signal
#   trap at all -- the run would never be swept again, silently disabling
#   auto-resume for it permanently. Mirrors lane-run.sh's lane.lock
#   critical-section doctrine exactly (lane-run.sh:521-538,579-585): a
#   NON-EXITING pending-signal trap is installed BEFORE mkdir (so a signal
#   arriving in the mkdir/ownership-recording window is recorded, not
#   swallowed); only after mkdir succeeds is anything owned; the REAL
#   cleanup trap (EXIT/INT/TERM) is installed next; then any signal that
#   arrived during that critical section is honored. INT/TERM must
#   TERMINATE the process (same rationale as lane-run.sh: a trap that only
#   cleans up and returns would let the caller keep going as if nothing
#   happened) -- exit codes 130/143 preserved.
# @arg $1 run  @arg $2 dry_run (0|1)
# @exitcode 0 swept; 1 lock held by another sweep, or the sweep body failed;
#   130/143 on INT/TERM received while this run's lock was held
ls_sweep_run() {
  local run="$1" dry_run="$2"
  local rd; rd="$(run_dir "$run")"
  mkdir -p "$rd"

  local _pending_signal=""
  trap '_pending_signal=INT' INT
  trap '_pending_signal=TERM' TERM

  if ! mkdir "$rd/.supervise.lock" 2>/dev/null; then
    ls_log "run $run: .supervise.lock held by another sweep; skipping this run entirely (never race a concurrent sweeper)"
    trap - INT TERM
    return 1
  fi
  _LS_LOCK_DIR="$rd/.supervise.lock"
  _LS_LOCK_OWNED=1

  trap ls_lock_cleanup EXIT
  trap 'ls_lock_cleanup; trap - EXIT INT TERM; exit 130' INT
  trap 'ls_lock_cleanup; trap - EXIT INT TERM; exit 143' TERM

  if [[ -n "$_pending_signal" ]]; then
    ls_log "run $run: signal $_pending_signal received during lock acquisition; exiting"
    case "$_pending_signal" in
      INT) ls_lock_cleanup; trap - EXIT INT TERM; exit 130 ;;
      TERM) ls_lock_cleanup; trap - EXIT INT TERM; exit 143 ;;
    esac
  fi

  local rc=0
  ls_sweep_run_body "$run" "$dry_run" || rc=$?
  ls_lock_cleanup
  trap - EXIT INT TERM
  return "$rc"
}

# @description CLI entry point: parse `[--dry-run] --once RUN | --all`, then
#   sweep the named run or every run directory under $FOREMAN_HOME/runs.
# @arg $@ CLI arguments
# @exitcode 0 swept; 2 usage error; 1 internal failure (unreadable log where
#   one exists, or a per-run lock/read failure)
main() {
  local dry_run=0 mode="" run_arg=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --dry-run) dry_run=1; shift ;;
      --once)
        if [[ $# -lt 2 ]]; then ls_usage; exit "$EXIT_CONFIG"; fi
        if [[ -n "$mode" && "$mode" != "once" ]]; then ls_usage; exit "$EXIT_CONFIG"; fi
        mode=once; run_arg="$2"; shift 2 ;;
      --all)
        if [[ -n "$mode" && "$mode" != "all" ]]; then ls_usage; exit "$EXIT_CONFIG"; fi
        mode=all; shift ;;
      -h|--help) ls_usage; exit "$EXIT_OK" ;;
      *) ls_usage; exit "$EXIT_CONFIG" ;;
    esac
  done
  if [[ -z "$mode" ]]; then ls_usage; exit "$EXIT_CONFIG"; fi
  if [[ "$mode" == "once" ]]; then
    if [[ ! "$run_arg" =~ ^[A-Za-z0-9._-]+$ ]]; then ls_usage; exit "$EXIT_CONFIG"; fi
  fi

  # Resolve [durable] config ONCE per invocation (env > TOML > default;
  # ls_handle_abandoned's cfg_get calls depend on _CFG_VALUES/_CFG_LOADED
  # having been populated -- cfg_load is safe to call more than once but
  # there is no need to repeat it per lane).
  cfg_load

  local overall_rc="$EXIT_OK"
  if [[ "$mode" == "once" ]]; then
    ls_sweep_run "$run_arg" "$dry_run" || overall_rc="$EXIT_FAIL"
  else
    if [[ -d "$FOREMAN_HOME/runs" ]]; then
      local rd run_id
      for rd in "$FOREMAN_HOME"/runs/*/; do
        [[ -d "$rd" ]] || continue
        run_id="$(basename "$rd")"
        ls_sweep_run "$run_id" "$dry_run" || overall_rc="$EXIT_FAIL"
      done
    fi
  fi
  exit "$overall_rc"
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then main "$@"; fi
