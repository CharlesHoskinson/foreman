#!/usr/bin/env bats
# @description Tests for lane-supervise.sh (v0.2.5 T8): classification
#   (COMPLETED/ALIVE/locked/ABANDONED/SKIP), the resume_max_attempts cap
#   (idempotent across two consecutive sweeps), dirty-refusal handling,
#   --dry-run's zero-mutation guarantee, and the pueue-absent
#   ready-to-run-command degrade. Synthetic runs are built by emitting events
#   with el_emit directly (no real lane-run.sh round ever executes) plus a
#   PATH-shim fake `resume.sh`/`lane-queue.sh` pair that records argv and
#   returns a controllable rc. ONE integration case uses the REAL resume.sh
#   against a genuine checkpoint in a throwaway git worktree, with only
#   lane-queue.sh faked for the re-enqueue half.
bats_require_minimum_version 1.5.0
load helpers

# @description Write a fake resume.sh to $SHIM_DIR: records argv (\x1f-joined)
#   to $SHIM_LOG_RESUME, then behaves per $FAKE_RESUME_RC -- 5 = dirty refusal
#   (matches resume.sh's own exit-5 contract), 0 = success (prints a PROMPT
#   line like the real one), anything else = a generic failure.
#   FAKE_RESUME_SIGNAL_MARKER=PATH (rework round 1 signal test): touch PATH
#   the instant this fake starts (proof the sweeper has reached this exact
#   slow call), then sleep up to 5s waiting to be killed by the TEST (which
#   signals the REAL top-level lane-supervise.sh pid directly, captured via
#   its own `$!` -- NOT this fake's own $PPID: `ls_handle_abandoned` invokes
#   resume.sh with a `2>&1` merge, and empirically that redirection makes
#   bash fork a genuine intermediate subshell for the command substitution,
#   so $PPID as seen from inside this fake is that EPHEMERAL subshell, not
#   the sweeper's own pid -- signaling by the test-captured real pid is the
#   only reliable way to hit the sweeper's own installed trap).
_write_fake_resume() {
  cat > "$SHIM_DIR/resume.sh" <<'SHIM'
#!/usr/bin/env bash
{
  printf 'resume.sh'
  for a in "$@"; do printf '\x1f%s' "$a"; done
  printf '\n'
} >> "$SHIM_LOG_RESUME"
if [[ -n "${FAKE_RESUME_SIGNAL_MARKER:-}" ]]; then
  : > "$FAKE_RESUME_SIGNAL_MARKER"
  sleep 5
  exit 0
fi
rc="${FAKE_RESUME_RC:-0}"
case "$rc" in
  5) echo "refusing to overwrite uncommitted work; re-run with --force" >&2; exit 5 ;;
  0) echo 'PROMPT: {}'; exit 0 ;;
  *) echo "resume.sh: simulated failure rc=$rc" >&2; exit "$rc" ;;
esac
SHIM
  chmod +x "$SHIM_DIR/resume.sh"
}

# @description Write a fake lane-queue.sh to $SHIM_DIR: records argv
#   (\x1f-joined) to $SHIM_LOG_LQ. `ensure` returns $FAKE_LQ_ENSURE_RC (never
#   executes anything, matching the real ensure's own no-CMD-execution
#   contract). `add` returns $FAKE_LQ_ADD_RC and, on success, prints
#   $FAKE_LQ_TASK_ID as the task id -- it never actually runs CMD/ARGS either
#   way (a real pueue-absent fallback WOULD, which is exactly the risk
#   lane-supervise.sh's ensure-first probe exists to avoid; this fake proves
#   lane-supervise.sh never depends on that fallback executing anything).
_write_fake_lane_queue() {
  cat > "$SHIM_DIR/lane-queue.sh" <<'SHIM'
#!/usr/bin/env bash
{
  printf 'lane-queue.sh'
  for a in "$@"; do printf '\x1f%s' "$a"; done
  printf '\n'
} >> "$SHIM_LOG_LQ"
sub="${1:-}"
case "$sub" in
  ensure) exit "${FAKE_LQ_ENSURE_RC:-0}" ;;
  add)
    rc="${FAKE_LQ_ADD_RC:-0}"
    if [[ "$rc" == "0" ]]; then echo "${FAKE_LQ_TASK_ID:-42}"; else echo "lane-queue: simulated add failure" >&2; fi
    exit "$rc"
    ;;
  *) exit 0 ;;
