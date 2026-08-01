#!/usr/bin/env bash
# formal/run-checks.sh — reproducible Quint regression runner
#
# Anchors verdicts on ^\[violation\] / ^\[ok\] only. Never greps bare
# "violation" (matches the success string "[ok] No violation found").
#
# Usage:
#   formal/run-checks.sh                 # gating commit-tier rows + controls
#   formal/run-checks.sh --tier commit   # same
#   formal/run-checks.sh --tier schedule # deep / large-bound rows
#   formal/run-checks.sh --all           # include non-gating rows
#   formal/run-checks.sh --typecheck-only
#   formal/run-checks.sh --self-test     # classifier + wrong-grep demos only
#   formal/run-checks.sh --row N         # run a single 1-based data row
#
# Kill policy: never pkill -f by pattern. Owned child PIDs only (see
# kill_owned_pid). Bound every model run with timeout so a hung solver cannot
# stall the suite.
#
# Exit codes:
#   0  all executed rows matched expectations; controls passed
#   1  mismatch, control failure, version mismatch, or ERROR classification
#   2  usage / environment error (missing quint, bad args)

set -euo pipefail

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FORMAL_ROOT="${SCRIPT_DIR}"
SPECS_DIR="${FORMAL_ROOT}/specs"
FIXTURES_DIR="${FORMAL_ROOT}/fixtures"
EXPECTATIONS="${FORMAL_ROOT}/expectations.tsv"
VACUOUS="${FORMAL_ROOT}/vacuous-predicates.tsv"
COVERAGE="${FORMAL_ROOT}/coverage.tsv"
OUT_DIR="${FORMAL_ROOT}/out"
REPORT_TSV="${OUT_DIR}/report.tsv"
REPORT_JSON="${OUT_DIR}/report.json"

PINNED_QUINT_VERSION="0.32.0"
PINNED_APALACHE_VERSION="0.56.1"

# Prefer a stable absolute path — never rely on /run/user/*/fnm_multishells/*
# which does not survive a new shell.
DEFAULT_QUINT_CANDIDATES=(
  "${QUINT_BIN:-}"
  "/root/.local/share/fnm/node-versions/v24.18.0/installation/bin/quint"
  "${HOME}/.local/share/fnm/node-versions/v24.18.0/installation/bin/quint"
)

# Per-row wall-clock bound (seconds). Prevents a hung solver from stalling CI.
DEFAULT_ROW_TIMEOUT_SIM=180
DEFAULT_ROW_TIMEOUT_APALACHE=600

# ---------------------------------------------------------------------------
# Globals
# ---------------------------------------------------------------------------

TIER="commit"
INCLUDE_NONGATING=0
TYPECHECK_ONLY=0
SELF_TEST_ONLY=0
ROW_FILTER=""
FAILURES=0
ROWS_RUN=0
ROWS_MATCHED=0
ROWS_SKIPPED=0
declare -a OWNED_PIDS=()

# Force plain output so anchors are greppable (FORCE_COLOR breaks matchers).
export NO_COLOR=1
unset FORCE_COLOR || true

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

# @description Emit a message with the formal-runner prefix.
# @arg $@ message fragments
# @stderr prefixed message
log()  { printf 'formal: %s\n' "$*" >&2; }
# @description Report a fatal usage or environment error and terminate the runner.
# @arg $@ error-message fragments
# @stderr prefixed fatal error
# @exitcode 2 always
die()  { log "ERROR: $*"; exit 2; }
# @description Record a non-fatal check failure for the final suite verdict.
# @arg $@ failure-message fragments
# @stderr prefixed failure message
fail() { log "FAIL: $*"; FAILURES=$((FAILURES + 1)); }

# ---------------------------------------------------------------------------
# ## kill_owned_pid
# Kill a single recorded PID (and its process group when the child is a group
# leader). Never uses pkill -f — that once matched its own command line and
# would kill sibling lanes sharing an Apalache server.
# ---------------------------------------------------------------------------
# @description Terminate one owned live PID or process group, escalating from
#   SIGTERM to SIGKILL after a brief bounded wait.
# @arg $1 recorded child PID; empty or already-dead PIDs are ignored
# @exitcode 0 after the target is absent or termination has been attempted
# shellcheck disable=SC2329 # invoked via cleanup_owned trap
kill_owned_pid() {
  local pid="${1:-}"
  [[ -n "${pid}" ]] || return 0
  if ! kill -0 "${pid}" 2>/dev/null; then
    return 0
  fi
  # Prefer process-group kill when we started a new session; fall back to PID.
  kill -TERM -- "-${pid}" 2>/dev/null || kill -TERM "${pid}" 2>/dev/null || true
  # Brief wait, then SIGKILL the same owned target only.
  for _ in 1 2 3 4 5; do
    kill -0 "${pid}" 2>/dev/null || return 0
    sleep 0.2
  done
  kill -KILL -- "-${pid}" 2>/dev/null || kill -KILL "${pid}" 2>/dev/null || true
}

