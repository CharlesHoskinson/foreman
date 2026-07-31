#!/usr/bin/env bash
# @description Bash entry points for the GraphStore port (files-only default).
#   Thin wrapper around skills/foreman/graph_store (Python, stdlib only).
#   Foreman core never imports a TerminusDB client; store consumers call these
#   helpers or the Python port directly.
#
# Environment:
#   FOREMAN_GRAPH_STORE       files_only (default) | terminusdb (deferred — errors)
#   FOREMAN_GRAPH_STORE_ROOT  materialisation directory for files-only
#   FOREMAN_HOME              used only if a future adapter needs run state
#
# Optional capabilities (queried, never assumed):
#   time_travel, branch_merge, cross_run_query
# Files-only reports all three unavailable.

set -euo pipefail

# @description Resolve the directory that contains the graph_store Python package.
# @stdout absolute path to skills/foreman (parent of graph_store/)
_gs_pkg_parent() {
  local here
  here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  # .../skills/foreman/scripts/lib → .../skills/foreman
  cd "$here/../.." && pwd
}

# @description Run a graph_store module command.
# @arg $@ forwarded to python -m graph_store
# @return exit status of the Python process
gs_python() {
  local parent
  parent="$(_gs_pkg_parent)"
  PYTHONPATH="${parent}${PYTHONPATH:+:$PYTHONPATH}" python3 -m graph_store "$@"
}

# @description Run the backend-agnostic port conformance suite against files-only.
# @return 0 on full pass; non-zero if any case fails
gs_contract_files_only() {
  gs_python contract files_only
}

# @description Run the suite against the broken stub; expect failure (soundness).
# @return 0 when the suite fails the stub for real reasons; non-zero otherwise
gs_contract_stub_expect_fail() {
  gs_python contract stub --expect-fail
}

# @description Open the default backend with no store configured and smoke-test it.
# @return 0 when files-only opens, writes, queries, and degrades on time-travel
gs_smoke_no_store() {
  unset FOREMAN_GRAPH_STORE || true
  gs_python smoke
}

# @description Print optional capabilities of the active backend as JSON.
gs_capabilities() {
  gs_python capabilities
}

# @description Normalise a version reference; reject the silent-empty branch: form.
# @arg $1 version reference
# @return 0 if accepted; 1 if rejected
gs_version_ref() {
  gs_python version-ref "$1"
}
