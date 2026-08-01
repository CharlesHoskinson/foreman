#!/usr/bin/env bash
# @description Replay Tier 1 golden rounds entirely from recorded JSON.
#   Offline execution is enforced structurally: this runner has no vendor-command
#   hook and only reads local artefacts with jq, awk, find, and shell builtins.
#   The recorded response is supplied to replay assertions as the vendor response,
#   but assertions inspect only decision-trace gates, verdicts, and emitted events.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GOLDEN_ROOT="${TIER1_GOLDEN_ROOT:-$ROOT/tests/golden-rounds}"
CLASS_DOCUMENT="${TIER1_CLASS_DOCUMENT:-$ROOT/docs/design/tier1-failure-classes.md}"
FAILURES=0
declare -A DEMONSTRATED_CLASSES=()

# @description Record a round-specific replay failure without stopping later rounds.
# @arg $1 round id
# @arg $2 discrepancy
round_fail() {
  local round_id="$1" discrepancy="$2"
  printf 'FAIL round_id=%s: %s\n' "$round_id" "$discrepancy" >&2
  FAILURES=$((FAILURES + 1))
}

# @description Assert the seeded FC-01 decision contract against one trace.
# @arg $1 decision-trace JSON path
# @return 0 when the expected gate/verdict/event structure is present
assert_stall_no_output_trace() {
  local trace_path="$1"
  jq -e '
    .trace_version == "decision-trace/v1"
    and .failure_class == "FC-01-monitor-predicate-cannot-fire"
    and .demonstrated_case == "unchanged"
    and .final_verdict == "STALL NO_OUTPUT"
    and ([.events[] |
      select(
        .case == "unchanged"
        and .decision == "classify_no_output"
        and .outcome == "predicate_fired"
        and .verdict == "STALL NO_OUTPUT"
        and (.emitted | type == "string" and startswith("STALL NO_OUTPUT"))
      )] | length == 1)
    and ([.events[] |
      select(
        .case == "changed"
        and .decision == "classify_no_output"
        and .outcome == "predicate_did_not_fire"
        and .verdict == "OK"
        and (.emitted | type == "string" and startswith("OK"))
      )] | length == 1)
    and ([.events[] |
      select(
        .case == "uncomputable"
        and .decision == "classify_no_output"
        and .outcome == "refused_to_classify"
        and .verdict == "UNVERIFIED"
        and (.emitted | type == "string" and startswith("UNVERIFIED"))
      )] | length == 1)
  ' "$trace_path" >/dev/null 2>&1
}

# @description Prove the defective FC-01 trace contains its seeded predicate defect.
# @arg $1 defective decision-trace JSON path
# @return 0 when the unavailable predicate and fallthrough decisions are present
assert_stall_no_output_defect() {
  local trace_path="$1"
  jq -e '
    .trace_version == "decision-trace/v1"
    and .failure_class == "FC-01-monitor-predicate-cannot-fire"
    and .demonstrated_case == "unchanged"
    and .final_verdict == "OK"
    and ([.events[] |
      select(
        .case == "unchanged"
        and .decision == "evaluate_content_digest"
        and .outcome == "predicate_unavailable"
        and (.evidence.undefined_functions |
          type == "array"
          and index("ev_content_hash") != null
          and index("ev_hash_unchanged") != null
          and index("ev_porcelain_digest") != null
          and index("ev_porcelain_uall_digest") != null)
      )] | length == 1)
    and ([.events[] |
      select(
        .case == "unchanged"
        and .decision == "classify_no_output"
        and .outcome == "fallthrough"
        and .verdict == "OK"
        and (.emitted | type == "string" and startswith("OK"))
      )] | length == 1)
    and ([.events[] |
      select(
        .case == "changed"
        and .decision == "evaluate_content_digest"
        and .outcome == "predicate_unavailable"
      )] | length == 1)
    and ([.events[] |
      select(
        .case == "changed"
        and .decision == "classify_no_output"
        and .outcome == "fallthrough"
        and .verdict == "OK"
        and (.emitted | type == "string" and startswith("OK"))
      )] | length == 1)
  ' "$trace_path" >/dev/null 2>&1
}

# @description Assert the corrected FC-02 formal-gate capability contract.
# @arg $1 decision-trace JSON path
assert_formal_setsid_trace() {
  local trace_path="$1"
  jq -e '
    .trace_version == "decision-trace/v1"
    and .failure_class == "FC-02-checker-verdict-unestablished"
    and .demonstrated_case == "setsid_unavailable"
    and .final_verdict == "SUITE PASSED"
    and (.events | length == 3)
    and [.events[].seq] == [1, 2, 3]
    and [.events[].decision] == ["probe_setsid_capability", "spawn_formal_rows", "summarize_formal_gate"]
    and [.events[].outcome] == ["announced_degradation", "plain_background_spawn", "models_executed"]
    and all(.events[]; .case == "setsid_unavailable")
    and ([.events[] | select(
      .decision == "probe_setsid_capability"
      and .outcome == "announced_degradation"
      and (.emitted | startswith("setsid unavailable (Git Bash/Windows) -- DEGRADED:"))
    )] | length == 1)
    and ([.events[] | select(
      .decision == "summarize_formal_gate"
      and .outcome == "models_executed"
      and .evidence.run == 19
      and .evidence.matched == 19
      and .evidence.failures == 0
      and .verdict == "SUITE PASSED"
      and .emitted == "formal: === summary: run=19 matched=19 skipped=17 failures=0 tier=commit ==="
    )] | length == 1)
  ' "$trace_path" >/dev/null 2>&1
}

