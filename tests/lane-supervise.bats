# bats test data (run via `bats`, not as a product executable)
#!/usr/bin/env bats
# @description Adapter + one-shot Node supervisor parity for lane-supervise.sh
#   (R5D). Seeds typed events.ndjson under FOREMAN_HOME/runs/<id>/ and invokes
#   the thin shell adapter that execs the tracked lane-supervise.js bundle.
bats_require_minimum_version 1.5.0
load helpers

# @description 40-char lowercase hex commit placeholder (or real SHA).
_sha40() {
  if [[ -n "${1:-}" ]]; then printf '%s' "$1"; else printf 'a%.0s' {1..40}; fi
}

# @description Seed a typed recoverable abandoned round with ownership.
# @arg $1 run  @arg $2 lane  @arg $3 worktree  @arg $4 commit40  @arg $5 command
_seed_recoverable() {
  local run="$1" lane="$2" wt="$3" commit="$4" cmd="${5:-impl}"
  local rd
  rd="$(run_dir "$run")"
  mkdir -p "$rd"
  jq -cn \
    --arg lane "$lane" \
    --arg run "$run" \
    --arg wt "$wt" \
    --arg commit "$commit" \
    --arg cmd "$cmd" \
    --arg report "$wt/FOREMAN_REPORT.md" \
    '{
      events: [
        {
          seq:1, ts:"2026-08-05T12:00:00Z", type:"prompt", lane:$lane,
          payload:{
            attempt:1,
            roundPlan:{
              schemaVersion:1,
              runId:$run,
              laneId:$lane,
              attemptId:1,
              mode:"round",
              commandArgv:[$cmd],
              gateCommand:"true",
              reportPath:$report,
              reportBaseline:{_tag:"Absent"}
            }
          }
        },
        {
          seq:2, ts:"2026-08-05T12:00:01Z", type:"checkpoint", lane:$lane,
          commit:$commit, payload:{attempt:1}
        },
        {
          seq:3, ts:"2026-08-05T12:00:02Z", type:"ownership", lane:$lane,
          payload:{
            attempt:1, launcher_pid:null, pid:null, job_id:null,
            worktree:$wt, config_dir:null, launcher:true
          }
        }
      ]
    }' | jq -c '.events[]' > "$rd/events.ndjson"
}

# @description Seed a completed typed round.
_seed_completed() {
  local run="$1" lane="$2"
  local rd c dig
  rd="$(run_dir "$run")"
  mkdir -p "$rd"
  c="$(_sha40)"
  dig="$(printf 'b%.0s' {1..64})"
  jq -cn \
    --arg lane "$lane" \
    --arg run "$run" \
    --arg c "$c" \
    --arg dig "$dig" \
    '{
      events:[
        {seq:1, ts:"2026-08-05T12:00:00Z", type:"prompt", lane:$lane,
         payload:{attempt:1, roundPlan:{
           schemaVersion:1, runId:$run, laneId:$lane, attemptId:1,
           mode:"round", commandArgv:["echo","hi"], gateCommand:"true",
           reportPath:"/r.md", reportBaseline:{_tag:"Absent"}}}},
        {seq:2, ts:"2026-08-05T12:00:01Z", type:"checkpoint", lane:$lane,
         commit:$c, payload:{attempt:1}},
        {seq:3, ts:"2026-08-05T12:00:02Z", type:"state", lane:$lane,
         payload:{attempt:1, state:"verifying"}},
        {seq:4, ts:"2026-08-05T12:00:03Z", type:"round_done", lane:$lane,
         payload:{attempt:1, outcome:{
           _tag:"completed",
           attemptIdentity:{runId:$run, laneId:$lane, attemptId:1},
           implementationExitCode:0, gateExitCode:0, reportFresh:true,
           reportBaseline:{_tag:"Absent"},
           report:{_tag:"Present", digest:$dig, byteLength:4}
         }}}
      ]
    }' | jq -c '.events[]' > "$rd/events.ndjson"
}

setup() {
  export FOREMAN_HOME="$BATS_TEST_TMPDIR/fh"
  mkdir -p "$FOREMAN_HOME"
  SCRIPTS="$BATS_TEST_DIRNAME/../skills/foreman/scripts"
  source "$SCRIPTS/lib/common.sh"
  BUNDLE="$SCRIPTS/../runtime/dist/lane-supervise.js"
  [ -f "$BUNDLE" ]
}

@test "adapter is thin: no product decision/restore/queue logic in the shell file" {
  local src
  src="$(cat "$SCRIPTS/lane-supervise.sh")"
  [[ "$src" == *"runtime/dist/lane-supervise.js"* ]]
  [[ "$src" == *"exec"* ]]
  ! grep -qE 'decideRoundResume|reserveResumeAttempt|WorktreeRestore|QueueSubmitter' \
    "$SCRIPTS/lane-supervise.sh"
  ! grep -q 'resume\.sh' "$SCRIPTS/lane-supervise.sh"
}