esac
SHIM
  chmod +x "$SHIM_DIR/lane-queue.sh"
}

# @description Emit a synthetic ownership event matching lane-run.sh's exact
#   shipped payload shape ({attempt, launcher_pid, pid, job_id, worktree,
#   config_dir, launcher:true}) -- ground truth read from lane_emit_ownership.
#   MSYS_NO_PATHCONV=1 mirrors lane_emit_ownership's OWN guard on this exact
#   jq call: without it, MSYS silently rewrites a bare POSIX-looking absolute
#   path argument (e.g. $BATS_TEST_TMPDIR's "/c/Users/...") to Windows form
#   ("C:/Users/...") before jq.exe ever sees it, storing a DIFFERENT string
#   than the caller's own $wt -- exactly the hazard lane-run.sh's own comment
#   documents for this same call site.
# @arg $1 run  @arg $2 lane  @arg $3 attempt  @arg $4 launcher_pid (empty = null)
# @arg $5 pid (empty = null)  @arg $6 worktree
_emit_ownership() {
  local run="$1" lane="$2" attempt="$3" lpid="$4" pid="$5" wt="$6"
  local payload
  payload="$(
    MSYS_NO_PATHCONV=1 jq -cn --argjson attempt "$attempt" --arg lp "$lpid" --arg pid "$pid" --arg wt "$wt" \
    '{attempt:$attempt,
      launcher_pid:(if $lp=="" then null else ($lp|tonumber) end),
      pid:(if $pid=="" then null else ($pid|tonumber) end),
      job_id:null, worktree:$wt, config_dir:null, launcher:true}'
  )"
  el_emit "$run" ownership "$lane" "$payload" >/dev/null
}

setup() {
  export FOREMAN_HOME="$BATS_TEST_TMPDIR/fh"
  SCRIPTS="$BATS_TEST_DIRNAME/../skills/foreman/scripts"
  source "$SCRIPTS/lib/common.sh"
  source "$SCRIPTS/lib/eventlog.sh"
  source "$SCRIPTS/lib/config.sh"
  SHIM_DIR="$BATS_TEST_TMPDIR/shim"
  mkdir -p "$SHIM_DIR"
  SHIM_LOG_RESUME="$BATS_TEST_TMPDIR/resume.log"
  SHIM_LOG_LQ="$BATS_TEST_TMPDIR/lq.log"
  : > "$SHIM_LOG_RESUME"
  : > "$SHIM_LOG_LQ"
  export SHIM_LOG_RESUME SHIM_LOG_LQ
  _write_fake_resume
  _write_fake_lane_queue
  PATH_WITH_SHIM="$SHIM_DIR:$PATH"
}

# --- classification: COMPLETED / ALIVE / locked / SKIP ---

@test "COMPLETED: round_done in the latest round -> noop, never touches resume.sh/lane-queue.sh" {
  el_init run1
  el_emit run1 prompt lane-a '{"cmd":"echo hi"}' >/dev/null
  el_emit run1 round_done lane-a '{"exit_code":0}' >/dev/null
  run env PATH="$PATH_WITH_SHIM" bash "$SCRIPTS/lane-supervise.sh" --once run1
  [ "$status" -eq 0 ]
  [[ "$output" == *"COMPLETED"* ]]
  [ ! -s "$SHIM_LOG_RESUME" ]
  [ ! -s "$SHIM_LOG_LQ" ]
}

@test "ALIVE: ownership launcher_pid is a genuinely live process -> noop" {
  el_init run1
  sleep 60 &
  local livepid=$!
  el_emit run1 prompt lane-a '{"cmd":"echo hi"}' >/dev/null
  _emit_ownership run1 lane-a 1 "$livepid" "" "$BATS_TEST_TMPDIR/wt-alive"
  run env PATH="$PATH_WITH_SHIM" bash "$SCRIPTS/lane-supervise.sh" --once run1
  kill "$livepid" 2>/dev/null || true
  wait "$livepid" 2>/dev/null || true
  [ "$status" -eq 0 ]
  [[ "$output" == *"ALIVE"* ]]
  [ ! -s "$SHIM_LOG_RESUME" ]
}

