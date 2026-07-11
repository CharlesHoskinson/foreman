#!/usr/bin/env bats
load helpers/fixture

SCRIPTS="$BATS_TEST_DIRNAME/../skills/foreman/scripts"

setup() {
  export FOREMAN_HOME="$BATS_TEST_TMPDIR/fhome"
  make_fixture_repo "$BATS_TEST_TMPDIR/repo"
  cd "$BATS_TEST_TMPDIR/repo"
  "$SCRIPTS/task-new.sh" T1 main
  WT="$BATS_TEST_TMPDIR/repo-T1"
  RD="$FOREMAN_HOME/runs/T1"
  echo "new" >> "$WT/src/app.sh"
  git -C "$WT" -c core.hooksPath= commit -qam "work"
  "$SCRIPTS/evidence-collect.sh" T1
  jq -n '{round:1,vendor:"grok",status:"ok"}' > "$RD/worker-round-1.json"
  # mock claude auditor
  mkdir -p "$BATS_TEST_TMPDIR/bin"
  cat > "$BATS_TEST_TMPDIR/bin/claude" <<'EOF'
#!/usr/bin/env bash
echo '{"structured_output":{"verdict":"APPROVED","findings":[]}}'
EOF
  chmod +x "$BATS_TEST_TMPDIR/bin/claude"
  export PATH="$BATS_TEST_TMPDIR/bin:$PATH"
  export FOREMAN_ORCHESTRATOR=claude
}

@test "runs auditor, writes valid verdict" {
  run "$SCRIPTS/audit-run.sh" T1
  [ "$status" -eq 0 ]
  [ "$(jq -r .verdict "$RD/audit-verdict.json")" = "APPROVED" ]
  grep -q "UNTRUSTED" "$RD"/audit-prompt-round-*.md
}

@test "exit 2 when audit vendor equals worker vendor" {
  jq -n '{round:1,vendor:"claude",status:"ok"}' > "$RD/worker-round-1.json"
  run "$SCRIPTS/audit-run.sh" T1
  [ "$status" -eq 2 ]
}

@test "exit 1 when auditor mutates the tree" {
  cat > "$BATS_TEST_TMPDIR/bin/claude" <<EOF
#!/usr/bin/env bash
echo evil > "$WT/src/app.sh"
echo '{"structured_output":{"verdict":"APPROVED","findings":[]}}'
EOF
  run "$SCRIPTS/audit-run.sh" T1
  [ "$status" -eq 1 ]
}

@test "exit 1 on schema-invalid verdict" {
  cat > "$BATS_TEST_TMPDIR/bin/claude" <<'EOF'
#!/usr/bin/env bash
echo '{"structured_output":{"verdict":"SURE"}}'
EOF
  run "$SCRIPTS/audit-run.sh" T1
  [ "$status" -eq 1 ]
}
