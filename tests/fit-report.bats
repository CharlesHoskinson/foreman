#!/usr/bin/env bats
# @description Fit-ledger reader (workload-fit-accounting Task 2 + rework r3):
#   foreman-fit-report.sh tallies discovery vs implementer offload from
#   $RD/fit.jsonl (architect-kept; never the event log). jq is required;
#   nested objects must count outer phase/weight; missing jq refuses cleanly.
load helpers

setup() {
  SCRIPTS="$BATS_TEST_DIRNAME/../skills/foreman/scripts"
  export FOREMAN_HOME="$BATS_TEST_TMPDIR/fh"
  RD="$FOREMAN_HOME/runs/r1"
  mkdir -p "$RD"
  # Default mixed ledger: discovery weight 2, implement weight 1 → 33% poor
  cat > "$RD/fit.jsonl" <<'EOF'
{"phase":"estimate","discovery_fraction":"high"}
{"phase":"discover","lane":"foreman-discover","weight":2}
{"phase":"implement","lane":"worker-grok","weight":1}
EOF
}

# Build a PATH with core tools but no jq (for jq-absent refusal only).
_nojq_env() {
  local bindir="$BATS_TEST_TMPDIR/nojq-bin"
  mkdir -p "$bindir"
  local t src
  # type -P ignores shell functions/aliases (this host wraps grep).
  for t in bash sh cat grep awk sed printf tr cut head tail dirname pwd mkdir env true; do
    src="$(type -P "$t" 2>/dev/null)" || continue
    ln -sf "$src" "$bindir/$t"
  done
  # Sanity: jq must not resolve when PATH is only bindir.
  env PATH="$bindir" "$bindir/bash" -c 'command -v jq' >/dev/null 2>&1 && return 1
  printf '%s' "$bindir"
}

@test "fit-report tallies discovery vs implementer offload with exact fields" {
  run bash "$SCRIPTS/foreman-fit-report.sh" r1
  [ "$status" -eq 0 ]
  # Exact single-line contract — leading or trailing garbage must fail.
  [ "$output" = "foreman-fit report RUN_ID=r1 discovery=2 offload=1 offload_fraction=33% fit_verdict=poor" ]
}

@test "a healthy hybrid run (mostly offload) reports good fit" {
  cat > "$RD/fit.jsonl" <<'EOF'
{"phase":"discover","lane":"foreman-discover","weight":1}
{"phase":"implement","lane":"worker-grok","weight":4}
EOF
  run bash "$SCRIPTS/foreman-fit-report.sh" r1
  [ "$status" -eq 0 ]
  [ "$output" = "foreman-fit report RUN_ID=r1 discovery=1 offload=4 offload_fraction=80% fit_verdict=good" ]
}

@test "all-discovery run reports poor cost-fit and zero offload" {
  printf '{"phase":"discover","lane":"foreman-discover","weight":1}\n' > "$RD/fit.jsonl"
  run bash "$SCRIPTS/foreman-fit-report.sh" r1
  [ "$status" -eq 0 ]
  [ "$output" = "foreman-fit report RUN_ID=r1 discovery=1 offload=0 offload_fraction=0% fit_verdict=poor" ]
}

@test "missing ledger is reported, not a crash" {
  run bash "$SCRIPTS/foreman-fit-report.sh" r1_absent
  [ "$status" -ne 0 ]
  # Exact contract line (stderr captured in $output by bats).
  [ "$output" = "foreman-fit-report: no fit ledger for r1_absent" ]
}

@test "empty ledger is zero-denominator: frac 0 poor" {
  : > "$RD/fit.jsonl"
  run bash "$SCRIPTS/foreman-fit-report.sh" r1
  [ "$status" -eq 0 ]
  [ "$output" = "foreman-fit report RUN_ID=r1 discovery=0 offload=0 offload_fraction=0% fit_verdict=poor" ]
}