@test "locked: worktree lane.lock held -> noop even with an unresolvable/dead pid (SC-E)" {
  el_init run1
  local wt="$BATS_TEST_TMPDIR/wt-locked"
  mkdir -p "$wt/.harness/lane.lock"
  el_emit run1 prompt lane-a '{"cmd":"echo hi"}' >/dev/null
  _emit_ownership run1 lane-a 1 999999999 "" "$wt"
  run env PATH="$PATH_WITH_SHIM" bash "$SCRIPTS/lane-supervise.sh" --once run1
  [ "$status" -eq 0 ]
  [[ "$output" == *"ALIVE"* ]]
  [ ! -s "$SHIM_LOG_RESUME" ]
}

@test "SKIP: a lane with events but no prompt ever recorded -> noop, logged as SKIP" {
  el_init run1
  el_emit run1 heartbeat lane-a '{}' >/dev/null
  run env PATH="$PATH_WITH_SHIM" bash "$SCRIPTS/lane-supervise.sh" --once run1
  [ "$status" -eq 0 ]
  [[ "$output" == *"no prompt event"* ]]
  [ ! -s "$SHIM_LOG_RESUME" ]
}

@test "ABANDONED but no ownership event ever recorded: never blind-resumes without a WORKTREE" {
  el_init run1
  el_emit run1 prompt lane-a '{"cmd":"echo hi"}' >/dev/null
  run env PATH="$PATH_WITH_SHIM" bash "$SCRIPTS/lane-supervise.sh" --once run1
  [ "$status" -eq 0 ]
  [[ "$output" == *"cannot recover its worktree path"* ]]
  [ ! -s "$SHIM_LOG_RESUME" ]
}

# --- ABANDONED action: resume + resume-event + re-enqueue ---

@test "ABANDONED under cap: resume.sh runs (no --force), resume event emitted, round re-enqueued via lane-queue.sh" {
  el_init run1
  local wt="$BATS_TEST_TMPDIR/wt-abandoned"
  mkdir -p "$wt"
  el_emit run1 prompt lane-a '{"cmd":"grok implement spec.md"}' >/dev/null
  _emit_ownership run1 lane-a 1 999999999 999999998 "$wt"

  run env PATH="$PATH_WITH_SHIM" FAKE_RESUME_RC=0 FAKE_LQ_ENSURE_RC=0 FAKE_LQ_ADD_RC=0 \
    bash "$SCRIPTS/lane-supervise.sh" --once run1
  [ "$status" -eq 0 ]
  [[ "$output" == *"ABANDONED"* ]]
  [[ "$output" == *"re-enqueued"* ]]

  # resume.sh invoked with exactly RUN LANE WT, never --force.
  grep -qF $'resume.sh\x1frun1\x1flane-a\x1f'"$wt" "$SHIM_LOG_RESUME"
  ! grep -q -- '--force' "$SHIM_LOG_RESUME"

  # lane-queue.sh add misc -- bash <lane-run.sh> run1 lane-a WT -- bash -c CMD
  grep -qF $'lane-queue.sh\x1fadd\x1fmisc\x1f--\x1fbash' "$SHIM_LOG_LQ"
  grep -qF 'lane-run.sh' "$SHIM_LOG_LQ"
  grep -qF -- $'--\x1fbash\x1f-c\x1fgrok implement spec.md' "$SHIM_LOG_LQ"

  local resume_evt
  resume_evt="$(jq -c 'select(.type=="resume")' "$(run_dir run1)/events.jsonl")"
  [ "$(jq -r .payload.resume_count <<<"$resume_evt")" = "1" ]
  [ "$(jq -r .payload.lane <<<"$resume_evt")" = "lane-a" ]
}

@test "resume succeeds but pueue unavailable (ensure fails): prints ready-to-run command, never calls add" {
  el_init run1
  local wt="$BATS_TEST_TMPDIR/wt-nopueue"
  mkdir -p "$wt"
  el_emit run1 prompt lane-a '{"cmd":"echo recovered-cmd"}' >/dev/null
  _emit_ownership run1 lane-a 1 999999999 999999998 "$wt"

  run env PATH="$PATH_WITH_SHIM" FAKE_RESUME_RC=0 FAKE_LQ_ENSURE_RC=3 \
    bash "$SCRIPTS/lane-supervise.sh" --once run1
  [ "$status" -eq 0 ]
  [[ "$output" == *"ready-to-run"* ]]
  [[ "$output" == *"lane-run.sh"* ]]
  grep -qF $'lane-queue.sh\x1fensure' "$SHIM_LOG_LQ"
  ! grep -qF $'\x1fadd\x1f' "$SHIM_LOG_LQ"

  # resume itself still succeeded and is durably recorded, independent of
  # whether re-enqueue could be confirmed.
  local resumes; resumes="$(jq -c 'select(.type=="resume")' "$(run_dir run1)/events.jsonl" | wc -l)"
  [ "$resumes" -eq 1 ]
}

