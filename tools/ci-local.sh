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
#   7. docs         - docs-check.sh (informational only; criterion 9 not yet scoped)
#   8. plugin-drift - installed skill vs repo skill (informational only)
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
# @description Print ci-local usage to standard error and terminate with a usage error.
# @exitcode 2 always
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
# @description Run warning-level ShellCheck across the shell tree, skipping when unavailable and failing only when ShellCheck reports errors.
# @stdout one normalized GATE shellcheck result line
# @exitcode 0 pass or skip
# @exitcode 1 one or more ShellCheck errors
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
# @description Strictly validate every open OpenSpec change package and fail if the validator is unavailable or any package is invalid.
# @stdout one normalized GATE openspec result line
# @exitcode 0 every open package is valid
# @exitcode 1 validator unavailable or at least one package invalid
gate_openspec() {
  local name="openspec"
  # Resolve through PATH first. Hardcoding one absolute path made a correctly
  # installed openspec read as a failed gate: the tool sits at
  # /root/.local/bin/openspec on a developer host and at /usr/local/bin in CI.
  # Same defect shape as the codespell check in gates-linux, which verified an
  # absolute path and so proved a file existed while masking whether the tool
  # resolved at all.
  local openspec_bin
  openspec_bin="$(command -v openspec 2>/dev/null || true)"
  if [[ -z "$openspec_bin" && -x /usr/local/bin/openspec ]]; then
    openspec_bin=/usr/local/bin/openspec
  fi
  if [[ -z "$openspec_bin" ]]; then
    echo "GATE ${name} NOT-AVAILABLE openspec not found on PATH or at /usr/local/bin/openspec — packages are UNVALIDATED"
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
# @description Run the Quint commit-tier and formal drift checks, or skip them in quick mode or when Quint is unavailable.
# @stdout one normalized GATE formal result line
# @exitcode 0 pass or skip
# @exitcode 1 either formal sub-check failed
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
# @description Run tests/run.sh under the host-wide Bats mutex, preserve its TAP output best-effort, and accept only PASS or SHADOW results.
# @stdout one normalized GATE bats result line
# @exitcode 0 pass, shadow, or quick-mode skip
# @exitcode 1 the runner failed or emitted no recognized result
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
    # The header must be stripped by its ACTUAL first column. It begins "PID",
    # not "OWNER" -- OWNER is the fifth column -- so the old filter kept the
    # header on every run and the warning fired unconditionally, including with
    # zero lanes. A diagnostic that always fires carries no information.
    if [[ -n "$(printf '%s' "$lane_ps" | sed '/^$/d' | grep -v '^PID\|^OWNER\|^---' || true)" ]]; then
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
# @description Smoke-test install.sh with a disposable HOME so the operator's real home is not modified.
# @stdout one normalized GATE install result line
# @exitcode 0 the installer succeeded
# @exitcode 1 install.sh is missing or failed
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
# @description Report completeness for discovered Foreman lane worktrees as an informational gate that never fails CI.
# @stdout lane-check output followed by one normalized GATE lanes result line
# @exitcode 0 always
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
# Gate 7: docs-check (informational — never fails the run)
# ---------------------------------------------------------------------------
# @description Run docs-check.sh and report each sub-gate state as an informational
#   line that never fails CI. Visibility for criterion 9 until its scope is settled.
# @stdout one normalized GATE docs result line
# @exitcode 0 always
gate_docs() {
  local name="docs"
  if [[ "$QUICK" -eq 1 ]]; then
    echo "GATE ${name} SKIP --quick"
    return 0
  fi

  local checker="$REPO_ROOT/skills/foreman/scripts/docs-check.sh"
  if [[ ! -x "$checker" && ! -f "$checker" ]]; then
    echo "GATE ${name} SKIP docs-check.sh missing"
    return 0
  fi

  local out summary
  # Guard non-zero exit from docs-check so set -e / pipefail cannot abort ci-local.
  set +o pipefail
  out="$(bash "$checker" 2>&1)" || true
  set -o pipefail

  summary="$(printf '%s\n' "$out" | grep -E '^docs-check:' | tail -n1 || true)"
  if [[ -z "$summary" ]]; then
    echo "GATE ${name} PASS no summary line from docs-check (informational)"
    return 0
  fi
  # Strip the "docs-check: " prefix; keep markdownlint=… codespell=… lychee=… comments=…
  summary="${summary#docs-check: }"
  echo "GATE ${name} PASS ${summary} (informational)"
  return 0
}

# ---------------------------------------------------------------------------
# Gate 8: plugin drift (informational — never fails the run)
# ---------------------------------------------------------------------------
# The installed skill path exists only on a developer host. A hosted runner has
# no ~/.claude, so a failing gate here would fail CI for an absent directory,
# not for drift. It reports and never fails, like the lanes gate above.
# @description Compare the installed Foreman skill with the repository copy as an informational drift gate that never fails CI.
# @stdout drift details when present followed by one normalized GATE plugin-drift result line
# @exitcode 0 always
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
# Unlike plugin-drift above, this gate FAILS. Foreman states its dependencies in
# three unreconciled places -- env/reference-manifest.toml, the must_*/should_*
# arrays in env/tool-check.sh, and the install routes in env/bootstrap-wsl.sh --
# and nothing compared them. That is how `strace` came to be required by the
# lock, missing from all three records, and invisible on a host reporting
# READY: yes while 102 tests failed. Making this informational would rebuild the
# same failure one level up: a check whose result changes nothing is decoration.
# @description Reconcile the three dependency records and fail the gate when they disagree.
# @stdout drift details when present followed by one normalized GATE dependencies result line
# @exitcode 0 the three records agree, or the checker is absent
# @exitcode 1 the records disagree
gate_dependencies() {
  local name="dependencies"
  local checker="$REPO_ROOT/dependencies/check-drift.sh"

  if [[ ! -f "$checker" ]]; then
    echo "GATE ${name} SKIP check-drift.sh missing"
    return 0
  fi

  local out rc drifts
  set +o pipefail
  out="$(bash "$checker" 2>&1)"
  rc=$?
  set -o pipefail

  if [[ "$rc" -eq 0 ]]; then
    echo "GATE ${name} PASS manifest+tool-check+bootstrap agree"
    return 0
  fi

  printf '%s\n' "$out"
  drifts="$(printf '%s\n' "$out" | grep -c '^DRIFT' || true)"
  echo "GATE ${name} FAIL drift=${drifts:-0} record(s) disagree"
  return 1
}

# ---------------------------------------------------------------------------
# Fails, like the dependencies gate and unlike plugin-drift. Document debt is
# not cosmetic here: two lane artifacts at the repository root caused 27
# redundant evidence files, and four competing resume documents at that same
# root left the undated one -- which read as canonical -- naming a branch that
# had been dead for days.
# @description Refuse root-document sprawl and duplicated evidence.
# @stdout violation details when present followed by one normalized GATE hygiene result line
# @exitcode 0 the tree is clean, or the checker is absent
# @exitcode 1 hygiene violations exist
gate_hygiene() {
  local name="hygiene"
  local checker="$REPO_ROOT/tools/repo-hygiene.sh"

  if [[ ! -f "$checker" ]]; then
    echo "GATE ${name} SKIP repo-hygiene.sh missing"
    return 0
  fi

  local out rc count
  set +o pipefail
  out="$(bash "$checker" 2>&1)"
  rc=$?
  set -o pipefail

  if [[ "$rc" -eq 0 ]]; then
    echo "GATE ${name} PASS root allowlist + no duplicate evidence"
    return 0
  fi

  printf '%s\n' "$out"
  count="$(printf '%s\n' "$out" | grep -c '^VIOLATION' || true)"
  echo "GATE ${name} FAIL violations=${count:-0}"
  return 1
}

# ---------------------------------------------------------------------------
# Run all gates
# ---------------------------------------------------------------------------
if ! gate_shellcheck; then gates_failed=$((gates_failed + 1)); fi
if ! gate_openspec; then gates_failed=$((gates_failed + 1)); fi
if ! gate_formal; then gates_failed=$((gates_failed + 1)); fi
# The bats suite gates by default. It was previously off because a hung file
# could hold the host-wide bats mutex indefinitely: tests/decision-events.bats
# once hung 31 minutes on one test with three unrelated verifications queued
# behind it, and "still running" reads as progress.
#
# That failure mode is now bounded. tests/run.sh wraps every file in
# `timeout --kill-after=30 ${TEST_FILE_TIMEOUT_S:-600}`, and the bound was
# exercised in production on 2026-08-01: run 584ddfbb saw audit-verdict.bats
# exceed 600s, get killed, and the run COMPLETE with test_verdict=TIMEOUT
# rather than hang. A hung file now costs at most ten minutes and yields a
# verdict instead of silence.
#
# Set FOREMAN_CI_BATS=0 to skip it for a single run; --quick still skips it too.
if [[ "${FOREMAN_CI_BATS:-1}" == 1 ]]; then
  if ! gate_bats; then gates_failed=$((gates_failed + 1)); fi
else
  echo "GATE bats OFF disabled for this run by FOREMAN_CI_BATS=0"
fi
if ! gate_install; then gates_failed=$((gates_failed + 1)); fi
if ! gate_lanes; then gates_failed=$((gates_failed + 1)); fi
# Informational only: markdownlint is at 45 findings with 44 pending an owner
# scope decision (obligation 56). Becomes gating when criterion 9's scope is settled.
if ! gate_docs; then gates_failed=$((gates_failed + 1)); fi
if ! gate_plugin_drift; then gates_failed=$((gates_failed + 1)); fi
if ! gate_dependencies; then gates_failed=$((gates_failed + 1)); fi
if ! gate_hygiene; then gates_failed=$((gates_failed + 1)); fi

if [[ "$gates_failed" -eq 0 ]]; then
  echo "CI-LOCAL RESULT PASS gates_failed=0"
  exit 0
fi
echo "CI-LOCAL RESULT FAIL gates_failed=${gates_failed}"
exit 1