# @description Prove the defective FC-02 trace never executed the models.
# @arg $1 defective decision-trace JSON path
assert_formal_setsid_defect() {
  local trace_path="$1"
  jq -e '
    .trace_version == "decision-trace/v1"
    and .failure_class == "FC-02-checker-verdict-unestablished"
    and .demonstrated_case == "setsid_unavailable"
    and .final_verdict == "SUITE FAILED"
    and (.events | length == 3)
    and [.events[].seq] == [1, 2, 3]
    and [.events[].decision] == ["spawn_formal_row", "classify_formal_rows", "summarize_formal_gate"]
    and [.events[].outcome] == ["command_not_found", "all_rows_error", "verdict_without_model_execution"]
    and all(.events[]; .case == "setsid_unavailable")
    and ([.events[] | select(
      .decision == "spawn_formal_row"
      and .outcome == "command_not_found"
      and .evidence.command == "setsid"
      and (.evidence.error | endswith("formal/run-checks.sh: line 547: setsid: command not found"))
    )] | length == 1)
    and ([.events[] | select(
      .decision == "summarize_formal_gate"
      and .outcome == "verdict_without_model_execution"
      and .evidence.run == 19
      and .evidence.matched == 0
      and .evidence.failures == 19
      and .verdict == "SUITE FAILED"
      and .emitted == "formal: === summary: run=19 matched=0 skipped=17 failures=19 tier=commit ==="
    )] | length == 1)
  ' "$trace_path" >/dev/null 2>&1
}

# @description Assert the corrected FC-03 empty-burst decision contract.
# @arg $1 decision-trace JSON path
assert_grok_empty_burst_trace() {
  local trace_path="$1"
  jq -e '
    . as $trace
    | .trace_version == "decision-trace/v1"
    and .failure_class == "FC-03-lane-terminal-without-deliverable"
    and .demonstrated_case == "zero_files_changed"
    and .final_verdict == "EMPTY-BURST FAILED"
    and (.events | length == 3)
    and [.events[].seq] == [1, 2, 3]
    and [.events[].decision] == ["invoke_vendor_process", "check_fresh_artifact", "classify_round_completion"]
    and [.events[].outcome] == ["exited_zero_each_round", "no_file_change", "rejected_missing_deliverable"]
    and all(.events[]; .case == "zero_files_changed")
    and ([.events[] | select(
      .decision == "check_fresh_artifact"
      and .outcome == "no_file_change"
      and .evidence.rounds == 2
      and .evidence.changed_files == 0
    )] | length == 1)
    and ([.events[] | select(
      .decision == "classify_round_completion"
      and .outcome == "rejected_missing_deliverable"
      and .evidence.exit_status == 1
      and .verdict == "EMPTY-BURST FAILED"
      and (.emitted | startswith(
        (($trace.implementation.source | split("/")[-1] | rtrimstr(".sh"))
        + ": EMPTY-BURST FAILED after 2 rounds")
      ))
    )] | length == 1)
  ' "$trace_path" >/dev/null 2>&1
}

# @description Prove the defective FC-03 trace trusted exit zero without output.
# @arg $1 defective decision-trace JSON path
assert_grok_empty_burst_defect() {
  local trace_path="$1"
  jq -e '
    .trace_version == "decision-trace/v1"
    and .failure_class == "FC-03-lane-terminal-without-deliverable"
    and .demonstrated_case == "zero_files_changed"
    and .final_verdict == "Result=success"
    and (.events | length == 3)
    and [.events[].seq] == [1, 2, 3]
    and [.events[].decision] == ["invoke_vendor_process", "verify_deliverable", "classify_round_completion"]
    and [.events[].outcome] == ["exited", "missing", "trusted_process_exit"]
    and all(.events[]; .case == "zero_files_changed")
    and ([.events[] | select(
      .decision == "verify_deliverable"
      and .outcome == "missing"
      and .evidence.changed_files == 0
      and .evidence.build_errors == 25
    )] | length == 1)
    and ([.events[] | select(
      .decision == "classify_round_completion"
      and .outcome == "trusted_process_exit"
      and .evidence.exit_status == 0
      and .verdict == "Result=success"
    )] | length == 1)
  ' "$trace_path" >/dev/null 2>&1
}

# @description Assert the corrected FC-04 watchdog ownership contract.
# @arg $1 decision-trace JSON path
assert_audit_watchdog_trace() {
  local trace_path="$1"
  jq -e '
    .trace_version == "decision-trace/v1"
    and .failure_class == "FC-04-process-ownership-leak"
    and .demonstrated_case == "audit_returns_before_timeout"
    and .final_verdict == "PASS"
    and (.events | length == 3)
    and [.events[].seq] == [1, 2, 3]
    and [.events[].decision] == ["wait_for_timeout_watchdog", "reap_timeout_watchdog", "compare_owned_sleep_processes"]
    and [.events[].outcome] == ["one_second_slices", "watchdog_and_sleep_reaped", "no_leak"]
    and all(.events[]; .case == "audit_returns_before_timeout")
    and ([.events[] | select(
      .decision == "reap_timeout_watchdog"
      and .outcome == "watchdog_and_sleep_reaped"
      and .evidence.scope == "test_process_group"
      and .evidence.kill_target == "exact PID"
    )] | length == 1)
    and ([.events[] | select(
      .decision == "compare_owned_sleep_processes"
      and .outcome == "no_leak"
      and .evidence.leaked_pids == []
      and .verdict == "PASS"
    )] | length == 1)
  ' "$trace_path" >/dev/null 2>&1
}