@test "COMPLETED: typed round_done -> COMPLETED, no events.ndjson mutation" {
  _seed_completed run1 lane-a
  local before
  before="$(cat "$(run_dir run1)/events.ndjson")"
  run env FOREMAN_HOME="$FOREMAN_HOME" bash "$SCRIPTS/lane-supervise.sh" --once run1
  [ "$status" -eq 0 ]
  [[ "$output" == *"COMPLETED"* ]]
  [ "$(cat "$(run_dir run1)/events.ndjson")" = "$before" ]
}

@test "ALIVE: ownership launcher_pid is a live process -> WAIT, no mutation" {
  local wt="$BATS_TEST_TMPDIR/wt-alive"
  mkdir -p "$wt"
  sleep 60 &
  local livepid=$!
  local c40
  c40="$(_sha40)"
  _seed_recoverable run1 lane-a "$wt" "$c40" "echo hi"
  local rd
  rd="$(run_dir run1)"
  head -n 2 "$rd/events.ndjson" > "$rd/events.ndjson.tmp"
  jq -cn --arg lane lane-a --arg wt "$wt" --argjson pid "$livepid" \
    '{seq:3, ts:"2026-08-05T12:00:02Z", type:"ownership", lane:$lane,
      payload:{attempt:1, launcher_pid:$pid, pid:null, worktree:$wt, launcher:true}}' \
    >> "$rd/events.ndjson.tmp"
  mv "$rd/events.ndjson.tmp" "$rd/events.ndjson"
  local before
  before="$(cat "$rd/events.ndjson")"
  run env FOREMAN_HOME="$FOREMAN_HOME" bash "$SCRIPTS/lane-supervise.sh" --once run1
  kill "$livepid" 2>/dev/null || true
  wait "$livepid" 2>/dev/null || true
  [ "$status" -eq 0 ]
  [[ "$output" == *"WAIT"* ]]
  [ "$(cat "$rd/events.ndjson")" = "$before" ]
}

@test "locked: worktree lane.lock held -> WAIT lock_held, no mutation" {
  local wt="$BATS_TEST_TMPDIR/wt-locked"
  mkdir -p "$wt/.harness/lane.lock"
  local c40
  c40="$(_sha40)"
  _seed_recoverable run1 lane-a "$wt" "$c40"
  local before
  before="$(cat "$(run_dir run1)/events.ndjson")"
  run env FOREMAN_HOME="$FOREMAN_HOME" bash "$SCRIPTS/lane-supervise.sh" --once run1
  [ "$status" -eq 0 ]
  [[ "$output" == *"WAIT"* ]]
  [[ "$output" == *"lock_held"* ]]
  [ "$(cat "$(run_dir run1)/events.ndjson")" = "$before" ]
}

@test "SKIP: lane with events but no prompt -> no prompt event" {
  local rd
  rd="$(run_dir run1)"
  mkdir -p "$rd"
  jq -cn '{seq:1, ts:"2026-08-05T12:00:00Z", type:"heartbeat", lane:"lane-a", payload:{}}' \
    > "$rd/events.ndjson"
  run env FOREMAN_HOME="$FOREMAN_HOME" bash "$SCRIPTS/lane-supervise.sh" --once run1
  [ "$status" -eq 0 ]
  [[ "$output" == *"no prompt event"* ]]
}

@test "no ownership worktree: never blind-resumes" {
  local rd c40
  rd="$(run_dir run1)"
  mkdir -p "$rd"
  c40="$(_sha40)"
  jq -cn --arg c "$c40" \
    '{
      events:[
        {seq:1, ts:"2026-08-05T12:00:00Z", type:"prompt", lane:"lane-a",
         payload:{attempt:1, roundPlan:{
           schemaVersion:1, runId:"run1", laneId:"lane-a", attemptId:1,
           mode:"round", commandArgv:["echo"], gateCommand:"true",
           reportPath:"/r.md", reportBaseline:{_tag:"Absent"}}}},
        {seq:2, ts:"2026-08-05T12:00:01Z", type:"checkpoint", lane:"lane-a",
         commit:$c, payload:{attempt:1}}
      ]
    }' | jq -c '.events[]' > "$rd/events.ndjson"
  run env FOREMAN_HOME="$FOREMAN_HOME" bash "$SCRIPTS/lane-supervise.sh" --once run1
  [ "$status" -eq 0 ]
  [[ "$output" == *"no ownership"* ]]
}

@test "cap reached: resume_limit_reached, no mutation" {
  local wt="$BATS_TEST_TMPDIR/wt-cap"
  mkdir -p "$wt"
  local c40
  c40="$(_sha40)"
  _seed_recoverable run1 lane-a "$wt" "$c40"
  jq -cn '{seq:4, ts:"2026-08-05T12:00:03Z", type:"resume_attempt", lane:"lane-a",
    payload:{attempt:1, resumeCount:1}}' >> "$(run_dir run1)/events.ndjson"
  local before
  before="$(cat "$(run_dir run1)/events.ndjson")"
  run env FOREMAN_HOME="$FOREMAN_HOME" RESUME_MAX_ATTEMPTS=1 \
    bash "$SCRIPTS/lane-supervise.sh" --once run1
  [ "$status" -eq 0 ]
  [[ "$output" == *"REFUSED"* ]]
  [[ "$output" == *"resume_limit"* ]]
  [ "$(cat "$(run_dir run1)/events.ndjson")" = "$before" ]
}