# ---------------------------------------------------------------------------
# ## cleanup_owned
# On EXIT, terminate every PID this runner recorded as owned.
# ---------------------------------------------------------------------------
# @description Terminate all recorded child PIDs and clear the ownership list.
# @exitcode 0 after cleanup attempts finish
# shellcheck disable=SC2329 # EXIT trap
cleanup_owned() {
  local pid
  for pid in "${OWNED_PIDS[@]:-}"; do
    kill_owned_pid "${pid}"
  done
  OWNED_PIDS=()
}
trap cleanup_owned EXIT

# ---------------------------------------------------------------------------
# ## resolve_quint
# Resolve the quint binary to a stable absolute path. Refuse fnm multishell
# paths. Absent checker → fail (never skip).
# ---------------------------------------------------------------------------
# @description Resolve a usable Quint executable while rejecting ephemeral fnm
#   multishell paths and preferring configured stable candidates.
# @stdout path to the resolved Quint executable
# @stderr skipped-path diagnostics or a fatal missing-tool error
# @exitcode 0 resolved; 2 no stable Quint executable found
resolve_quint() {
  local cand real
  for cand in "${DEFAULT_QUINT_CANDIDATES[@]}"; do
    [[ -n "${cand}" ]] || continue
    if [[ -x "${cand}" ]]; then
      real="$(readlink -f "${cand}" 2>/dev/null || printf '%s' "${cand}")"
      if [[ "${real}" == *"/fnm_multishells/"* ]] || [[ "${cand}" == *"/fnm_multishells/"* ]]; then
        log "skipping fnm multishell path: ${cand}"
        continue
      fi
      printf '%s\n' "${cand}"
      return 0
    fi
  done
  # Last resort: which, but reject multishell results.
  if command -v quint >/dev/null 2>&1; then
    cand="$(command -v quint)"
    real="$(readlink -f "${cand}" 2>/dev/null || printf '%s' "${cand}")"
    if [[ "${real}" == *"/fnm_multishells/"* ]] || [[ "${cand}" == *"/fnm_multishells/"* ]]; then
      # Try to locate installation via fnm node-versions.
      local found
      found="$(find "${HOME}/.local/share/fnm/node-versions" -path '*/bin/quint' -type f 2>/dev/null | head -1 || true)"
      if [[ -n "${found}" && -x "${found}" ]]; then
        printf '%s\n' "${found}"
        return 0
      fi
      die "quint resolves only through fnm multishell (${cand}); set QUINT_BIN to a stable path"
    fi
    printf '%s\n' "${cand}"
    return 0
  fi
  die "quint not found; install Quint ${PINNED_QUINT_VERSION} and set QUINT_BIN"
}

# ---------------------------------------------------------------------------
# ## assert_toolchain
# Pin and assert Quint 0.32.0 and Apalache 0.56.1 presence/version.
# ---------------------------------------------------------------------------
# @description Require the pinned Quint version and record whether the pinned
#   Apalache installation is available for rows that need it.
# @arg $1 resolved Quint executable path
# @stderr detected versions, warnings, or a fatal version mismatch
# @exitcode 0 Quint matches; 2 Quint version mismatch
assert_toolchain() {
  local quint_bin="$1"
  local ver
  ver="$("${quint_bin}" --version 2>/dev/null | head -1 | tr -d '[:space:]')"
  if [[ "${ver}" != "${PINNED_QUINT_VERSION}" ]]; then
    die "Quint version mismatch: got '${ver}', want ${PINNED_QUINT_VERSION} (binary: ${quint_bin})"
  fi
  log "quint ${ver} at ${quint_bin}"

  local apa_dir="${HOME}/.quint/apalache-dist-${PINNED_APALACHE_VERSION}"
  if [[ ! -d "${apa_dir}" ]]; then
    # Soft for simulation-only commit tier: warn, hard-fail only if a row needs apalache.
    log "WARN: Apalache ${PINNED_APALACHE_VERSION} not found at ${apa_dir}"
    APALACHE_OK=0
  else
    log "apalache ${PINNED_APALACHE_VERSION} at ${apa_dir}"
    APALACHE_OK=1
  fi
}