# @description Prove the defective FC-04 trace left the watchdog sleep alive.
# @arg $1 defective decision-trace JSON path
assert_audit_watchdog_defect() {
  local trace_path="$1"
  jq -e '
    .trace_version == "decision-trace/v1"
    and .failure_class == "FC-04-process-ownership-leak"
    and .demonstrated_case == "audit_returns_before_timeout"
    and .final_verdict == "TIMEOUT"
    and (.events | length == 3)
    and [.events[].seq] == [1, 2, 3]
    and [.events[].decision] == ["spawn_timeout_watchdog", "cleanup_timeout_watchdog", "observe_watchdog_child"]
    and [.events[].outcome] == ["plain_subshell", "wrapper_only_killed", "sleep_reparented"]
    and all(.events[]; .case == "audit_returns_before_timeout")
    and ([.events[] | select(
      .decision == "cleanup_timeout_watchdog"
      and .outcome == "wrapper_only_killed"
      and .evidence.timeout_seconds == 1800
    )] | length == 1)
    and ([.events[] | select(
      .decision == "observe_watchdog_child"
      and .outcome == "sleep_reparented"
      and .evidence.stdout_pipe_held_open == true
      and .verdict == "TIMEOUT"
    )] | length == 1)
  ' "$trace_path" >/dev/null 2>&1
}

# @description Assert the corrected FC-05 pid-namespace capability guard.
# @arg $1 decision-trace JSON path
assert_launcher_pidns_trace() {
  local trace_path="$1"
  jq -e '
    .trace_version == "decision-trace/v1"
    and .failure_class == "FC-05-environment-capability-gap"
    and .demonstrated_case == "pid_namespace_unavailable"
    and .final_verdict == "SKIP"
    and (.events | length == 2)
    and [.events[].seq] == [1, 2]
    and [.events[].decision] == ["probe_pid_namespace_capability", "run_kernel_cascade_assertion"]
    and [.events[].outcome] == ["capability_absent", "skipped"]
    and all(.events[]; .case == "pid_namespace_unavailable")
    and ([.events[] | select(
      .decision == "probe_pid_namespace_capability"
      and .outcome == "capability_absent"
      and .evidence.command == "unshare --pid --mount-proc --fork true"
    )] | length == 1)
    and ([.events[] | select(
      .decision == "run_kernel_cascade_assertion"
      and .outcome == "skipped"
      and .verdict == "SKIP"
      and .emitted == "pid namespaces unavailable on this host; the kernel cascade this test asserts cannot occur (see test 12 for the degraded setsid+pgid contract)"
    )] | length == 1)
  ' "$trace_path" >/dev/null 2>&1
}

# @description Prove the defective FC-05 guard checked a binary, not capability.
# @arg $1 defective decision-trace JSON path
assert_launcher_pidns_defect() {
  local trace_path="$1"
  jq -e '
    .trace_version == "decision-trace/v1"
    and .failure_class == "FC-05-environment-capability-gap"
    and .demonstrated_case == "pid_namespace_unavailable"
    and .final_verdict == "FAIL"
    and (.events | length == 3)
    and [.events[].seq] == [1, 2, 3]
    and [.events[].decision] == ["guard_kernel_cascade_assertion", "launch_pid_namespace", "run_kernel_cascade_assertion"]
    and [.events[].outcome] == ["binary_present", "degraded", "failed_without_capability"]
    and all(.events[]; .case == "pid_namespace_unavailable")
    and ([.events[] | select(
      .decision == "guard_kernel_cascade_assertion"
      and .outcome == "binary_present"
      and .evidence.command == "command -v unshare"
      and .evidence.path == "/usr/bin/unshare"
    )] | length == 1)
    and ([.events[] | select(
      .decision == "run_kernel_cascade_assertion"
      and .outcome == "failed_without_capability"
      and .verdict == "FAIL"
      and (.emitted | startswith("not ok 11 POSIX pidns: killing launcher_pid reaps a setsid/backgrounded escapee"))
    )] | length == 1)
  ' "$trace_path" >/dev/null 2>&1
}

# @description Assert the corrected FC-06 LF checkout contract.
# @arg $1 decision-trace JSON path
assert_crlf_worktree_trace() {
  local trace_path="$1"
  jq -e '
    .trace_version == "decision-trace/v1"
    and .failure_class == "FC-06-cross-boundary-representation"
    and .demonstrated_case == "autocrlf_shell_checkout"
    and .final_verdict == "PASS"
    and (.events | length == 2)
    and [.events[].seq] == [1, 2]
    and [.events[].decision] == ["apply_checkout_policy", "assert_bash_shebang_worktree_eol"]
    and [.events[].outcome] == ["lf_for_bash_files", "no_cr_bytes"]
    and all(.events[]; .case == "autocrlf_shell_checkout")
    and ([.events[] | select(
      .decision == "apply_checkout_policy"
      and .outcome == "lf_for_bash_files"
      and .evidence.catch_all == "* text=auto eol=lf"
    )] | length == 1)
    and ([.events[] | select(
      .decision == "assert_bash_shebang_worktree_eol"
      and .outcome == "no_cr_bytes"
      and .evidence.policy_test == "on autocrlf=true checkout, bash-shebang working trees contain no CR"
      and .verdict == "PASS"
    )] | length == 1)
  ' "$trace_path" >/dev/null 2>&1
}