@test "estimate-only ledger is zero-denominator: frac 0 poor" {
  printf '{"phase":"estimate","discovery_fraction":"high"}\n' > "$RD/fit.jsonl"
  run bash "$SCRIPTS/foreman-fit-report.sh" r1
  [ "$status" -eq 0 ]
  [ "$output" = "foreman-fit report RUN_ID=r1 discovery=0 offload=0 offload_fraction=0% fit_verdict=poor" ]
}

@test "exactly 50 percent offload is good (poor only when under 50)" {
  # Records without weight also prove default weight=1.
  cat > "$RD/fit.jsonl" <<'EOF'
{"phase":"discover"}
{"phase":"implement"}
EOF
  run bash "$SCRIPTS/foreman-fit-report.sh" r1
  [ "$status" -eq 0 ]
  [ "$output" = "foreman-fit report RUN_ID=r1 discovery=1 offload=1 offload_fraction=50% fit_verdict=good" ]
}

@test "unrecognised phase refuses the whole report" {
  cat > "$RD/fit.jsonl" <<'EOF'
{"phase":"totally-bogus","weight":5}
{"phase":"implement","weight":1}
EOF
  run bash "$SCRIPTS/foreman-fit-report.sh" r1
  [ "$status" -ne 0 ]
  [[ "$output" == *"foreman-fit-report: malformed ledger record at line 1:"* ]]
  [[ "$output" == *"unrecognised phase"* ]]
  # Never silently inflate the verdict.
  [[ "$output" != *"fit_verdict="* ]]
  [[ "$output" != *"offload_fraction=100%"* ]]
}

@test "missing phase field refuses the whole report" {
  cat > "$RD/fit.jsonl" <<'EOF'
{"weight":5}
{"phase":"implement","weight":1}
EOF
  run bash "$SCRIPTS/foreman-fit-report.sh" r1
  [ "$status" -ne 0 ]
  [[ "$output" == *"foreman-fit-report: malformed ledger record at line 1:"* ]]
  [[ "$output" == *"missing phase"* ]]
  [[ "$output" != *"fit_verdict="* ]]
}

@test "non-numeric weight refuses rather than crashing" {
  printf '{"phase":"discover","weight":"oops"}\n' > "$RD/fit.jsonl"
  run bash "$SCRIPTS/foreman-fit-report.sh" r1
  [ "$status" -ne 0 ]
  [[ "$output" == *"foreman-fit-report: malformed ledger record at line 1:"* ]]
  [[ "$output" == *"invalid weight"* ]]
  # Bash unbound-variable / arithmetic noise must not surface.
  [[ "$output" != *"unbound variable"* ]]
  [[ "$output" != *"arithmetic"* ]]
  [[ "$output" != *"fit_verdict="* ]]
}

@test "malformed JSON is diagnosed with line number, not a raw jq error" {
  cat > "$RD/fit.jsonl" <<'EOF'
{"phase":"discover","weight":1}
not json at all
{"phase":"implement","weight":1}
EOF
  run bash "$SCRIPTS/foreman-fit-report.sh" r1
  [ "$status" -ne 0 ]
  [[ "$output" == *"foreman-fit-report: malformed ledger record at line 2:"* ]]
  [[ "$output" == *"invalid JSON"* ]]
  # Raw jq diagnostics must never reach the user.
  [[ "$output" != *"jq: parse error"* ]]
  [[ "$output" != *"jq:"* ]]
  [[ "$output" != *"fit_verdict="* ]]
}

@test "nested object counts outer phase and weight only" {
  printf '%s\n' '{"phase":"implement","weight":1,"meta":{"phase":"discover","weight":5}}' > "$RD/fit.jsonl"
  run bash "$SCRIPTS/foreman-fit-report.sh" r1
  [ "$status" -eq 0 ]
  [ "$output" = "foreman-fit report RUN_ID=r1 discovery=0 offload=1 offload_fraction=100% fit_verdict=good" ]
}

