#!/usr/bin/env bats

DR="$BATS_TEST_DIRNAME/../sandbox/docker-run.sh"

setup() {
  # docker stub that records its argv then exits 0
  mkdir -p "$BATS_TEST_TMPDIR/bin"
  cat > "$BATS_TEST_TMPDIR/bin/docker-stub" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$@" > "$BATS_TEST_TMPDIR/argv.txt"
EOF
  chmod +x "$BATS_TEST_TMPDIR/bin/docker-stub"
  export DOCKER_BIN="$BATS_TEST_TMPDIR/bin/docker-stub"
  mkdir -p "$BATS_TEST_TMPDIR/wt"
  echo hi > "$BATS_TEST_TMPDIR/prompt.md"
}

@test "passes hardened flags and defaults to network none" {
  run "$DR" "$BATS_TEST_TMPDIR/wt" foreman-worker:latest -- bash -lc 'true'
  [ "$status" -eq 0 ]
  grep -qx -- '--network' "$BATS_TEST_TMPDIR/argv.txt"
  grep -qx -- 'none' "$BATS_TEST_TMPDIR/argv.txt"
  grep -qx -- '--cap-drop' "$BATS_TEST_TMPDIR/argv.txt"
  grep -qx -- '--read-only' "$BATS_TEST_TMPDIR/argv.txt"
  grep -qx -- 'no-new-privileges' "$BATS_TEST_TMPDIR/argv.txt"
}

@test "mounts prompt read-only when given" {
  run "$DR" --prompt "$BATS_TEST_TMPDIR/prompt.md" "$BATS_TEST_TMPDIR/wt" img -- true
  grep -q "prompt.md:/task/prompt.md:ro" "$BATS_TEST_TMPDIR/argv.txt"
}

@test "FOREMAN_NO_SANDBOX runs command on host" {
  FOREMAN_NO_SANDBOX=1 run "$DR" "$BATS_TEST_TMPDIR/wt" img -- bash -c 'echo escaped'
  [ "$status" -eq 0 ]
  [[ "$output" == *escaped* ]]
}

@test "rejects missing worktree with exit 2" {
  run "$DR" "$BATS_TEST_TMPDIR/nope" img -- true
  [ "$status" -eq 2 ]
}