# @description Prove the defective FC-06 trace materialized CRLF shell input.
# @arg $1 defective decision-trace JSON path
assert_crlf_worktree_defect() {
  local trace_path="$1"
  jq -e '
    .trace_version == "decision-trace/v1"
    and .failure_class == "FC-06-cross-boundary-representation"
    and .demonstrated_case == "autocrlf_shell_checkout"
    and .final_verdict == "$'"'"'\\r'"'"': command not found"
    and (.events | length == 2)
    and [.events[].seq] == [1, 2]
    and [.events[].decision] == ["materialize_shell_checkout", "run_foreman_setup"]
    and [.events[].outcome] == ["crlf", "shell_parse_failed"]
    and all(.events[]; .case == "autocrlf_shell_checkout")
    and ([.events[] | select(
      .decision == "materialize_shell_checkout"
      and .outcome == "crlf"
      and .evidence.affected_sh_files == 78
      and .evidence.index_blob_eol == "LF"
      and .evidence.worktree_eol == "CRLF"
    )] | length == 1)
    and ([.events[] | select(
      .decision == "run_foreman_setup"
      and .outcome == "shell_parse_failed"
      and .verdict == "$'"'"'\\r'"'"': command not found"
      and .emitted == "lib/common.sh: line 3: $'"'"'\\r'"'"': command not found"
    )] | length == 1)
  ' "$trace_path" >/dev/null 2>&1
}

# @description Assert the corrected FC-07 lane-artifact isolation contract.
# @arg $1 decision-trace JSON path
assert_lane_lint_isolation_trace() {
  local trace_path="$1"
  jq -e '
    .trace_version == "decision-trace/v1"
    and .failure_class == "FC-07-isolation-artifact-safety"
    and .demonstrated_case == "lane_artifact_contaminates_repository_total"
    and .final_verdict == "118 repository Markdown files checked; 1 lane artifact excluded"
    and (.events | length == 3)
    and [.events[].seq] == [1, 2, 3]
    and [.events[].decision] == ["define_isolation_boundary", "enumerate_markdown_inputs", "summarize_repository_lint"]
    and [.events[].outcome] == ["lane_artifacts_excluded", "repository_scope_only", "stable_repository_total"]
    and all(.events[]; .case == "lane_artifact_contaminates_repository_total")
    and ([.events[] | select(
      .decision == "define_isolation_boundary"
      and .outcome == "lane_artifacts_excluded"
      and .evidence.excluded_patterns == ["SPEC-*.md", ".harness/**", "FOREMAN_REPORT.*"]
    )] | length == 1)
    and ([.events[] | select(
      .decision == "enumerate_markdown_inputs"
      and .outcome == "repository_scope_only"
      and .evidence.checked_files == 118
      and .evidence.excluded_lane_artifacts == 1
      and .evidence.excluded_paths == ["SPEC-tier1.md"]
    )] | length == 1)
    and ([.events[] | select(
      .decision == "summarize_repository_lint"
      and .outcome == "stable_repository_total"
      and .evidence.repository_files == 118
      and .evidence.lane_artifacts_included == 0
      and .verdict == "118 repository Markdown files checked; 1 lane artifact excluded"
      and .emitted == "markdownlint: checked=118 repository_files=118 excluded_lane_artifacts=1 path=SPEC-tier1.md"
    )] | length == 1)
  ' "$trace_path" >/dev/null 2>&1
}

# @description Prove the defective FC-07 measurement crossed its lane boundary.
# @arg $1 defective decision-trace JSON path
assert_lane_lint_isolation_defect() {
  local trace_path="$1"
  jq -e '
    .trace_version == "decision-trace/v1"
    and .failure_class == "FC-07-isolation-artifact-safety"
    and .demonstrated_case == "lane_artifact_contaminates_repository_total"
    and .final_verdict == "119 Markdown files checked"
    and (.events | length == 3)
    and [.events[].seq] == [1, 2, 3]
    and [.events[].decision] == ["enumerate_markdown_inputs", "read_lane_scoped_artifact", "summarize_repository_lint"]
    and [.events[].outcome] == ["worktree_wide_glob", "included_outside_measurement_boundary", "contaminated_by_lane_artifact"]
    and all(.events[]; .case == "lane_artifact_contaminates_repository_total")
    and ([.events[] | select(
      .decision == "enumerate_markdown_inputs"
      and .outcome == "worktree_wide_glob"
      and .evidence.glob == "**/*.md"
      and .evidence.repository_files == 118
      and .evidence.lane_artifacts == 1
    )] | length == 1)
    and ([.events[] | select(
      .decision == "read_lane_scoped_artifact"
      and .outcome == "included_outside_measurement_boundary"
      and .evidence.path == "SPEC-tier1.md"
      and .evidence.expected_scope == "lane_only"
      and .evidence.observed_scope == "repository_lint"
    )] | length == 1)
    and ([.events[] | select(
      .decision == "summarize_repository_lint"
      and .outcome == "contaminated_by_lane_artifact"
      and .evidence.checked_files == 119
      and .evidence.repository_files == 118
      and .evidence.lane_artifacts_included == 1
      and .verdict == "119 Markdown files checked"
      and .emitted == "markdownlint: checked=119 repository_files=118 lane_artifacts_included=1 path=SPEC-tier1.md"
    )] | length == 1)
  ' "$trace_path" >/dev/null 2>&1
}

