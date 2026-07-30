#!/usr/bin/env bats
# @description Tests for wt-cleanup.sh. No coverage of this script existed in
#   the suite before v0.2.5 T6. Centerpiece: the 2026-07-17 data-loss
#   regression (bugeventlog.md, "wt-cleanup archives only FOREMAN_REPORT.md,
#   lost V2/V3/V4 audit reports") -- the pre-fix archiver copied only the
#   fixed FOREMAN_REPORT.md/.json pair, so the multi-round audit convention's
#   versioned reports (FOREMAN_REPORT_V2/V3/V4.*) and cold-diff patches
#   (DIFF_V*.patch) were silently gone the instant `git worktree remove` ran.
#   Also covers the ordinary dirty-refusal/--force/--keep-branches behaviors
#   and metadata/branch bookkeeping.
bats_require_minimum_version 1.5.0
load helpers

setup() { setup_tmp_repo; cd "$REPO"; }

@test "wt-cleanup archives FOREMAN_REPORT*.* and DIFF_*.patch (versioned reports + diff patches) before --force removal" {
  WT="$(bash "$SCRIPTS/wt-new.sh" run1 audit roundb | tail -1)"
  echo "V2 findings" > "$WT/FOREMAN_REPORT_V2.md"
  echo "V3 findings" > "$WT/FOREMAN_REPORT_V3.md"
  echo "V4 findings" > "$WT/FOREMAN_REPORT_V4.md"
  echo "cold diff v2" > "$WT/DIFF_V2.patch"
  echo "cold diff v3" > "$WT/DIFF_V3.patch"

  run bash "$SCRIPTS/wt-cleanup.sh" run1 --force
  [ "$status" -eq 0 ]

  archive="$FOREMAN_HOME/runs/run1/reports/audit-roundb"
  [ -d "$archive" ]
  [ -f "$archive/FOREMAN_REPORT.md" ]
  [ -f "$archive/FOREMAN_REPORT.json" ]
  [ -f "$archive/FOREMAN_REPORT_V2.md" ]
  [ -f "$archive/FOREMAN_REPORT_V3.md" ]
  [ -f "$archive/FOREMAN_REPORT_V4.md" ]
  [ -f "$archive/DIFF_V2.patch" ]
  [ -f "$archive/DIFF_V3.patch" ]
  grep -q "V3 findings" "$archive/FOREMAN_REPORT_V3.md"
  grep -q "cold diff v3" "$archive/DIFF_V3.patch"

  [ ! -d "$WT" ]
}

@test "wt-cleanup refuses a dirty worktree without --force but still archives its reports first" {
  WT="$(bash "$SCRIPTS/wt-new.sh" run1 implement fix | tail -1)"
  echo "V2 findings" > "$WT/FOREMAN_REPORT_V2.md"

  run bash "$SCRIPTS/wt-cleanup.sh" run1
  [ "$status" -eq 0 ]
  [[ "$output" == *"DIRTY worktree"* ]]
  [ -d "$WT" ]

  [ -f "$FOREMAN_HOME/runs/run1/reports/implement-fix/FOREMAN_REPORT_V2.md" ]
}

@test "wt-cleanup removes a clean worktree, marks metadata cleaned, prunes, and deletes the branch by default" {
  WT="$(bash "$SCRIPTS/wt-new.sh" run1 implement fix | tail -1)"
  git -C "$WT" -c core.hooksPath= add -A
  git -C "$WT" -c core.hooksPath= commit -qm "worker commit"

  run bash "$SCRIPTS/wt-cleanup.sh" run1
  [ "$status" -eq 0 ]
  [ ! -d "$WT" ]

  meta="$FOREMAN_HOME/runs/run1/worktrees/implement-fix.json"
  grep -q '"status": *"cleaned"' "$meta"
  run git branch --list "foreman/run1/implement/fix"
  [ -z "$output" ]
}