@test "--dry-run: plans resume, byte-identical events.ndjson" {
  local wt="$BATS_TEST_TMPDIR/wt-dry"
  mkdir -p "$wt"
  git -C "$wt" init -q -b main
  git -C "$wt" config user.email t@e.com
  git -C "$wt" config user.name t
  git -C "$wt" config commit.gpgsign false
  echo base > "$wt/f"
  git -C "$wt" -c core.hooksPath= add f
  git -C "$wt" -c core.hooksPath= commit -qm init
  local sha
  sha="$(git -C "$wt" rev-parse HEAD)"
  _seed_recoverable run1 lane-a "$wt" "$sha" "echo recovered"
  local before
  before="$(cat "$(run_dir run1)/events.ndjson")"
  run env FOREMAN_HOME="$FOREMAN_HOME" bash "$SCRIPTS/lane-supervise.sh" --dry-run --once run1
  [ "$status" -eq 0 ]
  [[ "$output" == *"dry-run"* ]]
  [ "$(cat "$(run_dir run1)/events.ndjson")" = "$before" ]
}

@test "--all sweeps every run directory under FOREMAN_HOME/runs" {
  _seed_completed run1 lane-a
  local rd2
  rd2="$(run_dir run2)"
  mkdir -p "$rd2"
  jq -cn '{seq:1, ts:"2026-08-05T12:00:00Z", type:"heartbeat", lane:"lane-b", payload:{}}' \
    > "$rd2/events.ndjson"
  run env FOREMAN_HOME="$FOREMAN_HOME" bash "$SCRIPTS/lane-supervise.sh" --all
  [ "$status" -eq 0 ]
  [[ "$output" == *"run1"* ]]
  [[ "$output" == *"run2"* ]]
}

@test "a held .supervise.lock makes the sweep skip that run and return 1" {
  local rd
  rd="$(run_dir run1)"
  mkdir -p "$rd/.supervise.lock"
  : > "$rd/events.ndjson"
  run env FOREMAN_HOME="$FOREMAN_HOME" bash "$SCRIPTS/lane-supervise.sh" --once run1
  [ "$status" -eq 1 ]
  [[ "$output" == *".supervise.lock held"* ]]
}

@test "--once against a run with no events at all is a trivial no-op" {
  run env FOREMAN_HOME="$FOREMAN_HOME" bash "$SCRIPTS/lane-supervise.sh" --once neverseen
  [ "$status" -eq 0 ]
  [[ "$output" == *"no events"* ]]
}

@test "usage errors: no args, unknown flag, --once missing RUN, bad RUN path -> exit 2" {
  run env FOREMAN_HOME="$FOREMAN_HOME" bash "$SCRIPTS/lane-supervise.sh"
  [ "$status" -eq 2 ]
  run env FOREMAN_HOME="$FOREMAN_HOME" bash "$SCRIPTS/lane-supervise.sh" --bogus
  [ "$status" -eq 2 ]
  run env FOREMAN_HOME="$FOREMAN_HOME" bash "$SCRIPTS/lane-supervise.sh" --once
  [ "$status" -eq 2 ]
  run env FOREMAN_HOME="$FOREMAN_HOME" bash "$SCRIPTS/lane-supervise.sh" --once 'bad/run'
  [ "$status" -eq 2 ]
}

@test "integration: clean worktree restore + Ready when pueue forced missing" {
  local wt="$BATS_TEST_TMPDIR/wt-int"
  mkdir -p "$wt"
  git -C "$wt" init -q -b main
  git -C "$wt" config user.email t@e.com
  git -C "$wt" config user.name t
  git -C "$wt" config commit.gpgsign false
  echo base > "$wt/f"
  git -C "$wt" -c core.hooksPath= add f
  git -C "$wt" -c core.hooksPath= commit -qm init
  echo resumed-content > "$wt/f"
  git -C "$wt" -c core.hooksPath= add f
  git -C "$wt" -c core.hooksPath= commit -qm tip
  local sha
  sha="$(git -C "$wt" rev-parse HEAD)"
  # Worktree is clean at tip; checkpoint is tip (overlay checkout of same tree).
  _seed_recoverable run1 lane-real "$wt" "$sha" "echo recovered"
  run env FOREMAN_HOME="$FOREMAN_HOME" LANE_QUEUE_FORCE_MISSING=1 \
    FOREMAN_SKILL_ROOT="$SCRIPTS/.." \
    bash "$SCRIPTS/lane-supervise.sh" --once run1
  [ "$status" -eq 0 ]
  [[ "$output" == *"resumed"* ]] || [[ "$output" == *"ready-to-run"* ]]
  local resumes
  resumes="$(jq -c 'select(.type=="resume_attempt")' "$(run_dir run1)/events.ndjson" | wc -l)"
  [ "$resumes" -ge 1 ]
  [[ "$output" == *"--round"* ]] || [[ "$output" == *"lane-run.sh"* ]]
}