# @description Assert the corrected FC-08 task-record reconciliation.
# @arg $1 decision-trace JSON path
assert_vendor_task_state_trace() {
  local trace_path="$1"
  jq -e '
    .trace_version == "decision-trace/v1"
    and .failure_class == "FC-08-record-state-disagreement"
    and .demonstrated_case == "implemented_tasks_unticked"
    and .final_verdict == "23 done / 19 open"
    and (.events | length == 2)
    and [.events[].seq] == [1, 2]
    and [.events[].decision] == ["verify_implemented_task_state", "reconcile_task_record"]
    and [.events[].outcome] == ["verified", "record_matches_verified_state"]
    and all(.events[]; .case == "implemented_tasks_unticked")
    and ([.events[] | select(
      .decision == "verify_implemented_task_state"
      and .outcome == "verified"
      and .evidence.done == 23
      and .evidence.open == 19
      and .evidence.t5_done == 0
    )] | length == 1)
    and ([.events[] | select(
      .decision == "reconcile_task_record"
      and .outcome == "record_matches_verified_state"
      and .verdict == "23 done / 19 open"
      and .emitted == "23 done / 19 open"
    )] | length == 1)
  ' "$trace_path" >/dev/null 2>&1
}

# @description Prove the defective FC-08 task record contradicted merged code.
# @arg $1 defective decision-trace JSON path
assert_vendor_task_state_defect() {
  local trace_path="$1"
  jq -e '
    .trace_version == "decision-trace/v1"
    and .failure_class == "FC-08-record-state-disagreement"
    and .demonstrated_case == "implemented_tasks_unticked"
    and .final_verdict == "0 of 42 tasks done"
    and (.events | length == 2)
    and [.events[].seq] == [1, 2]
    and [.events[].decision] == ["read_task_record", "compare_record_to_repository"]
    and [.events[].outcome] == ["reported", "disagreement"]
    and all(.events[]; .case == "implemented_tasks_unticked")
    and ([.events[] | select(
      .decision == "read_task_record"
      and .outcome == "reported"
      and .evidence.done == 0
      and .evidence.total == 42
    )] | length == 1)
    and ([.events[] | select(
      .decision == "compare_record_to_repository"
      and .outcome == "disagreement"
      and .evidence.repository_state == "T1 through T4 implemented, verified and merged"
      and .verdict == "0 of 42 tasks done"
    )] | length == 1)
  ' "$trace_path" >/dev/null 2>&1
}

# @description Assert the corrected FC-09 bounded rework decision contract.
# @arg $1 decision-trace JSON path
assert_reaudit_convergence_trace() {
  local trace_path="$1"
  jq -e '
    .trace_version == "decision-trace/v1"
    and .failure_class == "FC-09-decision-policy-nonconvergent"
    and .demonstrated_case == "rework_decision_repeats_without_convergence"
    and .final_verdict == "ESCALATE"
    and (.events | length == 3)
    and [.events[].seq] == [1, 2, 3]
    and [.events[].decision] == ["record_closure_delta", "evaluate_net_progress", "apply_rework_bound"]
    and [.events[].outcome] == ["computed", "progress_measured", "escalated_at_bound"]
    and all(.events[]; .case == "rework_decision_repeats_without_convergence")
    and ([.events[] | select(
      .decision == "record_closure_delta"
      and .outcome == "computed"
      and .evidence.round == 2
      and .evidence.closed == 8
      and .evidence.still_open == 10
      and .evidence.newly_introduced == 3
    )] | length == 1)
    and ([.events[] | select(
      .decision == "evaluate_net_progress"
      and .outcome == "progress_measured"
      and .evidence.net_closed == 5
      and .evidence.criterion == "newly_introduced < closed"
    )] | length == 1)
    and ([.events[] | select(
      .decision == "apply_rework_bound"
      and .outcome == "escalated_at_bound"
      and .evidence.rounds_observed == 2
      and .evidence.max_rework_rounds == 2
      and .evidence.decision_sequence == ["rework", "escalate"]
      and .verdict == "ESCALATE"
      and .emitted == "rounds=2 decision=ESCALATE net_closed=5"
    )] | length == 1)
  ' "$trace_path" >/dev/null 2>&1
}

# @description Prove the defective FC-09 policy repeats without settling.
# @arg $1 defective decision-trace JSON path
assert_reaudit_convergence_defect() {
  local trace_path="$1"
  jq -e '
    .trace_version == "decision-trace/v1"
    and .failure_class == "FC-09-decision-policy-nonconvergent"
    and .demonstrated_case == "rework_decision_repeats_without_convergence"
    and .final_verdict == "REWORK"
    and (.events | length == 4)
    and [.events[].seq] == [1, 2, 3, 4]
    and [.events[].decision] == ["apply_audit_policy", "apply_audit_policy", "apply_audit_policy", "evaluate_convergence"]
    and [.events[].outcome] == ["rework", "rework", "rework", "no_progress_criterion"]
    and all(.events[]; .case == "rework_decision_repeats_without_convergence")
    and ([.events[] | select(
      .decision == "apply_audit_policy"
      and .outcome == "rework"
      and .evidence.verdict == "BLOCKED"
      and .evidence.decision_changed == false
    )] | length == 3)
    and ([.events[] | select(.decision == "apply_audit_policy") | .evidence.round] == [1, 2, 3])
    and ([.events[] | select(
      .decision == "evaluate_convergence"
      and .outcome == "no_progress_criterion"
      and .evidence.rounds_observed == 3
      and .evidence.decision_sequence == ["rework", "rework", "rework"]
      and .verdict == "REWORK"
      and .emitted == "rounds=3 decision=REWORK convergence=undefined"
    )] | length == 1)
  ' "$trace_path" >/dev/null 2>&1
}