# ---------------------------------------------------------------------------
# ## classify_output
# Map checker output file → VIOLATED | HOLDS | ERROR.
# Anchors only: ^\[violation\] and ^\[ok\]. Unanchored "violation" is wrong —
# the success line is "[ok] No violation found".
# ---------------------------------------------------------------------------
# @description Classify a checker output file using only anchored outcome lines,
#   treating missing, truncated, or unrecognized output as ERROR.
# @arg $1 checker output file
# @stdout VIOLATED, HOLDS, or ERROR
# @exitcode 0 always
classify_output() {
  local file="$1"
  if [[ ! -f "${file}" ]]; then
    printf 'ERROR\n'
    return 0
  fi
  # Strip ANSI just in case some env re-enabled color.
  local plain
  plain="$(sed 's/\x1b\[[0-9;]*m//g' "${file}" 2>/dev/null || cat "${file}")"
  if printf '%s\n' "${plain}" | grep -qE '^\[violation\]'; then
    printf 'VIOLATED\n'
  elif printf '%s\n' "${plain}" | grep -qE '^\[ok\]'; then
    printf 'HOLDS\n'
  else
    printf 'ERROR\n'
  fi
}

# ---------------------------------------------------------------------------
# ## expected_to_observed_class
# Map manifest expected vocabulary onto classifier vocabulary.
# REACHABLE → expect VIOLATED (negated goal fires)
# NOT_REACHABLE → expect HOLDS
# ---------------------------------------------------------------------------
# @description Translate manifest expectation vocabulary into classifier
#   vocabulary, returning ERROR for an unknown expectation.
# @arg $1 expected outcome label
# @stdout VIOLATED, HOLDS, or ERROR
expected_to_observed_class() {
  case "$1" in
    VIOLATED|REACHABLE) printf 'VIOLATED\n' ;;
    HOLDS|NOT_REACHABLE) printf 'HOLDS\n' ;;
    *) printf 'ERROR\n' ;;
  esac
}

# ---------------------------------------------------------------------------
# ## demonstrate_wrong_grep
# Show that grep "violation" misclassifies the success string. Observed FAIL
# of the wrong predicate is required evidence before trusting the anchored one.
# ---------------------------------------------------------------------------
# @description Prove the bare-word grep is a false positive on the success
#   fixture while the anchored classifier correctly reports HOLDS.
# @stderr control result or failure diagnostic
# @exitcode 0 control behaved as expected; 1 mismatch; 2 fixture missing
demonstrate_wrong_grep() {
  local f="${FIXTURES_DIR}/success-contains-violation.txt"
  [[ -f "${f}" ]] || die "missing fixture ${f}"
  local wrong=0
  if grep -q "violation" "${f}"; then
    wrong=1
  fi
  local right
  right="$(classify_output "${f}")"
  if [[ "${wrong}" -eq 1 && "${right}" == "HOLDS" ]]; then
    log "control OK: bare grep \"violation\" is WRONG on success string; anchored classifier → HOLDS"
    return 0
  fi
  fail "wrong-grep control failed (wrong=${wrong} right=${right})"
  return 1
}

# ---------------------------------------------------------------------------
# ## run_classifier_controls
# Positive controls: known-violating → VIOLATED, known-holding → HOLDS,
# truncated → ERROR. Abort the suite if any misclassifies.
# ---------------------------------------------------------------------------
# @description Validate the classifier against fixed positive, holding, and
#   truncated fixtures, optional live fixtures, and the wrong-grep control.
# @stderr per-control results and failure diagnostics
# @exitcode 0 all controls pass; 1 a control fails; 2 a required fixture is missing
run_classifier_controls() {
  local c v h e
  log "--- classifier positive controls ---"

  v="$(classify_output "${FIXTURES_DIR}/classifier-violating.txt")"
  h="$(classify_output "${FIXTURES_DIR}/classifier-holding.txt")"
  e="$(classify_output "${FIXTURES_DIR}/classifier-truncated.txt")"
  local e2
  e2="$(classify_output "${FIXTURES_DIR}/classifier-truncated-partial.txt")"

  if [[ "${v}" != "VIOLATED" ]]; then
    fail "fixture classifier-violating.txt classified as ${v}, want VIOLATED"
    return 1
  fi
  log "control OK: known-violating fixture → VIOLATED"

  if [[ "${h}" != "HOLDS" ]]; then
    fail "fixture classifier-holding.txt classified as ${h}, want HOLDS"
    return 1
  fi
  log "control OK: known-holding fixture → HOLDS"

  if [[ "${e}" != "ERROR" ]]; then
    fail "fixture classifier-truncated.txt classified as ${e}, want ERROR"
    return 1
  fi
  log "control OK: truncated/tooling fixture → ERROR"

  if [[ "${e2}" != "ERROR" ]]; then
    fail "fixture classifier-truncated-partial.txt classified as ${e2}, want ERROR"
    return 1
  fi
  log "control OK: partial output → ERROR"

  # Live fixtures from real quint runs (if present).
  if [[ -f "${FIXTURES_DIR}/known-violating.out" ]]; then
    c="$(classify_output "${FIXTURES_DIR}/known-violating.out")"
    if [[ "${c}" != "VIOLATED" ]]; then
      fail "known-violating.out classified as ${c}, want VIOLATED"
      return 1
    fi
    log "control OK: live known-violating.out → VIOLATED"
  fi
  if [[ -f "${FIXTURES_DIR}/known-holding.out" ]]; then
    c="$(classify_output "${FIXTURES_DIR}/known-holding.out")"
    if [[ "${c}" != "HOLDS" ]]; then
      fail "known-holding.out classified as ${c}, want HOLDS"
      return 1
    fi
    log "control OK: live known-holding.out → HOLDS"
  fi

  demonstrate_wrong_grep || return 1
  return 0
}

