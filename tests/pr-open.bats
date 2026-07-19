#!/usr/bin/env bats
# @description Tests for pr-open.sh (hard-mode Task 5): the gate precondition
#   (unchanged from earlier releases) refuses before touching git/gh at all;
#   a passed gate pushes the branch over HTTPS using the fine-grained PAT via
#   GIT_ASKPASS (never as a bare argv token) and opens a DRAFT PR with
#   `-F <body-file>` (never `-b <string>`), never running `gh pr ready`; a
#   missing FOREMAN_GH_PAT refuses outright (no ambient-credential
#   fallback); and an SSH origin refuses (the PAT is HTTPS-only).
#
# All git/gh invocations are shimmed — no real GitHub remote is touched.
# `install_git_shim_recording`'s fake `git` answers `remote get-url origin`
# from a fixture file (`set_origin_https`/`set_origin_ssh` write it) and
# records every other invocation's full argv to $GIT_ARGV; `gh`'s shim
# records to $GH_ARGV and prints a fake PR URL for `pr create`.

# @description Create $FH (isolated FOREMAN_HOME), a run dir with meta.json
#   (a symbolic worktree path/branch — never actually touched, since git is
#   shimmed for these tests) and a gate-decision.json with the given pass
#   value.
# @arg $1 pass "true" or "false"
# @set FH FOREMAN_HOME for this test
# @set T task id
# @set RD the run directory
# @set WT / BRANCH the run's (symbolic) worktree path and branch name
# @set SCRIPTS skills/foreman/scripts in the real checkout
setup_run_with_gate() {
  local pass="$1"
  export FOREMAN_HOME="$BATS_TEST_TMPDIR/foreman-home"
  FH="$FOREMAN_HOME"
  mkdir -p "$FH"

  T="t1"
  WT="$BATS_TEST_TMPDIR/wt"
  BRANCH="ai/$T"
  RD="$FH/runs/$T"
  mkdir -p "$RD/evidence"

  jq -n --arg t "$T" --arg r "$BATS_TEST_TMPDIR/repo" --arg w "$WT" \
        --arg b "$BRANCH" --arg s "deadbeef" \
    '{task_id:$t, repo_root:$r, worktree:$w, branch:$b, base_sha:$s}' > "$RD/meta.json"
  echo "1 file changed" > "$RD/evidence/diff-stat.txt"
  cat > "$RD/task.md" <<'EOF'
# Task t1

## Goal
Trivial test task.
EOF

  jq -n --argjson p "$pass" '{pass:$p, reasons:[]}' > "$RD/gate-decision.json"

  SCRIPTS="$BATS_TEST_DIRNAME/../skills/foreman/scripts"
  export T RD WT BRANCH SCRIPTS
}

# @description Pre-write $RD/pr-body.md so pr-open.sh prefers it over
#   synthesizing one from evidence/task.md.
write_pr_body() {
  printf '# pre-written body\n' > "$RD/pr-body.md"
}

# @description Point the git shim's `remote get-url origin` fixture at an
#   HTTPS github.com URL.
# @set ORIGIN_URL_FILE fixture path the git shim reads at call time
set_origin_https() {
  ORIGIN_URL_FILE="$BATS_TEST_TMPDIR/origin-url.txt"
  echo "https://github.com/example-owner/example-repo.git" > "$ORIGIN_URL_FILE"
  export ORIGIN_URL_FILE
}

# @description Point the git shim's `remote get-url origin` fixture at an
#   SSH github.com URL (must be refused — the PAT is HTTPS-only).
# @set ORIGIN_URL_FILE fixture path the git shim reads at call time
set_origin_ssh() {
  ORIGIN_URL_FILE="$BATS_TEST_TMPDIR/origin-url.txt"
  echo "git@github.com:example-owner/example-repo.git" > "$ORIGIN_URL_FILE"
  export ORIGIN_URL_FILE
}

# @description Install a fake `git` on PATH: answers `remote get-url origin`
#   from $ORIGIN_URL_FILE (if set) and records every invocation's full argv
#   (one line per call) to $GIT_ARGV; every other subcommand is a no-op
#   success. Never touches a real repository.
# @set GIT_ARGV path to the recorded-argv file
install_git_shim_recording() {
  local dir="$BATS_TEST_TMPDIR/git-shim"
  mkdir -p "$dir"
  GIT_ARGV="$BATS_TEST_TMPDIR/git-argv.txt"
  : > "$GIT_ARGV"
  cat > "$dir/git" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$*" >> "$GIT_ARGV"
if [[ " \$* " == *" remote get-url origin "* ]]; then
  if [[ -n "\${ORIGIN_URL_FILE:-}" && -f "\${ORIGIN_URL_FILE:-}" ]]; then
    cat "\$ORIGIN_URL_FILE"
  else
    echo "https://github.com/example-owner/example-repo.git"
  fi
  exit 0
fi
exit 0
EOF
  chmod +x "$dir/git"
  export PATH="$dir:$PATH"
  export GIT_ARGV
}

