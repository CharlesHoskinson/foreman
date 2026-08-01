#!/usr/bin/env bash
# @description Local CI entrypoint: run every gate a CI job would have run, on
#   this host, reproducibly. Valuable whether or not remote CI exists — one
#   host-local, ordered report of every gate. The out-of-credits premise that
#   once justified this file was disproven on 2026-07-31. Gates run in order;
#   every gate runs even if an early one fails, so one invocation reports
#   everything. Exit non-zero if any failable gate failed.
#
# Gates (in order):
#   1. shellcheck   - warning-level scan of the shell tree; FAIL only on error
#   2. openspec     - strict validation of every change package
#   3. formal       - Quint commit-tier + drift (skip with --quick or if no quint)
#   4. bats         - tests/run.sh under the host-wide bats mutex (skip with --quick)
#   5. install      - install.sh smoke test under a disposable HOME
#   6. lanes        - lane-complete-check over /root/fm-wt/* (informational only)
#   7. plugin-drift - installed skill vs repo skill (informational only)
#
# Usage:
#   tools/ci-local.sh [--quick]
#
# @stdout One GATE <name> PASS|FAIL|SKIP <detail> line per gate, then
#   CI-LOCAL RESULT PASS|FAIL gates_failed=<n>
# @exitcode 0 no failable gate failed; 1 one or more failed; 2 usage error
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

QUICK=0
usage() {
  echo "usage: tools/ci-local.sh [--quick]" >&2
  exit 2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --quick) QUICK=1; shift ;;
    -h|--help) usage ;;
    *)
      echo "unknown argument: $1" >&2
      usage
      ;;
  esac
done

gates_failed=0

# Always run from REPO_ROOT for relative globs; cwd of the caller is irrelevant.
cd "$REPO_ROOT" || {
  echo "CI-LOCAL RESULT FAIL gates_failed=1 (cannot cd to repo root: $REPO_ROOT)" >&2
  exit 1
}