@test "jq absent refuses with exact required message" {
  local bindir
  bindir="$(_nojq_env)"
  run env PATH="$bindir" FOREMAN_HOME="$FOREMAN_HOME" "$bindir/bash" "$SCRIPTS/foreman-fit-report.sh" r1
  [ "$status" -ne 0 ]
  [ "$output" = "foreman-fit-report: jq is required to read the fit ledger (see dependencies/README.md)" ]
  [[ "$output" != *"fit_verdict="* ]]
}

@test "cleanup with no fit ledger skips fit report and still succeeds" {
  # Task 3 regression: foreman-cleanup.sh must not fail or emit fit tokens
  # when $RD/fit.jsonl is absent. Do not modify cleanup.sh in this rework.
  # wt-cleanup requires $RD/worktrees (dir present); empty list is fine.
  setup_tmp_repo
  cd "$REPO"
  local cln_rd
  cln_rd="$FOREMAN_HOME/runs/cln-nofit"
  mkdir -p "$cln_rd/worktrees"
  run bash "$SCRIPTS/foreman-cleanup.sh" cln-nofit
  [ "$status" -eq 0 ]
  [[ "$output" != *"fit_verdict="* ]]
  [[ "$output" != *"foreman-fit"* ]]
}

@test "two JSON objects on one line are refused as malformed" {
  # jq streams one result per top-level value; without a refusal both records
  # fall through the phase case uncounted (silent discovery=0).
  printf '%s\n' '{"phase":"discover","weight":2} {"phase":"implement","weight":3}' > "$RD/fit.jsonl"
  run bash "$SCRIPTS/foreman-fit-report.sh" r1
  [ "$status" -ne 0 ]
  [[ "$output" == *"foreman-fit-report: malformed ledger record at line 1:"* ]]
  [[ "$output" == *"multiple JSON values on one line"* ]]
  [[ "$output" != *"fit_verdict="* ]]
}

@test "three JSON objects on one line are refused as malformed" {
  printf '%s\n' '{"phase":"discover","weight":1} {"phase":"implement","weight":1} {"phase":"estimate"}' > "$RD/fit.jsonl"
  run bash "$SCRIPTS/foreman-fit-report.sh" r1
  [ "$status" -ne 0 ]
  [[ "$output" == *"foreman-fit-report: malformed ledger record at line 1:"* ]]
  [[ "$output" == *"multiple JSON values on one line"* ]]
  [[ "$output" != *"fit_verdict="* ]]
}

@test "single object with leading and trailing whitespace still counts" {
  printf '  \t{"phase":"discover","weight":2}  \t\n' > "$RD/fit.jsonl"
  run bash "$SCRIPTS/foreman-fit-report.sh" r1
  [ "$status" -eq 0 ]
  [ "$output" = "foreman-fit report RUN_ID=r1 discovery=2 offload=0 offload_fraction=0% fit_verdict=poor" ]
}

@test "case default refuses unrecognised classification (not silent skip)" {
  # Without the case default, an unrecognised phase that reached classification
  # would be silently ignored and the report would succeed with wrong totals.
  # Assert the refusal path, not merely the absence of a crash.
  cat > "$RD/fit.jsonl" <<'EOF'
{"phase":"totally-bogus","weight":5}
{"phase":"implement","weight":1}
EOF
  run bash "$SCRIPTS/foreman-fit-report.sh" r1
  [ "$status" -ne 0 ]
  [[ "$output" == *"foreman-fit-report: malformed ledger record at line 1:"* ]]
  [[ "$output" == *"unrecognised phase"* ]]
  # Silent-zero / inflated-success path that motivated the default must not appear.
  [[ "$output" != *"fit_verdict="* ]]
  [[ "$output" != *"offload_fraction=100%"* ]]
  [[ "$output" != *"discovery=0 offload=1"* ]]
}
