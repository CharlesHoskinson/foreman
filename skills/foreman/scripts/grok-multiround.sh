#!/usr/bin/env bash
# @description Bounded re-prompt loop for grok's single-burst `--prompt-file`
#   invocation (agents/grok-implementer.md "Single-burst: write-first
#   specs"). A single grok burst reads the spec, may narrate orientation,
#   and exits -- there is no follow-up turn. For genuinely exploratory specs
#   (grok must read/introspect before it can write), this helper re-issues
#   the spec across a bounded number of rounds, feeding forward a preamble
#   that tells grok the prior round produced no file changes and it must
#   write now instead of reading again. "Did grok write anything" is
#   detected via a content digest of worker-owned paths in the target working
#   dir, never by parsing grok's own narration.
# Usage: grok-multiround.sh SPEC [--max-rounds N] -- GROK_CMD [ARGS...]
#   SPEC          path to the five-part spec file (round 1 prompt, verbatim)
#   --max-rounds  bounded round budget (default 3)
#   GROK_CMD ...  the grok binary and its fixed args (e.g. --cwd WORKDIR);
#                 this helper appends `--prompt-file ROUND_SPEC` itself --
#                 do NOT pass --prompt-file in GROK_CMD's own args.
# @exitcode 0 a file change was observed within the round budget (prints
#   "grok-multiround: files changed (rounds=N)" on stdout)
# @exitcode 1 (EXIT_FAIL) no file change after the full round budget -- an
#   EMPTY-BURST FAILED: grok narrated orientation every round but never wrote
# @exitcode 2 (EXIT_CONFIG) bad usage (missing SPEC/GROK_CMD, unknown flag)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"
# shellcheck source=lib/evidence.sh
source "$SCRIPT_DIR/lib/evidence.sh"

