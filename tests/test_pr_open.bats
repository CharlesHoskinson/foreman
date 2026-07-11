#!/usr/bin/env bats
load helpers/fixture

SCRIPTS="$BATS_TEST_DIRNAME/../skills/foreman/scripts"

setup() {
  export FOREMAN_HOME="$BATS_TEST_TMPDIR/fhome"
  make_fixture_repo "$BATS_TEST_TMPDIR/repo"
  git init -q --bare "$BATS_TEST_TMPDIR/origin.git"
  git -C "$BATS_TEST_TMPDIR/repo" remote add origin "$BATS_TEST_TMPDIR/origin.git"
  git -C "$BATS_TEST_TMPDIR/repo" -c core.hooksPath= push -q origin main
  cd "$BATS_TEST_TMPDIR/repo"
  "$SCRIPTS/task-new.sh" T1 main
  WT="$BATS_TEST_TMPDIR/repo-T1"
  RD="$FOREMAN_HOME/runs/T1"
  echo new >> "$WT/src/app.sh"
  git -C "$WT" -c core.hooksPath= commit -qam "work"
  "$SCRIPTS/evidence-collect.sh" T1
  jq -n '{sha:"x",command:"true",exit_code:0,status:"pass"}' > "$RD/checks-result.json"
  jq -n '{verdict:"APPROVED",findings:[]}' > "$RD/audit-verdict.json"
  jq -n '{pass:true,reasons:[]}' > "$RD/gate-decision.json"
  # gh stub
  mkdir -p "$BATS_TEST_TMPDIR/bin"
  cat > "$BATS_TEST_TMPDIR/bin/gh-stub" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$@" > "$BATS_TEST_TMPDIR/gh-argv.txt"
echo "https://example.com/pr/1"
EOF
  chmod +x "$BATS_TEST_TMPDIR/bin/gh-stub"
  export GH_BIN="$BATS_TEST_TMPDIR/bin/gh-stub"
}

@test "pushes branch and opens PR with evidence body" {
  run "$SCRIPTS/pr-open.sh" T1
  [ "$status" -eq 0 ]
  git -C "$BATS_TEST_TMPDIR/origin.git" show-ref | grep -q "refs/heads/ai/T1"
  head -2 "$BATS_TEST_TMPDIR/gh-argv.txt" | tr '\n' ' ' | grep -q "pr create"
  grep -qx -- '--head' "$BATS_TEST_TMPDIR/gh-argv.txt"
  grep -qx -- 'ai/T1' "$BATS_TEST_TMPDIR/gh-argv.txt"
  grep -qx -- '--body-file' "$BATS_TEST_TMPDIR/gh-argv.txt"
  grep -q '\[foreman:T1\]' "$BATS_TEST_TMPDIR/gh-argv.txt"
  grep -q "APPROVED" "$RD/pr-body.md"
}

@test "refuses when evidence bundle is missing" {
  rm -f "$RD/evidence/commits.txt"
  run "$SCRIPTS/pr-open.sh" T1
  [ "$status" -eq 2 ]
  ! git -C "$BATS_TEST_TMPDIR/origin.git" show-ref | grep -q "refs/heads/ai/T1"
}

@test "refuses when gate has not passed" {
  jq -n '{pass:false,reasons:["x"]}' > "$RD/gate-decision.json"
  run "$SCRIPTS/pr-open.sh" T1
  [ "$status" -eq 1 ]
}

@test "exit 3 with instructions when gh missing" {
  export GH_BIN=definitely-not-gh
  run "$SCRIPTS/pr-open.sh" T1
  [ "$status" -eq 3 ]
  [[ "$output" == *"branch is pushed"* ]]
}