# @description Assert the corrected FC-10 task/objective reconciliation contract.
# @arg $1 decision-trace JSON path
assert_lane_report_objective_trace() {
  local trace_path="$1"
  jq -e '
    .trace_version == "decision-trace/v1"
    and .failure_class == "FC-10-orchestration-task-mismatch"
    and .demonstrated_case == "worker_success_for_different_objective"
    and .final_verdict == "TASK MATCH"
    and (.events | length == 3)
    and [.events[].seq] == [1, 2, 3]
    and [.events[].decision] == ["dispatch_lane_objective", "validate_worker_artifact", "classify_task_completion"]
    and [.events[].outcome] == ["objective_recorded", "report_complete", "objective_and_artifact_match"]
    and all(.events[]; .case == "worker_success_for_different_objective")
    and ([.events[] | select(
      .decision == "dispatch_lane_objective"
      and .outcome == "objective_recorded"
      and .evidence.objective == "Implement round-ownership-default and prove 8 of 8 round-ownership tests pass"
      and .evidence.required_artifact == "FOREMAN_REPORT.md"
    )] | length == 1)
    and ([.events[] | select(
      .decision == "validate_worker_artifact"
      and .outcome == "report_complete"
      and .evidence.required_sections == ["Changes", "Verification", "Evidence", "Gaps"]
      and .evidence.completed_sections == 4
      and .evidence.tbd_placeholders == 0
      and .evidence.worker_objective == "Implement round-ownership-default and prove 8 of 8 round-ownership tests pass"
    )] | length == 1)
    and ([.events[] | select(
      .decision == "classify_task_completion"
      and .outcome == "objective_and_artifact_match"
      and .evidence.expected_tests == 8
      and .evidence.passing_tests == 8
      and .verdict == "TASK MATCH"
      and .emitted == "task objective matched; FOREMAN_REPORT.md complete; round-ownership 8 of 8 pass"
    )] | length == 1)
  ' "$trace_path" >/dev/null 2>&1
}

# @description Prove the defective FC-10 lane succeeded against a different task.
# @arg $1 defective decision-trace JSON path
assert_lane_report_objective_defect() {
  local trace_path="$1"
  jq -e '
    .trace_version == "decision-trace/v1"
    and .failure_class == "FC-10-orchestration-task-mismatch"
    and .demonstrated_case == "worker_success_for_different_objective"
    and .final_verdict == "Result=success"
    and (.events | length == 3)
    and [.events[].seq] == [1, 2, 3]
    and [.events[].decision] == ["dispatch_lane_objective", "observe_worker_completion", "compare_task_to_artifact"]
    and [.events[].outcome] == ["objective_recorded", "process_success", "objective_mismatch"]
    and all(.events[]; .case == "worker_success_for_different_objective")
    and ([.events[] | select(
      .decision == "dispatch_lane_objective"
      and .outcome == "objective_recorded"
      and .evidence.objective == "Implement round-ownership-default and prove 8 of 8 round-ownership tests pass"
      and .evidence.required_artifact == "FOREMAN_REPORT.md"
    )] | length == 1)
    and ([.events[] | select(
      .decision == "observe_worker_completion"
      and .outcome == "process_success"
      and .evidence.exit_status == 0
      and .evidence.worker_claim == "Core mechanism landed and independently verified"
    )] | length == 1)
    and ([.events[] | select(
      .decision == "compare_task_to_artifact"
      and .outcome == "objective_mismatch"
      and .evidence.worker_objective == "Run the destructive refusal proof"
      and .evidence.dispatched_objective == "Implement round-ownership-default and prove 8 of 8 round-ownership tests pass"
      and .evidence.report_sections == ["Changes=(TBD)", "Verification=(TBD)", "Evidence=(TBD)", "Gaps=(TBD)"]
      and .evidence.completed_sections == 0
      and .verdict == "Result=success"
      and .emitted == "ExecMainStatus=0, Result=success; FOREMAN_REPORT.md sections complete=0 of 4"
    )] | length == 1)
  ' "$trace_path" >/dev/null 2>&1
}

# @description Assert that a defective trace contains its round-specific witness.
# @arg $1 round id
# @arg $2 defective decision-trace JSON path
# @return 0 when the trace exhibits the seeded defect
assert_seeded_defect() {
  local round_id="$1" trace_path="$2"

  case "$round_id" in
    audit-watchdog-orphaned-sleep)
      assert_audit_watchdog_defect "$trace_path"
      ;;
    crlf-worktree-shell-unrunnable)
      assert_crlf_worktree_defect "$trace_path"
      ;;
    formal-setsid-unavailable)
      assert_formal_setsid_defect "$trace_path"
      ;;
    grok-single-turn-empty-burst)
      assert_grok_empty_burst_defect "$trace_path"
      ;;
    launcher-pidns-capability-guard)
      assert_launcher_pidns_defect "$trace_path"
      ;;
    lane-lint-worktree-artifact-leak)
      assert_lane_lint_isolation_defect "$trace_path"
      ;;
    lane-report-objective-mismatch)
      assert_lane_report_objective_defect "$trace_path"
      ;;
    reaudit-rework-no-convergence)
      assert_reaudit_convergence_defect "$trace_path"
      ;;
    stall-no-output-undefined-predicate)
      assert_stall_no_output_defect "$trace_path"
      ;;
    vendor-adapter-task-state)
      assert_vendor_task_state_defect "$trace_path"
      ;;
    *)
      return 1
      ;;
  esac
}

