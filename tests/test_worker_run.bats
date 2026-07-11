#!/usr/bin/env bats
load helpers/fixture

SCRIPTS="$BATS_TEST_DIRNAME/../skills/foreman/scripts"

setup() {
  export FOREMAN_HOME="$BATS_TEST_TMPDIR/fhome"
  export FOREMAN_NO_SANDBOX=1        # run worker cmd on host in tests
  export XAI_API_KEY=test-key-123
  make_fixture_repo "$BATS_TEST_TMPDIR/repo"
  cd "$BATS_TEST_TMPDIR/repo"
  "$SCRIPTS/task-new.sh" T1 main
  WT="$BATS_TEST_TMPDIR/repo-T1"
  RD="$FOREMAN_HOME/runs/T1"
  # mock grok CLI: captures its -p prompt arg, makes a commit, emits an event
  mkdir -p "$BATS_TEST_TMPDIR/bin"
  cat > "$BATS_TEST_TMPDIR/bin/grok" <<'EOF'
#!/usr/bin/env bash
while [[ $# -gt 0 ]]; do
  if [[ "$1" == "-p" ]]; then printf '%s' "$2" > prompt-received.txt; shift 2; else shift; fi
done
echo '{"event":"done"}'
echo "worked" >> src/app.sh
git -c core.hooksPath= -c user.name=w -c user.email=w@w add -A
git -c core.hooksPath= -c user.name=w -c user.email=w@w commit -qm "worker change"
EOF
  chmod +x "$BATS_TEST_TMPDIR/bin/grok"
  export PATH="$BATS_TEST_TMPDIR/bin:$PATH"
}

@test "happy path: runs worker, records commit, cleans env file" {
  run "$SCRIPTS/worker-run.sh" T1
  [ "$status" -eq 0 ]
  [ "$(jq -r .committed "$RD/worker-round-1.json")" = "true" ]
  [ "$(jq -r .status "$RD/worker-round-1.json")" = "ok" ]
  [ ! -f "$RD/env" ]
  grep -q '"event":"done"' "$RD/worker-events-round-1.jsonl"
  grep -q "Task T1" "$WT/prompt-received.txt"
}

@test "fails round when worker does not commit" {
  cat > "$BATS_TEST_TMPDIR/bin/grok" <<'EOF'
#!/usr/bin/env bash
echo "uncommitted" >> src/app.sh
EOF
  run "$SCRIPTS/worker-run.sh" T1
  [ "$status" -eq 1 ]
  [ "$(jq -r .status "$RD/worker-round-1.json")" = "fail" ]
}

@test "exit 2 when worker vendor equals orchestrator" {
  FOREMAN_ORCHESTRATOR=grok run "$SCRIPTS/worker-run.sh" T1
  [ "$status" -eq 2 ]
}

@test "round number increments" {
  "$SCRIPTS/worker-run.sh" T1
  run "$SCRIPTS/worker-run.sh" T1
  [ -f "$RD/worker-round-2.json" ]
}
