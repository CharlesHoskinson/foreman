#!/usr/bin/env bats
# GraphStore port conformance — files-only default, backend-agnostic suite.
# Gate every bats run through: flock /tmp/foreman-bats.lock bats ...

load helpers

setup() {
  ROOT="$(cd "$BATS_TEST_DIRNAME/.." && pwd)"
  export PYTHONPATH="$ROOT/skills/foreman${PYTHONPATH:+:$PYTHONPATH}"
  # shellcheck source=/dev/null
  source "$ROOT/skills/foreman/scripts/lib/graph-store.sh"
}

@test "contract suite passes against files-only" {
  run gs_contract_files_only
  echo "$output"
  [[ "$status" -eq 0 ]]
  [[ "$output" == *"SUITE OK"* ]]
}

@test "contract suite fails the broken stub for real reasons" {
  run gs_contract_stub_expect_fail
  echo "$output"
  [[ "$status" -eq 0 ]]
  [[ "$output" == *"SOUNDNESS OK"* ]]
  # Stub alone (without --expect-fail) must exit non-zero
  run gs_python contract stub
  echo "$output"
  [[ "$status" -ne 0 ]]
  [[ "$output" == *"SUITE FAILED"* ]]
}

@test "files-only smoke with no store configured" {
  unset FOREMAN_GRAPH_STORE || true
  run gs_smoke_no_store
  echo "$output"
  [[ "$status" -eq 0 ]]
  [[ "$output" == *'"backend": "FilesOnlyGraphStore"'* ]] || [[ "$output" == *'"backend":"FilesOnlyGraphStore"'* ]]
  [[ "$output" == *'"store_configured": false'* ]] || [[ "$output" == *'"store_configured":false'* ]]
}

@test "files-only reports all three optional capabilities unavailable" {
  unset FOREMAN_GRAPH_STORE || true
  run gs_capabilities
  echo "$output"
  [[ "$status" -eq 0 ]]
  [[ "$output" == *'"optional_available": []'* ]] || [[ "$output" == *'"optional_available":[]'* ]]
  [[ "$output" == *'time_travel'* ]]
  [[ "$output" == *'branch_merge'* ]]
  [[ "$output" == *'cross_run_query'* ]]
}

@test "version reference branch: prefix is rejected" {
  run gs_version_ref "branch:main"
  echo "$output"
  [[ "$status" -ne 0 ]]
  [[ "$output" == *"REJECTED"* ]] || [[ "$output" == *"branch:"* ]]
}

@test "version reference bare main is accepted" {
  run gs_version_ref "main"
  echo "$output"
  [[ "$status" -eq 0 ]]
  [[ "$output" == "main" ]]
}

@test "open_from_env refuses deferred terminusdb adapter" {
  run env FOREMAN_GRAPH_STORE=terminusdb python3 -c \
    'from graph_store.files_only import open_from_env; open_from_env()'
  echo "$output"
  [[ "$status" -ne 0 ]]
  [[ "$output" == *"deferred"* ]] || [[ "$output" == *"TerminusDB"* ]]
}

@test "harness run_contract.sh exits 0 when both outcomes hold" {
  run bash "$ROOT/tests/graph_store/run_contract.sh"
  echo "$output"
  [[ "$status" -eq 0 ]]
  [[ "$output" == *"HARNESS OK"* ]]
}

@test "known-bad checkers are observed failing" {
  run bash "$ROOT/tests/graph_store/run_known_bad.sh"
  echo "$output"
  [[ "$status" -eq 0 ]]
  [[ "$output" == *"ALL KNOWN-BAD CHECKERS OBSERVED FAILING"* ]]
}