[[ $# -ge 1 ]] || die "$EXIT_CONFIG" "usage: grok-multiround.sh SPEC [--max-rounds N] -- GROK_CMD [ARGS...]"
SPEC="$1"; shift
[[ -f "$SPEC" ]] || die "$EXIT_CONFIG" "spec file not found: $SPEC"

MAX_ROUNDS=3
while [[ $# -gt 0 ]]; do
  case "$1" in
    --max-rounds)
      MAX_ROUNDS="${2:?--max-rounds needs a value}"
      shift 2
      ;;
    --)
      shift
      break
      ;;
    *)
      die "$EXIT_CONFIG" "unknown arg: $1 (expected --max-rounds N or --)"
      ;;
  esac
done
[[ $# -ge 1 ]] || die "$EXIT_CONFIG" "no GROK_CMD given after --"
GROK_ARGV=("$@")
[[ "$MAX_ROUNDS" =~ ^[1-9][0-9]*$ ]] || die "$EXIT_CONFIG" "--max-rounds must be a positive integer, got: $MAX_ROUNDS"

# Work dir: a --cwd DIR inside GROK_ARGV, else the caller's own cwd. The bounds
# check (i+1 < len) makes a trailing bare --cwd a clean no-op, not a set-u abort.
WD="$(pwd)"
i=0
while [[ $i -lt ${#GROK_ARGV[@]} ]]; do
  if [[ "${GROK_ARGV[$i]}" == "--cwd" && $((i+1)) -lt ${#GROK_ARGV[@]} ]]; then
    WD="${GROK_ARGV[$((i+1))]}"
  fi
  i=$((i+1))
done
# files_changed uses git status to identify its worker-owned evidence set, so
# WD MUST be a git work tree. Fail loudly up front rather than silently report
# EMPTY-BURST FAILED when the evidence set cannot be enumerated.
git -C "$WD" rev-parse --is-inside-work-tree >/dev/null 2>&1 \
  || die "$EXIT_CONFIG" "grok-multiround: --cwd is not a git work tree ($WD); files_changed detection requires git"

# The caller stages its spec inside the worktree by convention and passes that
# path. Exclude exactly THAT file from the evidence set rather than matching a
# filename pattern: `^SPEC-[^/]*\.md$` is anchored to the root, so
# `d/SPEC-notes.md` counted as work (false SUCCESS), while widening the pattern
# would exclude a lane whose real deliverable is `docs/SPEC-foo.md` (false
# EMPTY-BURST). The path is known; the pattern was a guess.
SPEC_REL=""
if [[ -n "${SPEC:-}" ]]; then
  _spec_dir="$(cd "$(dirname "$SPEC")" 2>/dev/null && pwd || true)"
  _wd_abs="$(cd "$WD" 2>/dev/null && pwd || true)"
  if [[ -n "$_spec_dir" && -n "$_wd_abs" ]]; then
    _spec_abs="$_spec_dir/$(basename "$SPEC")"
    case "$_spec_abs" in
      "$_wd_abs"/*) SPEC_REL="${_spec_abs#"$_wd_abs"/}" ;;
    esac
  fi
  unset _spec_dir _wd_abs _spec_abs
fi

# @description Paths git reports as changed in WD, EXCLUDING any the harness
#   or the caller manufactured rather than the worker.
#
#   A change detector that counts artifacts created by its own caller reports
#   success for a round that did nothing. Observed 2026-07-30: a spec opening
#   with "write SPEC-NOTES.md first" -- an anti-empty-burst guard -- satisfied
#   this digest by itself. Three lanes recorded round_done exit_code=0 having
#   implemented nothing, and the false green was caught only by diffing the
#   worktrees by hand. The instruction and the checker were authored by the
#   same party, and the instruction defeated the checker.
#
#   Excluded:
#     .harness/**  lane-run's own heartbeat + stream telemetry, written into
#                  the worktree by the supervisor, not by the worker.
#     SPEC_REL     the exact caller-staged spec path (if inside the worktree),
#                  not a filename pattern — so a real deliverable like
#                  docs/SPEC-foo.md still counts as work.
#   Porcelain is NUL-delimited and uses -uall so every untracked file is an
#   individual candidate. Paths stay in an array so unusual names are not
#   split while being passed to the evidence library.
CHANGED_PATHS=()
CHANGED_STATUS=()
# @description Collect worker-owned changed paths and statuses, excluding harness and the exact caller-staged spec path, to define the evidence set used to decide whether a vendor round produced work.
# @exitcode 0 the evidence set was enumerated
# @exitcode 1 enumeration was inconclusive and must not be treated as an empty round
collect_changed_paths() {
  local status_file entry path
  CHANGED_PATHS=()
  CHANGED_STATUS=()
  if ! status_file="$(mktemp -t grok-multiround-status.XXXXXX 2>/dev/null || mktemp -t grok-multiround-status)"; then
    EVIDENCE_STATUS="INCONCLUSIVE"
    EVIDENCE_REASON="status-buffer-create-failed:${WD}"
    return 1
  fi
  if ! git -C "$WD" status --porcelain=v1 -z -uall --no-renames >"$status_file" 2>/dev/null; then
    rm -f "$status_file"
    EVIDENCE_STATUS="INCONCLUSIVE"
    EVIDENCE_REASON="status-enumeration-failed:${WD}"
    return 1
  fi
  while IFS= read -r -d '' entry || [[ -n "${entry:-}" ]]; do
    [[ ${#entry} -ge 4 ]] || continue
    path="${entry:3}"
    [[ "$path" == .harness/* ]] && continue
    [[ -n "$SPEC_REL" && "$path" == "$SPEC_REL" ]] && continue
    CHANGED_PATHS+=("$path")
    CHANGED_STATUS+=("$entry")
  done <"$status_file"
  rm -f "$status_file"
}

# @description Content digest of the filtered worker-owned path set. Artifact
#   mode is intentional: work mode unions every status path back into the set,
#   which would reintroduce the excluded SPEC_REL and .harness/** paths.
# @sets SNAP_DIGEST to a sha256 hex digest
SNAP_DIGEST=""
# @description Digest the filtered worker-owned evidence set so successive snapshots decide whether a vendor round produced work without trusting vendor narration.
# @exitcode 0 SNAP_DIGEST contains the content digest
# @exitcode 1 the evidence set or digest was uncomputable and must fail closed
snap() {
  local digest_file rc
  collect_changed_paths || return 1
  if ! digest_file="$(mktemp -t grok-multiround-digest.XXXXXX 2>/dev/null || mktemp -t grok-multiround-digest)"; then
    EVIDENCE_STATUS="INCONCLUSIVE"
    EVIDENCE_REASON="digest-buffer-create-failed:${WD}"
    return 1
  fi
  if evidence_content_digest "$WD" artifact "${CHANGED_PATHS[@]}" >"$digest_file"; then
    SNAP_DIGEST="$(<"$digest_file")"
    rm -f "$digest_file"
    return 0
  else
    rc=$?
    rm -f "$digest_file"
    return "$rc"
  fi
}

# @description Fail closed when round evidence cannot be measured, rather than misclassifying an unmeasurable vendor round as producing no work.
# @exitcode 1 always; terminates through die with the evidence status and reason
evidence_failure() {
  die "$EXIT_FAIL" "grok-multiround: evidence mechanism failed (${EVIDENCE_STATUS:-INCONCLUSIVE}): ${EVIDENCE_REASON:-unknown-reason}"
}

snap || evidence_failure
before="$SNAP_DIGEST"
LAST_OUT="$(mktemp -t grok-multiround-out.XXXXXX 2>/dev/null || mktemp -t grok-multiround-out)"
GENERATED_SPECS=()
# @description Remove this run's temp files (last-output capture + any
#   generated round>1 spec files) on exit, success or failure alike. Never
#   removes SPEC itself -- round 1 reuses the caller's own SPEC path
#   directly and it is never added to GENERATED_SPECS.
cleanup() { rm -f "$LAST_OUT" "${GENERATED_SPECS[@]:-}"; }
trap cleanup EXIT

round=0
while [[ $round -lt $MAX_ROUNDS ]]; do
  round=$((round+1))
  if [[ $round -eq 1 ]]; then
    ROUND_SPEC="$SPEC"
  else
    ROUND_SPEC="$(mktemp -t grok-multiround-spec.XXXXXX 2>/dev/null || mktemp -t grok-multiround-spec)"
    GENERATED_SPECS+=("$ROUND_SPEC")
    {
      printf 'PRIOR ROUND PRODUCED no file changes and only orientation narration; do NOT read first — Write the deliverable now. Prior output:\n'
      cat "$LAST_OUT" 2>/dev/null || true
      printf '\n---\n'
      cat "$SPEC"
    } > "$ROUND_SPEC"
  fi

  "${GROK_ARGV[@]}" --prompt-file "$ROUND_SPEC" >"$LAST_OUT" 2>&1 || true

  snap || evidence_failure
  after="$SNAP_DIGEST"
  if [[ "$after" != "$before" ]]; then
    n_changed="${#CHANGED_PATHS[@]}"
    echo "grok-multiround: files changed (rounds=$round, paths=$n_changed)"
    if [[ $n_changed -gt 0 ]]; then
      printf 'grok-multiround:   %s\n' "${CHANGED_STATUS[@]}"
    fi
    exit "$EXIT_OK"
  fi
done

FAILED_OUT="${TMPDIR:-/tmp}/grok-multiround-failed.$$.log"
cp -f "$LAST_OUT" "$FAILED_OUT" 2>/dev/null || FAILED_OUT=""
echo "grok-multiround: EMPTY-BURST FAILED after $round rounds — no worker-owned file changed." >&2
if [[ -n "$FAILED_OUT" && -s "$FAILED_OUT" ]]; then
  echo "grok-multiround: the worker's own output is preserved at $FAILED_OUT" >&2
  echo "grok-multiround: --- last 40 lines of that output ---" >&2
  tail -n 40 "$FAILED_OUT" >&2
  echo "grok-multiround: --- end of worker output ---" >&2
else
  echo "grok-multiround: the worker produced NO output at all (not even narration)." >&2
fi
echo "grok-multiround: re-issue a spec whose FIRST instruction names the real deliverable (the source file to edit). Do NOT instruct the worker to create a notes/plan/sentinel file first: this detector excludes such artifacts, and before 2026-07-30 it counted them and reported a false success." >&2
echo "grok-multiround: a round is single-turn. A spec the worker must READ before it can WRITE cannot succeed at any --max-rounds; inline the facts instead of raising the budget." >&2
exit "$EXIT_FAIL"