# --- dirty refusal ---

@test "resume.sh dirty refusal (exit 5): alert emitted ONCE across two sweeps (idempotent, rework round 1), no crash, resume_count NOT incremented, never re-enqueues" {
  el_init run1
  local wt="$BATS_TEST_TMPDIR/wt-dirty"
  mkdir -p "$wt"
  el_emit run1 prompt lane-a '{"cmd":"grok implement spec.md"}' >/dev/null
  _emit_ownership run1 lane-a 1 999999999 999999998 "$wt"

  run env PATH="$PATH_WITH_SHIM" FAKE_RESUME_RC=5 bash "$SCRIPTS/lane-supervise.sh" --once run1
  [ "$status" -eq 0 ]
  [[ "$output" == *"refused"* ]]

  # Second consecutive sweep: the tree is STILL dirty (fake keeps returning
  # rc=5) -- resume.sh is retried (an operator cleaning the tree should let
  # a later sweep succeed normally), but the alert must NOT be re-emitted.
  run env PATH="$PATH_WITH_SHIM" FAKE_RESUME_RC=5 bash "$SCRIPTS/lane-supervise.sh" --once run1
  [ "$status" -eq 0 ]
  [[ "$output" == *"already emitted"* ]]

  local resumes alerts resume_calls
  resumes="$(jq -c 'select(.type=="resume")' "$(run_dir run1)/events.jsonl" | wc -l)"
  alerts="$(jq -c 'select(.type=="alert" and .payload.kind=="resume_refused_dirty")' "$(run_dir run1)/events.jsonl" | wc -l)"
  resume_calls="$(grep -c 'resume.sh' "$SHIM_LOG_RESUME")"
  [ "$resume_calls" -eq 2 ]   # resume.sh WAS retried both sweeps
  [ "$resumes" -eq 0 ]
  [ "$alerts" -eq 1 ]
  [ ! -s "$SHIM_LOG_LQ" ]
}

# --- cap: exactly one terminal alert across TWO consecutive sweeps ---

@test "cap reached: exactly one terminal abandoned alert across two consecutive sweeps, never an (N+1)th resume" {
  el_init run1
  local wt="$BATS_TEST_TMPDIR/wt-cap"
  mkdir -p "$wt"
  el_emit run1 prompt lane-a '{"cmd":"grok implement spec.md"}' >/dev/null
  _emit_ownership run1 lane-a 1 999999999 999999998 "$wt"
  # Pre-seed resume_count=1 (as if one prior successful auto-resume already
  # happened) so max=1 is already reached BEFORE either sweep runs.
  el_emit run1 resume lane-a '{"lane":"lane-a","resume_count":1,"from_checkpoint":""}' >/dev/null

  run env PATH="$PATH_WITH_SHIM" RESUME_MAX_ATTEMPTS=1 FAKE_RESUME_RC=0 FAKE_LQ_ENSURE_RC=0 FAKE_LQ_ADD_RC=0 \
    bash "$SCRIPTS/lane-supervise.sh" --once run1
  [ "$status" -eq 0 ]
  [[ "$output" == *"cap reached"* ]]
  [ ! -s "$SHIM_LOG_RESUME" ]   # cap already reached on entry -- resume.sh never runs

  run env PATH="$PATH_WITH_SHIM" RESUME_MAX_ATTEMPTS=1 FAKE_RESUME_RC=0 FAKE_LQ_ENSURE_RC=0 FAKE_LQ_ADD_RC=0 \
    bash "$SCRIPTS/lane-supervise.sh" --once run1
  [ "$status" -eq 0 ]
  [[ "$output" == *"already emitted"* ]]
  [ ! -s "$SHIM_LOG_RESUME" ]

  local alerts resumes
  alerts="$(jq -c 'select(.type=="alert" and .payload.kind=="abandoned")' "$(run_dir run1)/events.jsonl" | wc -l)"
  resumes="$(jq -c 'select(.type=="resume")' "$(run_dir run1)/events.jsonl" | wc -l)"
  [ "$alerts" -eq 1 ]     # exactly one terminal alert total, not two
  [ "$resumes" -eq 1 ]    # still just the one pre-seeded -- no (N+1)th
}