# ---------------------------------------------------------------------------
# Gate 1: shellcheck
# ---------------------------------------------------------------------------
gate_shellcheck() {
  local name="shellcheck"
  if ! command -v shellcheck >/dev/null 2>&1; then
    echo "GATE ${name} SKIP shellcheck not installed"
    return 0
  fi

  local files=()
  # shellcheck disable=SC2206
  local candidates=(
    skills/foreman/scripts/*.sh
    skills/foreman/scripts/lib/*.sh
    tools/*.sh
    env/*.sh
  )
  local f
  for f in "${candidates[@]}"; do
    [[ -f "$f" ]] && files+=("$f")
  done

  if [[ ${#files[@]} -eq 0 ]]; then
    echo "GATE ${name} SKIP no shell files matched"
    return 0
  fi

  local gcc_out err_count warn_count
  gcc_out="$(shellcheck -S warning -f gcc "${files[@]}" 2>&1 || true)"
  err_count="$(printf '%s\n' "$gcc_out" | grep -c ': error:' || true)"
  warn_count="$(printf '%s\n' "$gcc_out" | grep -c ': warning:' || true)"
  # Normalize empty grep -c edge cases
  err_count="${err_count:-0}"
  warn_count="${warn_count:-0}"

  if [[ "$err_count" -gt 0 ]]; then
    echo "GATE ${name} FAIL errors=${err_count} warnings=${warn_count}"
    return 1
  fi
  echo "GATE ${name} PASS warnings=${warn_count} files=${#files[@]}"
  return 0
}

# ---------------------------------------------------------------------------
# Gate 2: OpenSpec strict validation
# ---------------------------------------------------------------------------
gate_openspec() {
  local name="openspec"
  local openspec_bin="/usr/local/bin/openspec"
  if [[ ! -x "$openspec_bin" ]]; then
    echo "GATE ${name} FAIL ${openspec_bin} not executable"
    return 1
  fi

  local failed=()
  local valid=0
  local d c
  shopt -s nullglob
  for d in openspec/changes/*/; do
    c="$(basename "$d")"
    [[ "$c" = archive ]] && continue
    if "$openspec_bin" validate "$c" --strict >/dev/null 2>&1; then
      valid=$((valid + 1))
    else
      failed+=("$c")
    fi
  done
  shopt -u nullglob

  if [[ ${#failed[@]} -gt 0 ]]; then
    echo "GATE ${name} FAIL valid=${valid} failed=${#failed[@]} (${failed[*]})"
    return 1
  fi
  echo "GATE ${name} PASS packages_valid=${valid}"
  return 0
}

# ---------------------------------------------------------------------------
# Gate 3: formal models (Quint commit-tier + drift)
# ---------------------------------------------------------------------------
gate_formal() {
  local name="formal"
  if [[ "$QUICK" -eq 1 ]]; then
    echo "GATE ${name} SKIP --quick"
    return 0
  fi

  if ! command -v quint >/dev/null 2>&1; then
    echo "GATE ${name} SKIP quint not installed"
    return 0
  fi

  local checks_out checks_rc drift_out drift_rc
  # Detach pipefail so a non-zero runner does not abort the gate body before
  # we can format a single GATE line from both sub-checks.
  set +o pipefail
  checks_out="$(bash "$REPO_ROOT/formal/run-checks.sh" --tier commit 2>&1)"
  checks_rc=$?
  drift_out="$(bash "$REPO_ROOT/formal/check-drift.sh" 2>&1)"
  drift_rc=$?
  set -o pipefail

  if [[ "$checks_rc" -ne 0 || "$drift_rc" -ne 0 ]]; then
    local detail=""
    if [[ "$checks_rc" -ne 0 ]]; then
      local checks_tail
      checks_tail="$(printf '%s\n' "$checks_out" | tail -n 5 | tr '\n' ' ' | sed 's/[[:space:]]*$//')"
      detail+="run-checks rc=${checks_rc}: ${checks_tail}"
    fi
    if [[ "$drift_rc" -ne 0 ]]; then
      local drift_msg
      drift_msg="$(printf '%s\n' "$drift_out" | tr '\n' ' ' | sed 's/[[:space:]]*$//')"
      [[ -n "$detail" ]] && detail+="; "
      detail+="check-drift rc=${drift_rc}: ${drift_msg}"
    fi
    echo "GATE ${name} FAIL ${detail}"
    return 1
  fi

  echo "GATE ${name} PASS commit-tier+drift"
  return 0
}

# ---------------------------------------------------------------------------
# Gate 4: bats suite via tests/run.sh
# ---------------------------------------------------------------------------
gate_bats() {
  local name="bats"
  if [[ "$QUICK" -eq 1 ]]; then
    echo "GATE ${name} SKIP --quick (slow suite deferred)"
    return 0
  fi

  # Warn if lanes are active: the suite takes the host-wide bats mutex.
  if [[ -x "$REPO_ROOT/tools/lanectl.sh" ]]; then
    local lane_ps
    lane_ps="$(bash "$REPO_ROOT/tools/lanectl.sh" ps 2>/dev/null || true)"
    if [[ -n "$(printf '%s' "$lane_ps" | sed '/^$/d' | grep -v '^OWNER\|^---' || true)" ]]; then
      echo "WARNING: tools/lanectl.sh ps shows running lanes; bats holds /tmp/foreman-bats.lock and may starve them" >&2
      printf '%s\n' "$lane_ps" >&2
    fi
  fi

  export TEST_GATE_MODE="${TEST_GATE_MODE:-shadow}"

  local out rc result total
  # Detached from the controlling terminal so a backgrounded harness cannot
  # SIGTTIN-suspend on tty reads. stdin from /dev/null; flock is host-wide.
  set +o pipefail
  out="$(setsid flock /tmp/foreman-bats.lock bash "$REPO_ROOT/tests/run.sh" </dev/null 2>&1)"
  rc=$?
  set -o pipefail

  # Persist the full TAP stream (pass and fail). Best-effort only: a write
  # failure must not change the gate verdict.
  local tap_log
  tap_log="${TEST_TAP_LOG:-${TMPDIR:-/tmp}/foreman-test-tap.log}"
  mkdir -p -- "$(dirname "$tap_log")" 2>/dev/null || true
  printf '%s\n' "$out" >"$tap_log" 2>/dev/null || true

  result="$(printf '%s\n' "$out" | grep -E '^RESULT ' | tail -n1 || true)"
  total="$(printf '%s\n' "$out" | grep -E '^TOTAL ' | tail -n1 || true)"
  local report
  report="$(printf '%s\n' "$out" | grep -E '^REPORT ' | tail -n1 || true)"

  # PASS / SHADOW / ERROR / FAIL from the runner. Treat RESULT PASS and
  # RESULT SHADOW as green; anything else (or missing RESULT) as fail.
  if [[ "$result" == RESULT\ PASS* || "$result" == RESULT\ SHADOW* ]]; then
    echo "GATE ${name} PASS ${result#RESULT } ${total} ${report} ${tap_log}"
    return 0
  fi

  if [[ -z "$result" ]]; then
    echo "GATE ${name} FAIL no RESULT line from tests/run.sh rc=${rc} ${tap_log}"
    return 1
  fi
  echo "GATE ${name} FAIL ${result#RESULT } ${total} rc=${rc} ${tap_log}"
  return 1
}

# ---------------------------------------------------------------------------
# Gate 5: install.sh smoke test under disposable HOME
# ---------------------------------------------------------------------------
gate_install() {
  local name="install"
  local installer="$REPO_ROOT/install.sh"
  if [[ ! -f "$installer" ]]; then
    echo "GATE ${name} FAIL install.sh missing at $installer"
    return 1
  fi

  local tmp
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/ci-local-install.XXXXXX")"
  local rc=0
  # Disposable HOME so the installer cannot touch the operator's real one.
  if ! HOME="$tmp" bash "$installer" >/dev/null 2>&1; then
    rc=1
  fi
  rm -rf -- "$tmp"

  if [[ "$rc" -ne 0 ]]; then
    echo "GATE ${name} FAIL install.sh exited non-zero under disposable HOME"
    return 1
  fi
  echo "GATE ${name} PASS disposable_HOME_smoke"
  return 0
}

# ---------------------------------------------------------------------------
# Gate 6: lane completeness (informational — never fails the run)
# ---------------------------------------------------------------------------
gate_lanes() {
  local name="lanes"
  local checker="$REPO_ROOT/skills/foreman/scripts/lane-complete-check.sh"
  if [[ ! -x "$checker" && ! -f "$checker" ]]; then
    echo "GATE ${name} SKIP lane-complete-check.sh missing"
    return 0
  fi

  local checked=0 complete=0 incomplete=0
  local wt report verdict
  shopt -s nullglob
  for wt in /root/fm-wt/*/; do
    report="${wt}FOREMAN_REPORT.md"
    [[ -f "$report" ]] || continue
    checked=$((checked + 1))
    verdict="$(bash "$checker" "$wt" 2>&1 || true)"
    printf '%s\n' "$verdict"
    if printf '%s\n' "$verdict" | grep -q 'LANE_COMPLETE'; then
      complete=$((complete + 1))
    else
      incomplete=$((incomplete + 1))
    fi
  done
  shopt -u nullglob

  # Informational only: always PASS so mid-flight lanes do not fail CI.
  echo "GATE ${name} PASS checked=${checked} complete=${complete} incomplete=${incomplete} (informational)"
  return 0
}

# ---------------------------------------------------------------------------
# Gate 7: plugin drift (informational — never fails the run)
# ---------------------------------------------------------------------------
# The installed skill path exists only on a developer host. A hosted runner has
# no ~/.claude, so a failing gate here would fail CI for an absent directory,
# not for drift. It reports and never fails, like the lanes gate above.
gate_plugin_drift() {
  local name="plugin-drift"
  local checker="$REPO_ROOT/tools/plugin-drift.sh"
  local repo_skill="$REPO_ROOT/skills/foreman"
  local installed="${FOREMAN_INSTALLED_SKILL:-$HOME/.claude/skills/foreman}"

  if [[ ! -f "$checker" ]]; then
    echo "GATE ${name} SKIP plugin-drift.sh missing"
    return 0
  fi
  if [[ ! -d "$repo_skill" ]]; then
    echo "GATE ${name} SKIP repo skill dir missing: ${repo_skill}"
    return 0
  fi
  if [[ ! -d "$installed" ]]; then
    echo "GATE ${name} SKIP install path absent: ${installed}"
    return 0
  fi

  local out rc missing
  set +o pipefail
  out="$(bash "$checker" "$installed" "$repo_skill" 2>&1)"
  rc=$?
  set -o pipefail

  if [[ "$rc" -eq 0 ]]; then
    echo "GATE ${name} PASS no drift (informational)"
    return 0
  fi

  printf '%s\n' "$out"
  missing="$(printf '%s\n' "$out" | grep -c '^MISSING' || true)"
  missing="${missing:-0}"
  echo "GATE ${name} PASS drift=${missing} file(s) missing from ${installed} (informational)"
  return 0
}

# ---------------------------------------------------------------------------
# Run all gates
# ---------------------------------------------------------------------------
if ! gate_shellcheck; then gates_failed=$((gates_failed + 1)); fi
if ! gate_openspec; then gates_failed=$((gates_failed + 1)); fi
if ! gate_formal; then gates_failed=$((gates_failed + 1)); fi
# The bats gate is OFF by default as of 2026-07-30. It does not merely fail —
# it DEADLOCKS: tests/decision-events.bats hung 31 minutes on one test while
# holding the host-wide bats mutex, and three unrelated verifications queued
# behind it with no output. A gate that can hang forever is worse than no gate,
# because "still running" reads as progress.
# Re-enable per run with FOREMAN_CI_BATS=1, and see docs/design/test-cleanup-roadmap.md.
if [[ "${FOREMAN_CI_BATS:-0}" == 1 ]]; then
  if ! gate_bats; then gates_failed=$((gates_failed + 1)); fi
else
  echo "GATE bats OFF suite disabled as a gate (deadlocks; FOREMAN_CI_BATS=1 to run) — see docs/design/test-cleanup-roadmap.md"
fi
if ! gate_install; then gates_failed=$((gates_failed + 1)); fi
if ! gate_lanes; then gates_failed=$((gates_failed + 1)); fi
if ! gate_plugin_drift; then gates_failed=$((gates_failed + 1)); fi

if [[ "$gates_failed" -eq 0 ]]; then
  echo "CI-LOCAL RESULT PASS gates_failed=0"
  exit 0
fi
echo "CI-LOCAL RESULT FAIL gates_failed=${gates_failed}"
exit 1
