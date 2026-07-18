#!/usr/bin/env bash
# @description Setup & Environment stage wrapper (v0.2.7.5 lifecycle-three-stage,
#   Task 3): a pure, idempotent READ of env/tool-check.sh's readiness verdict.
#   Setup owns vendor authentication per spec R2 ("Setup owns all model
#   authentication"), but this script NEVER authenticates anything itself --
#   device/interactive auth (`grok login --device-code`, `codex login`,
#   `claude auth login`) is an OPERATOR action this script only INSTRUCTS, per
#   the spec's "emit a clear, actionable ... instruction and mark that vendor
#   NOT-READY" clause. auth-probes.md documents why: none of the three CLIs
#   offers a safe, non-interactive, headless auto-login this script could
#   drive blindly. Composes env/tool-check.sh rather than re-implementing its
#   checks (plan architecture: "two thin wrapper scripts COMPOSE existing
#   scripts ... not a rewrite"). Idempotent by construction: this script
#   mutates nothing on disk, so two runs against an unchanged host print
#   byte-identical verdicts (spec: "a second run ... shall change nothing and
#   re-report READY").
#
#   --lane SCOPING: without --lane, readiness is the WHOLE profile's
#   tool-check verdict (every must-tool, including non-vendor ones, must be
#   ok) -- this is the holistic "run Setup before any Use" check. With
#   --lane <vendor>, readiness is scoped SOLELY to that vendor's own
#   LANE_READY signal (env/tool-check.sh --lane, Task 2) -- an unrelated
#   must-tool failure elsewhere (e.g. a different vendor not yet signed in,
#   or a docs tool missing) never blocks a lane whose OWN vendor is already
#   authenticated. This scoped mode is what lets a caller ask "is JUST the
#   grok lane ready" without being coupled to the rest of the host's
#   provisioning state -- matching spec R1's "the readiness verdict SHALL be
#   NOT-READY for THAT LANE" (lane-scoped, not whole-host).
# Usage: foreman-setup.sh [--profile soft|hard|full] [--lane grok|codex|claude]
# @exitcode 0 READY (see --lane SCOPING above for what "ready" means here)
# @exitcode 1 NOT-READY -- see the printed NOT-READY line(s) for which
#   vendor(s)/tools are blocking, and the instruction to fix each
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

# Three levels up from skills/foreman/scripts (mirrors lane-run.sh's own
# lane_resolve_launcher repo-root resolution) -- independent of the caller's
# cwd, so this script works the same regardless of where it is invoked from.
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
TOOL_CHECK="$REPO_ROOT/env/tool-check.sh"

PROFILE="soft"
LANE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile) PROFILE="$2"; shift 2 ;;
    --lane) LANE="$2"; shift 2 ;;
    -h|--help)
      echo "usage: foreman-setup.sh [--profile soft|hard|full] [--lane grok|codex|claude]"
      exit 0
      ;;
    *) die "$EXIT_CONFIG" "unknown arg: $1" ;;
  esac
done

# @description Map a vendor id to its operator-facing, non-billing auth
#   instruction (auth-probes.md: the real login subcommand for each CLI --
#   never a headless/automated login attempt run BY this script).
# @arg $1 vendor id (grok|codex|claude)
# @stdout the instruction text; a generic fallback for an unrecognized id
fs_auth_instruction() {
  case "$1" in
    grok) echo "grok login --device-code" ;;
    codex) echo "codex login" ;;
    claude) echo "claude auth login" ;;
    *) echo "(no known auth instruction for $1)" ;;
  esac
}

tc_args=(--profile "$PROFILE")
[[ -n "$LANE" ]] && tc_args+=(--lane "$LANE")

# Split assignment (portability checklist): a bare `report="$(cmd)"` would
# abort this script under `set -e` the instant tool-check.sh exits nonzero
# (its normal NOT-READY exit code) -- the `|| tc_rc=$?` alternative path
# keeps the compound command's own status 0 while still capturing the real
# rc for later use.
tc_rc=0
report="$(bash "$TOOL_CHECK" "${tc_args[@]}" 2>&1)" || tc_rc=$?
echo "$report"

rc=0

# Per-vendor NOT-READY instructions: always derived from tool-check's own
# NOT_AUTHENTICATED line (Task 1), regardless of --lane, so an operator
# running a whole-host Setup check sees every vendor that needs attention,
# not just one.
not_auth_line="$(grep -m1 '^NOT_AUTHENTICATED: ' <<<"$report" || true)"
if [[ -n "$not_auth_line" ]]; then
  ids="${not_auth_line#NOT_AUTHENTICATED: }"
  for v in $ids; do
    echo "$v: NOT-READY -- run $(fs_auth_instruction "$v")"
  done
fi

if [[ -n "$LANE" ]]; then
  # Lane-scoped gate (see header SCOPING note): authoritative on the SCOPED
  # lane's own LANE_READY signal only -- deliberately NOT folded together
  # with tc_rc, so an unrelated must-tool failure elsewhere never blocks a
  # lane whose own vendor is already ready.
  lane_line="$(grep -m1 "^LANE_READY: ${LANE}=" <<<"$report" || true)"
  if [[ "$lane_line" == *"=yes" ]]; then
    rc=0
  else
    rc=1
  fi
else
  # Whole-profile gate: mirrors tool-check's own overall verdict exactly.
  if (( tc_rc != 0 )); then
    rc=1
  fi
fi

if (( rc == 0 )); then
  echo "SETUP: READY"
else
  echo "SETUP: NOT-READY"
fi
exit "$rc"
