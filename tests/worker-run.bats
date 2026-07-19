#!/usr/bin/env bats
# @description Launcher-only profile tests for worker-run.sh (hard-mode
#   Task 3): supervision under a fake foreman-launch, batch heartbeat
#   mirroring into the event log, host-side evidence + commit (the worker
#   itself never commits), a clean-slate env (no ambient secrets reach the
#   worker), and the launcher's 124 (timeout) contract. The container
#   profile (Task 4) is intentionally NOT covered here.
#
# Test-only seam: FOREMAN_WORKER_CMD_SHIM. wc_build_argv (lib/worker-cmd.sh)
# always builds a real vendor invocation (argv[0] = "grok"/"codex", neither
# installed in CI); worker-run.sh honors FOREMAN_WORKER_CMD_SHIM by
# substituting argv[0] with the given path when set, exactly analogous to
# the existing FOREMAN_LAUNCH seam for the launcher binary itself. This
# lets these tests exercise the real argv-building + spawn plumbing against
# a fake worker executable instead of a real grok/codex install.

# @description Create $FH (isolated FOREMAN_HOME), a throwaway git repo
#   acting as both repo_root and worktree (WT), and this run's meta.json +
#   task.md — everything worker-run.sh needs to start.
# @set FH FOREMAN_HOME for this test
# @set T task id
# @set ROOT / WT repo root and worktree path (same directory here — the
#   linked-worktree distinction only matters for the container profile,
#   Task 4, not exercised by this file)
# @set BRANCH / BASE_SHA the run's branch and base commit
# @set RD the run directory
# @set SCRIPTS skills/foreman/scripts in the real checkout
# @set SHIMS a scratch dir for fake executables this test installs
setup_run_with_meta() {
  export FOREMAN_HOME="$BATS_TEST_TMPDIR/foreman-home"
  FH="$FOREMAN_HOME"
  mkdir -p "$FH"

  T="t1"
  ROOT="$BATS_TEST_TMPDIR/repo"
  WT="$ROOT"
  mkdir -p "$ROOT"
  git -C "$ROOT" init -q -b main
  git -C "$ROOT" config user.email t@e.com
  git -C "$ROOT" config user.name t
  echo base > "$ROOT/f"
  git -C "$ROOT" add -A
  git -C "$ROOT" commit -qm base
  BASE_SHA="$(git -C "$ROOT" rev-parse HEAD)"
  BRANCH="ai/$T"
  git -C "$ROOT" checkout -qb "$BRANCH"

  RD="$FH/runs/$T"
  mkdir -p "$RD"
  jq -n --arg t "$T" --arg r "$ROOT" --arg w "$WT" --arg b "$BRANCH" --arg s "$BASE_SHA" \
    '{task_id:$t, repo_root:$r, worktree:$w, branch:$b, base_sha:$s}' > "$RD/meta.json"
  cat > "$RD/task.md" <<'EOF'
# Task t1

## Goal
Trivial test task: edit a file.
EOF

  SCRIPTS="$BATS_TEST_DIRNAME/../skills/foreman/scripts"
  SHIMS="$BATS_TEST_TMPDIR/shims"
  mkdir -p "$SHIMS"
  export ROOT WT T BRANCH BASE_SHA RD SCRIPTS SHIMS
}

