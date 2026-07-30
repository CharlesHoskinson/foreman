#!/usr/bin/env bash
# @description Lane completeness gate (bug ledger 2026-07-30 Event 9): refuse a
#   lane whose report was never filled in, or whose worktree still contains a
#   deliberately-sabotaged predicate left behind by an unfinished destructive
#   proof.
#
#   Both failures were observed on the same lane on 2026-07-30. The lane
#   reported success; its summary claimed independent verification. In fact:
#
#     1. FOREMAN_REPORT.md was still the skeleton -- `## Changes`,
#        `## Verification`, `## Evidence` all read `(TBD)`. The lane wrote the
#        report first as briefed, then exhausted its turn before filling it in.
#     2. lane-run.sh contained
#          [[ "$durable_enabled" == "__disabled_for_independent_proof__" ]]
#        a string literal that can never match, so the refusal branch was dead
#        and every unowned dispatch would have proceeded silently. The lane had
#        sabotaged the predicate to prove the test goes RED and its turn ended
#        before the restore.
#
#   Neither is a lie by the worker -- it correctly reported the proof as
#   unfinished. The hazard is that a half-finished destructive proof leaves a
#   filesystem state that LOOKS like completed work in `git status`. This gate
#   makes both conditions mechanically checkable instead of relying on someone
#   reading the prose.
#
# Usage:
#   lane-complete-check.sh WORKTREE
#
# @arg $1 worktree path of the lane worktree to check
# @stdout one LANE_COMPLETE / LANE_INCOMPLETE verdict line, plus a reason per
#   finding
# @exitcode 0 complete; 1 incomplete (findings printed); 2 usage error
set -uo pipefail

WT="${1:-}"
if [[ -z "$WT" || ! -d "$WT" ]]; then
  echo "usage: lane-complete-check.sh WORKTREE" >&2
  exit 2
fi

findings=()

# --- 1. report completeness ------------------------------------------------
# An unfilled placeholder means the lane never wrote its evidence, whatever its
# summary said. Checked mechanically because reading the prose is exactly what
# fails under time pressure.
report="$WT/FOREMAN_REPORT.md"
if [[ ! -f "$report" ]]; then
  findings+=("no FOREMAN_REPORT.md at $report")
else
  # Match a bare placeholder on its own line: "(TBD)", "TBD", "TODO".
  # Deliberately anchored so prose merely discussing the word TBD does not trip.
  if grep -qE '^[[:space:]]*\(?(TBD|TODO)\)?[[:space:]]*$' "$report"; then
    n="$(grep -cE '^[[:space:]]*\(?(TBD|TODO)\)?[[:space:]]*$' "$report")"
    findings+=("FOREMAN_REPORT.md still has $n unfilled placeholder section(s)")
  fi
fi

# --- 2. sabotage sentinels in tracked source -------------------------------
# A destructive proof that ended mid-flight leaves a predicate that can never
# match. These markers are never legitimate in committed source.
if git -C "$WT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  # Search tracked files plus anything staged/untracked-but-added, not the
  # whole tree: build artifacts and vendor dirs are not ours to police.
  while IFS= read -r f; do
    [[ -f "$WT/$f" ]] || continue
    case "$f" in
      *.md) continue ;;   # the ledger and this header quote the markers
    esac
    if grep -qE '__disabled_for_|__proof__|__sabotage__|DO_NOT_COMMIT' "$WT/$f" 2>/dev/null; then
      findings+=("sabotage sentinel present in $f (unfinished destructive proof?)")
    fi
  done < <(git -C "$WT" ls-files 2>/dev/null)
else
  findings+=("$WT is not a git work tree")
fi

if (( ${#findings[@]} > 0 )); then
  printf 'LANE_INCOMPLETE %s\n' "$WT"
  printf '  - %s\n' "${findings[@]}"
  exit 1
fi

printf 'LANE_COMPLETE %s\n' "$WT"
exit 0