# --- --dry-run: zero mutation ---

@test "--dry-run: prints the planned action, byte-identical events.jsonl, never calls resume.sh/lane-queue.sh" {
  el_init run1
  local wt="$BATS_TEST_TMPDIR/wt-dry"
  mkdir -p "$wt"
  el_emit run1 prompt lane-a '{"cmd":"grok implement spec.md"}' >/dev/null
  _emit_ownership run1 lane-a 1 999999999 999999998 "$wt"
  local before; before="$(cat "$(run_dir run1)/events.jsonl")"

  run env PATH="$PATH_WITH_SHIM" bash "$SCRIPTS/lane-supervise.sh" --dry-run --once run1
  [ "$status" -eq 0 ]
  [[ "$output" == *"dry-run"* ]]
  [[ "$output" == *"would run resume.sh"* ]]
  [ "$(cat "$(run_dir run1)/events.jsonl")" = "$before" ]
  [ ! -s "$SHIM_LOG_RESUME" ]
  [ ! -s "$SHIM_LOG_LQ" ]
}

@test "--dry-run at cap: prints would-emit-alert, never actually emits it" {
  el_init run1
  local wt="$BATS_TEST_TMPDIR/wt-dry-cap"
  mkdir -p "$wt"
  el_emit run1 prompt lane-a '{"cmd":"grok implement spec.md"}' >/dev/null
  _emit_ownership run1 lane-a 1 999999999 999999998 "$wt"
  el_emit run1 resume lane-a '{"lane":"lane-a","resume_count":1,"from_checkpoint":""}' >/dev/null
  local before; before="$(cat "$(run_dir run1)/events.jsonl")"

  run env PATH="$PATH_WITH_SHIM" RESUME_MAX_ATTEMPTS=1 bash "$SCRIPTS/lane-supervise.sh" --dry-run --once run1
  [ "$status" -eq 0 ]
  [[ "$output" == *"dry-run"* ]]
  [[ "$output" == *"would emit terminal alert"* ]]
  [ "$(cat "$(run_dir run1)/events.jsonl")" = "$before" ]
}

# --- --all mode ---

@test "--all sweeps every run directory under FOREMAN_HOME/runs" {
  el_init run1
  el_emit run1 prompt lane-a '{"cmd":"echo hi"}' >/dev/null
  el_emit run1 round_done lane-a '{"exit_code":0}' >/dev/null
  el_init run2
  el_emit run2 heartbeat lane-b '{}' >/dev/null
  run env PATH="$PATH_WITH_SHIM" bash "$SCRIPTS/lane-supervise.sh" --all
  [ "$status" -eq 0 ]
  [[ "$output" == *"run1 lane lane-a: COMPLETED"* ]]
  [[ "$output" == *"run2 lane lane-b"* ]]
}

# --- lock / usage / trivial no-op ---

@test "a held .supervise.lock makes the sweep skip that run and return 1 (never races a concurrent sweeper)" {
  el_init run1
  mkdir -p "$(run_dir run1)/.supervise.lock"
  run env PATH="$PATH_WITH_SHIM" bash "$SCRIPTS/lane-supervise.sh" --once run1
  [ "$status" -eq 1 ]
  [[ "$output" == *".supervise.lock held"* ]]
}

