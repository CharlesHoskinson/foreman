#!/usr/bin/env bats
load helpers

setup() {
  setup_tmp_repo
  # Hermetic trust for index-lock acquire (integration F4).
  setup_lock_trust_fixture
  cd "$REPO"
}

@test "wt-new creates worktree, branch, and report scaffold" {
  run bash "$SCRIPTS/wt-new.sh" run1 implement slug1
  [ "$status" -eq 0 ]
  WT="${lines[-1]}"
  [ -d "$WT" ]
  [ -f "$WT/FOREMAN_REPORT.md" ]
  [ -f "$WT/FOREMAN_REPORT.json" ]
  git -C "$REPO" show-ref --verify --quiet refs/heads/foreman/run1/implement/slug1
}

@test "wt-new does not create or advertise obsolete vendor-home directories" {
  run bash "$SCRIPTS/wt-new.sh" run1 implement slug1
  [ "$status" -eq 0 ]
  WT="${lines[-1]}"
  [ ! -e "$WT/.harness/vendor-home/grok" ]
  [ ! -e "$WT/.harness/vendor-home/codex" ]
  [[ "$output" != *"vendor-home (grok):"* ]]
  [[ "$output" != *"vendor-home (codex):"* ]]
}


# v0.2.7.5 worktree-hardening Rework Round 1 (Risk 1, Opus audit): before
# this fix, git-guards.sh (T1) was wired NOWHERE -- the whole concurrency-
# safe config bundle only took effect if an operator ran it manually, so
# foreman itself got zero automatic hardening. wt-new.sh now applies it to
# the shared repo (idempotently, best-effort) at every worktree creation.
# Throwaway repo only (setup_tmp_repo, per this file's own setup()) --
# never the real foreman repo.
@test "wt-new wires git-guards.sh into the shared repo at worktree creation (maintenance.auto=false takes effect automatically)" {
  [ "$(git -C "$REPO" config maintenance.auto 2>/dev/null || echo unset)" = "unset" ]
  run bash "$SCRIPTS/wt-new.sh" run1 implement
  [ "$status" -eq 0 ]
  [ "$(git -C "$REPO" config maintenance.auto)" = "false" ]
  [ "$(git -C "$REPO" config core.longpaths)" = "true" ]
  [[ "$output" == *"git-guards applied to"* ]]
}

@test "wt-new rejects malformed run id" {
  run bash "$SCRIPTS/wt-new.sh" "bad id" search
  [ "$status" -ne 0 ]
}

@test "wt-new rejects unknown role" {
  run bash "$SCRIPTS/wt-new.sh" run1 hacker
  [ "$status" -ne 0 ]
}

@test "wt-new refuses duplicate worktree path" {
  bash "$SCRIPTS/wt-new.sh" run1 plan
  run bash "$SCRIPTS/wt-new.sh" run1 plan
  [ "$status" -ne 0 ]
}

# v0.2.7.5 worktree-hardening T2: git_retry bounded exponential-backoff
# wrapper in lib/worktree.sh. Sourced standalone (no lib/common.sh) to pin
# that git_retry has no dependency on `log` -- it must work when this file
# is sourced on its own, as it is here.
@test "git_retry retries a transient failure then succeeds" {
  source "$SCRIPTS/lib/worktree.sh"
  f="$BATS_TEST_TMPDIR/n"; echo 0 > "$f"
  flaky() { local n; n=$(<"$f"); echo $((n+1)) > "$f"; [ "$n" -ge 1 ]; }
  run git_retry flaky
  [ "$status" -eq 0 ]
  [ "$(cat "$f")" = "2" ]
}

@test "git_retry gives up after max attempts" {
  source "$SCRIPTS/lib/worktree.sh"
  run git_retry false
  [ "$status" -ne 0 ]
}

@test "git_retry returns success immediately on a command that never fails (no retry overhead)" {
  source "$SCRIPTS/lib/worktree.sh"
  run git_retry true
  [ "$status" -eq 0 ]
}