# @description Fake foreman-launch: parses --heartbeat-file out of its own
#   args, writes >=1 heartbeat JSON line (matching the real schema's field
#   names closely enough for jq consumers), then execs everything after
#   `--` as the real CMD and exits with its status. Also installs a worker
#   CMD shim (at $SHIMS/worker.sh) that edits $WT/work.txt (giving the host
#   commit something to capture) and dumps its own environment to
#   $SHIMS/worker-env-dump.txt (so a test can assert no secret leaked
#   through). Sets FAKE_LAUNCH.
make_fake_launcher_writing_heartbeat_then_running_cmd() {
  local f="$BATS_TEST_TMPDIR/fake-launcher.sh"
  cat > "$f" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
hb=""
args=("$@")
i=0
cmd=()
while [[ $i -lt ${#args[@]} ]]; do
  case "${args[$i]}" in
    --heartbeat-file) hb="${args[$((i+1))]}"; i=$((i+2)) ;;
    --) i=$((i+1)); cmd=("${args[@]:$i}"); break ;;
    *) i=$((i+1)) ;;
  esac
done
if [[ -n "$hb" ]]; then
  printf '{"ts":"2026-07-18T00:00:00.000Z","launcher_pid":%d,"pid":%d,"job_id":"1","alive":true,"stdout_bytes":0,"stderr_bytes":0,"elapsed_s":0.1}\n' "$$" "$$" >> "$hb"
fi
rc=0
if [[ ${#cmd[@]} -gt 0 ]]; then
  "${cmd[@]}" || rc=$?
fi
if [[ -n "$hb" ]]; then
  printf '{"ts":"2026-07-18T00:00:01.000Z","launcher_pid":%d,"pid":%d,"job_id":"1","alive":false,"stdout_bytes":0,"stderr_bytes":0,"elapsed_s":0.2}\n' "$$" "$$" >> "$hb"
fi
exit "$rc"
EOF
  chmod +x "$f"
  FAKE_LAUNCH="$f"

  local w="$SHIMS/worker.sh"
  cat > "$w" <<EOF
#!/usr/bin/env bash
env > "$SHIMS/worker-env-dump.txt"
echo edited >> "$WT/work.txt"
EOF
  chmod +x "$w"
  export FAKE_LAUNCH
}

# @description Fake foreman-launch that ignores CMD entirely and exits with
#   a fixed code — stands in for a launcher that already killed CMD (e.g. a
#   real timeout: exit 124) before returning. Sets FAKE_LAUNCH.
# @arg $1 exit code to return
make_fake_launcher_exiting() {
  local code="$1" f="$BATS_TEST_TMPDIR/fake-launcher-exit.sh"
  cat > "$f" <<EOF
#!/usr/bin/env bash
exit $code
EOF
  chmod +x "$f"
  FAKE_LAUNCH="$f"
  export FAKE_LAUNCH
}

@test "launcher-only: supervise, mirror, evidence, host commit, clean env" {
  setup_run_with_meta
  make_fake_launcher_writing_heartbeat_then_running_cmd
  run env FOREMAN_LAUNCH="$FAKE_LAUNCH" FOREMAN_HOME="$FH" FOREMAN_GH_PAT="SECRET" \
    FOREMAN_WORKER_CMD_SHIM="$SHIMS/worker.sh" bash "$SCRIPTS/worker-run.sh" "$T"
  [ "$status" -eq 0 ]
  grep -q '"type":"heartbeat"' "$FH/runs/$T/events.jsonl"
  # evidence is non-empty AND names the file the worker created (a plain
  # `diff BASE_SHA` before `add -A` would omit the untracked new file and
  # leave this empty — the bug the post-`add -A` `--cached` diff fixes).
  [ -s "$FH/runs/$T/evidence/diff-stat.txt" ]
  grep -q 'work.txt' "$FH/runs/$T/evidence/diff-stat.txt"
  # exactly one commit over base, HOST-authored (the worker shim never runs
  # git), and it actually contains the worker's file.
  [ "$(git -C "$WT" rev-list --count "$BASE_SHA"..HEAD)" -eq 1 ]
  [ "$(git -C "$WT" log -1 --format='%ae')" = "t@e.com" ]
  git -C "$WT" show HEAD --stat | grep -q 'work.txt'
  ! grep -q SECRET "$SHIMS/worker-env-dump.txt"
}

@test "launcher-only: timeout => 124 + timeout alert" {
  setup_run_with_meta
  make_fake_launcher_exiting 124
  run env FOREMAN_LAUNCH="$FAKE_LAUNCH" FOREMAN_HOME="$FH" bash "$SCRIPTS/worker-run.sh" "$T"
  [ "$status" -eq 124 ]
  grep -q '"kind":"worker_timeout"' "$FH/runs/$T/events.jsonl"
}
