#!/usr/bin/env bash
# @description Merge-freshness gate (v0.2.5 T6): record a lane's merge-base
#   with origin/main at dispatch, then re-verify it just before merge. Closes
#   a gap wt-merge.sh alone cannot see: wt-merge.sh only checks for a
#   *content* overlap conflict between the incoming branch and the current
#   target index -- it says nothing about whether the incoming branch's
#   *history* has anything in common with current origin/main at all. A lane
#   dispatched from a stale or genuinely divergent base (e.g. a second root
#   commit) can still squash-merge cleanly today. No auto-salvage: a
#   NOT_MERGEABLE verdict prints the respawn-from-fresh-base recommendation
#   and stops -- this script never rebases, force-merges, or otherwise
#   repairs history itself.
#
# Usage:
#   merge-gate.sh record RUN LANE           # at dispatch time
#   merge-gate.sh check  RUN LANE BRANCH    # pre-merge, just before wt-merge.sh
#
# record RUN LANE
#   Emits one `merge_base` event -- payload {merge_base:<sha>,
#   degraded:<bool>} -- where sha is `git merge-base HEAD origin/main`. HEAD
#   is resolved relative to the caller's CURRENT WORKING DIRECTORY (the lane
#   worktree, at dispatch time) -- deliberately NOT forced to the repo root,
#   so each lane worktree records its own branch tip's merge-base. Degrade
#   path: when origin/main does not exist (no remote configured -- every
#   throwaway test repo, and some solo-dev clones), sha falls back to HEAD's
#   own commit and payload.degraded is true; this is a NOTED degrade, not a
#   failure -- an origin-less repo still needs some recorded base for the
#   ancestor check in `check` to have anything to verify against.
#   Remote-lane preflight doctrine: a caller dispatching a lane MUST reject
#   the dispatch outright when `record` itself fails (non-zero exit) -- a
#   lane with no recorded merge-base can never pass `check` (see: "no
#   recorded merge-base" below), so fail it at dispatch, not silently at
#   merge time.
#
# check RUN LANE BRANCH
#   Reads the run/lane's MOST RECENTLY recorded merge_base event and
#   re-verifies three conditions against BRANCH (the lane branch about to be
#   merged):
#     (a) the recorded sha still resolves to a commit (`git cat-file -e`) --
#         catches a rewritten/pruned/gc'd history the recording could not
#         foresee.
#     (b) BRANCH contains the recorded sha (`git merge-base --is-ancestor`)
#         -- catches parallel/unrelated history (e.g. an orphan branch): if
#         BRANCH's own history never passed through the recorded
#         merge-base, nothing about it is safe to squash onto current main.
#     (c) staleness bound: the recorded sha is not more than
#         `durable.merge_base_max_commits` (config allowlist, BOTH tables,
#         default 50, env MERGE_BASE_MAX_COMMITS) commits behind the
#         CURRENT origin/main -- catches a lane dispatched so long ago that
#         main has drifted past a safe auto-merge window, even when history
#         is technically linear. Skipped (not evaluated) when origin/main is
#         itself absent -- same degrade posture as `record`.
#   Prints EXACTLY one line to stdout: `MERGEABLE`, or
#   `NOT_MERGEABLE:<reason> -- <respawn recommendation>`. No auto-salvage:
#   that is the only thing check ever prints on a failing verdict -- no
#   extra diagnostics, no partial success. Exit 0 (MERGEABLE) or 6
#   (NOT_MERGEABLE).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"
# shellcheck source=lib/eventlog.sh
source "$SCRIPT_DIR/lib/eventlog.sh"
# shellcheck source=lib/config.sh
source "$SCRIPT_DIR/lib/config.sh"

require_cmd git
require_cmd jq

readonly EXIT_NOT_MERGEABLE=6
readonly RESPAWN_HINT="respawn from a fresh base (dispatch a new lane worktree from current origin/main)"
RELEASE_BLOCK=()

