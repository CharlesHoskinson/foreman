#!/usr/bin/env bats
load helpers

setup() { setup_tmp_repo; cd "$REPO"; }

@test "gate-eval fails when docs-check result is absent" {
  RD="$FOREMAN_HOME/runs/run1"
  mkdir -p "$RD"
  BASE_SHA="$(git -C "$REPO" rev-parse HEAD)"
  cat > "$RD/meta.json" <<EOF
{"worktree":"$REPO","repo_root":"$REPO","base_sha":"$BASE_SHA"}
EOF
  : > "$RD/hashes.txt"
  printf '{"status":"pass","exit_code":0}\n' > "$RD/checks-result.json"
  printf '{"verdict":"APPROVED"}\n' > "$RD/audit-verdict.json"

  run bash "$SCRIPTS/gate-eval.sh" run1
  [ "$status" -ne 0 ]
  grep -q 'docs-check missing (fail closed)' "$RD/gate-decision.json"
}
