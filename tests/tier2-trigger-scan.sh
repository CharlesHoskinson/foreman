#!/usr/bin/env bash
# @description Prove Tier 2 has no workflow, hook, release, or scheduler trigger.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PATTERN='tests/tier2-(compare|collect)\.sh|tier2_(compare|collect)\.py'

if (( $# > 0 )); then
  targets=("$@")
else
  targets=(
    "$REPO_ROOT/.github"
    "$REPO_ROOT/skills/superpowers/hooks"
    "$REPO_ROOT/skills/foreman/scripts"
    "$REPO_ROOT/tools"
    "$REPO_ROOT/env"
    "$REPO_ROOT/install.sh"
    "$REPO_ROOT/install.ps1"
  )
fi

printf 'TRIGGER_SCAN_COMMAND: grep -R -I -E -n -- %q' "$PATTERN"
printf ' %q' "${targets[@]}"
printf '\nTRIGGER_SCAN_OUTPUT_BEGIN\n'
if matches="$(grep -R -I -E -n -- "$PATTERN" "${targets[@]}" 2>&1)"; then
  grep_status=0
else
  grep_status=$?
fi
if [[ -n "$matches" ]]; then
  printf '%s\n' "$matches"
fi
printf 'TRIGGER_SCAN_OUTPUT_END\n'
printf 'TRIGGER_SCAN_RESULT grep_exit=%d output_bytes=%d\n' "$grep_status" "${#matches}"

case "$grep_status" in
  1) [[ -z "$matches" ]] ;;
  0) exit 1 ;;
  *) exit 2 ;;
esac