# @description Replay a recorded response against a round's decision-trace assertion.
#   The response argument deliberately remains opaque; only the trace is asserted.
# @arg $1 round id
# @arg $2 decision-trace JSON path
# @arg $3 recorded vendor response
# @return 0 when the decision trace satisfies the round's corrected contract
assert_decision_trace() {
  local round_id="$1" trace_path="$2" recorded_response="$3"

  # Supplying this value models the recorded response replacing a live call. It is
  # never parsed or compared, so cosmetic vendor wording cannot affect a verdict.
  : "$recorded_response"

  case "$round_id" in
    audit-watchdog-orphaned-sleep)
      assert_audit_watchdog_trace "$trace_path"
      ;;
    crlf-worktree-shell-unrunnable)
      assert_crlf_worktree_trace "$trace_path"
      ;;
    formal-setsid-unavailable)
      assert_formal_setsid_trace "$trace_path"
      ;;
    grok-single-turn-empty-burst)
      assert_grok_empty_burst_trace "$trace_path"
      ;;
    launcher-pidns-capability-guard)
      assert_launcher_pidns_trace "$trace_path"
      ;;
    lane-lint-worktree-artifact-leak)
      assert_lane_lint_isolation_trace "$trace_path"
      ;;
    lane-report-objective-mismatch)
      assert_lane_report_objective_trace "$trace_path"
      ;;
    reaudit-rework-no-convergence)
      assert_reaudit_convergence_trace "$trace_path"
      ;;
    stall-no-output-undefined-predicate)
      assert_stall_no_output_trace "$trace_path"
      ;;
    vendor-adapter-task-state)
      assert_vendor_task_state_trace "$trace_path"
      ;;
    *)
      return 1
      ;;
  esac
}

# @description Validate and replay both traces for one golden-round directory.
# @arg $1 round directory
replay_round() {
  local round_dir="$1"
  local round_id transcript defective_trace corrected_trace demonstration
  local artefact failure_class recorded_response
  local transcript_defective transcript_corrected demo_defective demo_corrected
  local expected_defective expected_corrected observed_defective observed_corrected
  local defective_result corrected_result expected_path

  round_id="$(basename "$round_dir")"
  transcript="$round_dir/transcript.json"
  defective_trace="$round_dir/defective-trace.json"
  corrected_trace="$round_dir/corrected-trace.json"
  demonstration="$round_dir/demonstration.json"

  for artefact in transcript.json defective-trace.json corrected-trace.json demonstration.json; do
    if [[ ! -f "$round_dir/$artefact" ]]; then
      round_fail "$round_id" "missing artefact: $artefact"
      return
    fi
    if ! jq -e . "$round_dir/$artefact" >/dev/null 2>&1; then
      round_fail "$round_id" "invalid JSON artefact: $artefact"
      return
    fi
  done

  if ! jq -e --arg round_id "$round_id" '
    .round_id == $round_id
    and (.failure_class | type == "string" and length > 0)
    and (.vendor.name | type == "string" and length > 0)
    and (.vendor.model | type == "string" and length > 0)
    and (.vendor.interface | type == "string" and length > 0)
    and (.vendor.version | type == "string" and length > 0)
    and (.input_context.prompt | type == "string")
    and (.input_context.repository_state | type == "string" and length > 0)
    and .input_context.network_access == false
    and (.response_text | type == "string" and length > 0)
    and (.recorded_at | type == "string" and length > 0)
    and (.recorded_version | type == "string" and length > 0)
    and (.defective_trace | type == "string" and length > 0)
    and (.corrected_trace | type == "string" and length > 0)
  ' "$transcript" >/dev/null 2>&1; then
    round_fail "$round_id" "transcript metadata is incomplete or permits network access"
    return
  fi

  failure_class="$(jq -r '.failure_class' "$transcript")"
  recorded_response="$(jq -r '.response_text' "$transcript")"
  transcript_defective="$(jq -r '.defective_trace' "$transcript")"
  transcript_corrected="$(jq -r '.corrected_trace' "$transcript")"

  for artefact in defective-trace.json corrected-trace.json; do
    if ! jq -e --arg round_id "$round_id" --arg failure_class "$failure_class" '
      .round_id == $round_id
      and .failure_class == $failure_class
      and (.events | type == "array")
      and (.final_verdict | type == "string" and length > 0)
    ' "$round_dir/$artefact" >/dev/null 2>&1; then
      round_fail "$round_id" "$artefact metadata does not match the round"
      return
    fi
  done

  if ! jq -e --arg round_id "$round_id" --arg failure_class "$failure_class" '
    .round_id == $round_id
    and .failure_class == $failure_class
    and (.defective_trace | type == "string" and length > 0)
    and (.corrected_trace | type == "string" and length > 0)
    and (.defective_verdict | type == "string" and length > 0)
    and (.corrected_verdict | type == "string" and length > 0)
    and (.harness_version | type == "string" and length > 0)
    and (.demonstrated_at | type == "string" and length > 0)
    and (.demonstrated_by | type == "string" and length > 0)
  ' "$demonstration" >/dev/null 2>&1; then
    round_fail "$round_id" "demonstration metadata does not match the round"
    return
  fi

  demo_defective="$(jq -r '.defective_trace' "$demonstration")"
  demo_corrected="$(jq -r '.corrected_trace' "$demonstration")"
  expected_defective="$(jq -r '.defective_verdict' "$demonstration")"
  expected_corrected="$(jq -r '.corrected_verdict' "$demonstration")"

  expected_path="tests/golden-rounds/$round_id/defective-trace.json"
  if [[ "$transcript_defective" != "$expected_path" || "$demo_defective" != "$expected_path" ]]; then
    round_fail "$round_id" "defective trace path is not the round artefact"
    return
  fi
  expected_path="tests/golden-rounds/$round_id/corrected-trace.json"
  if [[ "$transcript_corrected" != "$expected_path" || "$demo_corrected" != "$expected_path" ]]; then
    round_fail "$round_id" "corrected trace path is not the round artefact"
    return
  fi

  if [[ "$expected_defective" == "$expected_corrected" ]]; then
    round_fail "$round_id" \
      "demonstration record is not fail-then-pass: recorded verdicts are both $expected_defective"
    return
  fi

  if ! assert_seeded_defect "$round_id" "$defective_trace"; then
    round_fail "$round_id" "defective trace does not exhibit the seeded defect"
    return
  fi

  if assert_decision_trace "$round_id" "$defective_trace" "$recorded_response"; then
    defective_result="pass"
  else
    defective_result="fail"
  fi
  if assert_decision_trace "$round_id" "$corrected_trace" "$recorded_response"; then
    corrected_result="pass"
  else
    corrected_result="fail"
  fi

  if [[ "$defective_result" != "fail" ]]; then
    round_fail "$round_id" \
      "replay is not fail-then-pass: defective decision trace unexpectedly satisfies the round assertion"
    return
  fi
  if [[ "$corrected_result" != "pass" ]]; then
    round_fail "$round_id" \
      "replay is not fail-then-pass: corrected decision trace does not satisfy the round assertion"
    return
  fi

  observed_defective="$(jq -r '.final_verdict' "$defective_trace")"
  observed_corrected="$(jq -r '.final_verdict' "$corrected_trace")"
  if [[ "$observed_defective" != "$expected_defective" \
    || "$observed_corrected" != "$expected_corrected" ]]; then
    round_fail "$round_id" \
      "replay verdict pair $observed_defective -> $observed_corrected does not match record $expected_defective -> $expected_corrected"
    return
  fi

  DEMONSTRATED_CLASSES["$failure_class"]=1
  printf 'PASS round_id=%s: replayed fail-then-pass; decision verdicts=%s -> %s\n' \
    "$round_id" "$observed_defective" "$observed_corrected"
}