# v0.2.7.5 worktree-hardening T3: wt_sweep_stale_locks in lib/worktree.sh.
@test "stale-lock sweep removes an aged 0-byte lock, spares a fresh/nonempty one" {
  setup_tmp_repo
  : > "$REPO/.git/index.lock"
  touch -d '2 minutes ago' "$REPO/.git/index.lock"
  echo held > "$REPO/.git/other.lock"    # non-empty -> spared
  source "$SCRIPTS/lib/worktree.sh"
  run wt_sweep_stale_locks "$REPO"
  [ ! -f "$REPO/.git/index.lock" ]
  [ -f "$REPO/.git/other.lock" ]
}

@test "stale-lock sweep spares a 0-byte lock that is fresh (younger than the threshold)" {
  setup_tmp_repo
  : > "$REPO/.git/index.lock"   # fresh mtime, just created
  source "$SCRIPTS/lib/worktree.sh"
  run wt_sweep_stale_locks "$REPO"
  [ -f "$REPO/.git/index.lock" ]
}

@test "wt-new sweeps a stale lock in the shared repo at lane start before worktree add" {
  : > "$REPO/.git/index.lock"
  touch -d '2 minutes ago' "$REPO/.git/index.lock"
  run bash "$SCRIPTS/wt-new.sh" run1 implement
  [ "$status" -eq 0 ]
  [ ! -f "$REPO/.git/index.lock" ]
}

# v0.2.7.5 worktree-hardening T4: scoped GIT_OPTIONAL_LOCKS/GIT_ASK_YESNO.
# Writes a `git` shim ahead of the real one on PATH that logs argv plus both
# env vars for every invocation, then execs the REAL git (resolved before
# PATH is mutated) so wt-new.sh's own behavior is unaffected.
write_git_env_shim() {
  local dir="$1" real_git
  real_git="$(command -v git)"
  cat > "$dir/git" <<SHIM
#!/usr/bin/env bash
printf '%s|OPTIONAL_LOCKS=%s|ASK_YESNO=%s\n' "\$*" "\${GIT_OPTIONAL_LOCKS:-<unset>}" "\${GIT_ASK_YESNO:-<unset>}" >> "$GIT_SHIM_LOG"
exec "$real_git" "\$@"
SHIM
  chmod +x "$dir/git"
}

@test "wt-new scopes GIT_OPTIONAL_LOCKS=0 to read-only rev-parse polls only; GIT_ASK_YESNO=false lane-wide" {
  shim_dir="$BATS_TEST_TMPDIR/shim"
  mkdir -p "$shim_dir"
  export GIT_SHIM_LOG="$BATS_TEST_TMPDIR/git-calls.log"
  : > "$GIT_SHIM_LOG"
  write_git_env_shim "$shim_dir"
  export PATH="$shim_dir:$PATH"

  run bash "$SCRIPTS/wt-new.sh" run1 implement slug1
  [ "$status" -eq 0 ]

  # wt-new.sh's own two read-only polls (ROOT and BASE_SHA resolution) are
  # the ones this task scopes -- both must carry GIT_OPTIONAL_LOCKS=0. (A
  # helper's OWN internal read-only git call, e.g. wt_sweep_stale_locks's or
  # repo_lock_path's "rev-parse --git-dir"/"--git-common-dir" probes, is a
  # separate, lib/worktree.sh-internal concern out of this task's stated
  # wt-new.sh/lane-run.sh scope, and is deliberately not asserted here.)
  run grep -- '-c core.hooksPath= rev-parse --show-toplevel' "$GIT_SHIM_LOG"
  [ -n "$output" ]
  [[ "$output" == *"OPTIONAL_LOCKS=0"* ]]

  run grep -- 'rev-parse HEAD.{commit}' "$GIT_SHIM_LOG"
  [ -n "$output" ]
  [[ "$output" == *"OPTIONAL_LOCKS=0"* ]]

  # the worktree add (write) path exists and NEVER carries GIT_OPTIONAL_LOCKS=0
  run grep 'worktree add' "$GIT_SHIM_LOG"
  [ -n "$output" ]
  while IFS= read -r line; do
    [[ "$line" != *"OPTIONAL_LOCKS=0"* ]]
  done <<< "$output"

  # GIT_ASK_YESNO=false lane-wide -- no call, read or write, is <unset>
  run grep 'ASK_YESNO=<unset>' "$GIT_SHIM_LOG"
  [ -z "$output" ]
}