@test "rework round 1: a SIGTERM mid-sweep (during resume.sh) releases .supervise.lock instead of stranding it" {
  el_init run1
  local wt="$BATS_TEST_TMPDIR/wt-signal"
  mkdir -p "$wt"
  el_emit run1 prompt lane-a '{"cmd":"grok implement spec.md"}' >/dev/null
  _emit_ownership run1 lane-a 1 999999999 999999998 "$wt"

  # Same pattern tests/lane-run.bats already uses for its own TERM tests:
  # background the REAL process, capture its own $! (the ONLY reliable pid
  # to signal -- see _write_fake_resume's doc comment on why the fake's own
  # $PPID does not work here), bounded-wait for proof the slow call was
  # truly reached, then signal by that real pid and capture the exit status
  # via `wait`.
  local marker="$BATS_TEST_TMPDIR/resume-running"
  rm -f "$marker"
  env PATH="$PATH_WITH_SHIM" FAKE_RESUME_SIGNAL_MARKER="$marker" \
    bash "$SCRIPTS/lane-supervise.sh" --once run1 &
  local sweeper_pid=$!

  local waited=0
  while [[ ! -f "$marker" ]]; do
    sleep 0.1
    waited=$((waited + 1))
    [ "$waited" -gt 100 ] && break   # 10s bound
  done
  [ -f "$marker" ]   # sanity: the slow call was genuinely reached

  kill -TERM "$sweeper_pid" 2>/dev/null || true
  local sweep_status=0
  wait "$sweeper_pid" || sweep_status=$?
  [ "$sweep_status" -eq 143 ]
  [ ! -d "$(run_dir run1)/.supervise.lock" ]

  # Proof the lock is genuinely usable again afterward, not just "absent by
  # accident": a normal follow-up sweep must succeed cleanly.
  run env PATH="$PATH_WITH_SHIM" FAKE_RESUME_RC=0 FAKE_LQ_ENSURE_RC=0 FAKE_LQ_ADD_RC=0 \
    bash "$SCRIPTS/lane-supervise.sh" --once run1
  [ "$status" -eq 0 ]
  [[ "$output" == *"ABANDONED"* ]]
}

@test "--once against a run with no events at all is a trivial no-op" {
  run env PATH="$PATH_WITH_SHIM" bash "$SCRIPTS/lane-supervise.sh" --once neverseen
  [ "$status" -eq 0 ]
  [[ "$output" == *"no events"* ]]
}

@test "usage errors: no args, unknown flag, --once missing RUN, bad RUN charset -> exit 2" {
  run env PATH="$PATH_WITH_SHIM" bash "$SCRIPTS/lane-supervise.sh"
  [ "$status" -eq 2 ]
  run env PATH="$PATH_WITH_SHIM" bash "$SCRIPTS/lane-supervise.sh" --bogus
  [ "$status" -eq 2 ]
  run env PATH="$PATH_WITH_SHIM" bash "$SCRIPTS/lane-supervise.sh" --once
  [ "$status" -eq 2 ]
  run env PATH="$PATH_WITH_SHIM" bash "$SCRIPTS/lane-supervise.sh" --once 'bad run!'
  [ "$status" -eq 2 ]
}

# --- ONE real-resume integration case ---

@test "integration: real resume.sh restores a genuine checkpoint for an ABANDONED lane, then re-enqueues via fake lane-queue.sh" {
  el_init run1
  source "$SCRIPTS/lib/checkpoint.sh"
  setup_git_worktree
  local lane="lane-real"
  echo "resumed-content" > "$WT/f"
  local sha; sha="$(ckpt_snapshot "$WT" "$lane")"
  el_emit run1 checkpoint "$lane" '{}' "$sha" >/dev/null
  git -C "$WT" checkout -- . 2>/dev/null   # leave the worktree CLEAN at "base"
  [ "$(cat "$WT/f")" = "base" ]

  el_emit run1 prompt "$lane" '{"cmd":"echo recovered"}' >/dev/null
  _emit_ownership run1 "$lane" 1 999999999 999999998 "$WT"

  # This test resolves resume.sh to the REAL co-located script (no fake
  # resume.sh shadowing it on PATH) but still fakes lane-queue.sh for the
  # re-enqueue half, per the spec's "one real-resume integration case".
  local real_shim="$BATS_TEST_TMPDIR/real-shim"
  mkdir -p "$real_shim"
  cp "$SHIM_DIR/lane-queue.sh" "$real_shim/lane-queue.sh"
  chmod +x "$real_shim/lane-queue.sh"

  run env PATH="$real_shim:$PATH" FAKE_LQ_ENSURE_RC=0 FAKE_LQ_ADD_RC=0 \
    bash "$SCRIPTS/lane-supervise.sh" --once run1
  [ "$status" -eq 0 ]
  [[ "$output" == *"ABANDONED"* ]]
  [[ "$output" == *"re-enqueued"* ]]
  [ "$(cat "$WT/f")" = "resumed-content" ]   # the REAL checkpoint was actually restored

  grep -qF $'lane-queue.sh\x1fadd\x1fmisc' "$SHIM_LOG_LQ"
  local resumes; resumes="$(jq -c 'select(.type=="resume")' "$(run_dir run1)/events.jsonl" | wc -l)"
  [ "$resumes" -eq 1 ]
}