validate_release_block() {
  (( ${#RELEASE_BLOCK[@]} == 0 )) && return 0
  (( ${#RELEASE_BLOCK[@]} == 28 )) \
    || die "$EXIT_CONFIG" "merge-gate: invalid release block"
  local expected=(
    --endstop-state-root --endstop-contract-id --endstop-contract-sha
    --endstop-family-sha --endstop-child-id --endstop-action
    --endstop-candidate-sha --release-program --release-phase
    --release-owner --release-repo --release-candidate-commit
    --release-register --release-evidence
  )
  local i
  for i in "${!expected[@]}"; do
    [[ "${RELEASE_BLOCK[i * 2]}" == "${expected[i]}" ]] \
      || die "$EXIT_CONFIG" "merge-gate: invalid release block"
  done
}

# @description Print the one-and-only NOT_MERGEABLE line and exit 6. No
#   auto-salvage: this is the entirety of check's failure output.
# @arg $1 reason short human-readable reason
not_mergeable() {
  printf 'NOT_MERGEABLE:%s -- %s\n' "$1" "$RESPAWN_HINT"
  exit "$EXIT_NOT_MERGEABLE"
}

# @description `record RUN LANE`: emit the merge_base event for the caller's
#   cwd HEAD against origin/main (or HEAD itself, degraded, when origin/main
#   is absent).
# @arg $1 run id  @arg $2 lane id
# @stdout the recorded sha
cmd_record() {
  local run="$1" lane="$2"
  local sha degraded=false
  git_nohooks rev-parse HEAD >/dev/null 2>&1 \
    || die "$EXIT_FAIL" "merge-gate: cannot resolve HEAD (cwd not a git worktree?)"
  if git_nohooks rev-parse --verify -q origin/main >/dev/null 2>&1; then
    sha="$(git_nohooks merge-base HEAD origin/main)" \
      || die "$EXIT_FAIL" "merge-gate: merge-base HEAD origin/main failed"
  else
    sha="$(git_nohooks rev-parse HEAD)"
    degraded=true
    log "merge-gate: origin/main not found for $run/$lane -- degrading to HEAD's own sha ($sha)"
  fi
  local payload
  payload="$(jq -cn --arg sha "$sha" --argjson degraded "$degraded" '{merge_base:$sha, degraded:$degraded}')"
  el_emit "$run" merge_base "$lane" "$payload" >/dev/null \
    || die "$EXIT_FAIL" "merge-gate: el_emit merge_base failed for $run/$lane"
  echo "$sha"
}

# @description `check RUN LANE BRANCH`: re-verify the most recently recorded
#   merge-base for run/lane against BRANCH.
# @arg $1 run id  @arg $2 lane id  @arg $3 branch to verify
# @stdout MERGEABLE, or NOT_MERGEABLE:<reason> -- <hint>
# @exitcode 0 MERGEABLE  @exitcode 6 NOT_MERGEABLE
cmd_check() {
  local run="$1" lane="$2" branch="$3"
  git_nohooks rev-parse --verify -q "$branch" >/dev/null 2>&1 \
    || die "$EXIT_CONFIG" "merge-gate: unknown branch: $branch"

  cfg_load
  local max_commits
  max_commits="$(cfg_get durable merge_base_max_commits 50)"

  # Most recently recorded merge_base event for this run/lane. el_read never
  # lists ignored/nonexistent data by itself; a run with no events.jsonl
  # simply yields nothing here, and the empty-sha check below turns that
  # into a clean NOT_MERGEABLE verdict rather than a crash.
  # T7 audit nit (corrupt-log case): a CORRUPT log -- el_read rc=2, a
  # malformed/torn line anywhere in events.jsonl -- is a DIFFERENT case that
  # must be guarded explicitly. Under `set -euo pipefail`, an unguarded
  # `sha=$(el_read ... | jq ... | tail -1)` lets el_read's own nonzero rc
  # abort THIS SCRIPT mid-contract before the empty-sha check below ever
  # runs (empirically confirmed: `f(){ return 2; }; out="$(f | cat)"` under
  # `set -euo pipefail` exits the script immediately, printing nothing) --
  # breaking the "prints exactly one NOT_MERGEABLE line, or MERGEABLE, never
  # anything else" contract this function's own header promises. The
  # `|| read_rc=$?` form (same required if/||-guarded-assignment pattern
  # lane-run.sh's own ckpt_snapshot capture uses) captures el_read's
  # pipeline exit status without tripping errexit, so a corrupt log now
  # yields a clean NOT_MERGEABLE verdict instead of an uncontracted crash.
  local sha read_rc=0
  sha="$(el_read "$run" 0 2>/dev/null \
    | jq -r --arg lane "$lane" \
        'select(.type=="merge_base" and .lane==$lane) | .payload.merge_base' \
    | tail -1)" || read_rc=$?
  (( read_rc != 0 )) && not_mergeable "corrupt or unreadable event log for $run/$lane"
  [[ -n "$sha" && "$sha" != "null" ]] \
    || not_mergeable "no recorded merge-base for $run/$lane"

  git_nohooks cat-file -e "${sha}^{commit}" 2>/dev/null \
    || not_mergeable "recorded merge-base $sha no longer resolves to a commit"

  git_nohooks merge-base --is-ancestor "$sha" "$branch" 2>/dev/null \
    || not_mergeable "parallel history -- $branch does not contain recorded merge-base $sha"

  if git_nohooks rev-parse --verify -q origin/main >/dev/null 2>&1; then
    local behind
    behind="$(git_nohooks rev-list --count "${sha}..origin/main")"
    if (( behind > max_commits )); then
      not_mergeable "stale base -- $behind commits behind origin/main (max $max_commits)"
    fi
  fi

  if (( ${#RELEASE_BLOCK[@]} == 28 )); then
    [[ "${RELEASE_BLOCK[11]}" == "integrate" ]] \
      || not_mergeable "release policy expected integrate action"
    local branch_commit
    branch_commit="$(git_nohooks rev-parse "${branch}^{commit}" 2>/dev/null)" \
      || not_mergeable "candidate branch does not resolve"
    [[ "$branch_commit" == "${RELEASE_BLOCK[23]}" ]] \
      || not_mergeable "candidate branch commit does not match release block"
    "$SCRIPT_DIR/lib/release-policy.sh" \
      "${RELEASE_BLOCK[1]}" "${RELEASE_BLOCK[3]}" \
      "${RELEASE_BLOCK[5]}" "${RELEASE_BLOCK[7]}" \
      "${RELEASE_BLOCK[9]}" "${RELEASE_BLOCK[11]}" \
      "${RELEASE_BLOCK[13]}" "${RELEASE_BLOCK[15]}" \
      "${RELEASE_BLOCK[17]}" "${RELEASE_BLOCK[19]}" \
      "${RELEASE_BLOCK[21]}" "${RELEASE_BLOCK[23]}" \
      "${RELEASE_BLOCK[25]}" "${RELEASE_BLOCK[27]}" \
      >/dev/null 2>&1 \
      || not_mergeable "release policy refused integration"
  fi

  echo "MERGEABLE"
}

SUB="${1:-}"
shift || true
case "$SUB" in
  record)
    RUN="${1:?usage: merge-gate.sh record RUN LANE}"
    LANE="${2:?usage: merge-gate.sh record RUN LANE}"
    cmd_record "$RUN" "$LANE"
    ;;
  check)
    RUN="${1:?usage: merge-gate.sh check RUN LANE BRANCH}"
    LANE="${2:?usage: merge-gate.sh check RUN LANE BRANCH}"
    BRANCH="${3:?usage: merge-gate.sh check RUN LANE BRANCH}"
    shift 3
    RELEASE_BLOCK=("$@")
    validate_release_block
    cmd_check "$RUN" "$LANE" "$BRANCH"
    ;;
  *)
    echo "usage: merge-gate.sh record RUN LANE | check RUN LANE BRANCH" >&2
    exit "$EXIT_CONFIG"
    ;;
esac
