#!/usr/bin/env bash
# @description Fail when the installed foreman skill is missing files the repo
#   ships. The installed plugin once lacked fm-session.py and the whole ontology
#   directory while nothing reported a problem.
# @arg $1 installed skill directory
# @arg $2 repo skill directory (skills/foreman)
# @exitcode 0 no drift; 1 drift found; 2 usage error
set -euo pipefail

installed="${1:-}"
repo="${2:-}"
if [[ -z "$installed" || -z "$repo" ]]; then
  echo "usage: plugin-drift.sh INSTALLED_DIR REPO_SKILL_DIR" >&2
  exit 2
fi
if [[ ! -d "$repo" ]]; then
  echo "not a directory: $repo" >&2
  exit 2
fi
if [[ ! -d "$installed" ]]; then
  echo "MISSING (entire install): $installed" >&2
  exit 1
fi

missing=0
while IFS= read -r rel; do
  if [[ ! -e "$installed/$rel" ]]; then
    echo "MISSING $rel"
    missing=$((missing + 1))
  fi
done < <(cd "$repo" && find . -type f -printf '%P\n' | sort)

if (( missing > 0 )); then
  echo "plugin-drift: $missing file(s) missing from the install"
  exit 1
fi
echo "plugin-drift: no drift"
