#!/usr/bin/env bats
load helpers

setup() {
  setup_tmp_repo
  cd "$REPO"
}

seed_check_commit() {
  BASE_SHA="$(git rev-parse HEAD)"
  printf 'committed\n' > committed.txt
  cat > Makefile <<'EOF'
.PHONY: check
check:
	@test -f committed.txt
	@test ! -e dirty-only.txt
	@printf 'target-check-ok\n'
EOF
  git add Makefile committed.txt
  git commit -qm 'add target check'
  HEAD_SHA="$(git rev-parse HEAD)"
  printf 'must not enter archive\n' > dirty-only.txt
  export BASE_SHA HEAD_SHA
}

write_soft_index() {
  local run_id="$1"
  shift
  local rd="$FOREMAN_HOME/runs/$run_id"
  mkdir -p "$rd/worktrees"
  jq -n --arg wt "$REPO" --arg root "$REPO" --arg base "$BASE_SHA" \
    '$ARGS.positional | map({
      id:., role:"implement", slug:., worktree:$wt,
      repo_root:$root, base_sha:$base, status:"ready"
    })' --args "$@" > "$rd/worktrees/index.json"
}

@test "soft-mode run executes target make check from pristine commit with an exact selector" {
  seed_check_commit
  write_soft_index pilot implement-dosbox

  DOCS_CHECK_FORCE_MISSING=markdownlint,codespell,lychee \
    run bash "$SCRIPTS/checks-run.sh" pilot implement-dosbox

  [ "$status" -eq 0 ]
  [ "$(jq -r .status "$FOREMAN_HOME/runs/pilot/checks-result.json")" = pass ]
  [ "$(jq -r .command "$FOREMAN_HOME/runs/pilot/checks-result.json")" = "make check" ]
  [ "$(jq -r .sha "$FOREMAN_HOME/runs/pilot/checks-result.json")" = "$HEAD_SHA" ]
  [ "$(jq -r .status "$FOREMAN_HOME/runs/pilot/docs-check.json")" = pass ]
  [ "$(jq -r .policy "$FOREMAN_HOME/runs/pilot/docs-check.json")" = target-owned-check ]
  grep -q 'target-check-ok' "$FOREMAN_HOME/runs/pilot/checks.log"
}

@test "soft-mode run refuses an implicit selection even when one worktree exists" {
  seed_check_commit
  write_soft_index pilot implement-a

  run bash "$SCRIPTS/checks-run.sh" pilot

  [ "$status" -eq 2 ]
  [[ "$output" == *"worktree selector"* ]]
}

@test "soft-mode run with several worktrees refuses an implicit selection" {
  seed_check_commit
  write_soft_index pilot implement-a implement-b

  run bash "$SCRIPTS/checks-run.sh" pilot

  [ "$status" -eq 2 ]
  [[ "$output" == *"worktree selector"* ]]
}

@test "soft-mode run accepts an exact worktree id when several exist" {
  seed_check_commit
  write_soft_index pilot implement-a implement-b

  run bash "$SCRIPTS/checks-run.sh" pilot implement-b

  [ "$status" -eq 0 ]
  [ "$(jq -r .status "$FOREMAN_HOME/runs/pilot/checks-result.json")" = pass ]
}

@test "soft-mode run refuses an unknown explicit worktree id" {
  seed_check_commit
  write_soft_index pilot implement-a

  run bash "$SCRIPTS/checks-run.sh" pilot missing

  [ "$status" -eq 2 ]
  [[ "$output" == *"no worktree matches selector"* ]]
}