@test "wt-cleanup --keep-branches preserves the branch after removal" {
  WT="$(bash "$SCRIPTS/wt-new.sh" run1 implement fix | tail -1)"
  git -C "$WT" -c core.hooksPath= add -A
  git -C "$WT" -c core.hooksPath= commit -qm "worker commit"

  run bash "$SCRIPTS/wt-cleanup.sh" run1 --keep-branches
  [ "$status" -eq 0 ]
  [ ! -d "$WT" ]

  run git branch --list "foreman/run1/implement/fix"
  [[ "$output" == *"foreman/run1/implement/fix"* ]]
}

# v0.2.7.5 worktree-hardening T5 (net-new clause): SIGINT-before-remove. The
# porcelain-refuse + report-archive halves already ship (guarded by the two
# tests above and the dirty-refuse regression test below); this is the
# genuinely new ordering clause -- a worktree's recorded live lane subprocess
# must be gone BEFORE `git worktree remove` is attempted, never after.
@test "wt-cleanup SIGINTs a worktree's recorded lane subprocess before git worktree remove; pid is gone, removal succeeds" {
  source "$SCRIPTS/lib/common.sh"
  source "$SCRIPTS/lib/eventlog.sh"
  WT="$(bash "$SCRIPTS/wt-new.sh" run1 implement sigint | tail -1)"
  git -C "$WT" -c core.hooksPath= add -A
  git -C "$WT" -c core.hooksPath= commit -qm "clean"

  # A background subprocess to stand in for a still-alive lane. Wrapped in
  # `sleep 300 & wait` (not a bare `sleep 300 &`) so this bash instance stays
  # alive as a real wrapper process rather than exec-optimizing directly into
  # sleep -- matching tests/foreman-cleanup.bats's own established pattern
  # for the same concern.
  # Redirects stdout/stderr AND explicitly closes fd 3 (bats-core's own
  # internal pipe, used to detect test completion by its write end closing) --
  # a well-known bats-core gotcha: a background process that inherits fd 3
  # and is still alive when the test itself finishes keeps that pipe open,
  # so the bats RUNNER hangs waiting for it to close even though every test's
  # own "ok"/"not ok" line has already printed. Empirically confirmed during
  # this task: closing stdout/stderr alone was NOT sufficient -- the orphaned
  # grandchild "sleep 300" left behind after this wrapper is SIGKILL'd still
  # held fd 3 open and the whole bats run hung until it was killed by hand;
  # only after ALSO adding `3>&-` did the run return promptly.
  bash -c 'sleep 300 & wait' >/dev/null 2>&1 3>&- &
  target_pid=$!

  el_init run1 >/dev/null
  payload="$(jq -cn --argjson pid "$target_pid" --arg wt "$WT" \
    '{attempt:1, launcher_pid:null, pid:$pid, job_id:null, worktree:$wt, config_dir:null, launcher:true}' | tr -d '\r')"
  el_emit run1 ownership implement-sigint "$payload" >/dev/null

  run bash "$SCRIPTS/wt-cleanup.sh" run1 --force
  [ "$status" -eq 0 ]
  [[ "$output" == *"SIGINT lane subprocess (pid $target_pid)"* ]]

  # The pid is gone by the time remove was attempted (bounded SIGINT+grace,
  # escalating to SIGKILL -- see wtc_sigint_worktree), and removal succeeded.
  run kill -0 "$target_pid"
  [ "$status" -ne 0 ]
  [ ! -d "$WT" ]

  wait "$target_pid" 2>/dev/null || true
}