# @description Install a fake `gh` on PATH: records every invocation's full
#   argv (one line per call) to $GH_ARGV (pre-touched so an uninvoked shim
#   still leaves an existing, empty file for a caller's `[ ! -s ... ]`
#   check); `pr create` additionally prints a fake PR URL to stdout.
# @set GH_ARGV path to the recorded-argv file
install_gh_shim_recording() {
  local dir="$BATS_TEST_TMPDIR/gh-shim"
  mkdir -p "$dir"
  GH_ARGV="$BATS_TEST_TMPDIR/gh-argv.txt"
  : > "$GH_ARGV"
  cat > "$dir/gh" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$*" >> "$GH_ARGV"
if [[ "\$1" == "pr" && "\$2" == "create" ]]; then
  echo "https://github.com/example-owner/example-repo/pull/1"
  exit 0
fi
exit 0
EOF
  chmod +x "$dir/gh"
  export PATH="$dir:$PATH"
  export GH_ARGV
}

@test "gate not passed: refuse, no push, no gh" {
  setup_run_with_gate false
  install_git_shim_recording
  install_gh_shim_recording
  run env FOREMAN_HOME="$FH" bash "$SCRIPTS/pr-open.sh" "$T"
  [ "$status" -ne 0 ]
  ! grep -q push "$GIT_ARGV" 2>/dev/null
  [ ! -s "$GH_ARGV" ]
}

@test "gate passed: HTTPS PAT push then DRAFT PR with -F, no gh pr ready" {
  setup_run_with_gate true
  write_pr_body
  set_origin_https
  install_git_shim_recording
  install_gh_shim_recording
  run env FOREMAN_HOME="$FH" FOREMAN_GH_PAT=tok bash "$SCRIPTS/pr-open.sh" "$T"
  [ "$status" -eq 0 ]
  grep -q push "$GIT_ARGV"
  grep -qF -- '--draft' "$GH_ARGV"
  grep -qF -- '-F' "$GH_ARGV"
  ! grep -qE -- '(^| )-b( |$)' "$GH_ARGV"
  ! grep -q 'pr ready' "$GH_ARGV"
  # Bonus: the PAT itself never appears in argv recorded for EITHER tool —
  # it only ever reaches processes via GIT_ASKPASS (a file path) and the
  # scoped GH_TOKEN env var for the one gh call.
  ! grep -qF 'tok' "$GIT_ARGV"
  ! grep -qF 'tok' "$GH_ARGV"
  # pr-url.txt captures gh's stdout.
  [ -s "$RD/pr-url.txt" ]
}

@test "no PAT: refuse (no ambient fallback)" {
  setup_run_with_gate true
  write_pr_body
  set_origin_https
  install_git_shim_recording
  install_gh_shim_recording
  run env FOREMAN_HOME="$FH" bash "$SCRIPTS/pr-open.sh" "$T"
  [ "$status" -ne 0 ]
  ! grep -q push "$GIT_ARGV" 2>/dev/null
  [ ! -s "$GH_ARGV" ]
}

@test "ssh origin: refuse (PAT is HTTPS-only)" {
  setup_run_with_gate true
  write_pr_body
  set_origin_ssh
  install_git_shim_recording
  install_gh_shim_recording
  run env FOREMAN_HOME="$FH" FOREMAN_GH_PAT=tok bash "$SCRIPTS/pr-open.sh" "$T"
  [ "$status" -ne 0 ]
  ! grep -q push "$GIT_ARGV" 2>/dev/null
  [ ! -s "$GH_ARGV" ]
}

@test "no existing pr-body.md: synthesized from evidence + task.md" {
  setup_run_with_gate true
  set_origin_https
  install_git_shim_recording
  install_gh_shim_recording
  run env FOREMAN_HOME="$FH" FOREMAN_GH_PAT=tok bash "$SCRIPTS/pr-open.sh" "$T"
  [ "$status" -eq 0 ]
  [ -f "$RD/pr-body.md" ]
  grep -q 'Trivial test task' "$RD/pr-body.md"
  grep -q '1 file changed' "$RD/pr-body.md"
}

@test "askpass helper is cleaned up after the run" {
  setup_run_with_gate true
  write_pr_body
  set_origin_https
  install_git_shim_recording
  install_gh_shim_recording
  run env FOREMAN_HOME="$FH" FOREMAN_GH_PAT=tok bash "$SCRIPTS/pr-open.sh" "$T"
  [ "$status" -eq 0 ]
  [ ! -e "$RD/.askpass.sh" ]
}
