#!/usr/bin/env bats
# @description Coverage for lifecycle-three-stage Task 4: foreman-cleanup.sh,
#   the Cleanup stage wrapper. Exercises the ordered, idempotent teardown:
#   SIGINT a still-alive lane subprocess before touching worktrees, delegate
#   to wt-cleanup.sh (dirty-tree guard + report archive, never reimplemented),
#   consume a `.pueued-owned` marker only when present (never a blind pueue
#   shutdown), and re-run cleanly a second time.
load helpers

setup() {
  setup_tmp_repo
  cd "$REPO"
  SCR="$BATS_TEST_DIRNAME/../skills/foreman/scripts"
}

@test "cleanup preserves a dirty worktree and archives its reports; rerun is idempotent" {
  WT="$(bash "$SCR/wt-new.sh" clnrun implement lane-a | tail -1)"
  echo dirty > "$WT/uncommitted.txt"
  echo report > "$WT/FOREMAN_REPORT.md"

  run bash "$SCR/foreman-cleanup.sh" clnrun
  [ "$status" -eq 0 ]
  [ -d "$WT" ]                                    # dirty tree NOT deleted
  ls "$FOREMAN_HOME/runs/clnrun/reports/implement-lane-a" | grep -q FOREMAN_REPORT

  run bash "$SCR/foreman-cleanup.sh" clnrun        # idempotent rerun
  [ "$status" -eq 0 ]
  [ -d "$WT" ]
}

@test "cleanup removes a clean worktree via wt-cleanup.sh's own porcelain guard (delegated, not reimplemented)" {
  WT="$(bash "$SCR/wt-new.sh" clnrun-clean implement lane-z | tail -1)"
  git -C "$WT" -c core.hooksPath= add -A
  git -C "$WT" -c core.hooksPath= commit -qm "worker commit"

  run bash "$SCR/foreman-cleanup.sh" clnrun-clean
  [ "$status" -eq 0 ]
  [ ! -d "$WT" ]

  run bash "$SCR/foreman-cleanup.sh" clnrun-clean   # idempotent rerun
  [ "$status" -eq 0 ]
}

@test "cleanup logs a best-effort SIGINT attempt against a lane's still-alive owning pid, before worktree teardown" {
  source "$SCR/lib/common.sh"
  source "$SCR/lib/eventlog.sh"
  WT="$(bash "$SCR/wt-new.sh" clnrun-sigint implement lane-b | tail -1)"
  git -C "$WT" -c core.hooksPath= add -A
  git -C "$WT" -c core.hooksPath= commit -qm "clean"

  # A long-lived, harmless background process to serve as the "still alive"
  # owning pid. Asserting the OBSERVABLE code path (kill -0 found it alive,
  # the SIGINT log line fired) rather than the OS-level signal effect: on
  # this host, plain `kill -INT` against a bash pid empirically does NOT
  # reliably terminate it (verified directly -- Windows/MSYS signal delivery
  # to a non-launcher-wrapped process is unreliable, the same reality
  # lane-run.sh's own kill_cmd_bounded/taskkill apparatus exists to work
  # around). foreman-cleanup.sh's SIGINT step is explicitly best-effort
  # (spec/plan wording) -- this test proves the attempt happens, not that
  # this platform's signal delivery is reliable (it is not, and that is a
  # pre-existing, documented platform limitation, not a bug this task fixes).
  bash -c 'sleep 30 & wait' &
  target_pid=$!

  el_init clnrun-sigint >/dev/null
  payload="$(jq -cn --argjson pid "$target_pid" '{attempt:1, launcher_pid:null, pid:$pid, job_id:null, worktree:null, config_dir:null, launcher:true}' | tr -d '\r')"
  el_emit clnrun-sigint ownership lane-b "$payload" >/dev/null

  run bash "$SCR/foreman-cleanup.sh" clnrun-sigint --force
  [ "$status" -eq 0 ]
  [[ "$output" == *"SIGINT lane lane-b (pid $target_pid)"* ]]

  # Reap directly so the test never leaks a background process regardless of
  # whether the OS actually honored the SIGINT.
  kill -9 "$target_pid" 2>/dev/null || true
  wait "$target_pid" 2>/dev/null || true
}

@test "cleanup consumes the .pueued-owned marker when present (never a blind pueue shutdown otherwise)" {
  WT="$(bash "$SCR/wt-new.sh" clnrun-pueue implement lane-d | tail -1)"
  git -C "$WT" -c core.hooksPath= add -A
  git -C "$WT" -c core.hooksPath= commit -qm "clean"
  mkdir -p "$FOREMAN_HOME/runs/clnrun-pueue"
  : > "$FOREMAN_HOME/runs/clnrun-pueue/.pueued-owned"

  run bash "$SCR/foreman-cleanup.sh" clnrun-pueue --force
  [ "$status" -eq 0 ]
  [ ! -f "$FOREMAN_HOME/runs/clnrun-pueue/.pueued-owned" ]
}

@test "cleanup refuses an unknown run id cleanly (no such run dir)" {
  run bash "$SCR/foreman-cleanup.sh" no-such-run-ever
  [ "$status" -ne 0 ]
}
