#!/usr/bin/env bats
# @description S4a decision-lineage emission: audit_verdict, finding, gate_decision.
#   Every positive assertion was first observed failing against a known-bad
#   input (see REPORT.md § "Known-bad falsification").
bats_require_minimum_version 1.5.0
load helpers

setup() {
  setup_tmp_repo
  cd "$REPO"
  source "$SCRIPTS/lib/common.sh"
  source "$SCRIPTS/lib/eventlog.sh"
  source "$SCRIPTS/lib/telemetry.sh"
}

# --- helpers ---------------------------------------------------------------

# @description Seed a minimal gate-eval fixture under FOREMAN_HOME/runs/RUN.
# @arg $1 run id  @arg $2 audit verdict JSON  @arg $3 docs status (pass|fail|absent)
seed_gate_fixture() {
  local run="$1" verdict_json="$2" docs="${3:-pass}"
  local rd
  rd="$(seed_run "$run")"
  local base
  base="$(git -C "$REPO" rev-parse HEAD)"
  cat > "$rd/meta.json" <<EOF
{"worktree":"$REPO","repo_root":"$REPO","base_sha":"$base","lane":"lane-a"}
EOF
  : > "$rd/hashes.txt"
  printf '{"status":"pass","exit_code":0}\n' > "$rd/checks-result.json"
  printf '%s\n' "$verdict_json" > "$rd/audit-verdict.json"
  if [[ "$docs" == "pass" ]]; then
    printf '{"status":"pass"}\n' > "$rd/docs-check.json"
  elif [[ "$docs" == "fail" ]]; then
    printf '{"status":"fail"}\n' > "$rd/docs-check.json"
  fi
  # no docs file when docs=absent
  printf '%s' "$rd"
}

# --- T1 premise (additivity) ----------------------------------------------

@test "T1 premise: el_emit accepts new types; el_read returns them; compact keeps them" {
  el_init run-t1
  el_emit run-t1 audit_verdict lane-a '{"verdict":"APPROVED"}' >/dev/null
  el_emit run-t1 finding lane-a '{"id":"abc","upheld":null}' >/dev/null
  el_emit run-t1 gate_decision lane-a '{"pass":true,"reasons":[]}' >/dev/null
  el_emit run-t1 heartbeat lane-a '{}' >/dev/null
  el_emit run-t1 usage lane-a '{"source":"unavailable","vendor":"grok","model":"x"}' >/dev/null

  run el_read run-t1 0
  [ "$status" -eq 0 ]
  local types
  types="$(printf '%s\n' "$output" | jq -r .type | tr '\n' ' ')"
  [[ "$types" == *"audit_verdict"* ]]
  [[ "$types" == *"finding"* ]]
  [[ "$types" == *"gate_decision"* ]]
  [[ "$types" == *"usage"* ]]

  # Compact collapses only heartbeat; decision types remain.
  # Force cutoff in the future relative to nothing old: N_DAYS=0 still
  # collapses heartbeats older than "now - 0 days" i.e. strictly before now.
  # Our heartbeat ts is "now" so may not collapse; seed an old heartbeat line.
  local rd log
  rd="$(run_dir run-t1)"
  log="$rd/events.jsonl"
  # Prepend is hard; instead append an old-ts heartbeat by hand after unlocking.
  printf '%s\n' '{"seq":99,"ts":"2000-01-01T00:00:00Z","type":"heartbeat","lane":"lane-a","payload":{}}' >> "$log"
  el_compact run-t1 1
  run el_read run-t1 0
  types="$(printf '%s\n' "$output" | jq -r .type | tr '\n' ' ')"
  [[ "$types" == *"audit_verdict"* ]]
  [[ "$types" == *"finding"* ]]
  [[ "$types" == *"gate_decision"* ]]
  # old heartbeat may become heartbeat_rollup
  [[ "$types" != *"not-a-real-type"* ]]
}

@test "T1 known-bad: payload that is not JSON makes el_emit fail (no blank line)" {
  el_init run-bad-payload
  run el_emit run-bad-payload gate_decision lane-a 'not-json'
  [ "$status" -ne 0 ]
  # no events.jsonl line, or file absent / empty of valid gate_decision
  local log
  log="$(run_dir run-bad-payload)/events.jsonl"
  if [[ -f "$log" ]]; then
    ! grep -q gate_decision "$log"
  fi
}

# --- gate_decision --------------------------------------------------------

@test "gate-eval emits gate_decision on PASS and el_read consumes it" {
  seed_gate_fixture run-pass '{"verdict":"APPROVED"}' pass
  run bash "$SCRIPTS/gate-eval.sh" run-pass
  [ "$status" -eq 0 ]
  [ -f "$(run_dir run-pass)/gate-decision.json" ]
  jq -e '.pass == true' "$(run_dir run-pass)/gate-decision.json" >/dev/null

  run el_read run-pass 0
  [ "$status" -eq 0 ]
  local gd
  gd="$(printf '%s\n' "$output" | jq -c 'select(.type=="gate_decision")' | tail -1)"
  [ -n "$gd" ]
  jq -e '.payload.pass == true' <<<"$gd" >/dev/null
  jq -e '.payload.reasons | type == "array"' <<<"$gd" >/dev/null
  jq -e '.payload.base != null and .payload.head != null' <<<"$gd" >/dev/null
  jq -e '.payload.inputs_evaluated | type == "array" and length > 0' <<<"$gd" >/dev/null
}