# v0.2.7.5 worktree-hardening Rework Round 1 (Risk 3, Opus audit): the
# single-pid SIGINT/KILL above reaps ONLY the recorded pid -- a grandchild
# it spawned is reparented and survives untouched. wtc_sigint_worktree now
# follows up with a tree-sweep (Windows: taskkill //T against the resolved
# winpid; POSIX: process-group signal).
#
# What this test can HONESTLY assert, and why: three independent, fully
# reproducible manual trials during this task (a 2-level nested-bash
# grandchild, a 1-level direct `sleep &` child, and a PowerShell
# Get-CimInstance Win32_Process query against the child's own real Windows
# PID) all confirmed that on THIS host, a plain bash-forked/backgrounded
# job's REAL Win32 ParentProcessId is NOT its logical bash parent's winpid
# at all -- e.g. a direct `sleep &` child's own real ParentProcessId pointed
# to a wholly different, unrelated PID than the backgrounding bash's own
# winpid. This is a genuine, pre-existing MSYS/Cygwin fork-emulation
# architecture constraint (already alluded to in lane-run.sh's own header
# comment: "Windows' native PPID chain for Cygwin/MSYS fork() does not
# match the logical bash process tree") -- no kill mechanism reachable from
# user space (taskkill /T's own PPID walk, or an equivalent from-scratch
# PowerShell Win32_Process recursive walk) can locate such a child via its
# parent's pid, because the OS's own process table simply does not record
# that link. Asserting real cross-process grandchild death here would
# therefore be either flaky or silently platform-dependent, not a genuine
# regression guard.
#
# What IS deterministically, honestly testable -- and what this test
# asserts -- is that the code correctly performs the sweep ATTEMPT with the
# right target: a PATH-shimmed "spy" taskkill (logs its own invocation, then
# execs the REAL taskkill.exe -- a spy, not a stub, so the real attempt
# still runs) combined with the WT_CLEANUP_PROC_ROOT test-only knob
# (mirrors lane-run.bats's own LANE_PROC_ROOT pattern for the identical
# reason: deterministic winpid resolution instead of racing the real
# /proc/<pid>/winpid entry's lifetime) to pin the exact invocation shape.
# This mirrors this exact codebase's own established testing philosophy for
# taskkill-involving code (tests/lane-run.bats's kill_cmd_bounded sweep
# tests stub taskkill for the identical reason: real cross-process sweep
# fidelity is not reliably observable from a test).
@test "wt-cleanup: after the primary recorded pid is confirmed gone, a tree-sweep is attempted against its resolved winpid (Windows //T path)" {
  # The test shims the real taskkill to observe the sweep invocation; without
  # one on PATH its own `command -v taskkill` capture fails outright.
  command -v taskkill >/dev/null 2>&1 \
    || skip "taskkill unavailable: the Windows //T winpid tree-sweep path cannot be exercised on this host"
  source "$SCRIPTS/lib/common.sh"
  source "$SCRIPTS/lib/eventlog.sh"
  WT="$(bash "$SCRIPTS/wt-new.sh" run1 implement treesig | tail -1)"
  git -C "$WT" -c core.hooksPath= add -A
  git -C "$WT" -c core.hooksPath= commit -qm "clean"

  gc_pid_file="$BATS_TEST_TMPDIR/gc.pid"
  bash -c 'sleep 300 & echo $! > "'"$gc_pid_file"'"; wait' >/dev/null 2>&1 3>&- &
  target_pid=$!
  for _ in $(seq 1 50); do [ -f "$gc_pid_file" ] && break; sleep 0.1; done
  [ -f "$gc_pid_file" ]
  gc_pid="$(cat "$gc_pid_file")"

  proc_root="$BATS_TEST_TMPDIR/proc"
  mkdir -p "$proc_root/$target_pid"
  echo "4000000" > "$proc_root/$target_pid/winpid"   # real-but-nonexistent, same convention as lane-run.bats
  export WT_CLEANUP_PROC_ROOT="$proc_root"

  stub_dir="$BATS_TEST_TMPDIR/stub"
  mkdir -p "$stub_dir"
  real_taskkill="$(command -v taskkill)"
  argv_log="$BATS_TEST_TMPDIR/taskkill-argv.log"
  cat > "$stub_dir/taskkill" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$*" >> "$argv_log"
exec "$real_taskkill" "\$@"
EOF
  chmod +x "$stub_dir/taskkill"
  export PATH="$stub_dir:$PATH"

  el_init run1 >/dev/null
  payload="$(jq -cn --argjson pid "$target_pid" --arg wt "$WT" \
    '{attempt:1, launcher_pid:null, pid:$pid, job_id:null, worktree:$wt, config_dir:null, launcher:true}' | tr -d '\r')"
  el_emit run1 ownership implement-treesig "$payload" >/dev/null

  run bash "$SCRIPTS/wt-cleanup.sh" run1 --force
  [ "$status" -eq 0 ]

  # Primary recorded pid: confirmed gone (unchanged proof from the test above).
  run kill -0 "$target_pid"
  [ "$status" -ne 0 ]
  [ ! -d "$WT" ]

  # The tree-sweep fired with the right resolved target and the right flag.
  [ -f "$argv_log" ]
  grep -q -- "4000000" "$argv_log"
  grep -q -- "//T" "$argv_log"

  # Explicit cleanup regardless of the (platform-limited, documented above)
  # real sweep outcome -- never leak the grandchild sleep for its own
  # remaining 300s lifetime.
  kill -9 "$gc_pid" 2>/dev/null || true
  wait "$target_pid" 2>/dev/null || true
}