# @description Compare documented failure classes with successfully demonstrated rounds.
# @return 0 when the class document can be read, including for incomplete coverage
report_coverage() {
  local -a all_classes=() missing_classes=()
  local failure_class demonstrated_count=0

  if [[ ! -f "$CLASS_DOCUMENT" ]]; then
    printf 'FAIL coverage: missing class document: %s\n' "$CLASS_DOCUMENT" >&2
    FAILURES=$((FAILURES + 1))
    return 1
  fi
  mapfile -t all_classes < <(
    awk -F '`' '/^Stable id: `/ { print $2 }' "$CLASS_DOCUMENT"
  )
  if (( ${#all_classes[@]} == 0 )); then
    printf 'FAIL coverage: no failure classes found in %s\n' "$CLASS_DOCUMENT" >&2
    FAILURES=$((FAILURES + 1))
    return 1
  fi

  for failure_class in "${all_classes[@]}"; do
    if [[ -n "${DEMONSTRATED_CLASSES[$failure_class]+present}" ]]; then
      demonstrated_count=$((demonstrated_count + 1))
    else
      missing_classes+=("$failure_class")
    fi
  done

  printf 'COVERAGE: %d of %d failure classes demonstrated' \
    "$demonstrated_count" "${#all_classes[@]}"
  if (( ${#missing_classes[@]} > 0 )); then
    printf '; missing:'
    printf ' %s' "${missing_classes[@]}"
  fi
  printf '\n'
  if (( demonstrated_count < ${#all_classes[@]} )); then
    printf 'COVERAGE NOTE: incomplete corpus is loud; a newly recorded failure class is not closed until its golden round and demonstration record exist.\n'
  fi
}

if ! command -v jq >/dev/null 2>&1; then
  printf 'FAIL Tier 1 replay requires local jq\n' >&2
  exit 2
fi
if [[ ! -d "$GOLDEN_ROOT" ]]; then
  printf 'FAIL Tier 1 golden-round root missing: %s\n' "$GOLDEN_ROOT" >&2
  exit 1
fi

declare -a round_dirs=()
mapfile -d '' -t round_dirs < <(
  find "$GOLDEN_ROOT" -mindepth 1 -maxdepth 1 -type d -print0 | sort -z
)
if (( ${#round_dirs[@]} == 0 )); then
  printf 'FAIL Tier 1 replay found no golden rounds in %s\n' "$GOLDEN_ROOT" >&2
  exit 1
fi

for round_dir in "${round_dirs[@]}"; do
  replay_round "$round_dir"
done
report_coverage || true

if (( FAILURES > 0 )); then
  printf 'Tier 1 replay: FAIL (%d round or coverage error(s))\n' "$FAILURES" >&2
  exit 1
fi
printf 'Tier 1 replay: PASS (%d round(s))\n' "${#round_dirs[@]}"