# v0.2.7.5 worktree-hardening T6 (soak-discovered regression): concurrent
# wt-new.sh invocations against the SAME run_id used to race on
# index.json's unsynchronized read-modify-write with a fixed (not
# per-process-unique) ".tmp" name -- a real concurrent-lane soak run during
# this task reliably crashed one of six concurrent lanes ("mv: cannot stat
# ... index.json.tmp: No such file or directory") and could silently drop
# an entry even without a crash. Now serialized under a bounded mkdir mutex
# with a per-process-unique tmp filename. Six concurrent roles (the full
# role set) all succeed and every one of the six lands in index.json.
# bats test_tags=slow
@test "wt-new: 6 concurrent lanes against the same run_id all succeed, index.json gets exactly 6 correct entries" {
  local roles=(search plan audit implement advisor misc)
  local pids=() r
  for r in "${roles[@]}"; do
    ( bash "$SCRIPTS/wt-new.sh" concrun "$r" >"$BATS_TEST_TMPDIR/out-$r.log" 2>&1
      echo "$?" > "$BATS_TEST_TMPDIR/rc-$r" ) &
    pids+=("$!")
  done
  for p in "${pids[@]}"; do wait "$p"; done

  for r in "${roles[@]}"; do
    [ "$(cat "$BATS_TEST_TMPDIR/rc-$r")" = "0" ]
  done

  idx="$FOREMAN_HOME/runs/concrun/worktrees/index.json"
  [ -f "$idx" ]
  [ "$(jq 'length' "$idx")" = "6" ]
  for r in "${roles[@]}"; do
    run jq -r --arg r "$r" '.[] | select(.role==$r) | .id' "$idx"
    [ "$output" = "$r" ]
  done
  # the index mutex was released cleanly by every lane, not left held
  [ ! -d "$FOREMAN_HOME/runs/concrun/worktrees/.index.lock" ]
}

# v0.2.7.5 worktree-hardening Rework Round 1 (Risk 2, Opus audit): the
# index.json critical section had no `trap` -- a jq/python3 failure BETWEEN
# `mkdir "$IDX_LOCK"` and the (former) unconditional `rmdir` at the end
# aborted the script under `set -e` before that rmdir ever ran, leaking the
# lock (the NEXT same-run lane would then spin the full ~30s bound and
# proceed unsynchronized). Injects the failure at `mv` (exported bash
# function, inherited by the wt-new.sh subprocess), not `jq`: the update is
# `jq ... > tmp && mv tmp "$IDX"`, and POSIX/bash `set -e` semantics exempt
# every command in a `&&`/`||` list EXCEPT the one following the FINAL
# `&&`/`||` -- so a failing `jq` here (empirically confirmed while writing
# this test: it does NOT abort the script at all, `&&` just short-circuits
# past the never-run `mv`) would not actually exercise the trap. `mv` IS
# that final command, so its failure is the one that genuinely aborts under
# `set -e` -- precisely reproducing the original bug's mechanics. Matched
# on the index.json path so this shadow cannot affect any unrelated mv call.
@test "wt-new: an injected failure inside the index.json critical section still releases the mkdir lock" {
  mv() {
    if [[ "$*" == *"worktrees/index.json"* ]]; then
      echo "fake-mv: simulated failure for index.json update" >&2
      return 1
    fi
    command mv "$@"
  }
  export -f mv
  run bash "$SCRIPTS/wt-new.sh" run1 implement
  [ "$status" -ne 0 ]
  [ ! -d "$FOREMAN_HOME/runs/run1/worktrees/.index.lock" ]
}