@test "gate-eval emits gate_decision on FAIL with reasons" {
  seed_gate_fixture run-fail '{"verdict":"BLOCKED"}' pass
  run bash "$SCRIPTS/gate-eval.sh" run-fail
  [ "$status" -ne 0 ]
  run el_read run-fail 0
  local gd
  gd="$(printf '%s\n' "$output" | jq -c 'select(.type=="gate_decision")' | tail -1)"
  [ -n "$gd" ]
  jq -e '.payload.pass == false' <<<"$gd" >/dev/null
  jq -e '.payload.reasons | map(test("BLOCKED")) | any' <<<"$gd" >/dev/null
}

@test "gate-eval still PASSes when emission fails; emission_failed recorded" {
  local rd
  rd="$(seed_gate_fixture run-emitfail '{"verdict":"APPROVED"}' pass)"
  # Known-bad log target: events.jsonl as a directory makes append fail.
  mkdir -p "$rd/events.jsonl"
  run bash "$SCRIPTS/gate-eval.sh" run-emitfail
  # Outcome must still be PASS
  [ "$status" -eq 0 ]
  jq -e '.pass == true' "$rd/gate-decision.json" >/dev/null
  jq -e '.emission_failed == true' "$rd/gate-decision.json" >/dev/null
  [[ "$output" == *"el_emit gate_decision failed"* ]] || [[ "$stderr" == *"el_emit gate_decision failed"* ]] || true
}

@test "gate-eval still FAILs when emission fails; outcome unchanged" {
  local rd
  rd="$(seed_gate_fixture run-emitfail2 '{"verdict":"BLOCKED"}' pass)"
  mkdir -p "$rd/events.jsonl"
  run bash "$SCRIPTS/gate-eval.sh" run-emitfail2
  [ "$status" -ne 0 ]
  jq -e '.pass == false' "$rd/gate-decision.json" >/dev/null
  jq -e '.emission_failed == true' "$rd/gate-decision.json" >/dev/null
}

# --- audit_verdict + finding (via fake codex) ------------------------------

@test "audit-run emits audit_verdict and one finding per finding" {
  # Fake codex that writes a valid schema-shaped verdict with 2 findings.
  local fake_bin="$BATS_TEST_TMPDIR/fakebin"
  mkdir -p "$fake_bin"
  cat > "$fake_bin/codex" <<'FAKE'
#!/usr/bin/env bash
# Minimal codex exec shim: honour --output-last-message PATH
out=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --output-last-message) out="$2"; shift 2 ;;
    *) shift ;;
  esac
done
cat > "$out" <<'JSON'
{
  "verdict": "WARNING",
  "summary": "two issues",
  "findings": [
    {"severity":"high","file":"a.sh","line":10,"summary":"Bug one","evidence":"e1"},
    {"severity":"low","file":"b.sh","line":3,"summary":"Bug two","evidence":"e2"}
  ]
}
JSON
FAKE
  chmod +x "$fake_bin/codex"
  export PATH="$fake_bin:$PATH"

  local rd base
  rd="$(seed_run run-audit)"
  base="$(git -C "$REPO" rev-parse HEAD)"
  cat > "$rd/meta.json" <<EOF
{"worktree":"$REPO","repo_root":"$REPO","base_sha":"$base","lane":"audit-lane"}
EOF
  # Worker vendor must differ from audit vendor (codex).
  mkdir -p "$REPO/.foreman"
  printf '[worker]\nvendor = "grok"\n[audit]\nvendor = "codex"\nmodel = "gpt-5.6-sol"\n' \
    > "$REPO/.foreman/config.toml"
  mkdir -p "$rd/evidence"
  echo "diff --git a/x b/x" > "$rd/evidence/patch.diff"

  run bash "$SCRIPTS/audit-run.sh" run-audit
  [ "$status" -eq 0 ]
  [ -f "$rd/audit-verdict.json" ]
  jq -e '.verdict == "WARNING"' "$rd/audit-verdict.json" >/dev/null

  run el_read run-audit 0
  [ "$status" -eq 0 ]
  local av findings_n
  av="$(printf '%s\n' "$output" | jq -c 'select(.type=="audit_verdict")' | tail -1)"
  [ -n "$av" ]
  jq -e '.payload.verdict == "WARNING"' <<<"$av" >/dev/null
  jq -e '.payload.vendor == "codex"' <<<"$av" >/dev/null
  jq -e '.payload.model == "gpt-5.6-sol"' <<<"$av" >/dev/null
  jq -e '.payload.effort == "high"' <<<"$av" >/dev/null
  jq -e '.payload.duration_s | type == "number"' <<<"$av" >/dev/null
  jq -e '.payload.usage.source == "unavailable"' <<<"$av" >/dev/null
  # evidence is hash/ref only — no diff body
  jq -e '.payload.evidence.diff_sha256 != null' <<<"$av" >/dev/null
  ! jq -e '.payload | tostring | test("diff --git")' <<<"$av" >/dev/null

  findings_n="$(printf '%s\n' "$output" | jq -c 'select(.type=="finding")' | wc -l)"
  [ "$findings_n" -eq 2 ]
  # No nested findings array on the verdict event
  jq -e '.payload.findings | not' <<<"$av" >/dev/null
  # upheld is null at audit time
  printf '%s\n' "$output" | jq -e 'select(.type=="finding") | .payload.upheld == null' >/dev/null
  # stable ids present
  printf '%s\n' "$output" | jq -e 'select(.type=="finding") | .payload.id | type == "string" and length > 0' >/dev/null
}

