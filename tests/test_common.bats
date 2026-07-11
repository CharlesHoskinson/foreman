#!/usr/bin/env bats
load helpers/fixture

setup() {
  export FOREMAN_HOME="$BATS_TEST_TMPDIR/fhome"
  source "$BATS_TEST_DIRNAME/../skills/foreman/scripts/lib/common.sh"
}

@test "run_dir uses FOREMAN_HOME" {
  [ "$(run_dir T1)" = "$FOREMAN_HOME/runs/T1" ]
}

@test "die exits with given code" {
  run bash -c "source '$BATS_TEST_DIRNAME/../skills/foreman/scripts/lib/common.sh'; die 2 boom"
  [ "$status" -eq 2 ]
  [[ "$output" == *boom* ]]
}

@test "require_cmd exits 3 on missing command" {
  run require_cmd definitely-not-a-real-cmd-xyz
  [ "$status" -eq 3 ]
}

@test "toml_get reads scalar, default, and array" {
  cat > "$BATS_TEST_TMPDIR/c.toml" <<'EOF'
[worker]
vendor = "grok"
[gate]
forbidden_paths = ["tests/**", "*.lock"]
EOF
  [ "$(toml_get "$BATS_TEST_TMPDIR/c.toml" worker.vendor)" = "grok" ]
  [ "$(toml_get "$BATS_TEST_TMPDIR/c.toml" worker.model gpt-x)" = "gpt-x" ]
  [ "$(toml_get "$BATS_TEST_TMPDIR/c.toml" gate.forbidden_paths | head -1)" = "tests/**" ]
}

@test "hash_snapshot hashes tracked files matching globs" {
  make_fixture_repo "$BATS_TEST_TMPDIR/repo"
  run hash_snapshot "$BATS_TEST_TMPDIR/repo" 'tests/**'
  [ "$status" -eq 0 ]
  [[ "${lines[0]}" == tests/test_sample.sh* ]]
}

@test "hash_snapshot fails on a directory that is not a worktree" {
  mkdir -p "$BATS_TEST_TMPDIR/not-a-repo"
  run hash_snapshot "$BATS_TEST_TMPDIR/not-a-repo" 'tests/**'
  [ "$status" -ne 0 ]
}