# T5 Step 5: guard (do NOT reimplement) the ALREADY-shipped dirty-refuse +
# report-archive behavior, combined with proof that the new SIGINT step
# correctly scopes to actual removal only -- a worktree skipped as dirty is
# never removed, so its recorded lane subprocess is left alive.
@test "wt-cleanup: dirty-refuse + archive still guarded; a skipped (dirty) worktree's recorded subprocess is left alive (no removal => no SIGINT)" {
  source "$SCRIPTS/lib/common.sh"
  source "$SCRIPTS/lib/eventlog.sh"
  WT="$(bash "$SCRIPTS/wt-new.sh" run1 implement dirtysig | tail -1)"
  echo dirty > "$WT/uncommitted.txt"
  echo "V2 findings" > "$WT/FOREMAN_REPORT_V2.md"

  # Redirects stdout/stderr AND explicitly closes fd 3 (bats-core's own
  # internal pipe, used to detect test completion by its write end closing) --
  # a well-known bats-core gotcha: a background process that inherits fd 3
  # and is still alive when the test itself finishes keeps that pipe open,
  # so the bats RUNNER hangs waiting for it to close even though every test's
  # own "ok"/"not ok" line has already printed. Empirically confirmed during
  # this task: closing stdout/stderr alone was NOT sufficient -- the orphaned
  # grandchild "sleep 300" left behind after this wrapper is SIGKILL'd still
  # held fd 3 open and the whole bats run hung until it was killed by hand;
  # only after ALSO adding `3>&-` did the run return promptly.
  bash -c 'sleep 300 & wait' >/dev/null 2>&1 3>&- &
  target_pid=$!
  el_init run1 >/dev/null
  payload="$(jq -cn --argjson pid "$target_pid" --arg wt "$WT" \
    '{attempt:1, launcher_pid:null, pid:$pid, job_id:null, worktree:$wt, config_dir:null, launcher:true}' | tr -d '\r')"
  el_emit run1 ownership implement-dirtysig "$payload" >/dev/null

  run bash "$SCRIPTS/wt-cleanup.sh" run1
  [ "$status" -eq 0 ]
  [[ "$output" == *"DIRTY worktree"* ]]
  [ -d "$WT" ]                                                            # already-shipped: dirty tree NOT deleted
  [ -f "$FOREMAN_HOME/runs/run1/reports/implement-dirtysig/FOREMAN_REPORT_V2.md" ]  # already-shipped: archived
  run kill -0 "$target_pid"
  [ "$status" -eq 0 ]                                                     # never SIGINT'd -- worktree was never removed

  kill -9 "$target_pid" 2>/dev/null || true
  wait "$target_pid" 2>/dev/null || true
}