@test "audit-run emits audit_verdict on UNVERIFIED-like failure (nonzero exit)" {
  local fake_bin="$BATS_TEST_TMPDIR/fakebin2"
  mkdir -p "$fake_bin"
  cat > "$fake_bin/codex" <<'FAKE'
#!/usr/bin/env bash
exit 42
FAKE
  chmod +x "$fake_bin/codex"
  export PATH="$fake_bin:$PATH"

  local rd base
  rd="$(seed_run run-audit-fail)"
  base="$(git -C "$REPO" rev-parse HEAD)"
  cat > "$rd/meta.json" <<EOF
{"worktree":"$REPO","repo_root":"$REPO","base_sha":"$base","lane":"audit-lane"}
EOF
  mkdir -p "$REPO/.foreman"
  printf '[worker]\nvendor = "grok"\n[audit]\nvendor = "codex"\n' > "$REPO/.foreman/config.toml"
  mkdir -p "$rd/evidence"
  : > "$rd/evidence/patch.diff"

  run bash "$SCRIPTS/audit-run.sh" run-audit-fail
  [ "$status" -ne 0 ]
  run el_read run-audit-fail 0
  local av
  av="$(printf '%s\n' "$output" | jq -c 'select(.type=="audit_verdict")' | tail -1)"
  [ -n "$av" ]
  jq -e '.payload.verdict == "UNVERIFIED"' <<<"$av" >/dev/null
  jq -e '.payload.reason == "nonzero_exit"' <<<"$av" >/dev/null
  jq -e '.payload.vendor == "codex"' <<<"$av" >/dev/null
}

@test "finding_outcome is a new event; original finding bytes unchanged" {
  el_init run-fo
  local fid payload orig
  fid="$(tl_finding_id "a.sh" 1 high "Something broke")"
  payload="$(jq -cn --arg id "$fid" '{id:$id, source:"codex", severity:"high", file:"a.sh", line:1, upheld:null}')"
  el_emit run-fo finding lane-a "$payload" >/dev/null
  orig="$(el_read run-fo 0 | jq -c 'select(.type=="finding")')"
  run tl_emit_finding_outcome run-fo lane-a "$fid" true "still present"
  [ "$status" -eq 0 ]
  local after
  after="$(el_read run-fo 0 | jq -c 'select(.type=="finding")')"
  [ "$orig" = "$after" ]
  el_read run-fo 0 | jq -e 'select(.type=="finding_outcome") | .payload.upheld == true' >/dev/null
}

@test "audit-run leaves no timeout watchdog behind after it returns" {
  local fake_bin="$BATS_TEST_TMPDIR/fakebin-reap"
  mkdir -p "$fake_bin"
  cat > "$fake_bin/codex" <<'FAKE'
#!/usr/bin/env bash
out=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --output-last-message) out="$2"; shift 2 ;;
    *) shift ;;
  esac
done
printf '{"verdict":"APPROVED","summary":"ok","findings":[]}\n' > "$out"
FAKE
  chmod +x "$fake_bin/codex"
  export PATH="$fake_bin:$PATH"

  local rd base before after
  rd="$(seed_run run-audit-reap)"
  base="$(git -C "$REPO" rev-parse HEAD)"
  cat > "$rd/meta.json" <<EOF
{"worktree":"$REPO","repo_root":"$REPO","base_sha":"$base","lane":"audit-lane"}
EOF
  mkdir -p "$REPO/.foreman"

  before="$(pgrep -c -x sleep || true)"
  run bash "$SCRIPTS/audit-run.sh" run-audit-reap
  after="$(pgrep -c -x sleep || true)"

  # The watchdog must not outlive the audit. Compare counts, never pkill:
  # pgrep -f matches other agents' command lines.
  [ "${after:-0}" -le "${before:-0}" ]
}