# ---------------------------------------------------------------------------
# ## check_vacuous_registry
# Fail if any gating/selected manifest row cites a registered vacuous predicate
# for the property it cannot answer. Also used to report VACUOUS when a row
# would treat rework_rounds_bounded as an UNVERIFIED-loop termination check.
# ---------------------------------------------------------------------------
# @description Reject gating expectations that rely on registered vacuous
#   predicates and require the seeded rework-rounds vacuity entry.
# @stderr registry evidence, vacuity guidance, and failure diagnostics
# @exitcode 0 registry is sound; 1 a vacuity check fails; 2 registry file missing
check_vacuous_registry() {
  [[ -f "${VACUOUS}" ]] || die "missing ${VACUOUS}"
  [[ -f "${EXPECTATIONS}" ]] || die "missing ${EXPECTATIONS}"

  local pred cannot use ev
  local bad=0
  while IFS=$'\t' read -r pred cannot use ev || [[ -n "${pred:-}" ]]; do
    [[ -z "${pred}" || "${pred}" == \#* || "${pred}" == "predicate" ]] && continue
    # Scan expectation invariants for the vacuous predicate used as if it answered cannot_answer.
    # Manifest must not list rework_rounds_bounded for the UNVERIFIED-loop property.
    if awk -F'\t' -v p="${pred}" 'NR>1 && $1 !~ /^#/ && $3==p && $8=="yes" {found=1} END{exit !found}' "${EXPECTATIONS}"; then
      fail "vacuous predicate '${pred}' appears as a gating invariant; use '${use}' for '${cannot}'"
      log "  evidence: ${ev}"
      bad=1
    fi
  done < "${VACUOUS}"

  # Explicit self-check: confirm registry entry for rework_rounds_bounded exists.
  if ! awk -F'\t' '$1=="rework_rounds_bounded" {found=1} END{exit !found}' "${VACUOUS}"; then
    fail "vacuous registry missing rework_rounds_bounded seed entry"
    bad=1
  else
    log "vacuous registry: rework_rounds_bounded → use audit_attempts_bounded_by_three for UNVERIFIED-loop"
  fi

  # Observed VACUOUS classification demo: holding without constrained counter advancing.
  # We do not run the vacuous predicate as a gate; we record the classification rule.
  log "vacuity rule: if an invariant holds while its constrained state never advances, report VACUOUS not HOLDS"
  log "vacuity seed: rework_rounds_bounded under always-error auditor is VACUOUS for termination (round never advances)"

  return "${bad}"
}

# ---------------------------------------------------------------------------
# ## typecheck_all
# Typecheck every .qnt under formal/specs/ with the pinned quint.
# ---------------------------------------------------------------------------
# @description Typecheck every formal specification with the resolved pinned
#   Quint executable, continuing through files to report all failures.
# @arg $1 resolved Quint executable path
# @stderr per-model progress and any typechecker output
# @exitcode 0 all models typecheck; 1 one or more models fail
typecheck_all() {
  local quint_bin="$1"
  local f rc=0
  log "--- typecheck all models ---"
  shopt -s nullglob
  for f in "${SPECS_DIR}"/*.qnt; do
    log "typecheck $(basename "${f}")"
    if ! "${quint_bin}" typecheck "${f}" >/tmp/formal-typecheck.out 2>&1; then
      fail "typecheck failed: ${f}"
      cat /tmp/formal-typecheck.out >&2 || true
      rc=1
    else
      log "  OK $(basename "${f}")"
    fi
  done
  shopt -u nullglob
  return "${rc}"
}

# ---------------------------------------------------------------------------
# ## parse_bound
# Parse bound field into samples/steps or depth.
# ---------------------------------------------------------------------------
# @description Extract the sample count before "x" from a simulation bound.
# @arg $1 simulation bound in samplesxsteps form
# @stdout sample count
parse_bound_samples() {
  local bound="$1"
  printf '%s\n' "${bound%%x*}"
}
# @description Extract the step count after "x" from a simulation bound.
# @arg $1 simulation bound in samplesxsteps form
# @stdout step count
parse_bound_steps() {
  local bound="$1"
  printf '%s\n' "${bound##*x}"
}
# @description Remove the depth= prefix from an Apalache bound.
# @arg $1 Apalache bound in depth=N form
# @stdout depth value
parse_bound_depth() {
  local bound="$1"
  printf '%s\n' "${bound#depth=}"
}

# ---------------------------------------------------------------------------
# ## build_quint_args
# Build the quint argv for a manifest entrypoint + method + bound.
# Requires explicit entrypoint (main= and/or init=/step=). Refuses blank.
# ---------------------------------------------------------------------------
# @description Validate one manifest row and assemble its Quint invocation in
#   the global QUINT_CMD array for simulation or Apalache verification.
# @arg $1 resolved Quint executable path
# @arg $2 model name without the .qnt suffix
# @arg $3 comma-separated main=, init=, or step= entrypoint tokens
# @arg $4 invariant name
# @arg $5 method: simulation or apalache
# @arg $6 method-specific bound
# @stderr missing-model or invalid-entrypoint diagnostics
# @exitcode 0 command assembled; 1 row cannot produce a valid command
build_quint_cmd() {
  local quint_bin="$1"
  local model="$2"
  local entrypoint="$3"
  local invariant="$4"
  local method="$5"
  local bound="$6"

  local spec="${SPECS_DIR}/${model}.qnt"
  [[ -f "${spec}" ]] || { log "missing spec ${spec}"; return 1; }
  [[ -n "${entrypoint}" && "${entrypoint}" != "-" ]] || {
    log "refusing row with empty entrypoint for model=${model} invariant=${invariant}"
    return 1
  }

  local -a cmd=("${quint_bin}")
  local verb="run"
  if [[ "${method}" == "apalache" ]]; then
    verb="verify"
  fi
  cmd+=("${verb}" "${spec}")

  # Parse entrypoint tokens: main=X, init=Y, step=Z (comma-separated)
  local part
  IFS=',' read -ra parts <<< "${entrypoint}"
  local has_entry=0
  for part in "${parts[@]}"; do
    case "${part}" in
      main=*)
        cmd+=(--main="${part#main=}")
        has_entry=1
        ;;
      init=*)
        cmd+=(--init="${part#init=}")
        has_entry=1
        ;;
      step=*)
        cmd+=(--step="${part#step=}")
        has_entry=1
        ;;
      *)
        log "unknown entrypoint token: ${part}"
        return 1
        ;;
    esac
  done
  if [[ "${has_entry}" -ne 1 ]]; then
    log "entrypoint did not yield main/init/step: ${entrypoint}"
    return 1
  fi

  cmd+=(--invariant="${invariant}")

  if [[ "${method}" == "simulation" ]]; then
    local samples steps
    samples="$(parse_bound_samples "${bound}")"
    steps="$(parse_bound_steps "${bound}")"
    cmd+=(--max-samples="${samples}" --max-steps="${steps}" --backend=rust)
  else
    local depth
    depth="$(parse_bound_depth "${bound}")"
    cmd+=(--max-steps="${depth}")
  fi

  # Print as NUL-safe lines for caller — use a global array instead.
  QUINT_CMD=("${cmd[@]}")
}

# ---------------------------------------------------------------------------
# ## run_bounded
# Run a command with a wall-clock timeout; record PID for owned kill.
# Writes stdout+stderr to $outfile. Returns the command exit code (or 124
# on timeout). Does not use pkill.
# ---------------------------------------------------------------------------
# @description Run a command in a new session under a wall-clock watchdog,
#   recording its PID and killing only its owned process group on timeout.
# @arg $1 timeout in seconds
# @arg $2 combined stdout/stderr output file
# @arg $3... command and arguments
# @exitcode command status, or 124 after timeout
run_bounded() {
  local timeout_s="$1"
  local outfile="$2"
  shift 2
  # Use bash background + sleep watchdog with recorded PID (no pkill -f).
  (
    # New session so we can kill the process group by PGID == PID. setsid does
    # not exist in Git Bash on Windows, where its absence previously made every
    # row die with "setsid: command not found" and classify as ERROR (19 rows,
    # matched=0). Degrade to a plain background spawn there: the timeout path
    # below already falls back from a process-group kill to a single-pid kill,
    # so the only property lost is the group guarantee, and that is worth far
    # more than a suite that cannot run at all.
    if command -v setsid >/dev/null 2>&1; then
      setsid "$@" >"${outfile}" 2>&1 &
    else
      "$@" >"${outfile}" 2>&1 &
    fi
    local child=$!
    # Record in a file the parent can read (subshell isolation).
    printf '%s\n' "${child}" > "${outfile}.pid"
    local waited=0
    while kill -0 "${child}" 2>/dev/null; do
      if [[ "${waited}" -ge "${timeout_s}" ]]; then
        # Timeout: kill owned process group only.
        kill -TERM -- "-${child}" 2>/dev/null || kill -TERM "${child}" 2>/dev/null || true
        sleep 1
        kill -KILL -- "-${child}" 2>/dev/null || kill -KILL "${child}" 2>/dev/null || true
        wait "${child}" 2>/dev/null || true
        printf '\n[formal-runner] TIMEOUT after %ss\n' "${timeout_s}" >>"${outfile}"
        exit 124
      fi
      sleep 1
      waited=$((waited + 1))
    done
    wait "${child}"
    exit $?
  )
  return $?
}

# ---------------------------------------------------------------------------
# ## normalize_expected_label
# Pretty-print expected for reports (keep REACHABLE vocabulary).
# ---------------------------------------------------------------------------
# @description Explain an observed-versus-expected result mismatch in terms of
#   lost model discrimination, a modeled-fix regression, or a generic mismatch.
# @arg $1 raw manifest expectation
# @arg $2 observed classifier result
# @stdout one-line mismatch explanation
mismatch_message() {
  local expected_raw="$1"
  local observed="$2"
  local want
  want="$(expected_to_observed_class "${expected_raw}")"
  if [[ "${want}" == "VIOLATED" && "${observed}" == "HOLDS" ]]; then
    printf 'model lost discriminating power: expected %s (→ VIOLATED) but observed HOLDS\n' "${expected_raw}"
  elif [[ "${want}" == "HOLDS" && "${observed}" == "VIOLATED" ]]; then
    printf 'regression in modelled fix: expected %s (→ HOLDS) but observed VIOLATED\n' "${expected_raw}"
  else
    printf 'outcome mismatch: expected %s (→ %s) observed %s\n' "${expected_raw}" "${want}" "${observed}"
  fi
}

# ---------------------------------------------------------------------------
# ## run_manifest
# Execute selected rows and compare observed vs expected in both directions.
# ---------------------------------------------------------------------------
# @description Execute selected expectation rows with bounded Quint commands,
#   compare anchored outcomes, update suite counters, and write TSV/JSON reports.
# @arg $1 resolved Quint executable path
# @stderr row progress, method-honesty statements, and mismatch diagnostics
run_manifest() {
  local quint_bin="$1"
  mkdir -p "${OUT_DIR}"
  : > "${REPORT_TSV}"
  printf 'model\tentrypoint\tinvariant\texpected\tobserved\tmatch\tmethod\tbound\ttier\tgating\tprovenance\tseconds\tlogfile\n' \
    > "${REPORT_TSV}"

  local line_no=0 data_no=0
  local model entrypoint invariant expected method bound tier gating provenance notes
  local observed want match logfile t0 t1 elapsed timeout_s rc
  local selected

  while IFS=$'\t' read -r model entrypoint invariant expected method bound tier gating provenance notes || [[ -n "${model:-}" ]]; do
    line_no=$((line_no + 1))
    [[ -z "${model}" || "${model}" == \#* || "${model}" == "model" ]] && continue
    data_no=$((data_no + 1))

    if [[ -n "${ROW_FILTER}" && "${data_no}" != "${ROW_FILTER}" ]]; then
      continue
    fi

    selected=0
    if [[ "${tier}" == "${TIER}" ]]; then
      selected=1
    fi
    # schedule tier also runs when explicitly requested; commit is default
    if [[ "${TIER}" == "all-tiers" ]]; then
      selected=1
    fi
    if [[ "${selected}" -eq 0 ]]; then
      ROWS_SKIPPED=$((ROWS_SKIPPED + 1))
      continue
    fi
    if [[ "${gating}" != "yes" && "${INCLUDE_NONGATING}" -eq 0 ]]; then
      ROWS_SKIPPED=$((ROWS_SKIPPED + 1))
      log "skip non-gating row ${data_no}: ${model} ${invariant}"
      continue
    fi

    if [[ "${method}" == "apalache" && "${APALACHE_OK:-0}" -ne 1 ]]; then
      fail "row ${data_no}: apalache ${PINNED_APALACHE_VERSION} required but not present"
      printf '%s\t%s\t%s\t%s\tERROR\tno\t%s\t%s\t%s\t%s\t%s\t0\t\n' \
        "${model}" "${entrypoint}" "${invariant}" "${expected}" \
        "${method}" "${bound}" "${tier}" "${gating}" "${provenance}" >> "${REPORT_TSV}"
      ROWS_RUN=$((ROWS_RUN + 1))
      continue
    fi

    log "--- row ${data_no}: ${model} ${entrypoint} ${invariant} expect=${expected} method=${method} bound=${bound} ---"
    : "${notes:-}"

    if ! build_quint_cmd "${quint_bin}" "${model}" "${entrypoint}" "${invariant}" "${method}" "${bound}"; then
      fail "row ${data_no}: could not build command (entrypoint required)"
      printf '%s\t%s\t%s\t%s\tERROR\tno\t%s\t%s\t%s\t%s\t%s\t0\t\n' \
        "${model}" "${entrypoint}" "${invariant}" "${expected}" \
        "${method}" "${bound}" "${tier}" "${gating}" "${provenance}" >> "${REPORT_TSV}"
      ROWS_RUN=$((ROWS_RUN + 1))
      continue
    fi

    logfile="${OUT_DIR}/row-${data_no}-${model}-${invariant//\//_}.log"
    if [[ "${method}" == "apalache" ]]; then
      timeout_s="${DEFAULT_ROW_TIMEOUT_APALACHE}"
    else
      timeout_s="${DEFAULT_ROW_TIMEOUT_SIM}"
    fi

    t0="$(date +%s)"
    set +e
    run_bounded "${timeout_s}" "${logfile}" "${QUINT_CMD[@]}"
    rc=$?
    set -e
    t1="$(date +%s)"
    elapsed=$((t1 - t0))

    # Track child pid file if present for cleanup bookkeeping.
    if [[ -f "${logfile}.pid" ]]; then
      OWNED_PIDS+=("$(cat "${logfile}.pid")")
      rm -f "${logfile}.pid"
    fi

    observed="$(classify_output "${logfile}")"
    want="$(expected_to_observed_class "${expected}")"

    # Method honesty line.
    if [[ "${observed}" == "HOLDS" ]]; then
      if [[ "${method}" == "simulation" ]]; then
        log "  method: simulation ${bound} samples×steps under Quint ${PINNED_QUINT_VERSION} — no counterexample within bound (not a proof)"
      else
        log "  method: apalache depth ${bound#depth=} under Quint ${PINNED_QUINT_VERSION}/Apalache ${PINNED_APALACHE_VERSION} — no counterexample within N steps (not a proof)"
      fi
    elif [[ "${observed}" == "VIOLATED" ]]; then
      log "  method: ${method} bound=${bound} Quint ${PINNED_QUINT_VERSION} — [violation] observed"
    else
      log "  method: ${method} bound=${bound} — classifier ERROR (rc=${rc}); see ${logfile}"
    fi

    match=no
    if [[ "${observed}" == "${want}" ]]; then
      match=yes
      ROWS_MATCHED=$((ROWS_MATCHED + 1))
      log "  MATCH observed=${observed} expected=${expected} (${elapsed}s)"
    else
      fail "row ${data_no}: $(mismatch_message "${expected}" "${observed}")"
      log "  logfile: ${logfile}"
      # Show anchored lines for diagnosis.
      grep -E '^\[(violation|ok)\]' "${logfile}" >&2 || log "  (no anchored outcome line in log)"
    fi

    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
      "${model}" "${entrypoint}" "${invariant}" "${expected}" \
      "${observed}" "${match}" "${method}" "${bound}" "${tier}" \
      "${gating}" "${provenance}" "${elapsed}" "${logfile}" >> "${REPORT_TSV}"

    ROWS_RUN=$((ROWS_RUN + 1))
  done < "${EXPECTATIONS}"

  # Machine-readable JSON summary for CI upload.
  python3 - <<'PY' "${REPORT_TSV}" "${REPORT_JSON}" "${FAILURES}" "${ROWS_RUN}" "${ROWS_MATCHED}" "${PINNED_QUINT_VERSION}" "${PINNED_APALACHE_VERSION}" "${TIER}"
import json, sys, pathlib
tsv, out, failures, run, matched, qv, av, tier = sys.argv[1:9]
rows = []
text = pathlib.Path(tsv).read_text(encoding="utf-8", errors="replace").splitlines()
if not text:
    pathlib.Path(out).write_text("{}", encoding="utf-8")
    raise SystemExit(0)
headers = text[0].split("\t")
for line in text[1:]:
    if not line.strip():
        continue
    cols = line.split("\t")
    rows.append(dict(zip(headers, cols)))
doc = {
    "quint_version": qv,
    "apalache_version": av,
    "tier": tier,
    "failures": int(failures),
    "rows_run": int(run),
    "rows_matched": int(matched),
    "standing_limits": (
        "Simulation/Apalache results are bounded. A HOLDS row means no "
        "counterexample within the recorded bound — not a proof. Nothing is "
        "established about fairness, torn writes, real subprocess kill, or "
        "hash collisions. M1 eventually_terminal is a no-fairness stuttering "
        "artifact, not a liveness defect."
    ),
    "rows": rows,
}
pathlib.Path(out).write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")
PY
  log "wrote ${REPORT_TSV} and ${REPORT_JSON}"
}

# ---------------------------------------------------------------------------
# ## check_coverage_files_exist
# Soft presence check for coverage.tsv paths (does not implement full drift
# gate against git diff — that is for CI optional step).
# ---------------------------------------------------------------------------
# @description Require the coverage registry and report its number of
#   non-comment model-to-source mappings.
# @stderr coverage-row count or a fatal missing-file error
# @exitcode 0 registry exists; 2 registry missing
check_coverage_registry() {
  [[ -f "${COVERAGE}" ]] || die "missing ${COVERAGE}"
  local n
  n="$(grep -vE '^\s*#|^model\t' "${COVERAGE}" | grep -c . || true)"
  log "coverage registry: ${n} model→source rows"
}

# ---------------------------------------------------------------------------
# ## usage
# ---------------------------------------------------------------------------
# @description Print the script's header-based command-line usage text.
# @stdout usage and exit-code documentation
usage() {
  sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
}

# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
# @description Parse runner options, execute controls and registry checks, then
#   typecheck and run the selected formal-model manifest rows.
# @arg $@ command-line options
# @stderr progress, diagnostics, and final suite summary
# @exitcode 0 selected suite passes; 1 checks fail; 2 invalid usage or environment
main() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --tier)
        TIER="${2:-}"
        shift 2
        ;;
      --all)
        INCLUDE_NONGATING=1
        shift
        ;;
      --typecheck-only)
        TYPECHECK_ONLY=1
        shift
        ;;
      --self-test)
        SELF_TEST_ONLY=1
        shift
        ;;
      --row)
        ROW_FILTER="${2:-}"
        shift 2
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        die "unknown arg: $1"
        ;;
    esac
  done

  case "${TIER}" in
    commit|schedule|all-tiers) ;;
    *) die "invalid --tier ${TIER} (commit|schedule|all-tiers)" ;;
  esac

  mkdir -p "${OUT_DIR}"

  if ! command -v setsid >/dev/null 2>&1; then
    log "setsid unavailable (Git Bash/Windows) -- DEGRADED: rows spawn without their own process group; timeout falls back to a single-pid kill"
  fi

  # --- controls first; abort before any real row if classifier is unsound ---
  if ! run_classifier_controls; then
    log "classifier controls failed — aborting without running the manifest"
    exit 1
  fi

  if ! check_vacuous_registry; then
    log "vacuous-predicate registry check failed"
    # continue to report but will fail overall
  fi
  check_coverage_registry

  if [[ "${SELF_TEST_ONLY}" -eq 1 ]]; then
    if [[ "${FAILURES}" -gt 0 ]]; then
      log "self-test FAILED (${FAILURES} failures)"
      exit 1
    fi
    log "self-test PASSED"
    exit 0
  fi

  local quint_bin
  quint_bin="$(resolve_quint)"
  assert_toolchain "${quint_bin}"

  set +e
  typecheck_all "${quint_bin}"
  local tc_rc=$?
  set -e
  if [[ "${tc_rc}" -ne 0 ]]; then
    FAILURES=$((FAILURES + 1))
  fi

  if [[ "${TYPECHECK_ONLY}" -eq 1 ]]; then
    if [[ "${FAILURES}" -gt 0 ]]; then
      log "typecheck-only FAILED"
      exit 1
    fi
    log "typecheck-only PASSED"
    exit 0
  fi

  run_manifest "${quint_bin}"

  log "=== summary: run=${ROWS_RUN} matched=${ROWS_MATCHED} skipped=${ROWS_SKIPPED} failures=${FAILURES} tier=${TIER} ==="
  if [[ "${FAILURES}" -gt 0 || "${ROWS_MATCHED}" -ne "${ROWS_RUN}" ]]; then
    log "SUITE FAILED"
    exit 1
  fi
  if [[ "${ROWS_RUN}" -eq 0 ]]; then
    fail "no rows executed"
    exit 1
  fi
  log "SUITE PASSED"
  exit 0
}

main "$@"
